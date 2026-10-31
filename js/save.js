// Saving entries, and the alert that stays up when a save fails.

import { el } from "./dom.js";
import { saveTombstones, syncPushEntries, tombstones } from "./sync-ui.js";
import { persistEntries } from "./store.js";

// ---------- storage ----------
// Entries and photos live in IndexedDB (js/store.js). localStorage keeps only the small
// things — preferences, summaries, tombstones — which is all it was ever big enough for.
// saveEntries stays synchronous to its callers: memory is updated at once, the durable
// write happens behind it, and a write that fails raises the banner instead of going quiet.
export function saveEntries(list) {
  if (typeof tombstones === "object") { // a live entry supersedes any prior delete of the same id
    let touched = false;
    for (const e of list) if (tombstones[e.id]) { delete tombstones[e.id]; touched = true; }
    if (touched) saveTombstones();
  }
  persistEntries(list);
  if (typeof syncPushEntries === "function") syncPushEntries(); // best-effort cloud push
}

// A failed save used to be invisible: the entry stayed on screen and died at the next
// reload. Now it says so, and keeps saying so until a save lands.
let saveAlertEl = null;
export function showSaveAlert(err) {
  console.error("deposits: save failed", err);
  if (!saveAlertEl) {
    saveAlertEl = el("div", { class: "save-alert", role: "alert" },
      el("strong", null, "This didn't save."),
      el("span", null, "Your words are still on screen but not stored yet. Export from the menu before closing the app."));
    document.body.appendChild(saveAlertEl);
  }
  saveAlertEl.classList.add("show");
}
function clearSaveAlert() { if (saveAlertEl) saveAlertEl.classList.remove("show"); }
