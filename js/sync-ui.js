// Cloud sync as the app sees it: tombstones, push and pull, the health dot, staying connected.
// The transport itself is sync.js.

import { S } from "./state.js";
import { el } from "./dom.js";
import { TAX_KEY, applyTaxonomy, taxonomyDoc, taxonomyUpdatedAt } from "./taxonomy.js";
import { saveEntries } from "./save.js";
import { imagesUsedIn } from "./richtext.js";
import { saveWeekSummaries, saveWeekSummaryVersions, weekSummaries, weekSummaryVersions } from "./week-summary.js";
import { render } from "./render.js";
import { cloudConfigured, fetchState, imageIdsIn, onSyncHealth, pullImages, pushImages, pushState, setupLink, syncHealth } from "./sync.js";
import { hasImage, imageBlob, imageUrl, persistenceState, putImage } from "./store.js";

// ---------- cloud sync (Cloudflare R2, optional) ----------
// local-first: IndexedDB stays the source of truth for instant/offline capture. When a
// Worker URL and secret are set, changes push up and remote changes merge down (last-write-
// wins on updatedAt). Every path no-ops cleanly when unconfigured or offline — the app never
// depends on it.
//
// Photos never travel in this payload. They are separate objects in the bucket, uploaded
// once and pulled once per device into IndexedDB. The previous backend kept them as base64
// inside the rows and refetched every one on every launch, which is what exhausted a shared
// free tier and paused the project.

function syncActive() { return cloudConfigured(); }

// ---------- is it actually working? ----------
// The dot next to Settings used to be lit by having a config, which is not the same claim as
// "your entries are reaching the cloud" — and on the device where those two came apart, it
// said nothing. Green now means a request landed; amber means the last one didn't.

export function syncDotClass() {
  if (!cloudConfigured()) return "";
  return syncHealth().failing ? " warn" : " live";
}
// Repaint in place: health changes between renders, and a full render to move a 6px dot is
// both wasteful and capable of stealing a caret out of the composer.
function paintSyncDot() {
  document.querySelectorAll(".ico-dot").forEach(d => { d.className = "ico-dot" + syncDotClass(); });
}
onSyncHealth(paintSyncDot);

