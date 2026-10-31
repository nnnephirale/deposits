// TEMPORARY: the gradient tuner for the composer's fade. Comes out with css/tuner.css once the
// numbers are settled.

import { el } from "./dom.js";

// ---------- the gradient tuner (temporary) ----------
// TEMPORARY. A scratch panel for dialling in the composer's fade by eye instead of by guess —
// the five numbers behind .composer-top::after, live, with the values printed so they can be
// read back. When the fade is settled these numbers go into the CSS as literals and everything
// in this section comes out: the FADE_SPECS list, the panel, its CSS, and the Settings row.
//
// Stored so a reload doesn't undo an afternoon of tuning, and written onto :root as overrides
// rather than into the rule — the CSS keeps the defaults, so `reset` is a matter of removing
// what's here and letting them show through again, with nothing to copy back.
const FADE_KEY = "weekly-deposits-fade-tune";
const FADE_TUNE_ON_KEY = "weekly-deposits-fade-tune-on";
// TWO treatments, tuned separately and on purpose. They do different jobs: the list's band has
// to hide a scrolling list behind the compose bar, while the composer's only has to soften a
// few lines passing under a pinned row. One set of numbers for both would be a compromise
// between two things that were never the same. The group also answers "why did nothing move?" —
// each fade only exists in its own view.
const FADE_GROUPS = [
  {
    id: "entry", label: "entry", where: "open an entry and scroll — this one lives under the composer's pinned head",
    specs: [
      { k: "h",    var: "--fade-h",    label: "length",  min: 0,  max: 160, step: 1,    unit: "px", def: 30 },
      { k: "blur", var: "--fade-blur", label: "blur",    min: 0,  max: 30,  step: 0.5,  unit: "px", def: 7 },
      { k: "op",   var: "--fade-op",   label: "opacity", min: 0,  max: 1,   step: 0.01, unit: "",   def: 1 },
      { k: "hold", var: "--fade-hold", label: "hold",    min: 0,  max: 90,  step: 1,    unit: "%",  def: 0 },
      { k: "mask", var: "--fade-mask", label: "falloff", min: 10, max: 100, step: 1,    unit: "%",  def: 100 }
    ]
  },
  {
    id: "list", label: "list", where: "the band above the compose bar in week and month view",
    specs: [
      { k: "h",    var: "--lfade-h",    label: "length",  min: 40, max: 320, step: 2,    unit: "px", def: 162 },
      { k: "blur", var: "--lfade-blur", label: "blur",    min: 0,  max: 30,  step: 0.5,  unit: "px", def: 11 },
      { k: "op",   var: "--lfade-op",   label: "opacity", min: 0,  max: 1,   step: 0.01, unit: "",   def: 1 },
      { k: "sat",  var: "--lfade-sat",  label: "colour",  min: 100, max: 300, step: 5,   unit: "%",  def: 180 },
      // hold and midpoint are two stops on one gradient and must stay in order. CSS clamps a
      // later stop to an earlier one rather than erroring, so crossing them doesn't break
      // anything — it just makes one of the two dials stop appearing to do anything, which is
      // the exact confusion this whole panel is here to avoid.
      { k: "hold", var: "--lfade-hold", label: "hold",    min: 0,  max: 90,  step: 1,    unit: "%",  def: 34, notAbove: "mid" },
      { k: "mid",  var: "--lfade-mid",  label: "midpoint", min: 10, max: 100, step: 1,   unit: "%",  def: 66, notBelow: "hold" },
      { k: "mask", var: "--lfade-mask", label: "falloff", min: 10, max: 100, step: 1,    unit: "%",  def: 55 }
    ]
  }
];
let fadeTune = {};          // { entry: {…}, list: {…} } — only the keys she has moved
export let fadeTuneOn = false;
let fadeGroupId = "entry";
try { fadeTune = JSON.parse(localStorage.getItem(FADE_KEY)) || {}; } catch (e) {}
try { fadeTuneOn = localStorage.getItem(FADE_TUNE_ON_KEY) === "1"; } catch (e) {}
// v1 of this stored one flat object for the composer's fade alone. Anything without the two
// group keys is that, so it is read as the entry group rather than thrown away.
if (fadeTune && !fadeTune.entry && !fadeTune.list && Object.keys(fadeTune).length) {
  fadeTune = { entry: fadeTune };
}
function fadeGroup(id) { return FADE_GROUPS.find(g => g.id === (id || fadeGroupId)); }
function fadeStore(id) { return (fadeTune[id] = fadeTune[id] || {}); }
function fadeValue(gid, spec) {
  const v = (fadeTune[gid] || {})[spec.k];
  return v == null ? spec.def : v;
}
// Only the keys that DIFFER from the default are written. A var set to its own default is
// indistinguishable from an unset one on screen but not in the stylesheet — leaving them off
// keeps "reset" and "never touched" the same state rather than two that merely look alike.
function applyFadeTune() {
  const st = document.documentElement.style;
  for (const g of FADE_GROUPS) {
    for (const spec of g.specs) {
      const v = (fadeTune[g.id] || {})[spec.k];
      if (v == null) st.removeProperty(spec.var);
      else st.setProperty(spec.var, v + spec.unit);
    }
  }
}
function saveFadeTune() {
  try { localStorage.setItem(FADE_KEY, JSON.stringify(fadeTune)); } catch (e) {}
  applyFadeTune();
}
function resetFadeTune(gid) { fadeTune[gid] = {}; saveFadeTune(); }
/** Both groups on two lines, for reading back. Defaults included, so it is a complete
 *  description rather than a diff that only means something next to the stylesheet. */
