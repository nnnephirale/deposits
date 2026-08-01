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
const blobs = new Map();  // image id -> Blob: what gets uploaded, and the real bytes
const urls = new Map();   // image id -> object URL: what the DOM renders
let onError = () => {};

/** Report a failed write. The whole point of this module: a save that doesn't land says so. */
export function onStoreError(fn) { onError = fn; }

export function imageBlob(id) { return blobs.get(id); }
export function imageIds() { return [...blobs.keys()]; }

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

function urlFor(id, blob) {
  const prev = urls.get(id);
  if (prev) URL.revokeObjectURL(prev);
  const u = URL.createObjectURL(blob);
  urls.set(id, u);
  return u;
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
  const rows = await reqDone(store(ENTRY_STORE).getAll());
  const imgs = await reqDone(store(IMAGE_STORE).getAll());
  await done;
  for (const rec of imgs) if (rec && rec.blob) blobs.set(rec.id, rec.blob);
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
    const ids = [];
    if (e.images) {
      for (const [id, val] of Object.entries(e.images)) {
        const url = adoptImage(id, val);
        if (url) { ids.push(id); if (blobs.has(id)) pendingImages.push(id); }
      }
    }
    if (ids.length) rec.imageIds = ids;
    return rec;
  });

  const { store, done } = tx([ENTRY_STORE, IMAGE_STORE], "readwrite");
  const es = store(ENTRY_STORE);
  const is = store(IMAGE_STORE);
  const keep = new Set(records.map(r => r.id));
  // entries deleted since the last write have to go, or a delete would never stick
  const existing = await reqDone(es.getAllKeys());
  for (const k of existing) if (!keep.has(k)) es.delete(k);
  for (const rec of records) es.put(rec);
  for (const id of pendingImages) is.put({ id, blob: blobs.get(id) });
  await done;
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
    const { store, done } = tx([ENTRY_STORE, IMAGE_STORE], "readonly");
    out.entries = await reqDone(store(ENTRY_STORE).count());
    const imgs = await reqDone(store(IMAGE_STORE).getAll());
    await done;
    out.images = imgs.length;
    out.imageBytes = imgs.reduce((n, r) => n + ((r.blob && r.blob.size) || 0), 0);
  }
  try {
    const est = await navigator.storage.estimate();
    out.quota = est.quota; out.usage = est.usage;
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
