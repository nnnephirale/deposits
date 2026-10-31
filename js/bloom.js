// The wrapped cue: the chevron under the period, the heat bloom it opens, and the status-bar
// tint while it's open.

import { S } from "./state.js";
import { confirmAction, el } from "./dom.js";
import { topicById } from "./taxonomy.js";
import { generateWeekSummary, weekSumInFlight } from "./anthropic.js";
import { SHOW_WSUM_KEY, weekKey, weekSummaries } from "./week-summary.js";
import { activeEntries } from "./grouping.js";
import { isDark } from "./prefs.js";
import { render } from "./render.js";
import { RECAP_MIN_ENTRIES, currentRecapTake, monthKey, monthNameOf, monthRecaps, openRecap, recapInFlight, startMonthRecap } from "./recap.js";
import { openWeekReveal } from "./week-reveal.js";

// ============================================================================
// THE WRAPPED CUE — one chevron under the period, and the heat bloom it opens
// ----------------------------------------------------------------------------
// It replaced two magic wands (one in weekSummaryBlock, one in monthRecapBlock) that were
// absolutely positioned over the first entry card's top-right corner. There is one door now,
// it sits under the thing it's about, and it is the same control in both views.
//
// The gesture is a scrub, not a button: drag down and the bloom follows the finger, so the
// wrapped can be peeked at and backed out of. Past PULL_COMMIT it finishes on its own.
// ============================================================================
const cueEl = document.getElementById("wrappedCue");
const chevEl = document.getElementById("wcChev");
const heatEl = document.getElementById("heat");
export const wrapEl = document.querySelector(".wrap");

const PULL_FULL = 150;    // px of drag that equals a fully bloomed screen
const PULL_COMMIT = 0.58; // …and the fraction of it that counts as "yes, open it"

// what the cue would do right now: null = don't show it at all.
//   { kind: "open", run }      a reading exists — go straight in
//   { kind: "make", run, ask } nothing yet — the bloom lands on the offer to write one
let cueAction = null;

export function syncWrappedCue(list) {
  cueAction = list && list.length ? wrappedActionFor(list) : null;
  cueEl.hidden = !cueAction;
  wrapEl.classList.toggle("has-cue", !!cueAction);
  // catch up with wherever the page already is: a reload restores the scroll position,
  // and without this the cue would come back at full strength sitting under the header
  syncCueFade(wrapEl.scrollTop || window.scrollY);
  chevEl.setAttribute("aria-label",
    !cueAction ? "Open the wrapped"
      : cueAction.kind === "open"
        ? (S.view === "week" ? "Open this week's wrapped" : "Open this month's wrapped")
        : (S.view === "week" ? "Read this week back" : "Read this month back"));
}

function wrappedActionFor(list) {
  if (S.view === "week") {
    const k = weekKey(S.wk.year, S.wk.week);
    if (weekSumInFlight.has(k)) return null;         // already being written
    const rec = weekSummaries[k];
    if (rec) return { kind: "open", run: () => openWeekReveal(S.wk.year, S.wk.week, list) };
    // A key is the only condition now. The old rule also wanted entries on three separate
    // days, which read as the control being broken rather than as the week being too quiet:
    // nothing on screen said what was missing, and a week bunched onto one day — six deposits
    // on a Sunday — could never be summarised at all. A thin week is the AI's problem to
    // handle, not a reason to hide the door to it.
    if (S.apiKey) return {
      kind: "make",
      ask: "Create a summary of this week?", ok: "Summarize",
      run: () => {
        S.showWeekSummary = true; // she asked for it — don't let it land hidden
        try { localStorage.setItem(SHOW_WSUM_KEY, "1"); } catch (e) {}
        generateWeekSummary(S.wk.year, S.wk.week, list);
        render();
      }
    };
    return null;
  }
  const k = monthKey(S.mo.year, S.mo.month);
  if (recapInFlight.has(k)) return null;
  if (currentRecapTake(monthRecaps[k])) return { kind: "open", run: () => openRecap(S.mo.year, S.mo.month) };
  if (S.apiKey && list.length >= RECAP_MIN_ENTRIES) return {
    kind: "make",
    ask: "Read " + monthNameOf(S.mo.year, S.mo.month) + " back? A few observations, one at a time.",
    ok: "Read it",
    run: () => startMonthRecap(S.mo.year, S.mo.month)
  };
  return null;
}

