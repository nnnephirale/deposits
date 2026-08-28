// ---------- durable local storage (IndexedDB) ----------
// Replaces localStorage as the app's source of truth. The old store kept every entry AND
// every pasted photo — as base64 text — inside one ~5MB key. Once that filled, every
// setItem threw, the throw was swallowed, and the entry lived in memory only: on screen
// until the next reload, then gone. That is what ate a week of entries.
//
// Here: entries and photos go to IndexedDB (hundreds of MB to GB, quota shared with nothing
// else), photos as real Blobs rather than base64 — a third smaller and no string juggling.
// Writes that fail are reported to onStoreError instead of vanishing.
//
// The DOM still wants a URL per photo, so entries handed out by loadEntries carry the same
// `images: { id: url }` shape they always did — object URLs now instead of data URLs. Every
// consumer (renderRichBlocks, imagesUsedIn, the composer) is unchanged.

const DB_NAME = "deposits";
const DB_VERSION = 1;
const ENTRY_STORE = "entries";
const IMAGE_STORE = "images";
const META_STORE = "meta";

// the localStorage key the app used until now — read once, on migration, then left in place
// (stripped of its photos) as a plain-text fallback.
const LEGACY_ENTRIES_KEY = "weekly-deposits-entries";

let db = null;
const blobs = new Map();      // image id -> Blob: what gets uploaded, and the real bytes
const urls = new Map();       // image id -> object URL: what the DOM renders
const persisted = new Set();  // image ids already written to disk — see writeAll
let onError = () => {};

/** Report a failed write. The whole point of this module: a save that doesn't land says so. */
export function onStoreError(fn) { onError = fn; }

export function imageBlob(id) { return blobs.get(id); }
export function imageIds() { return [...blobs.keys()]; }
export function hasImage(id) { return blobs.has(id); }

/** Take a photo pulled down from the cloud into local storage, and hand back a URL for it. */
export async function putImage(id, blob) {
  blobs.set(id, blob);
  const url = urlFor(id, blob);
  if (db) {
    const { store, done } = tx([IMAGE_STORE], "readwrite");
    store(IMAGE_STORE).put({ id, blob });
    await done;
    persisted.add(id);
  }
  return url;
}

// ---------- open ----------

export function openStore() {
  return new Promise((resolve, reject) => {
    let req;
    try { req = indexedDB.open(DB_NAME, DB_VERSION); }
    catch (e) { return reject(e); }
    req.onupgradeneeded = () => {
      const d = req.result;
      if (!d.objectStoreNames.contains(ENTRY_STORE)) d.createObjectStore(ENTRY_STORE, { keyPath: "id" });
      if (!d.objectStoreNames.contains(IMAGE_STORE)) d.createObjectStore(IMAGE_STORE, { keyPath: "id" });
      if (!d.objectStoreNames.contains(META_STORE)) d.createObjectStore(META_STORE, { keyPath: "k" });
    };
    req.onsuccess = () => { db = req.result; resolve(db); };
    req.onerror = () => reject(req.error);
    // Safari fires this when another tab holds an older version open; the app still works
    // off whatever is already there rather than hanging on a promise that never settles.
    req.onblocked = () => reject(new Error("indexeddb blocked by another tab"));
  });
}

function tx(stores, mode) {
  const t = db.transaction(stores, mode);
  return {
    t,
    store: n => t.objectStore(n),
    done: new Promise((res, rej) => {
      t.oncomplete = () => res();
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error || new Error("transaction aborted"));
    })
  };
}

function reqDone(r) {
  return new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });
}

// ---------- data url <-> blob ----------

// Synchronous decode rather than fetch(dataUrl): no network stack, no CSP surface, and it
// runs inside the same turn as the save so nothing can interleave.
function dataUrlToBlob(s) {
  const comma = s.indexOf(",");
  if (comma < 0) return null;
  const header = s.slice(0, comma);
  const type = (header.match(/^data:([^;,]+)/) || [, "application/octet-stream"])[1];
  const body = s.slice(comma + 1);
  if (!/;base64/i.test(header)) return new Blob([decodeURIComponent(body)], { type });
  const bin = atob(body);
  const buf = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
  return new Blob([buf], { type });
}

// One URL per photo per page load, and never revoked while the page lives. Revoking on
// replacement looked tidy but the DOM may still be rendering the old one — and a revoked
// URL renders as a broken-image glyph, which is exactly what it did.
function urlFor(id, blob) {
  const prev = urls.get(id);
  if (prev) return prev;
  const u = URL.createObjectURL(blob);
  urls.set(id, u);
  return u;
}

/** The URL to render for a photo, or null if this device doesn't hold it yet. Everything
 *  that displays a photo goes through here, so there is exactly one URL per id. */
export function imageUrl(id) {
  const existing = urls.get(id);
  if (existing) return existing;
  const b = blobs.get(id);
  return b ? urlFor(id, b) : null;
}

