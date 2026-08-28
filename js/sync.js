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

// Shared with SSaved. Both apps are served from the same origin and talk to the same Worker,
// so they can share one stored credential — enter it in either and the other already has it.
// Kept separate from CONFIG_KEY so an older install's config still loads.
const SHARED_KEY = "cf-worker";

function readShared() {
  try {
    const v = JSON.parse(localStorage.getItem(SHARED_KEY));
    return v && v.secret ? v : null;
  } catch (e) { return null; }
}

// A one-time setup link carries the key in the URL fragment: #k=<secret>. A fragment is never
// sent to a server and never appears in access logs, and it is stripped from the address bar
// the moment it is read, so it does not linger in history or in a shared screenshot.
function readSetupLink() {
  try {
    const h = new URLSearchParams((location.hash || "").replace(/^#/, ""));
    const secret = h.get("k");
    if (!secret) return null;
    const url = h.get("w") || (readShared() || {}).url || null;
    // Strip only once the link is actually usable. A link that carries the key but no
    // address, opened on a device with nothing stored, used to be consumed anyway: the
    // fragment went, the config never arrived, and the one copy of the key on that phone
    // was gone with the address bar.
    if (!url) return null;
    history.replaceState(null, "", location.pathname + location.search);
    return { url, secret };
  } catch (e) { return null; }
}

let cfg = null;
try { cfg = JSON.parse(localStorage.getItem(CONFIG_KEY)) || null; } catch (e) {}
if (!cfg || !cfg.secret) cfg = readShared() || cfg;

export function cloudConfig() { return cfg; }
export function cloudConfigured() { return !!(cfg && cfg.url && cfg.secret); }

/** A link that sets this device up in one tap. The key rides in the fragment. */
export function setupLink() {
  if (!cloudConfigured()) return null;
  return location.origin + location.pathname +
    "#w=" + encodeURIComponent(cfg.url) + "&k=" + encodeURIComponent(cfg.secret);
}

export function setCloudConfig(next) {
  cfg = next && next.url && next.secret
    ? { url: String(next.url).replace(/\/+$/, ""), secret: String(next.secret) }
    : null;
  try {
    if (cfg) {
      localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
      localStorage.setItem(SHARED_KEY, JSON.stringify(cfg)); // SSaved reads this one
    } else {
      localStorage.removeItem(CONFIG_KEY);
      localStorage.removeItem(SHARED_KEY);
    }
  } catch (e) {}
  resetHealth();   // a new address or key gets a clean record; the old one's is not about it
  return cfg;
}

// a setup link wins over whatever is stored: it is the newer, deliberate instruction
const fromLink = readSetupLink();
if (fromLink) {
  cfg = fromLink;
  try {
    localStorage.setItem(CONFIG_KEY, JSON.stringify(cfg));
    localStorage.setItem(SHARED_KEY, JSON.stringify(cfg));
  } catch (e) {}
}

function headers(extra) {
  return { authorization: "Bearer " + cfg.secret, ...(extra || {}) };
}

// Every request gets a deadline. Without one, a phone that loses signal mid-request leaves
// the promise pending forever — which is how the sync button sat on "syncing…" indefinitely
// with nothing to report and no way back.
const TIMEOUT_JSON = 20000;
const TIMEOUT_BLOB = 60000;   // photos are bigger and phones are slower

function deadline(ms) {
  if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

// ---------- health ----------
// Every sync failure used to be a console.warn, on a phone with no console. The app went on
// looking connected — the dot is lit by having a config, not by anything having worked — so a
// device could stop reaching the Worker and say nothing about it for days.
//
// lastOkAt is kept in localStorage on purpose. "last synced 9 days ago" is the sentence that
// names the problem; and after WebKit's seven-day sweep takes the storage, its absence
// alongside a config that is also gone is the same fact told the other way.

const HEALTH_KEY = "weekly-deposits-sync-health";
let health = { lastOkAt: null, lastError: null, lastErrorAt: null };
try { health = { ...health, ...(JSON.parse(localStorage.getItem(HEALTH_KEY)) || {}) }; } catch (e) {}

let healthListener = null;
let lastWroteHealth = 0;

/** { lastOkAt, lastError, lastErrorAt, failing } — failing means the last attempt didn't land. */
export function syncHealth() {
  const failing = !!(health.lastError && (!health.lastOkAt || health.lastErrorAt > health.lastOkAt));
  return { ...health, failing };
}
/** Called when the answer to syncHealth() changes, so the dot can repaint without a render. */
export function onSyncHealth(fn) { healthListener = fn; }

function noteHealth(next) {
  const before = syncHealth().failing;
  Object.assign(health, next);
  const now = Date.now();
  // One write a minute at most: a photo pull is a request per photo, and none of this is
  // worth a storage write each.
  if (before !== syncHealth().failing || now - lastWroteHealth > 60000) {
    lastWroteHealth = now;
    try { localStorage.setItem(HEALTH_KEY, JSON.stringify(health)); } catch (e) {}
  }
  if (before !== syncHealth().failing && healthListener) { try { healthListener(syncHealth()); } catch (e) {} }
}

function resetHealth() {
  health = { lastOkAt: null, lastError: null, lastErrorAt: null };
  try { localStorage.removeItem(HEALTH_KEY); } catch (e) {}
}

function noteOk() { noteHealth({ lastOkAt: new Date().toISOString(), lastError: null }); }
function noteFail(reason) { noteHealth({ lastError: reason, lastErrorAt: new Date().toISOString() }); }

async function call(path, init, ms = TIMEOUT_JSON) {
  if (!cloudConfigured()) throw new Error("cloud not configured");
  let res;
  try {
    res = await fetch(cfg.url + path, { ...init, signal: deadline(ms) });
  } catch (e) {
    const timedOut = e.name === "TimeoutError" || e.name === "AbortError";
    const reason = timedOut ? "timed out after " + (ms / 1000) + "s" : (e.message || "unreachable");
    noteFail(reason);
    if (timedOut) throw new Error(reason);
    throw e;
  }
  // A 412 is the conflict check doing its job and a 404 is an image this device doesn't have
  // yet — both are round-trips that reached the Worker and came back understood.
  if (res.ok || res.status === 412 || res.status === 404) noteOk();
  else if (res.status === 401) noteFail("secret rejected");
  else noteFail("HTTP " + res.status);
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
    const rows = body.entries || [];
    const live = rows.filter(e => !e.deletedAt).length;
    return { ok: true, entries: live, deleted: rows.length - live };
  } catch (e) {
    return { ok: false, reason: e.message || "unreachable" };
  }
}

/** What "Load failed" actually was.
 *
 *  WebKit says "Load failed" for every fetch that doesn't complete, and Chrome says "Failed
 *  to fetch": no status, no cause, and the same three words whether the phone is off the
 *  network, a content blocker ate the request, Private Relay dropped it, the carrier's DNS
 *  refuses workers.dev, or the Worker is simply refusing this page's origin. Those have
 *  completely different fixes, so the check asks the questions one at a time instead of
 *  handing the browser's sentence back to her.
 *
 *  /health is the probe on purpose: no Authorization header, so it is a *simple* request that
 *  goes straight out with no preflight, and it needs no secret to answer. Then, if even that
 *  fails, the same URL again with mode:"no-cors" — an opaque response still resolves when the
 *  bytes came back, so a reply that only CORS rejected is told apart from nothing arriving.
 */
export async function cloudDiagnose() {
  if (!cloudConfigured()) return { ok: false, reason: "not set up", stage: "unconfigured" };

  const first = await cloudCheck();
  if (first.ok) return first;
  // A status came back, so the network is fine and the answer is already specific.
  if (!/load failed|failed to fetch|networkerror|unreachable|timed out/i.test(first.reason || "")) return first;

  if (typeof navigator !== "undefined" && navigator.onLine === false) {
    return { ok: false, stage: "offline", reason: "this device is offline — nothing left the phone." };
  }

  const host = cfg.url.replace(/^https?:\/\//, "");
  try {
    const res = await fetch(cfg.url + "/health", { signal: deadline(8000) });
    if (res.ok) {
      const body = await res.json().catch(() => ({}));
      if (body.configured === false) {
        return { ok: false, stage: "no-secret",
          reason: host + " is up but has no secret set — run `wrangler secret put DEPOSITS_SECRET`." };
      }
      return { ok: false, stage: "request-blocked",
        reason: host + " answers a plain request, so it's this app's request being stopped — a content blocker, "
          + "a VPN or Private Relay. Turn those off for this site and test again." };
    }
    return { ok: false, stage: "health-http", reason: host + " answered /health with HTTP " + res.status + "." };
  } catch (e) {
    try {
      await fetch(cfg.url + "/health", { mode: "no-cors", signal: deadline(8000) });
      return { ok: false, stage: "cors",
        reason: host + " is reachable but refusing this page's origin — set ALLOWED_ORIGIN on the Worker to "
          + location.origin + " and redeploy." };
    } catch (e2) {
      return { ok: false, stage: "unreachable",
        reason: "can't reach " + host + " at all from this network. Try Wi-Fi instead of cellular, and turn off "
          + "Private Relay or a VPN — mobile networks do block workers.dev." };
    }
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
    // absent by design on a bucket written by an older Worker — left undefined rather than
    // defaulted to an empty doc, so the app can tell "no taxonomy up there" from "no tags".
    taxonomy: body.taxonomy || null,
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
  }, TIMEOUT_BLOB);
  if (!res.ok) throw new Error("upload failed: HTTP " + res.status);
  return res.json();
}

export async function downloadImage(id) {
  const res = await call("/images/" + encodeURIComponent(id), { headers: headers() }, TIMEOUT_BLOB);
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
export async function pullImages(ids, have, store, onProgress) {
  let got = 0, failed = 0;
  const todo = ids.filter(id => !have(id));
  for (const id of todo) {
    try {
      const blob = await downloadImage(id);
      if (blob) { await store(id, blob); got++; }
    } catch (e) { failed++; console.warn("deposits: photo download failed", id, e); }
    if (onProgress) onProgress(got + failed, todo.length);
  }
  return { got, failed, total: todo.length };
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
