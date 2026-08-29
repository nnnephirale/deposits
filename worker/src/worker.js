// deposits — Cloudflare Worker
//
// The whole backend: one R2 bucket behind a shared secret. No database to provision, and
// nothing that pauses. Two kinds of object live in the bucket:
//
//   entries.json   the entries, without photos — small, rewritten whole on each push
//   images/<id>    one object per photo, written once and never rewritten
//
// Photos are separate objects on purpose. The Supabase setup kept them as base64 inside the
// rows and re-downloaded every one of them on every app launch, which is what ran the free
// tier out of transfer and paused the project. Here a photo is fetched once per device, kept
// in that device's IndexedDB, and never asked for again.
//
// Auth is a single shared secret in a header. One user, one secret, no accounts — and the
// bucket is private, so nothing is reachable without it.

const JSON_HEADERS = { "content-type": "application/json; charset=utf-8" };

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "") || "/";

    if (request.method === "OPTIONS") return cors(new Response(null, { status: 204 }), env);
    // `configured` says whether a secret exists at all, without revealing anything about it.
    // That is the difference between "wrangler secret put never reached this Worker" and
    // "it did, and the value does not match" — two problems with entirely different fixes,
    // and indistinguishable from a 401 alone.
    if (path === "/health") return cors(json({ ok: true, configured: !!env.DEPOSITS_SECRET }), env);

    try {
      if (path === "/entries") {
        if (!authorized(request, env)) return cors(json({ error: "unauthorized" }, 401), env);
        if (request.method === "GET") return cors(await getEntries(env), env);
        if (request.method === "PUT") return cors(await putEntries(request, env, ctx), env);
      }
      // entries.json is rewritten whole on every push and R2 keeps no versions, so a bad
      // merge overwrites the only copy up here — see 7a160f5, where a stale tombstone ate
      // every summary written after it. These are the undo: one dated copy per day, and a
      // dashboard that can show what changed between then and now.
      if (path === "/snapshots") {
        if (!authorized(request, env)) return cors(json({ error: "unauthorized" }, 401), env);
        if (request.method === "GET") return cors(await listSnapshots(env), env);
      }
      if (path.startsWith("/snapshots/")) {
        if (!authorized(request, env)) return cors(json({ error: "unauthorized" }, 401), env);
        const date = path.slice("/snapshots/".length);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return cors(json({ error: "bad date" }, 400), env);
        if (request.method === "GET") return cors(await getSnapshot(date, env), env);
      }
      // ---- SSaved (moving out; see ../worker-ssaved) ----
      // These routes now live in their own Worker. They are still answered here until SSaved's
      // client has been repointed, because removing them before that would take SSaved down —
      // set SSAVED_ROUTES = "off" in wrangler.toml and redeploy once the new URL is live.
      //
      // Why they are leaving at all: one Worker meant one daily request budget for two apps,
      // and SSaved's reads are unauthenticated by design. A crawled share link could spend the
      // journal's quota, which is exactly how both apps went dark at once on 28 Aug 2026 —
      // Cloudflare error 1027, and a browser can only see it as "Load failed".
      const ss = env.SSAVED_ROUTES === "off" ? null : path.match(/^\/s\/([A-Za-z0-9_-]{1,64})(?:\/img\/([A-Za-z0-9._-]{1,128}))?$/);
      if (ss) {
        const [, collection, image] = ss;
        if (image) {
          if (request.method === "GET") return cors(await getObject(`ssaved/images/${collection}/${image}`, env, true), env);
          if (!authorized(request, env)) return cors(json({ error: "unauthorized" }, 401), env);
          if (request.method === "PUT") return cors(await putSsavedImage(collection, image, request, env), env);
        } else {
          if (request.method === "GET") return cors(await getObject(`ssaved/${collection}/data.json`, env), env);
          if (!authorized(request, env)) return cors(json({ error: "unauthorized" }, 401), env);
          if (request.method === "PUT") return cors(await putSsavedData(collection, request, env), env);
        }
        return cors(json({ error: "method not allowed" }, 405), env);
      }

      if (path.startsWith("/images/")) {
        if (!authorized(request, env)) return cors(json({ error: "unauthorized" }, 401), env);
        const id = decodeURIComponent(path.slice("/images/".length));
        if (!/^[A-Za-z0-9._-]{1,128}$/.test(id)) return cors(json({ error: "bad image id" }, 400), env);
        if (request.method === "GET") return cors(await getImage(id, env), env);
        if (request.method === "PUT") return cors(await putImage(id, request, env), env);
        if (request.method === "HEAD") return cors(await headImage(id, env), env);
      }
      return cors(json({ error: "not found" }, 404), env);
    } catch (err) {
      return cors(json({ error: String(err && err.message || err) }, 500), env);
    }
  },

  // The Supabase keep-alive moved to the ssaved Worker along with the routes it serves — it
  // was always SSaved's uptime, not this one's. This Worker has no schedule of its own; what
  // watches *it* runs elsewhere on purpose (../worker-ssaved's cron, and the GitHub Actions
  // check that sits outside Cloudflare entirely).
};

