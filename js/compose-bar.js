// The compose bar: tap for a new entry, long-press to swap to export.

import { el, sheetRoot } from "./dom.js";
import { pauseShimmerOnScroll } from "./widgets.js";
import { activeEntries, exportHeading, toMarkdown } from "./grouping.js";
import { openComposer } from "./composer.js";

// ---------- fab: tap = new entry, long-press = swap to export ----------
export const fab = document.getElementById("fab");
const composeHint = document.querySelector(".compose-hint");
pauseShimmerOnScroll(composeHint); // window scroll — the bar is fixed, so the sweep would ride over moving cards
const EXPORT_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15V3.5"/><path d="M7.5 7.5 12 3l4.5 4.5"/><path d="M5 13v5.5A1.5 1.5 0 0 0 6.5 20h11a1.5 1.5 0 0 0 1.5-1.5V13"/></svg>';
const PLUS_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg>';
export const TICK_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5 10 17.5 19.5 7"/></svg>';
let fabMode = "add";
let fabHoldTimer = null, fabLongFired = false, fabRevertTimer = null;

// the dock's primary button is icon-based now, so every state swaps innerHTML — assigning
// textContent would drop the svg and leave a bare glyph in a 44px circle.
function setFabMode(mode) {
  fabMode = mode;
  clearTimeout(fabRevertTimer);
  fab.classList.remove("copied");
  if (mode === "export") {
    composeHint.classList.remove("shimmer"); // its svg would vanish under background-clip:text
    composeHint.innerHTML = EXPORT_ICON + "<span style=\"margin-left:8px\">export markdown</span>";
    fab.setAttribute("aria-label", "Export markdown");
    fabRevertTimer = setTimeout(() => setFabMode("add"), 5000); // untouched: fall back to +
  } else {
    composeHint.textContent = "Start typing\u2026";
    composeHint.classList.add("shimmer");
    fab.setAttribute("aria-label", "New entry");
  }
}

export async function doExport() {
  const md = toMarkdown(activeEntries(), exportHeading());
  clearTimeout(fabRevertTimer);
  try {
    await navigator.clipboard.writeText(md);
    fab.classList.add("copied");
    composeHint.classList.remove("shimmer");
    composeHint.innerHTML = TICK_ICON + "<span style=\"margin-left:8px\">copied</span>";
    setTimeout(() => setFabMode("add"), 1200);
  } catch (e) {
    setFabMode("add");
    const overlay = el("div", { class: "overlay", onclick: () => sheetRoot.innerHTML = "" });
    const sheet = el("div", { class: "sheet", onclick: ev => ev.stopPropagation() });
    sheet.appendChild(el("div", { class: "grabber" }));
    sheet.appendChild(el("p", { class: "export-note" }, "select all + copy:"));
    const ta = el("textarea", { class: "export-area", rows: "14", readonly: "readonly" });
    ta.value = md;
    ta.addEventListener("focus", () => ta.select());
    sheet.appendChild(ta);
    overlay.appendChild(sheet);
    sheetRoot.appendChild(overlay);
  }
}

fab.addEventListener("pointerdown", () => {
  fabLongFired = false;
  clearTimeout(fabHoldTimer);
  fabHoldTimer = setTimeout(() => {
    fabLongFired = true;
    setFabMode(fabMode === "add" ? "export" : "add");
  }, 500);
});
["pointerup", "pointerleave", "pointercancel"].forEach(evt =>
  fab.addEventListener(evt, () => clearTimeout(fabHoldTimer)));
fab.addEventListener("contextmenu", e => e.preventDefault());
fab.addEventListener("click", () => {
  if (fabLongFired) { fabLongFired = false; return; } // swallow the click after a long press
  if (fabMode === "add") openComposer(null);
  else doExport();
});