/** "just now" / "6 minutes ago" / "9 days ago" — the number that makes a stale sync obvious. */
function agoText(iso) {
  if (!iso) return null;
  const then = Date.parse(iso);
  if (!then) return null;
  const mins = Math.round((Date.now() - then) / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return mins + " minute" + (mins === 1 ? "" : "s") + " ago";
  const hrs = Math.round(mins / 60);
  if (hrs < 36) return hrs + " hour" + (hrs === 1 ? "" : "s") + " ago";
  const days = Math.round(hrs / 24);
  return days + " day" + (days === 1 ? "" : "s") + " ago";
}

// ---------- staying connected ----------
// Why this phone kept ending up disconnected: WebKit deletes all script-writable storage —
// localStorage and IndexedDB together — after seven days of Safari use without a visit, and
// the Worker address and secret live in localStorage. requestPersistence() asks to be spared
// and is usually refused in a plain tab.
//
// Rather than explain that to the one person who uses this, put the key somewhere the sweep
// can't reach: the URL of the home-screen icon. A bookmark is not script-writable storage.
// An icon whose URL carries #w=…&k=… re-seeds the config on every cold launch, so a wiped
// device opens, reconnects and pulls all its entries back down without anyone noticing it
// had been wiped. Set up once, and the failure mode is gone rather than described.

S.storageRisk = null;   // { persisted, standalone, webkit, atRisk } once resolved

/** The one-time move, offered only on a device that is actually exposed. */
export function keepConnectedRow() {
  const wrap = el("div", { style: { display: "none" } });
  const line = el("p", { class: "settings-note", style: { margin: "6px 0 0" } });

  const btn = el("button", { class: "lock-btn", style: { marginTop: "10px" }, onclick: async () => {
    const link = setupLink();
    if (!link) return;
    // A home-screen app has no share button of its own, so from there the link has to travel
    // back to Safari to be installed.
    if (S.storageRisk && S.storageRisk.standalone) {
      try {
        await navigator.clipboard.writeText(link);
        line.textContent = "copied. open Safari, paste it in, then Share \u2192 \u201cAdd to Home Screen\u201d. "
          + "use that new icon from now on and it stays connected on its own.";
      } catch (e) {
        line.textContent = link;
      }
      return;
    }
    history.replaceState(null, "", link);
    btn.textContent = "the address bar is ready";
    line.textContent = "tap the share button, then \u201cAdd to Home Screen\u201d, and open deposits from that icon. "
      + "it carries your key, so it reconnects itself \u2014 even if Safari clears everything.";
  } }, "keep this device connected");

  wrap.appendChild(btn);
  wrap.appendChild(line);

  const fill = st => {
    // Persistent storage granted means the browser has already promised to keep this; there
    // is nothing to fix and nothing to say.
    if (st && st.webkit && !st.persisted) wrap.style.display = "";
  };
  if (S.storageRisk) fill(S.storageRisk);
  else persistenceState().then(st => { S.storageRisk = st; fill(st); }).catch(() => {});
  return wrap;
}

/** The line Settings shows under the address: what the last round-trip actually did. */
export function syncHealthText() {
  const h = syncHealth();
  const last = agoText(h.lastOkAt);
  if (h.failing) {
    return "not reaching it: " + h.lastError
      + (last ? " — last synced " + last + "." : " — nothing has synced from this device yet.");
  }
  if (last) return "last synced " + last + ".";
  return "nothing has synced from this device yet.";
}

// the etag of the bucket object we last read: sent back on write so a device that wrote in
// between gets a 412 instead of being flattened.
let cloudEtag = null;

// tombstones: ids/keys deleted locally, retained so the deletion still propagates on the
// next push (survives being offline at delete time).
const TOMB_KEY = "weekly-deposits-tombstones";
const SUM_TOMB_KEY = "weekly-deposits-summary-tombstones";
export let tombstones = {}, summaryTombstones = {};
try { tombstones = JSON.parse(localStorage.getItem(TOMB_KEY)) || {}; } catch (e) {}
try { summaryTombstones = JSON.parse(localStorage.getItem(SUM_TOMB_KEY)) || {}; } catch (e) {}
export function saveTombstones() {
  try { localStorage.setItem(TOMB_KEY, JSON.stringify(tombstones)); } catch (e) {}
  try { localStorage.setItem(SUM_TOMB_KEY, JSON.stringify(summaryTombstones)); } catch (e) {}
}
export function tombstoneEntry(id) { tombstones[id] = new Date().toISOString(); saveTombstones(); }
export function tombstoneSummary(k) { summaryTombstones[k] = new Date().toISOString(); saveTombstones(); }

// The wire shape: the entry as the app holds it, with the photo map replaced by bare ids.
// The bytes live in the bucket under those ids.
// The union matters: a device that hasn't downloaded a photo yet still holds its id, and
// pushing without it would delete that photo's reference for every other device too.
function entryToWire(e) {
  const w = { ...e };
  delete w.images;
  const ids = new Set([...(e.imageIds || []), ...(e.images ? Object.keys(e.images) : [])]);
  if (ids.size) w.imageIds = [...ids]; else delete w.imageIds;
  return w;
}
// Rebuild the photo map from whatever this device already holds locally, keeping the id list
// either way. Photos not here yet are filled in by the background pull, so an entry renders
// immediately with its text rather than waiting on its images.
function wireToEntry(w) {
  const e = { ...w };
  const ids = w.imageIds || [];
  if (ids.length) {
    e.imageIds = ids;
    const m = {};
    for (const id of ids) { const u = imageUrl(id); if (u) m[id] = u; }
    if (Object.keys(m).length) e.images = m;
  }
  return e;
}
export function summaryUpdatedAt(rec) { return rec.updatedAt || rec.createdAt || new Date(0).toISOString(); }

// pull remote state and merge into local (last-write-wins). returns true if local changed.
export async function syncPull() {
  if (!syncActive()) return false;
  let changed = false;
  let remote;
  try {
    remote = await fetchState();
    cloudEtag = remote.etag;
  } catch (e) {
    console.warn("sync pull failed", e);
    return false;   // never fall through to a push on a failed pull — see pushEntriesNow
  }

  const byId = new Map(S.entries.map(e => [e.id, e]));
  for (const w of remote.entries) {
    if (w.deletedAt) {
      if (byId.delete(w.id)) changed = true;
      tombstones[w.id] = w.deletedAt;
      continue;
    }
    if (tombstones[w.id] && new Date(tombstones[w.id]) >= new Date(w.updatedAt)) continue; // local delete wins
    const local = byId.get(w.id);
    if (!local || new Date(w.updatedAt) >= new Date(local.updatedAt || local.createdAt)) {
      const ne = wireToEntry(w);
      // don't let a copy whose photos this device hasn't downloaded yet drop images we
      // already hold for markers the text still references
      if (local && local.images) {
        const keep = imagesUsedIn(ne.text, local.images);
        ne.images = { ...keep, ...(ne.images || {}) };
        if (!Object.keys(ne.images).length) delete ne.images;
      }
      byId.set(w.id, ne); changed = true;
    }
  }
  S.entries = [...byId.values()];

  // remote deletions of summaries, then remote summaries themselves
  for (const [k, ts] of Object.entries(remote.tombstones || {})) {
    if (!tombstones[k] || new Date(ts) > new Date(tombstones[k])) tombstones[k] = ts;
  }
  for (const [k, r] of Object.entries(remote.summaries || {})) {
    if (r && r.deletedAt) {
      // A DELETION IS DATED AND SO IS A SUMMARY, and the newer one wins — the entries merge two
      // loops up has always compared them and this did not. A summary tombstone lives in the
      // cloud document forever (nothing collects them), so a week cleared once was a week whose
      // every future summary was deleted on the next pull: generate it, watch it save, and lose
      // it silently the next time the app opened. The write to summaryTombstones was the second
      // half of it, re-arming the deletion this device had already retired.
      const local = weekSummaries[k];
      if (local && new Date(summaryUpdatedAt(local)) > new Date(r.deletedAt)) continue;
      if (weekSummaries[k]) { delete weekSummaries[k]; changed = true; }
      if (weekSummaryVersions[k]) { delete weekSummaryVersions[k]; saveWeekSummaryVersions(); }
      summaryTombstones[k] = r.deletedAt;
      continue;
    }
    if (summaryTombstones[k] && new Date(summaryTombstones[k]) >= new Date(summaryUpdatedAt(r))) continue;
    const local = weekSummaries[k];
    if (!local || new Date(summaryUpdatedAt(r)) >= new Date(summaryUpdatedAt(local))) {
      weekSummaries[k] = r; changed = true;
    }
  }

  // her tag names, colours and the ones she's added — last-write-wins on the taxonomy's own
  // stamp, independent of the entries. Two guards, both about not mistaking silence for a
  // deletion: a doc with no taxonomy key at all (an older Worker drops it, see putEntries) and
  // one with no stamp are both left alone rather than read as "she cleared her tags".
  const rtax = remote.taxonomy;
  if (rtax && rtax.updatedAt &&
      (!taxonomyUpdatedAt || new Date(rtax.updatedAt) > new Date(taxonomyUpdatedAt))) {
    if (applyTaxonomy(rtax)) {
      try { localStorage.setItem(TAX_KEY, JSON.stringify(taxonomyDoc())); } catch (e) {}
      changed = true;
    }
  }

  saveTombstones();
  if (changed) { saveEntries(S.entries); saveWeekSummaries(); }

  // photos this device is missing, fetched in the background — the entries are already up
  pullMissingImages();
  return changed;
}

// Photo transfer runs behind the entries and reports where it is, so a slow connection
// looks like progress rather than a hang.
export let photoStatus = null;            // { done, total } while transferring, else null
S.onPhotoProgress = null;        // Settings subscribes to this while its sheet is open
function photoProgress(done, total) {
  photoStatus = done >= total ? null : { done, total };
  if (S.onPhotoProgress) S.onPhotoProgress(photoStatus, done, total);
}

// Each photo is fetched at most once, ever, and then lives in IndexedDB. This is the whole
// difference from the old backend, which re-downloaded all of them on every launch.
// `force` re-fetches everything, for when local copies are there but unusable.
let pullingImages = false;
export async function pullMissingImages(force) {
  if (!syncActive() || pullingImages) return { got: 0, failed: 0, total: 0 };
  pullingImages = true;
  try {
    const wanted = imageIdsIn(S.entries);
    const missing = force ? wanted : wanted.filter(id => !hasImage(id));
    if (!missing.length) return { got: 0, failed: 0, total: 0 };
    const res = await pullImages(missing, force ? () => false : hasImage, putImage, photoProgress);
    if (res.got) {
      S.entries = S.entries.map(e => {
        const ids = e.imageIds || (e.images ? Object.keys(e.images) : []);
        if (!ids.length) return e;
        const m = {};
        for (const id of ids) { const u = imageUrl(id); if (u) m[id] = u; }
        return Object.keys(m).length ? { ...e, images: m } : e;
      });
      render();
    }
    return res;
  } catch (e) {
    console.warn("photo pull failed", e);
    return { got: 0, failed: 0, total: 0 };
  } finally {
    pullingImages = false;
    photoStatus = null;
  }
}

let entryPushT = null, summaryPushT = null;
export function syncPushEntries() { if (!syncActive()) return; clearTimeout(entryPushT); entryPushT = setTimeout(pushEntriesNow, 1200); }
export function syncPushSummaries() { if (!syncActive()) return; clearTimeout(summaryPushT); summaryPushT = setTimeout(pushSummariesNow, 1200); }

// One object holds entries, tombstones and summaries together, so there is one writer and
// one conflict check rather than three racing each other.
export async function pushEntriesNow(retrying) {
  if (!syncActive()) return;
  try {
    const state = {
      entries: S.entries.map(entryToWire).concat(
        Object.entries(tombstones).map(([id, ts]) => ({ id, deletedAt: ts, updatedAt: ts }))),
      tombstones: {},
      // Tombstones for weeks that still hold a summary are NOT sent. The spread put them last,
      // so any tombstone that outlived its week — a pull can add one back without
      // saveWeekSummaries running to clear it — overwrote the live record on its way up and
      // deleted that week's summary on every device. A week that has a summary is a week that
      // is not deleted; the two can never both be true in the payload now.
      summaries: {
        ...weekSummaries,
        ...Object.fromEntries(Object.entries(summaryTombstones)
          .filter(([k]) => !weekSummaries[k])
          .map(([k, ts]) => [k, { deletedAt: ts, updatedAt: ts }]))
      }
    };
    // Only once she has edited it on THIS device. Sending the untouched defaults would give a
    // device that has never been near Settings a say in the taxonomy, and its say would be
    // "everything back to the seed" — see taxonomyUpdatedAt in taxonomy.js.
    if (taxonomyUpdatedAt) state.taxonomy = taxonomyDoc();
    const res = await pushState(state, cloudEtag || undefined);
    if (res.conflict) {
      // the other device wrote while we were composing this. Re-read, re-merge, then write
      // once more — never twice, so a genuine disagreement can't spin.
      if (retrying) { console.warn("sync push: still conflicting, leaving it for the next save"); return; }
      cloudEtag = res.etag;
      await syncPull();
      return pushEntriesNow(true);
    }
    cloudEtag = res.etag;
    // photos after the text, and NOT awaited: the words have landed, and a photo upload
    // that stalls must not hold the caller (or the Settings button) open behind it
    pushImages(imageIdsIn(S.entries), imageBlob)
      .then(r => { if (r.failed) console.warn("deposits: " + r.failed + " photo upload(s) failed"); })
      .catch(e => console.warn("deposits: photo push failed", e));
  } catch (e) {
    console.warn("sync push entries failed", e);
  }
}
// summaries ride along with the entries object, so this is the same write
async function pushSummariesNow() { return pushEntriesNow(); }

export async function initSync() {
  if (!syncActive()) return;
  await syncPull();
  render();
  syncPushEntries();
}