/** Take whatever the composer produced for an image and settle it into a Blob we own. */
function adoptImage(id, value) {
  if (blobs.has(id) && typeof value === "string" && !value.startsWith("data:")) {
    return urls.get(id) || urlFor(id, blobs.get(id)); // already ours: an object URL round-tripping
  }
  let blob = null;
  if (value instanceof Blob) blob = value;
  else if (typeof value === "string" && value.startsWith("data:")) blob = dataUrlToBlob(value);
  if (!blob) return typeof value === "string" ? value : null;
  blobs.set(id, blob);
  return urlFor(id, blob);
}

// ---------- load ----------

export async function loadEntries() {
  if (!db) return [];
  const { store, done } = tx([ENTRY_STORE, IMAGE_STORE], "readonly");
  // both requests are issued before either is awaited. Safari ends a transaction as soon as
  // it has no pending requests, and awaiting the first one yields long enough for that to
  // happen — the second call then throws TransactionInactiveError.
  const rowsReq = store(ENTRY_STORE).getAll();
  const imgsReq = store(IMAGE_STORE).getAll();
  const rows = await reqDone(rowsReq);
  const imgs = await reqDone(imgsReq);
  await done;
  for (const rec of imgs) if (rec && rec.blob) { blobs.set(rec.id, rec.blob); persisted.add(rec.id); }
  return rows.map(rec => {
    const e = { ...rec };
    const ids = e.imageIds || [];
    delete e.imageIds;
    if (ids.length) {
      const m = {};
      for (const id of ids) {
        const b = blobs.get(id);
        if (b) m[id] = urls.get(id) || urlFor(id, b);
      }
      if (Object.keys(m).length) e.images = m;
    }
    return e;
  });
}

// ---------- save ----------
// Saves are serialised: a write in flight when another arrives means the newer list simply
// replaces the queued one. Rapid typing can't stack transactions, and the last state always
// wins — which is also what the entries themselves assume (last write wins on updatedAt).

let writing = null;
let queued = null;

export function persistEntries(list) {
  queued = list;
  if (writing) return writing;
  writing = (async () => {
    try {
      while (queued) {
        const batch = queued;
        queued = null;
        await writeAll(batch);
      }
    } catch (e) {
      onError(e);
      throw e;
    } finally {
      writing = null;
    }
  })();
  // the caller is synchronous (saveEntries), so swallow here — onError already told the user
  return writing.catch(() => {});
}

/** Await any write still in flight. Call before the page goes away. */
export function flushEntries() { return writing ? writing.catch(() => {}) : Promise.resolve(); }

async function writeAll(list) {
  if (!db) throw new Error("store not open");

  // settle images to Blobs first, outside the transaction — decoding a few MB of base64
  // inside one would hold it open long enough for Safari to time it out.
  const pendingImages = [];
  const records = list.map(e => {
    const rec = { ...e };
    delete rec.images;
    // Union with any ids already on the entry: a photo synced from another device but not
    // downloaded here yet has an id and no blob, and must keep its place in the list.
    const ids = new Set(e.imageIds || []);
    if (e.images) {
      for (const [id, val] of Object.entries(e.images)) {
        const url = adoptImage(id, val);
        // only NEW blobs get written. Re-cloning every photo into IndexedDB on every save
        // was 3.2MB a time — slow enough to fail outright on a phone, and it invalidated
        // the object URLs the DOM was still rendering.
        if (url) { ids.add(id); if (blobs.has(id) && !persisted.has(id)) pendingImages.push(id); }
      }
    }
    if (ids.size) rec.imageIds = [...ids]; else delete rec.imageIds;
    return rec;
  });

  // Which ids are on disk, read in a transaction of its own. This used to be an await in
  // the MIDDLE of the write transaction, which Safari treats as the end of it — every put
  // and delete after the await then threw, and the save failed on iOS while passing
  // everywhere else.
  const rt = tx([ENTRY_STORE], "readonly");
  const existing = await reqDone(rt.store(ENTRY_STORE).getAllKeys());
  await rt.done;

  const keep = new Set(records.map(r => r.id));
  const drop = existing.filter(k => !keep.has(k)); // deleted since the last write

  // From here to `await done` there is not a single await: the transaction stays alive
  // because it always has a pending request.
  const { store, done } = tx([ENTRY_STORE, IMAGE_STORE], "readwrite");
  const es = store(ENTRY_STORE);
  const is = store(IMAGE_STORE);
  for (const k of drop) es.delete(k);
  for (const rec of records) es.put(rec);
  for (const id of pendingImages) is.put({ id, blob: blobs.get(id) });
  await done;
  for (const id of pendingImages) persisted.add(id);
}

// ---------- migration off localStorage ----------
// Non-destructive by design. Entries and photos are copied into IndexedDB and read back
// before anything is touched; only once that read-back matches does the old key get its
// photos stripped — which is what actually frees the 5MB and lets the small keys
// (summaries, preferences) start saving again. The entry text stays behind in localStorage
// as a plain fallback, so even a total IndexedDB failure leaves the words recoverable.