// ---- the status bar ------------------------------------------------------
// Installed to the home screen, iOS paints the strip above the page with theme-color. Left
// at the app's grey it reads as a foreign band across the top of a screen full of colour.
// It can't be made transparent without also turning the clock white (see the meta comment),
// so instead it is kept matching: set on arrival, restored on the way out.
const THEME_BASE = "#F0F0F1", THEME_BASE_DARK = "#0E0E0F";
function themeBase() { return isDark() ? THEME_BASE_DARK : THEME_BASE; }
const themeMeta = document.querySelector('meta[name="theme-color"]');
function setThemeColor(hex) { if (themeMeta) themeMeta.setAttribute("content", hex); }
// (the starting colour is set by applyTheme in prefs.js, which runs at load)
// what the top of the bloom actually resolves to: the field nearest the top of the screen,
// alpha-composited over the wash the same way the CSS does it. Approximated rather than
// sampled — reading a real pixel would mean a canvas snapshot of a blurred, animating layer.
function heatTopColor() {
  if (!heatFields.length) return themeBase();
  // whichever field ended up highest on screen is the one under the status bar
  const hex = heatFields.reduce((a, b) => (b.y < a.y ? b : a)).c;
  const n = parseInt(hex.slice(1), 16);
  const wash = isDark() ? 18 : 252; // the .heat-wash: #FCFCFB, or #121213 in dark mode
  const mix = (c, i) => Math.round(c * i + wash * (1 - i));
  // the top of the screen catches a field's outer falloff, not its core, so it lands light
  const a = 0.34;
  return "#" + [mix((n >> 16) & 255, a), mix((n >> 8) & 255, a), mix(n & 255, a)]
    .map(v => v.toString(16).padStart(2, "0")).join("");
}

// ---- the bloom ----------------------------------------------------------
// Fields are rebuilt per open because they're made of THIS period's topics: which ones,
// and how much of each. A month of nothing but work is one big blue field; a scattered
// month is six small ones. That's the "heat" — it's her data, not decoration.
let heatFields = [];   // {c, y} per field — y in vh from centre, for heatTopColor()
function buildHeatFields(list) {
  heatEl.querySelectorAll(".heat-field").forEach(n => n.remove());
  heatFields = [];
  const tally = {};
  list.forEach(e => (e.tags || []).forEach(t => { if (topicById[t]) tally[t] = (tally[t] || 0) + 1; }));
  let ranked = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 6);
  // a period with no topics at all still deserves a transition, so fall back to the
  // deck's own three neutrals rather than opening onto a blank white screen
  if (!ranked.length) ranked = [["_a", 1], ["_b", 1], ["_c", 1]];
  const NEUTRAL = isDark() ? { _a: "#3A3024", _b: "#22323A", _c: "#352638" }
                           : { _a: "#EDE4D8", _b: "#DFE7EA", _c: "#EAE0EA" };
  const top = ranked[0][1];

  // where the bloom is born: the chevron's own centre, in viewport units
  const r = chevEl.getBoundingClientRect();
  const ox = (r.left + r.width / 2) + "px";
  const oy = (r.top + r.height / 2) + "px";

  ranked.forEach(([id, n], i) => {
    // fan them around the origin rather than scattering randomly — a fixed golden-angle
    // spiral means the same period always blooms the same way, which matters the second
    // time she opens it. Random placement made a familiar month look like a new one.
    const ang = i * 2.399963 - 1.2;              // ~137.5°, the golden angle
    // pushed well off centre and sized under the viewport: fields that all cover the whole
    // screen are just one colour, and the point is to SEE that this month was mostly work
    const reach = 0.28 + 0.055 * i;
    const share = n / top;                        // 1 for her biggest topic
    const colour = NEUTRAL[id] || topicById[id].heat;
    heatFields.push({ c: colour, y: Math.sin(ang) * reach });
    const f = el("div", { class: "heat-field" });
    f.style.setProperty("--c", colour);
    f.style.setProperty("--ox", ox);
    f.style.setProperty("--oy", oy);
    f.style.setProperty("--x", `calc(50vw + ${(Math.cos(ang) * reach * 100).toFixed(1)}vw)`);
    f.style.setProperty("--y", `calc(50vh + ${(Math.sin(ang) * reach * 100).toFixed(1)}vh)`);
    f.style.setProperty("--d", (62 + share * 38).toFixed(0) + "vmax");
    f.style.setProperty("--blur", (22 + i * 4) + "px");
    // her biggest topic is the most present; the tail is a tint
    f.style.setProperty("--w", (0.38 + share * 0.50).toFixed(2));
    heatEl.appendChild(f);
  });
}

