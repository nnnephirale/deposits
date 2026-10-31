// Entry point: hide-on-scroll header, wiring, desktop shortcuts and boot. Imports every module,
// so this one file is all index.html needs to load. window.__deposits is the way in from the
// console.

import { S } from "./state.js";
import { sheetRoot } from "./dom.js";
import { shiftWeek, stepMonth } from "./dates.js";
import { showSaveAlert } from "./save.js";
import { initSync, pushEntriesNow, syncPull } from "./sync-ui.js";
import { activeEntries, exportHeading, toMarkdown } from "./grouping.js";
import { render } from "./render.js";
import { deskMQ, deskSearchInput } from "./rails.js";
import { openComposer } from "./composer.js";
import { openRecap, recapErrors, startMonthRecap } from "./recap.js";
import { openMenu } from "./menu.js";
import { fab } from "./compose-bar.js";
import { syncCueFade, wrapEl } from "./bloom.js";
import { flushEntries, imageBlob, loadEntries, migrateFromLocalStorage, onStoreError, openStore, persistenceState, requestPersistence, storageReport } from "./store.js";
import { cloudCheck, cloudConfig, setCloudConfig } from "./sync.js";
import "./taxonomy.js";
import "./anthropic.js";
import "./richtext.js";
import "./widgets.js";
import "./week-summary.js";
import "./prefs.js";
import "./entries.js";
import "./tuner.js";
import "./viewport.js";
import "./calendar.js";
import "./week-reveal.js";
import "./search.js";
import "./settings.js";

// ---------- header hides on scroll down, returns on scroll up ----------
const headerEl = document.querySelector(".header");
let headerLastY = window.scrollY, headerHidden = false;
function setHeaderHidden(h) {
  if (headerHidden === h) return;
  headerHidden = h;
  headerEl.classList.toggle("hidden", h);
}
// on desktop the page doesn't scroll — .wrap does — so the cue's fade has to listen there
// too, or it stays at full opacity forever in the one layout where it never scrolls off.
wrapEl.addEventListener("scroll", () => syncCueFade(wrapEl.scrollTop), { passive: true });
window.addEventListener("scroll", () => {
  const y = window.scrollY;
  syncCueFade(y);
  const dy = y - headerLastY;
  headerLastY = y;
  if (document.body.style.position === "fixed") return; // sheet open: the jump to 0 isn't a real scroll
  if (Math.abs(dy) > 240) return; // programmatic jump (sheet-close restore), not a finger
  if (y < 70) { setHeaderHidden(false); return; } // near the top the header always shows
  if (dy > 4) setHeaderHidden(true);
  else if (dy < -4) setHeaderHidden(false);
}, { passive: true });

// ---------- wiring ----------
// both live inside the compose bar, so both must stop the bar's own click
document.getElementById("composeAdd").addEventListener("click", ev => {
  ev.stopPropagation();
  openComposer(null);
});
document.getElementById("menuBtn").addEventListener("click", ev => {
  ev.stopPropagation();
  openMenu();
});
// the bar is a div (it holds a button), so give it the keyboard behaviour a button would have
fab.addEventListener("keydown", ev => {
  if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); fab.click(); }
});
function stepPeriod(delta) {
  if (S.view === "week") S.wk = shiftWeek(S.wk.year, S.wk.week, delta);
  else S.mo = stepMonth(S.mo, delta);
  S.deskTopic = null; // a filter belongs to the period it was set in
  render();
}
document.getElementById("prevBtn").addEventListener("click", () => stepPeriod(-1));
document.getElementById("nextBtn").addEventListener("click", () => stepPeriod(1));

