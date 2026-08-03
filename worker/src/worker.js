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
        if (request.method === "PUT") return cors(await putEntries(request, env), env);
      }
      // ---- SSaved ----
      // Reads are public so share links keep working for people who do not have the secret;
      // writes need it. That is strictly better than what SSaved has today, where the bucket
      // is public and the tables have no row-level security, so anyone holding a share link
      // can also delete the collection.
      const ss = path.match(/^\/s\/([A-Za-z0-9_-]{1,64})(?:\/img\/([A-Za-z0-9._-]{1,128}))?$/);
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

  // Keeps the shared Supabase project awake on SSaved's behalf. SSaved has no local copy of
  // its cards — when that project pauses, SSaved is simply down. Its own keep-alive lives in
  // a GitHub workflow, and GitHub switches scheduled workflows off after 60 days of repo
  // quiet, which is how it died the first time. This scheduler has no such rule.
  async scheduled(event, env, ctx) {
    ctx.waitUntil(pingSupabase(env));
  }
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
async function putEntries(request, env) {
  const payload = await request.json();
  if (!payload || !Array.isArray(payload.entries)) {
    return json({ error: "expected { entries: [...] }" }, 400);
  }
  const body = JSON.stringify({
    entries: payload.entries,
    tombstones: payload.tombstones || {},
    summaries: payload.summaries || {},
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
  return json({ ok: true, etag: put.etag, count: payload.entries.length });
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

// ---------- SSaved keep-alive ----------

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
