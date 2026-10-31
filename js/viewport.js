// What a phone composer measures against: the visual viewport, the caret's position, the
// keyboard's remembered height, page-scroll lock, the sheet's saved height.

import { S } from "./state.js";
import { el } from "./dom.js";
import { lastViewId } from "./render.js";
import { deskMQ } from "./rails.js";

// ---------- the visual viewport ----------
// The keyboard does NOT shrink the layout viewport on iOS: 100dvh reads exactly the same with
// it open, so a sheet sized in dvh is taller than the room left above it. Safari's response is
// to scroll the visual viewport up until the caret is visible, and since a position:fixed
// overlay is placed against the LAYOUT viewport, that scroll drags the whole composer off the
// top of the screen — reported as "the keyboard pushes the composer up and I can't see what I
// type". These two vars are the fix's raw material: --vvh caps the sheet to what's visible (so
// there is nothing left for Safari to scroll) and --vvt puts the overlay back over it.
// resize fires when the keyboard opens/closes; scroll fires when Safari chases the caret.
export const vvp = window.visualViewport;
// the live composer's field re-measure, registered by build(). autoGrow pins an explicit pixel
// height on the textarea, so when the sheet shrinks under it the field keeps its old size and
// puts the caret back out of reach — the same trap setSheetHeight already clears by hand. One
// at a time, dropped on close: build() makes a new textarea on every rebuild.
S.sheetViewportSync = null;
// the live composer's fmt-bar re-home, registered by build(). The bar's DOM parent depends on
// the breakpoint (docked pill on a phone, in-flow row on desktop) and crossing it doesn't
// rebuild the composer, so the crossing has to reach in and move it. Dropped on close.
S.composerFmtReattach = null;

// ---------- where the caret is, in pixels ----------
// The composer's field grows to its full content height and the SHEET does the scrolling, so
// the textarea never has an overflow of its own — and a caret that is inside its own element's
// box is a caret no browser has any reason to scroll into view. Past the first screenful that
// reads as the text being eaten: new lines land behind the docked format pill and the keyboard
// and nothing follows them down. Safari's own caret-chase is no help either — it scrolls the
// VISUAL viewport, which is exactly what --vvh is built to leave nothing to scroll.
//
// So the caret is measured and the sheet is scrolled by hand. There is no API for a textarea's
// caret position, so this is the mirror trick: a hidden div carrying the field's own metrics
// (font, width, padding, wrapping) with the text up to the caret inside it, laid out by the
// same engine the field uses. A wrapped line therefore counts exactly as the field wraps it,
// which counting "\n"s cannot do.
//
// One mirror for the whole app, made on demand and left in place: it is a single hidden div,
// and the composer is rebuilt often enough (every tag pick, every day change) that a per-build
// one would be a slow leak.
let caretMirror = null;
// every property that can move a line break — anything missed here shows up as the caret
// drifting a line or two out once the text wraps
const CARET_MIRROR_PROPS = [
  "fontFamily", "fontSize", "fontWeight", "fontStyle", "fontVariant", "lineHeight",
  "letterSpacing", "wordSpacing", "textTransform", "textIndent", "textRendering",
  "paddingTop", "paddingRight", "paddingBottom", "paddingLeft",
  "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth", "tabSize"
];
/** The caret line's offset from the top of a textarea's border box, and its height. */
export function caretLineIn(ta) {
  if (!caretMirror) {
    caretMirror = el("div", { class: "caret-mirror", "aria-hidden": "true" });
    document.body.appendChild(caretMirror);
  }
  const cs = getComputedStyle(ta);
  caretMirror.style.width = ta.clientWidth + "px";
  for (const p of CARET_MIRROR_PROPS) caretMirror.style[p] = cs[p];
  caretMirror.textContent = ta.value.slice(0, ta.selectionEnd);
  // a zero-width SPACE rather than an empty span: an empty inline box has no rect to read, and
  // a caret sitting just after a newline needs a box on the new line, not the end of the old one
  const mark = el("span", null, "\u200B");
  caretMirror.appendChild(mark);
  const mr = caretMirror.getBoundingClientRect(), sr = mark.getBoundingClientRect();
  return { top: sr.top - mr.top, height: sr.height || parseFloat(cs.lineHeight) || 22 };
}