// ---------- auth ----------

function authorized(request, env) {
  const secret = env.DEPOSITS_SECRET;
  if (!secret) return false;
  const header = request.headers.get("authorization") || "";
  const presented = header.startsWith("Bearer ") ? header.slice(7) : "";
  // Trim both sides. Pasting a key into an interactive prompt very easily carries a trailing
  // newline, and a stored "abc\n" against a sent "abc" is a mismatch that looks exactly like
  // a wrong key while being invisible in every place you would go to check it.
  return timingSafeEqual(presented.trim(), String(secret).trim());
}

// Compare without leaking length or position through timing. Cheap here, and the alternative
// is a secret you can walk one character at a time.
function timingSafeEqual(a, b) {
  const enc = new TextEncoder();
  const ab = enc.encode(a), bb = enc.encode(b);
  let diff = ab.length ^ bb.length;
  const n = Math.max(ab.length, bb.length);
  for (let i = 0; i < n; i++) diff |= (ab[i] || 0) ^ (bb[i] || 0);
  return diff === 0;
}

// ---------- entries ----------

const ENTRIES_KEY = "entries.json";

async function getEntries(env) {
  const obj = await env.BUCKET.get(ENTRIES_KEY);
  if (!obj) return json({ entries: [], tombstones: {}, etag: null });
  const body = await obj.json();
  return new Response(JSON.stringify({ ...body, etag: obj.etag }), {
    headers: { ...JSON_HEADERS, etag: obj.etag }
  });
}

// Conditional write. The client sends the etag it last read; a mismatch means the other
// device wrote in between, and the client re-reads, re-merges and retries rather than
// flattening whatever it never saw.
async function putEntries(request, env, ctx) {
  const payload = await request.json();
  if (!payload || !Array.isArray(payload.entries)) {
    return json({ error: "expected { entries: [...] }" }, 400);
  }
  // The taxonomy (her tag names and colours) rides along with the entries, but unlike them it
  // is CARRIED FORWARD when a push doesn't mention it. A client only sends it once she has
  // edited it on that device, so a device still on the defaults pushes an entry without one —
  // and rewriting the object with the key simply missing would drop her renamed tags for every
  // device. The extra read only happens on that path.
  let taxonomy = payload.taxonomy;
  if (!taxonomy) {
    const prev = await env.BUCKET.get(ENTRIES_KEY);
    if (prev) taxonomy = (await prev.json().catch(() => ({}))).taxonomy;
  }
  const body = JSON.stringify({
    entries: payload.entries,
    tombstones: payload.tombstones || {},
    summaries: payload.summaries || {},
    ...(taxonomy ? { taxonomy } : {}),
    writtenAt: new Date().toISOString()
  });

  const expected = request.headers.get("if-match");
  const opts = { httpMetadata: { contentType: "application/json" } };
  if (expected && expected !== "*") opts.onlyIf = { etagMatches: expected };
  else if (!expected) opts.onlyIf = { etagDoesNotExist: true }; // first write only

  let put = await env.BUCKET.put(ENTRIES_KEY, body, opts);
  if (put === null) {
    // precondition failed: somebody else is ahead of us
    const current = await env.BUCKET.get(ENTRIES_KEY);
    return json({ error: "conflict", etag: current ? current.etag : null }, 412);
  }
  // The first push of a day leaves a dated copy behind. One extra head and one extra put,
  // once a day; at a few hundred KB a snapshot a year of them is under a percent of the free
  // 10 GB, so nothing is pruned — an old snapshot is worth more than the space it holds.
  // waitUntil, because the client is waiting on this response and the copy is not its problem.
  if (ctx) ctx.waitUntil(snapshotDaily(body, env));
  return json({ ok: true, etag: put.etag, count: payload.entries.length });
}