let heatP = 0, heatRaf = 0, heatFallback = 0;
function setHeatP(p) {
  heatP = p;
  heatEl.style.setProperty("--p", p.toFixed(4));
}
// animate --p to a target and call done() on arrival. rAF rather than a CSS transition:
// a custom property can't interpolate without @property, and more to the point the scrub
// has to be able to reverse mid-flight, which a running transition would fight.
//
// A TIMER RACES THE rAF — same lesson the composer's unfold already learned. A hidden tab
// gets zero rAF callbacks, so if she pulls the chevron halfway and the phone locks (or she
// switches apps), the retreat animation never runs and she comes back to a half-bloomed
// screen stranded over her list with no way out. Timers still fire when hidden; whichever
// lands first settles it, and `settled` means done() runs exactly once either way.
function heatTo(target, ms, done) {
  cancelAnimationFrame(heatRaf);
  clearTimeout(heatFallback);
  const from = heatP, t0 = performance.now();
  const ease = x => 1 - Math.pow(1 - x, 3); // ease-out cubic, same family as the app's easing
  let settled = false;
  const finish = () => {
    if (settled) return;
    settled = true;
    cancelAnimationFrame(heatRaf);
    clearTimeout(heatFallback);
    setHeatP(target);
    if (done) done();
  };
  const step = now => {
    const k = Math.min(1, (now - t0) / ms);
    if (k >= 1) { finish(); return; }
    setHeatP(from + (target - from) * ease(k));
    heatRaf = requestAnimationFrame(step);
  };
  heatRaf = requestAnimationFrame(step);
  heatFallback = setTimeout(finish, ms + 120);
}
function heatOpen(list) {
  buildHeatFields(list);
  heatEl.classList.add("live");
  setHeatP(0);
}
function heatClose() {
  cancelAnimationFrame(heatRaf);
  clearTimeout(heatFallback);
  heatEl.classList.remove("live");
  setHeatP(0);
  setThemeColor(themeBase());
}

// once a node leaves the document, do something. Used for both handoffs below, so neither
// has to poll: the deck and the confirm box both just remove themselves when they're done.
function onGone(node, then) {
  const parent = node.parentNode;
  if (!parent) { then(); return; }
  const obs = new MutationObserver(() => {
    if (node.isConnected) return;
    obs.disconnect();
    then();
  });
  obs.observe(parent, { childList: true });
}