// ---------- the keyboard's height, remembered ----------
// iOS won't tell you how tall the keyboard is until it has already opened, so it can only be
// learned from the last time. The FIRST composer on a fresh install still adjusts when the
// keyboard lands; every one after that opens already sized for it. The 80px floor keeps
// Safari's collapsing toolbar out of the number, and the 600 ceiling keeps a junk value from
// swallowing the whole screen.
// Only devices that actually HAVE a soft keyboard may learn or reserve. Without this gate a
// plain window resize on desktop reads as a keyboard: the first cut used a bare "the visual
// viewport is >80px shorter than innerHeight" test, caught an 88px difference while the window
// was being resized, cached it, and from then on padded the desktop composer by 88px of nothing.
const SOFT_KB = window.matchMedia("(hover: none) and (pointer: coarse)").matches;
// 140px floor, not 80: Safari's collapsing URL bar is ~60–90px and iOS's accessory bar alone is
// ~50px, and neither is a keyboard. A real phone keyboard is ~250–400px.
const KB_MIN = 140;
const KB_KEY = "weekly-deposits-kb-h-v2";   // v2: the old key may hold a resize mistaken for a keyboard
let kbHeight = 0;
try {
  const v = parseInt(localStorage.getItem(KB_KEY), 10);
  if (v >= KB_MIN && v < 600) kbHeight = v;
} catch (e) {}

// --kbr is the band held back for a keyboard that is on its way but hasn't arrived. The BACKDROP
// still covers the whole visible viewport (--vvh) — reserving by shrinking --vvh instead would
// leave the list showing unblurred under the sheet. Only the sheet's own ceiling is reduced.
// --vvh shrinks and --kbr is handed back in the same frame, and the sheet is measured against
// the difference, so the keyboard's arrival is a no-op instead of a jump.
let kbReserve = 0, kbReserveTimer = null;
function setKbReserve(px) {
  kbReserve = Math.max(0, Math.round(px));
  document.documentElement.style.setProperty("--kbr", kbReserve + "px");
}
export function reserveForKeyboard() {
  clearTimeout(kbReserveTimer);
  if (!SOFT_KB || !kbHeight) return;                          // no soft keyboard, or nothing learned
  if (vvp && vvp.height < window.innerHeight - KB_MIN) return; // already up: --vvh has it
  setKbReserve(kbHeight);
  // a hardware keyboard means it never comes, and a dismissed one means it left again — either
  // way don't sit on the band forever, or the composer stays short for no reason
  kbReserveTimer = setTimeout(() => setKbReserve(0), 1400);
}
export function clearKeyboardReserve() {
  clearTimeout(kbReserveTimer);
  setKbReserve(0);
}
// The keyboard RE-opening is not as well announced as its first arrival. Focus a field again
// after dismissing it and iOS can bring the keyboard back without firing a visualViewport resize
// or scroll that lands on the settled geometry — so --vvh/--vvt/--vvb keep describing a screen
// with no keyboard on it, and anything docked to that measurement stays down where the keyboard
// now is. It came back the moment the page was scrolled, which is simply the next event that
// happened to run syncViewportVars: the reading was always available, nothing had asked for it.
// So ask, on a short ladder rather than once — the geometry settles somewhere inside the
// keyboard's own animation and the exact frame isn't knowable. reserveForKeyboard() alongside it
// covers the same gap from the other side, predicting the band from the cached height so the
// first frame is already right; syncViewportVars hands the reserve back as soon as a real
// measurement disagrees.
let kbResyncTimers = [];
export function resyncForKeyboard() {
  kbResyncTimers.forEach(clearTimeout);
  kbResyncTimers = [60, 180, 350, 600, 900].map(d => setTimeout(syncViewportVars, d));
  reserveForKeyboard();
}

