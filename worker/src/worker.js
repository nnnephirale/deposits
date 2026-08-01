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
    if (path === "/health") return cors(json({ ok: true }), env);

    if (!authorized(request, env)) {
      return cors(json({ error: "unauthorized" }, 401), env);
    }

    try {
      if (path === "/entries") {
        if (request.method === "GET") return cors(await getEntries(env), env);
        if (request.method === "PUT") return cors(await putEntries(request, env), env);
      }
      if (path.startsWith("/images/")) {
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
  return timingSafeEqual(presented, secret);
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