export function fadeTuneSummary(gid) {
  const one = g => g.label + ": " + g.specs.map(sp => sp.label + " " + fadeValue(g.id, sp) + sp.unit).join(" · ");
  return gid ? one(fadeGroup(gid)) : FADE_GROUPS.map(one).join("\n");
}
applyFadeTune();

// The panel. Fixed and floating so it can sit over EITHER view — the list's band and the
// composer's each only exist in their own one, and the panel has to be usable in front of
// whichever is on screen, keyboard up or not.
// Every control is a custom drag row rather than <input type=range> for exactly one reason:
// a native range steals focus, the keyboard collapses, the sheet resizes, and the thing being
// tuned moves out from under the finger tuning it. These rows commit on pointerdown with
// preventDefault, the same rule the format bar and the day strip already follow.
let fadeTunerEl = null;
function syncFadeTuner() {
  if (fadeTuneOn) mountFadeTuner(); else if (fadeTunerEl) { fadeTunerEl.remove(); fadeTunerEl = null; }
}
export function setFadeTuneOn(on) {
  fadeTuneOn = on;
  try { localStorage.setItem(FADE_TUNE_ON_KEY, on ? "1" : "0"); } catch (e) {}
  syncFadeTuner();
}
function mountFadeTuner() {
  if (fadeTunerEl) { fadeTunerEl.remove(); fadeTunerEl = null; }
  // The panel gets out of the way of whichever fade it is dialling: the list's band is at the
  // BOTTOM of the screen, so the panel goes to the top for that group and stays low for the
  // composer's, whose fade sits up under the pinned head. Tuning something you cannot see
  // because the dials are parked on top of it is its own kind of "nothing changed".
  const panel = el("div", { class: "fade-tuner" + (fadeGroupId === "list" ? " at-top" : "") });
  fadeTunerEl = panel;
  // a press anywhere on the panel keeps the caret where it is
  panel.addEventListener("pointerdown", ev => {
    if (ev.target.closest(".ft-copy, .ft-reset, .ft-hide, .ft-seg button")) return; // buttons need their click
    ev.preventDefault();
  });

  const g = fadeGroup();
  panel.appendChild(el("div", { class: "ft-head" },
    el("span", { class: "ft-title" }, "fade"),
    el("button", { class: "ft-hide", "aria-label": "Hide the tuner",
      onclick: () => setFadeTuneOn(false) }, "×")));

  // which of the two treatments is being dialled. A segmented control, because these are modes
  // of one panel and not two separate buttons — and because the pair on screen is what says
  // there ARE two, which is the thing that isn't obvious from either view on its own.
  const seg = el("div", { class: "ft-seg", role: "group", "aria-label": "Which fade" });
  for (const grp of FADE_GROUPS) {
    seg.appendChild(el("button", {
      class: grp.id === fadeGroupId ? "on" : "",
      "aria-pressed": String(grp.id === fadeGroupId),
      onclick: () => { fadeGroupId = grp.id; mountFadeTuner(); }
    }, grp.label));
  }
  panel.appendChild(seg);
  // "I pulled the sliders and nothing changed" is the failure this line exists to prevent:
  // each fade only exists in its own view, so the panel says where to go and look.
  panel.appendChild(el("p", { class: "ft-where" }, g.where));

  const rows = {};
  for (const spec of g.specs) {
    const row = el("div", { class: "ft-row" });
    const fill = el("div", { class: "ft-fill" });
    const label = el("span", { class: "ft-label" }, spec.label);
    const val = el("span", { class: "ft-val" });
    row.appendChild(fill); row.appendChild(label); row.appendChild(val);
    const paint = () => {
      const v = fadeValue(g.id, spec);
      val.textContent = v + spec.unit;
      fill.style.width = ((v - spec.min) / (spec.max - spec.min) * 100).toFixed(2) + "%";
      row.classList.toggle("moved", (fadeTune[g.id] || {})[spec.k] != null);
    };
    rows[spec.k] = paint;
    // scrub anywhere along the row: the row IS the track, so there is no thumb to hit. Pointer
    // capture means the finger can leave the row vertically and still be scrubbing it.
    const at = clientX => {
      const r = row.getBoundingClientRect();
      const t = Math.min(1, Math.max(0, (clientX - r.left) / r.width));
      const raw = spec.min + t * (spec.max - spec.min);
      const snapped = Math.round(raw / spec.step) * spec.step;
      // step 0.01 and 0.5 both leave float dust (0.30000000000000004) — round to the step's
      // own precision so the number shown is the number she can read out
      const dp = (String(spec.step).split(".")[1] || "").length;
      let v = Number(snapped.toFixed(dp));
      const other = k => g.specs.find(x => x.k === k);
      if (spec.notAbove) v = Math.min(v, fadeValue(g.id, other(spec.notAbove)));
      if (spec.notBelow) v = Math.max(v, fadeValue(g.id, other(spec.notBelow)));
      fadeStore(g.id)[spec.k] = v;
      saveFadeTune(); paint();
    };
    row.addEventListener("pointerdown", ev => {
      ev.preventDefault();
      try { row.setPointerCapture(ev.pointerId); } catch (e) {}
      at(ev.clientX);
      const move = e2 => at(e2.clientX);
      const end = e2 => {
        row.removeEventListener("pointermove", move);
        row.removeEventListener("pointerup", end);
        row.removeEventListener("pointercancel", end);
        row.removeEventListener("lostpointercapture", end);
        try { row.releasePointerCapture(e2.pointerId); } catch (err) {}
      };
      row.addEventListener("pointermove", move);
      row.addEventListener("pointerup", end);
      row.addEventListener("pointercancel", end);
      row.addEventListener("lostpointercapture", end);
    });
    paint();
    panel.appendChild(row);
  }

  const foot = el("div", { class: "ft-foot" });
  // BOTH groups go on the clipboard, not just the one showing: what she sends back should
  // describe the whole design, and half of it is a puzzle at the other end.
  const copy = el("button", { class: "ft-copy", onclick: async () => {
    const line = fadeTuneSummary();
    try { await navigator.clipboard.writeText(line); copy.textContent = "copied both"; }
    catch (e) { copy.textContent = line; }
    setTimeout(() => { copy.textContent = "copy values"; }, 2200);
  } }, "copy values");
  // resets the group on screen only — the other one is not what she is looking at
  const reset = el("button", { class: "ft-reset", onclick: () => {
    resetFadeTune(g.id);
    for (const spec of g.specs) rows[spec.k]();
  } }, "reset");
  foot.appendChild(copy); foot.appendChild(reset);
  panel.appendChild(foot);
  document.body.appendChild(panel);
}
syncFadeTuner();