// commit: finish the bloom, then hand it to the deck.
// The bloom is NOT torn down when the deck opens — it BECOMES the deck's background and
// stays for its whole life. .recap is opaque `var(--canvas)`, so tearing the bloom down
// meant cutting from a screen full of her colours to a flat near-white one in a single
// frame. Now the thing the drag built is the sky she reads it under, and it only leaves
// when she does. (A deck opened any other way — the auto-reveal when a summary lands —
// never gets .on-heat, so it keeps its own stock blobs. No regression there.)
function heatCommit(action) {
  heatTo(1, Math.max(160, (1 - heatP) * 420), () => {
    // only once it's full — theme-color is a whole-OS repaint, not something to drive per frame
    setThemeColor(heatTopColor());
    // an exception in run() must not leave the screen bloomed with no deck and no way back:
    // the handoff is what retreats the bloom when nothing opens, so it has to run regardless
    if (action.kind === "open") {
      try { action.run(); } finally { heatHandOff(); }
      return;
    }
    // nothing written yet: the offer arrives ON the bloom, and backing out takes it away
    confirmAction(action.ask, action.ok, () => { action.run(); heatHandOff(); });
    const box = document.querySelector(".confirm-overlay");
    // the confirm mounts on document.body as .confirm-overlay — NOT in sheetRoot, and not
    // with the .overlay class the sheets use. Watch the real node, not a guess at it.
    if (box) onGone(box, () => {
      if (!document.querySelector(".recap") && heatP > 0) heatTo(0, 340, heatClose);
    });
  });
}
function heatHandOff() {
  const deck = document.querySelector(".recap");
  if (!deck) { heatTo(0, 340, heatClose); return; } // nothing opened (a generation started) — don't strand it
  deck.classList.add("on-heat");
  onGone(deck, () => heatTo(0, 520, heatClose));
}

// ---- the scrub ----------------------------------------------------------
let pull = null;
chevEl.addEventListener("pointerdown", ev => {
  if (!cueAction) return;
  ev.preventDefault();
  pull = { y0: ev.clientY, moved: 0, list: activeEntries(), action: cueAction };
  chevEl.classList.add("pulling");
  try { chevEl.setPointerCapture(ev.pointerId); } catch (e) {}
  heatOpen(pull.list);
});
chevEl.addEventListener("pointermove", ev => {
  if (!pull) return;
  const dy = ev.clientY - pull.y0;
  pull.moved = Math.max(pull.moved, Math.abs(dy));
  const p = Math.max(0, Math.min(1, dy / PULL_FULL));
  setHeatP(p);
  // the chevron IS the progress readout: it sinks with the pull and darkens as it commits
  chevEl.style.transform = "translateY(" + (p * 16).toFixed(1) + "px)";
  chevEl.style.color = p >= PULL_COMMIT ? (isDark() ? "#A2A2A8" : "#6E6E73") : (isDark() ? "#55555B" : "#C4C4C9");
});
function endPull(ev, mayCommit) {
  if (!pull) return;
  const { action, moved } = pull;
  pull = null;
  chevEl.classList.remove("pulling");
  chevEl.style.transform = "";
  chevEl.style.color = "";
  try { chevEl.releasePointerCapture(ev.pointerId); } catch (e) {}
  if (!mayCommit) { heatTo(0, 260, heatClose); return; }
  // a tap is a drag that never went anywhere — it plays the whole thing rather than
  // doing nothing, so the control still works for anyone who doesn't discover the drag
  if (moved < 6) { heatCommit(action); return; }
  if (heatP >= PULL_COMMIT) heatCommit(action);
  else heatTo(0, 260, heatClose);
}
chevEl.addEventListener("pointerup", ev => endPull(ev, true));
// pointercancel is NOT a quiet pointerup and must never commit. It fires when the system
// takes the gesture away — an edge-swipe back, a notification, the browser deciding this
// was a scroll after all — and she never let go of anything. Sharing the release path meant
// a stolen gesture past the threshold opened the wrapped on its own. It always retreats,
// which also guarantees no half-bloomed screen is left stranded over the list.
chevEl.addEventListener("pointercancel", ev => endPull(ev, false));

// ---- fade the cue out as the list scrolls under the header ----
// continuous, not a class toggle: it should melt as she scrolls, not blink off at a line.
export function syncCueFade(y) {
  cueEl.style.setProperty("--cue-o", String(Math.max(0, 1 - y / 64)));
  cueEl.style.pointerEvents = y > 56 ? "none" : "";
}