export async function migrateFromLocalStorage() {
  if (!db) return { ran: false, reason: "no db" };

  const { store: mStore, done: mDone } = tx([META_STORE], "readonly");
  const flag = await reqDone(mStore(META_STORE).get("migrated"));
  await mDone;
  if (flag && flag.v) return { ran: false, reason: "already migrated" };

  let raw = null;
  try { raw = localStorage.getItem(LEGACY_ENTRIES_KEY); } catch (e) {}
  if (!raw) {
    await setMeta("migrated", true);
    return { ran: false, reason: "nothing to migrate" };
  }

  let legacy;
  try { legacy = JSON.parse(raw); } catch (e) { return { ran: false, reason: "legacy json unreadable" }; }
  if (!Array.isArray(legacy) || !legacy.length) {
    await setMeta("migrated", true);
    return { ran: false, reason: "legacy store empty" };
  }

  // don't overwrite a store that already has entries — a second device, or a re-run
  const { store: cStore, done: cDone } = tx([ENTRY_STORE], "readonly");
  const already = await reqDone(cStore(ENTRY_STORE).count());
  await cDone;
  if (already > 0) {
    await setMeta("migrated", true);
    return { ran: false, reason: "indexeddb already populated" };
  }

  await writeAll(legacy);

  // read back before trusting it
  const check = await loadEntries();
  if (check.length !== legacy.length) {
    return { ran: false, reason: `verify failed: ${check.length}/${legacy.length}` };
  }

  const photos = legacy.reduce((n, e) => n + (e.images ? Object.keys(e.images).length : 0), 0);
  const freed = raw.length;

  // verified — now strip the photos out of the old copy to reclaim the space
  try {
    const slim = legacy.map(e => { const c = { ...e }; delete c.images; return c; });
    localStorage.setItem(LEGACY_ENTRIES_KEY, JSON.stringify(slim));
  } catch (e) {
    // couldn't rewrite it; harmless — IndexedDB has everything, localStorage just stays full
  }
  await setMeta("migrated", true);
  await setMeta("migratedAt", new Date().toISOString());

  return { ran: true, entries: legacy.length, photos, freedBytes: freed };
}

async function setMeta(k, v) {
  const { store, done } = tx([META_STORE], "readwrite");
  store(META_STORE).put({ k, v });
  await done;
}

// ---------- diagnostics ----------
// Exposed so Settings can show real numbers instead of you having to plug a phone into a Mac.

export async function storageReport() {
  const out = { entries: 0, images: 0, imageBytes: 0, quota: null, usage: null, legacyBytes: 0 };
  if (db) {
    // count(), never getAll(). Reading every blob to sum their sizes pulled megabytes into
    // memory to render one line of text, and on a phone it simply never came back.
    const et = tx([ENTRY_STORE], "readonly");
    out.entries = await reqDone(et.store(ENTRY_STORE).count());
    await et.done;
    const it = tx([IMAGE_STORE], "readonly");
    out.images = await reqDone(it.store(IMAGE_STORE).count());
    await it.done;
    // sizes come from the copies already in memory — free, and accurate for everything loaded
    for (const b of blobs.values()) out.imageBytes += b.size || 0;
  }
  try {
    const est = await Promise.race([
      navigator.storage.estimate(),
      new Promise(r => setTimeout(() => r(null), 3000))
    ]);
    if (est) { out.quota = est.quota; out.usage = est.usage; }
  } catch (e) {}
  try { out.legacyBytes = (localStorage.getItem(LEGACY_ENTRIES_KEY) || "").length; } catch (e) {}
  return out;
}

/** Ask the browser to stop evicting us. Safari clears script storage after 7 idle days
 *  unless the site is persisted; a home-screen install usually gets this granted silently. */
export async function requestPersistence() {
  try {
    if (navigator.storage && navigator.storage.persist) {
      if (await navigator.storage.persisted()) return true;
      return await navigator.storage.persist();
    }
  } catch (e) {}
  return false;
}

/** Why this device may lose everything, in the two terms that decide it.
 *
 *  WebKit deletes all script-writable storage — localStorage AND IndexedDB — after seven
 *  days of Safari use without a visit to the site. First party, no exceptions asked for and
 *  none given. That is what takes the cloud config with it: the Worker address and the
 *  secret live in localStorage, so a phone that goes a week untouched comes back looking
 *  like a device that was never set up.
 *
 *  Two things exempt a site: storage the browser has agreed to persist, and a home-screen
 *  install (which is also how Safari decides to grant the first). Anything else on WebKit is
 *  living on a seven-day clock.
 */
export async function persistenceState() {
  let persisted = false;
  try {
    if (navigator.storage && navigator.storage.persisted) persisted = !!(await navigator.storage.persisted());
  } catch (e) {}

  const standalone = (typeof navigator !== "undefined" && navigator.standalone === true)
    || !!(window.matchMedia && window.matchMedia("(display-mode: standalone)").matches);

  // Chrome and Firefox evict only under real storage pressure, and warning there would be
  // crying wolf. The seven-day rule is WebKit's alone.
  const ua = navigator.userAgent || "";
  const webkit = /^((?!chrome|android|crios|fxios|edg).)*safari/i.test(ua);

  return { persisted, standalone, webkit, atRisk: webkit && !persisted && !standalone };
}
