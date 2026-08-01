// ---------- cloud sync (Cloudflare R2 via a Worker) ----------
// Transport only — the merge stays in the app, where it can see the entries.
//
// Replaces the Supabase client. Two things about the old setup caused the outage this
// module exists to prevent: photos were stored as base64 inside the rows, and every launch
// pulled every row with `select("*")` — so each start re-downloaded every photo ever pasted.
// That ran a shared free tier out of transfer and paused the project, taking the other app
// on it down as collateral.
//
// Here the entries payload carries no photo bytes at all. A photo is a separate object,
// fetched at most once per device and then kept in that device's IndexedDB. Steady state is
// one small JSON GET per launch.

const CONFIG_KEY = "weekly-deposits-cloud";

let cfg = null;
try { cfg = JSON.parse(localStorage.getItem(CONFIG_KEY)) || null; } catch (e) {}

export function cloudConfig() { return cfg; }
export function cloudConfigured() { return !!(cfg && cfg.url && cfg.secret); }

export function setCloudConfig(next) {
  cfg = next && next.url && next.secret
    ? { url: String(next.url).replace(/\/+$/, ""), secret: String(next.secret) }
    : null;
  try {
    if (cfg) localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    else localStorage.removeItem(CONFIG_KEY);
  } catch (e) {}
  return cfg;
}

function headers(extra) {
  return { authorization: "Bearer " + cfg.secret, ...(extra || {}) };
}

async function call(path, init) {
  if (!cloudConfigured()) throw new Error("cloud not configured");
  const res = await fetch(cfg.url + path, init);
  return res;
}

/** Reachable and the secret is right? Used by Settings to give a straight yes/no. */
export async function cloudCheck() {
  if (!cloudConfigured()) return { ok: false, reason: "not set up" };
  try {
    const res = await call("/entries", { headers: headers() });
    if (res.status === 401) return { ok: false, reason: "secret rejected" };
    if (!res.ok) return { ok: false, reason: "HTTP " + res.status };
    const body = await res.json();
    return { ok: true, entries: (body.entries || []).length };
  } catch (e) {
    return { ok: false, reason: e.message || "unreachable" };
  }
}

// ---------- entries ----------

export async function fetchState() {
  const res = await call("/entries", { headers: headers() });
  if (!res.ok) throw new Error("pull failed: HTTP " + res.status);
  const body = await res.json();
  return {
    entries: body.entries || [],
    tombstones: body.tombstones || {},
    summaries: body.summaries || {},
    etag: body.etag || res.headers.get("etag") || null
  };
}

/** Returns { ok, etag } — or { conflict: true, etag } when the other device wrote first,
 *  which is the caller's cue to re-pull, re-merge and try again rather than overwrite. */
export async function pushState(state, etag) {
  const h = headers({ "content-type": "application/json" });
  if (etag) h["if-match"] = etag;
  const res = await call("/entries", { method: "PUT", headers: h, body: JSON.stringify(state) });
  if (res.status === 412) {
    const body = await res.json().catch(() => ({}));
    return { conflict: true, etag: body.etag || null };
  }
  if (!res.ok) throw new Error("push failed: HTTP " + res.status);
  const body = await res.json();
  return { ok: true, etag: body.etag || null };
}

// ---------- photos ----------
// One object each, written once. An id that is already up there is skipped by the Worker,
// so re-pushing the same entry costs a HEAD, not an upload.

export async function uploadImage(id, blob) {
  const res = await call("/images/" + encodeURIComponent(id), {
    method: "PUT",
    headers: headers({ "content-type": blob.type || "image/jpeg" }),
    body: blob
  });
  if (!res.ok) throw new Error("upload failed: HTTP " + res.status);
  return res.json();
}

export async function downloadImage(id) {
  const res = await call("/images/" + encodeURIComponent(id), { headers: headers() });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error("download failed: HTTP " + res.status);
  return res.blob();
}

/** Push any photo the cloud doesn't have yet. Failures are per-photo: one bad upload must
 *  not stop the rest, and the entry text has already landed regardless. */
export async function pushImages(ids, getBlob) {
  let sent = 0, failed = 0;
  for (const id of ids) {
    const blob = getBlob(id);
    if (!blob) continue;
    try { const r = await uploadImage(id, blob); if (!r.skipped) sent++; }
    catch (e) { failed++; console.warn("deposits: photo upload failed", id, e); }
  }
  return { sent, failed };
}

/** Pull any photo this device is missing. Runs in the background after a sync — the entries
 *  are already on screen; the photos fill in. */
export async function pullImages(ids, have, store) {
  let got = 0, failed = 0;
  for (const id of ids) {
    if (have(id)) continue;
    try {
      const blob = await downloadImage(id);
      if (blob) { await store(id, blob); got++; }
    } catch (e) { failed++; console.warn("deposits: photo download failed", id, e); }
  }
  return { got, failed };
}

/** Every photo id referenced by a list of entries. */
export function imageIdsIn(entries) {
  const ids = new Set();
  for (const e of entries) {
    if (e.images) for (const id of Object.keys(e.images)) ids.add(id);
    if (e.imageIds) for (const id of e.imageIds) ids.add(id);
  }
  return [...ids];
}
