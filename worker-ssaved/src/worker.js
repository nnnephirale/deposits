// ssaved — its own Worker
//
// Split out of the deposits Worker on 28 Aug 2026, the day deposits went dark on every device
// at once with Cloudflare error 1027: the free plan's 100,000 requests a day, spent. Both apps
// were behind one Worker, so they shared one daily budget — and SSaved's reads are public by
// design, which means a crawled share link or a left-open tab could spend a journal's quota.
// Same blast radius that took SSaved's Supabase project down and deposits with it.
//
// Two Workers, one bucket. The bucket has no per-app limits worth worrying about (10 GB, and
// downloads are never charged); the request ceiling is per account but a runaway on one Worker
// is now visible as that Worker's own traffic rather than as the other app mysteriously dying.
//
//   ssaved/<collection>/data.json      the cards, without image bytes
//   ssaved/images/<collection>/<id>    one object per screenshot, written once
//
// Reads are unauthenticated on purpose so share links work for people who don't have the
// secret. Writes need it. That is still strictly better than the old setup, where the bucket
// was public and the tables had no row-level security, so anyone with a share link could
// delete the collection.

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), env);
    if (path === "/health") return cors(json({ ok: true, app: "ssaved", configured: !!env.DEPOSITS_SECRET }), env);

    try {
      const m = path.match(/^\/s\/([A-Za-z0-9_-]{1,64})(?:\/img\/([A-Za-z0-9._-]{1,128}))?$/);
      if (m) {
        const [, collection, image] = m;
        if (image) {
          if (request.method === "GET") return cors(await getObject(`ssaved/images/${collection}/${image}`, env, true), env);
          if (!authorized(request, env)) return cors(json({ error: "unauthorized" }, 401), env);
          if (request.method === "PUT") return cors(await putImage(collection, image, request, env), env);
        } else {
          if (request.method === "GET") return cors(await getObject(`ssaved/${collection}/data.json`, env), env);
          if (!authorized(request, env)) return cors(json({ error: "unauthorized" }, 401), env);
          if (request.method === "PUT") return cors(await putData(collection, request, env), env);
        }
        return cors(json({ error: "method not allowed" }, 405), env);
      }
      return cors(json({ error: "not found" }, 404), env);
    } catch (err) {
      return cors(json({ error: String(err && err.message || err) }, 500), env);
    }
  },

  // Two jobs, both of them somebody else's uptime.
  //
  // 1. Keep the Supabase project SSaved still reads from awake. SSaved has no local copy of
  //    its cards, so when that project pauses SSaved is simply down. Its original keep-alive
  //    was a GitHub workflow, and GitHub disables scheduled workflows after 60 days of repo
  //    quiet — which is how it died the first time. Cloudflare's scheduler has no such rule.
  //
  // 2. Watch deposits and say something when it stops answering. deposits is local-first, so
  //    an outage there is silent for days: the app keeps working and simply stops syncing.
  //    A cron on a *different* Worker notices within the hour. It is not a real off-account
  //    monitor — a daily-limit rejection can stop this cron too — which is why the GitHub
  //    Actions check exists alongside it.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(Promise.all([pingSupabase(env), watchDeposits(env)]));
  }
};

// ---------- auth ----------
// The same secret as deposits, deliberately: one credential to hold, and the two apps have
// always shared it. Separate Workers, separate quotas, same key.

function authorized(request, env) {
  const secret = env.DEPOSITS_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  return timingSafeEqual(presented.trim(), String(secret).trim());
}

function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a), bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

// ---------- storage ----------

async function getObject(key, env, isImage) {
  const obj = await env.BUCKET.get(key);
  if (!obj) return json(isImage ? { error: "not found" } : { folders: [], cards: [], etag: null }, isImage ? 404 : 200);
  if (isImage) {
    const headers = new Headers();
    obj.writeHttpMetadata(headers);
    headers.set("etag", obj.httpEtag);
    headers.set("cache-control", "public, max-age=31536000, immutable"); // keys are timestamped, never rewritten
    return new Response(obj.body, { headers });
  }
  const body = await obj.json();
  return new Response(JSON.stringify({ ...body, etag: obj.etag }), {
    headers: { ...JSON_HEADERS, etag: obj.etag }
  });
}