function syncViewportVars() {
  const s = document.documentElement.style;
  const h = Math.round(vvp ? vvp.height : window.innerHeight);
  const t = Math.round(vvp ? vvp.offsetTop : 0);
  s.setProperty("--vvh", h + "px");
  s.setProperty("--vvt", t + "px");
  // How much of the LAYOUT viewport the keyboard (plus iOS's own accessory bar) is sitting on
  // top of. Overlays run to the screen bottom, so this is what their content has to be lifted
  // by — expressed in layout coordinates, which is why --vvt belongs in the sum: the visual
  // viewport's bottom edge is at --vvt + --vvh, and everything below that is covered.
  // Gated the same way the cache is: anything under KB_MIN is a collapsing toolbar or a window
  // being dragged, not a keyboard, and padding the sheet by it is a visible glitch.
  const band = Math.max(0, window.innerHeight - (h + t));
  const isKb = SOFT_KB && band >= KB_MIN && band < 600;
  s.setProperty("--kb", (isKb ? band : 0) + "px");
  // The same measurement, UNGATED. --kb's gates exist to protect the cached keyboard HEIGHT from
  // learning a window-drag or a collapsing toolbar; they are wrong for anything that just needs
  // to sit on top of whatever is covering the screen right now. Something docked to the keyboard
  // via --kb drops to the bottom and hides under it the moment a reading falls outside the gate
  // (band under KB_MIN, or SOFT_KB false), and it stays there, because nothing re-opens the gate.
  // --vvb is simply "how far the visual viewport's bottom is above the screen's" — no
  // classification, so nothing to get wrong and nothing to get stuck.
  s.setProperty("--vvb", band + "px");
  if (isKb) {
    // Hand the reserved band back — --vvh accounts for the real keyboard now. Trusting the
    // measurement over the prediction is what self-corrects a stale cache: worst case one small
    // adjustment, never the full-height jump. This runs on every reading, scrolled or not.
    if (kbReserve) clearKeyboardReserve();
    // But only LEARN from an undistorted one (t ≈ 0). Once Safari has scrolled the visual
    // viewport, the band describes keyboard + scroll rather than the keyboard, and caching that
    // would over-reserve on the next open. t is 0 at the moment a keyboard first appears, which
    // is the reading we wanted anyway.
    if (t < 4 && band !== kbHeight) {
      kbHeight = band;
      try { localStorage.setItem(KB_KEY, String(band)); } catch (e) {}
    }
  }
}
syncViewportVars();
if (vvp) {
  // resize = the keyboard came or went, so the field has to be re-measured too. scroll = Safari
  // chasing the caret, which only needs the overlay moved — re-measuring on every one of those
  // would be dozens of reflows per keystroke.
  vvp.addEventListener("resize", () => {
    syncViewportVars();
    if (S.sheetViewportSync) S.sheetViewportSync();
  });
  vvp.addEventListener("scroll", syncViewportVars);
}
// orientation lands before the new metrics do, hence the beat
window.addEventListener("orientationchange", () => setTimeout(() => {
  syncViewportVars();
  if (S.sheetViewportSync) S.sheetViewportSync();
}, 80));