const HISTORY_PREFIX = "history/";

async function snapshotDaily(body, env) {
  try {
    const key = HISTORY_PREFIX + new Date().toISOString().slice(0, 10) + ".json";
    if (await env.BUCKET.head(key)) return;        // today already has one
    await env.BUCKET.put(key, body, { httpMetadata: { contentType: "application/json" } });
  } catch (e) {
    console.log("snapshot failed: " + (e && e.message));  // never fails the push
  }
}

async function listSnapshots(env) {
  const out = [];
  let cursor;
  do {
    const page = await env.BUCKET.list({ prefix: HISTORY_PREFIX, cursor });
    for (const o of page.objects) {
      out.push({ date: o.key.slice(HISTORY_PREFIX.length).replace(/\.json$/, ""), size: o.size, uploaded: o.uploaded });
    }
    cursor = page.truncated ? page.cursor : null;
  } while (cursor);
  out.sort((a, b) => b.date.localeCompare(a.date));   // newest first: the one you want is at the top
  return json({ snapshots: out });
}

async function getSnapshot(date, env) {
  const obj = await env.BUCKET.get(HISTORY_PREFIX + date + ".json");
  if (!obj) return json({ error: "no snapshot for " + date }, 404);
  return new Response(obj.body, { headers: JSON_HEADERS });
}

// ---------- images ----------

async function putImage(id, request, env) {
  const key = "images/" + id;
  const existing = await env.BUCKET.head(key);
  if (existing) return json({ ok: true, skipped: true, size: existing.size }); // written once, never rewritten
  const body = await request.arrayBuffer();
  if (!body.byteLength) return json({ error: "empty body" }, 400);
  await env.BUCKET.put(key, body, {
    httpMetadata: { contentType: request.headers.get("content-type") || "image/jpeg" }
  });
  return json({ ok: true, size: body.byteLength });
}

async function getImage(id, env) {
  const obj = await env.BUCKET.get("images/" + id);
  if (!obj) return json({ error: "not found" }, 404);
  const headers = new Headers();
  obj.writeHttpMetadata(headers);
  headers.set("etag", obj.httpEtag);
  // an image object is immutable — once a device has it, it never needs to ask again
  headers.set("cache-control", "public, max-age=31536000, immutable");
  return new Response(obj.body, { headers });
}

async function headImage(id, env) {
  const obj = await env.BUCKET.head("images/" + id);
  if (!obj) return new Response(null, { status: 404 });
  return new Response(null, { status: 200, headers: { "content-length": String(obj.size) } });
}

// ---------- SSaved storage ----------
// One JSON document per collection, and one object per screenshot. Same shape as deposits:
// the document carries no image bytes, so opening a collection costs a few KB rather than
// re-serving every screenshot. Exceeding cached egress on the previous host is what took
// SSaved down; on R2 downloads are not charged at all.

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

async function putSsavedData(collection, request, env) {
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

async function putSsavedImage(collection, image, request, env) {
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

// ---------- helpers ----------

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), { status, headers: JSON_HEADERS });
}

// The app is served from a different origin than the Worker, so every request is cross-origin.
// ALLOWED_ORIGIN pins that to the one page rather than opening it to anything that has the
// secret — defence in depth, not the lock itself.
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