async function putData(collection, request, env) {
  const payload = await request.json();
  if (!payload || !Array.isArray(payload.cards)) {
    return json({ error: "expected { cards: [...], folders: [...] }" }, 400);
  }
  const body = JSON.stringify({
    cards: payload.cards,
    folders: payload.folders || [],
    writtenAt: new Date().toISOString()
  });
  const expected = request.headers.get("if-match");
  const opts = { httpMetadata: { contentType: "application/json" } };
  if (expected && expected !== "*") opts.onlyIf = { etagMatches: expected };

  const put = await env.BUCKET.put(`ssaved/${collection}/data.json`, body, opts);
  if (put === null) {
    const current = await env.BUCKET.head(`ssaved/${collection}/data.json`);
    return json({ error: "conflict", etag: current ? current.etag : null }, 412);
  }
  return json({ ok: true, etag: put.etag, cards: payload.cards.length });
}

async function putImage(collection, image, request, env) {
  const key = `ssaved/images/${collection}/${image}`;
  const existing = await env.BUCKET.head(key);
  if (existing) return json({ ok: true, skipped: true, size: existing.size });
  const body = await request.arrayBuffer();
  if (!body.byteLength) return json({ error: "empty body" }, 400);
  await env.BUCKET.put(key, body, {
    httpMetadata: { contentType: request.headers.get("content-type") || "image/png" }
  });
  return json({ ok: true, size: body.byteLength });
}

// ---------- other people's uptime ----------

async function pingSupabase(env) {
  const url = env.SUPABASE_PING_URL;
  const key = env.SUPABASE_ANON_KEY;
  if (!url || !key) return;
  try {
    const r = await fetch(url, { headers: { apikey: key, authorization: "Bearer " + key } });
    console.log(`supabase ping: HTTP ${r.status}${r.ok ? " (alive)" : " (paused or over limit)"}`);
  } catch (e) {
    console.log("supabase ping failed: " + e.message);
  }
}

async function watchDeposits(env) {
  const url = env.DEPOSITS_HEALTH_URL;
  if (!url) return;
  let status = 0, detail = "";
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(10000) });
    status = r.status;
    // 429 here is error 1027: the account's daily request ceiling, which takes the journal
    // down on every device at once and reads in a browser as a contentless "Load failed".
    detail = r.ok ? "" : (await r.text().catch(() => "")).slice(0, 200);
  } catch (e) {
    detail = e.message || "unreachable";
  }
  if (status === 200) { console.log("deposits: ok"); return; }
  const msg = `deposits is not answering: ${status || "no response"} ${detail}`.trim();
  console.log(msg);
  await alert(env, msg);
}

/** Fire-and-forget. ALERT_URL is any endpoint that takes a POST body — an ntfy.sh topic is
 *  the zero-setup one: https://ntfy.sh/<something-only-you-know>, and the phone app
 *  subscribes to it. Nothing to sign up for and nothing to pay.
 *
 *  ALERT_EMAIL rides along as ntfy's `Email` header, which forwards the same message to an
 *  address — so the alert arrives somewhere that is still there when the phone isn't. It is
 *  ntfy's own free forwarding, rate-limited and sent from their address; for something more
 *  yours, Cloudflare Email Routing plus a send_email binding sends direct from this Worker,
 *  but that wants a domain on the account and a verified destination.
 *
 *  The message carries the dashboard link, because the next thing anyone reading it wants is
 *  to see whether their entries are safe. */
async function alert(env, message) {
  if (!env.ALERT_URL) return;
  const headers = { "content-type": "text/plain", title: "deposits" };
  if (env.ALERT_EMAIL) headers.email = env.ALERT_EMAIL;
  const body = env.DASHBOARD_URL ? message + "\n\n" + env.DASHBOARD_URL : message;
  try {
    await fetch(env.ALERT_URL, { method: "POST", headers, body });
  } catch (e) {
    console.log("alert failed: " + e.message);
  }
}

// ---------- helpers ----------

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}

function cors(res, env) {
  const origin = env.ALLOWED_ORIGIN || "*";
  const h = new Headers(res.headers);
  h.set("access-control-allow-origin", origin);
  h.set("access-control-allow-methods", "GET, PUT, HEAD, OPTIONS");
  h.set("access-control-allow-headers", "authorization, content-type, if-match");
  h.set("access-control-max-age", "86400");
  h.set("vary", "origin");
  return new Response(res.body, { status: res.status, headers: h });
}