// ---------- keyboard (desktop) ----------
// deliberately small: step the period, write, search. everything else already has a
// visible control, and a shortcut nobody can see isn't a feature.
function typingTarget(t) {
  if (!t) return false;
  const tag = t.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable;
}
function anySheetOpen() {
  return sheetRoot.childElementCount > 0 || !!document.querySelector(".read-back, .img-preview-back");
}
document.addEventListener("keydown", ev => {
  // the scope pull-down closes before anything else claims Escape
  if (ev.key === "Escape" && S.deskScopeOpen) { ev.stopPropagation(); S.deskScopeOpen = false; render(); return; }
  const meta = ev.metaKey || ev.ctrlKey;
  // ⌘K reaches search only when nothing is open over the list. With a sheet up the key
  // belongs to that sheet — the composer claims it for paste-a-link, and the search sheet IS
  // what this would have opened. Focusing the rail field behind an overlay was the bug.
  if (meta && (ev.key === "k" || ev.key === "K")) {
    if (anySheetOpen()) return;
    ev.preventDefault();
    if (deskMQ.matches && deskSearchInput) deskSearchInput.focus();
    else openMenu();
    return;
  }
  if (meta && (ev.key === "n" || ev.key === "N")) {
    if (anySheetOpen()) return;
    ev.preventDefault();
    openComposer(null);
    return;
  }
  if (meta || ev.altKey || typingTarget(ev.target) || anySheetOpen()) return;
  if (ev.key === "ArrowLeft") { ev.preventDefault(); stepPeriod(-1); }
  else if (ev.key === "ArrowRight") { ev.preventDefault(); stepPeriod(1); }
});

// ---------- boot ----------
// Opening IndexedDB is async, so the first render waits for it — a render against an empty
// list would flash an empty week and, worse, a save landing in that window would persist the
// emptiness over the real entries.
(async () => {
  onStoreError(showSaveAlert);
  try {
    await openStore();
  } catch (err) {
    // No IndexedDB (private mode, a locked-down browser). Fall back to the old localStorage
    // copy so the app still opens read-mostly, and say plainly that saves won't stick.
    console.error("deposits: indexeddb unavailable", err);
    try { S.entries = JSON.parse(localStorage.getItem("weekly-deposits-entries")) || []; } catch (e) { S.entries = []; }
    render();
    showSaveAlert(err);
    return;
  }

  const migration = await migrateFromLocalStorage().catch(err => {
    console.error("deposits: migration failed", err);
    return { ran: false, reason: "threw" };
  });
  if (migration.ran) {
    console.info(`deposits: moved ${migration.entries} entries and ${migration.photos} photos into IndexedDB, ` +
                 `freeing ~${Math.round(migration.freedBytes / 1024)}KB of localStorage`);
  }

  S.entries = await loadEntries();
  render();

  // Ask first, then look: a granted request is exactly what takes this device off the clock,
  // and asking after reading the answer would report a state one launch out of date.
  requestPersistence()
    .then(() => persistenceState())
    .then(st => { S.storageRisk = st; })
    .catch(() => {});

  // restore any existing session and reconcile with the cloud (async; local render already happened)
  initSync();
})();

// A pending write must not die with the page. pagehide is the one event iOS reliably fires
// when an app is backgrounded or killed; visibilitychange covers the tab-switch case.
window.addEventListener("pagehide", () => { flushEntries(); });
document.addEventListener("visibilitychange", () => { if (document.hidden) flushEntries(); });

// Module scope hides everything from the console, and we have been leaning on the console to
// diagnose exactly this kind of problem. One deliberate handle, rather than leaking the lot.
window.__deposits = {
  get entries() { return S.entries; },
  report: storageReport,
  imageBlob,
  flush: flushEntries,
  export: () => toMarkdown(activeEntries(), exportHeading()),
  cloud: cloudConfig,
  connect: cfg => { setCloudConfig(cfg); return cloudCheck(); },
  sync: async () => { await syncPull(); await pushEntriesNow(); render(); },
  // A month's reading, on demand. The door in the UI is a scrub gesture on the chevron and
  // then a button on the deck's last card, which is a long way to go when what you want to
  // know is whether the call itself works. Defaults to the month on screen.
  recap: (year, month) => startMonthRecap(year == null ? S.mo.year : year, month == null ? S.mo.month : month),
  // and the one that opens a reading already written, without the scrub gesture
  read: (year, month) => openRecap(year == null ? S.mo.year : year, month == null ? S.mo.month : month),
  recapErrors: () => ({ ...recapErrors })
};