// pinned so the list behind a sheet can't scroll while it's open (iOS scroll-chaining fix).
// The desktop three-pane deck scrolls .wrap itself (position: absolute; overflow-y: auto) —
// the page never scrolls there at all, per the comment on that rule — so pinning body.style
// only fixes the phone. Locking .wrap too is deskMQ-gated: below the desktop breakpoint .wrap
// has no overflow rule of its own (the phone scrolls the window instead, per listScroller()),
// and setting overflow-y there would flip it off its default `visible` for no reason — CSS ties
// the axes together, so overflow-y: hidden while overflow-x is still `visible` forces overflow-x
// to compute as `auto`, which can put a horizontal scrollbar where there never was one. But the
// CLEAR on unlock is unconditional, not equally gated — the breakpoint can cross while a sheet
// is open (rotate, resize the window), and checking deskMQ.matches again at unlock time would
// read the NEW breakpoint, skip clearing a lock made under the OLD one, and leave .wrap stuck
// with an inline overflow-y: hidden after crossing down to mobile. Clearing an inline style
// that was never set is a harmless no-op, so there's nothing to gate on the way out.
let composerScrollY = 0, lockedViewId = null;
export function lockPageScroll() {
  if (document.body.style.position === "fixed") return; // already locked (e.g. composer opened from search)
  composerScrollY = window.scrollY;
  lockedViewId = lastViewId; // so unlock can tell whether the list underneath is still the same one
  document.body.style.position = "fixed";
  document.body.style.top = -composerScrollY + "px";
  document.body.style.width = "100%";
  if (deskMQ.matches) { const dw = document.querySelector(".wrap"); if (dw) dw.style.overflowY = "hidden"; }
}
export function unlockPageScroll() {
  document.body.style.position = "";
  document.body.style.top = "";
  document.body.style.width = "";
  const dw = document.querySelector(".wrap");
  if (dw) dw.style.overflowY = "";
  // A remembered offset is only meaningful if it still points at the same list. Toggling day
  // view or the order from the ⋮ menu re-renders underneath a locked page, so restoring the
  // pre-menu offset would drop her partway down a list that has been reordered — while the
  // header's own week/month tabs (no lock involved) correctly start at the top. Same rule for
  // both now.
  window.scrollTo(0, lastViewId === lockedViewId ? composerScrollY : 0);
}

// document-level selectionchange hook for whichever composer textarea is live. build()
// recreates the field on every day/week change, so the previous hook has to go with it —
// one listener at a time, dropped for good when the composer closes.
let fmtSelSync = null;
export function bindFmtSelectionSync(fn) {
  if (fmtSelSync) document.removeEventListener("selectionchange", fmtSelSync);
  fmtSelSync = fn;
  if (fn) document.addEventListener("selectionchange", fn);
}

// the composer height the notch was last dragged to, remembered across opens and reloads.
// Stored as a FRACTION of the viewport, not pixels: the notch is really answering "how much
// of the screen should the composer take", and a fraction survives a window resize, a rotate,
// and the phone→desktop jump — where a saved pixel height would either clamp to the ceiling
// or turn into a sliver. Device-local on purpose (never synced): a phone and a 1440px window
// want different composers.
// -frac2: the v1 key can hold a value that was never a choice. Back when the composer opened at
// its ceiling, dragging UP clamped to the height it already had and stored that — so a phone that
// had ever felt an upward drag carries a fraction pinned to its own safe area, and would keep
// opening at full height and never meet the new 85% default. There is no way to tell that artifact
// apart from a deliberate drag to the top, which is now a real preference, so the key retires
// instead of being guessed at. v1 is removed rather than left to sit in a budget shared with the
// entries and their base64 images.
const SHEET_FRAC_KEY = "weekly-deposits-composer-height-frac2";
export let sheetFrac = null;
try {
  localStorage.removeItem("weekly-deposits-composer-height-frac");
  const raw = parseFloat(localStorage.getItem(SHEET_FRAC_KEY));
  // guard the stored value, don't trust it: a NaN would poison every height calculation
  // downstream, and Math.max/min can't rescue NaN — it propagates through both.
  if (raw > 0.2 && raw <= 1) sheetFrac = raw;
} catch (e) {}
export function saveSheetFrac(frac) {
  sheetFrac = frac;
  try { localStorage.setItem(SHEET_FRAC_KEY, String(frac)); } catch (e) {}
}
