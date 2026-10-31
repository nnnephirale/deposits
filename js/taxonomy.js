// Topics and modes: the seed, her edits to it, and the colours each topic is drawn in
// (tone() gives the dark-mode set).

import { S } from "./state.js";
import { syncPushEntries } from "./sync-ui.js";
import { isDark } from "./prefs.js";

// ---------- taxonomy ----------
// bg/fg/dot are the pills as they appear in the list. `heat` is the same topic turned up
// for the wrapped bloom — see HARMONY below for why it isn't just `dot` at more saturation.
const DEFAULT_TOPICS = [
  { id: "work", label: "work", bg: "#E3EDFB", fg: "#2B5FA8", dot: "#4A82D0", heat: "#70A6F2" },
  { id: "eats", label: "notable eats", bg: "#FBEBDD", fg: "#A85B22", dot: "#D98B4A", heat: "#E78B39" },
  { id: "health", label: "health & fitness", bg: "#E2F2E4", fg: "#2E7D3A", dot: "#55A862", heat: "#41C25D" },
  { id: "watched", label: "watched/watching", bg: "#EEE7F9", fg: "#6C46A8", dot: "#9670D4", heat: "#B38EF2" },
  { id: "internet", label: "internet things", bg: "#DFF2F2", fg: "#1F7A7A", dot: "#48A8A8", heat: "#41B9B9" },
  { id: "shopping", label: "shopping", bg: "#FBE5EE", fg: "#B03A6B", dot: "#D8699A", heat: "#F471AC" },
  { id: "relationship", label: "relationships", bg: "#FBE3E1", fg: "#B0403A", dot: "#D8706A", heat: "#F37C75" },
  { id: "home", label: "home", bg: "#F2ECDF", fg: "#8A6D2F", dot: "#B39554", heat: "#C89E3A" },
  { id: "listening", label: "listening to", bg: "#E5E7FB", fg: "#4A50A8", dot: "#7B80D4", heat: "#959BF2" },
  { id: "discovered", label: "discovered ✨", bg: "#FFF6D9", fg: "#9C7A00", dot: "#E8C24A", heat: "#C2A13A" },
  { id: "lookgood", label: "look good feel good", bg: "#F7E6F4", fg: "#9A3E8C", dot: "#C86EB8", heat: "#F361DD" },
];
// HARMONY — how the `heat` column was derived, so it can be re-derived rather than re-guessed.
// Each topic's `dot` was read in OKLCH, its HUE kept, and lightness + chroma replaced with one
// shared rule: L = 0.72 for every topic, and chroma at 85% of that hue's own maximum in sRGB.
//   Same L is what makes eleven colours read as one family instead of eleven decisions.
//   Same %-of-max chroma (not same absolute chroma) is what makes them equally VIVID: the
//   sRGB ceiling is 0.265 at magenta and 0.123 at teal, so one flat number would have left
//   the teal muted and clipped the magenta.
// The source dots were all over the place — L 0.605 (work) to 0.826 (discovered) — which is
// why "just saturate the dots" would have produced a bloom with holes in it.
// Two notes for anyone changing this: `discovered` and `home` land 5° apart in hue and are
// indistinguishable once blurred (harmless — they blend), and the fields paint with
// mix-blend-mode: multiply, so overlaps deepen like ink rather than washing out to grey.
const DEFAULT_MODES = [
  { id: "remember", label: "i want to remember" },
  { id: "rundown", label: "weekly rundown" },
  { id: "learned", label: "what i've learned" },
];

// ---------- the taxonomy, as she has edited it ----------
// The eleven topics above are the SEED, not the truth: Settings can rename them, add her own
// and drop the ones she never files under. So TOPICS/MODES are live bindings — every reader in
// the app already looks them up inside a function, so replacing the array is enough and nothing
// needs re-wiring. Only the two id maps are derived, and reindexTaxonomy rebuilds those.
//
// Entries store tag IDs, never labels, so a rename is invisible to every deposit already filed
// under it. Removing a tag leaves those ids sitting on the entries untouched — they simply stop
// resolving and the deposits read as untagged — which is what makes the removal recoverable
// rather than destructive (see the undo in openSettings).
export const TAX_KEY = "weekly-deposits-taxonomy";
export let TOPICS = DEFAULT_TOPICS.map(t => ({ ...t }));
export let MODES = DEFAULT_MODES.map(m => ({ ...m }));
// Removed tags aren't thrown away, they're retired: kept aside with their id and their old
// position, so restoring one puts every deposit filed under it straight back where it was.
// A restore that had to re-create the tag would mint a NEW id and leave those deposits
// untagged forever, which is what would make "remove" a decision rather than a try.
// The last six, because these are undo affordances and not an archive.
export const RETIRED_MAX = 6;
S.RETIRED = [];
// null until she has actually changed something. That is also the push gate: a device still on
// the defaults must never send them, or merely opening the app on the iPad would roll back a
// rename made on the phone.
export let taxonomyUpdatedAt = null;
export let topicById = {}, modeById = {};
function reindexTaxonomy() {
  topicById = Object.fromEntries(TOPICS.map(t => [t.id, t]));
  modeById = Object.fromEntries(MODES.map(m => [m.id, m]));
}
// Adopt a stored/remote taxonomy. The shape is what's checked, not the contents: `topics` has
// to BE an array, but it is allowed to be an empty one. Rejecting empty was the first cut and it
// was wrong in the one case that matters — replacing all eleven seeded topics with her own means
// passing through zero topics, and a reload at that moment would have handed the seed straight
// back. Nothing can reach here with an accidental empty anyway: the only writer is a deliberate
// edit, and syncPull ignores any remote doc that isn't stamped.
// Missing colours are re-derived rather than left undefined, so a hand-edited or part-migrated
// doc can't render a pill with `background: undefined`.
export function applyTaxonomy(tax) {
  if (!tax || !Array.isArray(tax.topics)) return false;
  TOPICS = tax.topics.filter(t => t && t.id).map(t => ({
    ...topicColours(t.hue != null ? t.hue : hexHue(t.dot || "#4A82D0")),
    ...t,
    label: String(t.label == null ? t.id : t.label)
  }));
  if (Array.isArray(tax.modes)) {
    MODES = tax.modes.filter(m => m && m.id)
      .map(m => ({ id: m.id, label: String(m.label == null ? m.id : m.label) }));
  }
  if (Array.isArray(tax.retired)) S.RETIRED = tax.retired.filter(r => r && r.id).slice(-RETIRED_MAX);
  if (tax.updatedAt) taxonomyUpdatedAt = tax.updatedAt;
  reindexTaxonomy();
  return true;
}
export function taxonomyDoc() {
  return { topics: TOPICS, modes: MODES, retired: S.RETIRED, updatedAt: taxonomyUpdatedAt };
}
// Every edit lands here: stamp it, write it, re-index, and let the debounced entry push carry it
// to the other devices on the same trip as everything else.
export function saveTaxonomy() {
  taxonomyUpdatedAt = new Date().toISOString();
  reindexTaxonomy();
  try { localStorage.setItem(TAX_KEY, JSON.stringify(taxonomyDoc())); } catch (e) {}
  syncPushEntries();
}

// ---------- deriving a new topic's colours ----------
// A tag she adds has to land in the same family as the eleven seeded above, and HARMONY is
// already the rule they follow. Read back off those eleven, each role sits at one shared
// lightness with the hue doing all the distinguishing:
//   bg  L 0.943 C 0.025   fg  L 0.525 C 0.130   dot L 0.665 C 0.130
//   heat L 0.720, chroma at 85% of that hue's own sRGB maximum (HARMONY's rule, unchanged)
// So a new hue needs nothing but those numbers converted, with every chroma pulled back to what
// the hue can actually hold — the sRGB ceiling is ~0.27 at magenta and ~0.12 at teal, and asking
// for 0.130 at teal would clip to a colour that isn't the one requested.
function oklchLinear(L, C, H) {
  const h = H * Math.PI / 180, a = C * Math.cos(h), b = C * Math.sin(h);
  const l = Math.pow(L + 0.3963377774 * a + 0.2158037573 * b, 3);
  const m = Math.pow(L - 0.1055613458 * a - 0.0638541728 * b, 3);
  const s = Math.pow(L - 0.0894841775 * a - 1.2914855480 * b, 3);
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
  ];
}
function oklchToHex(L, C, H) {
  const enc = v => {
    const c = v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(Math.max(0, v), 1 / 2.4) - 0.055;
    return Math.round(Math.min(1, Math.max(0, c)) * 255).toString(16).padStart(2, "0");
  };
  return ("#" + oklchLinear(L, C, H).map(enc).join("")).toUpperCase();
}
// bisection rather than an analytic solve: the sRGB boundary in OKLCH has no closed form worth
// carrying, and 22 halvings land inside a thousandth of a chroma unit — far finer than 8-bit.
function maxChroma(L, H) {
  let lo = 0, hi = 0.4;
  for (let i = 0; i < 22; i++) {
    const mid = (lo + hi) / 2;
    if (oklchLinear(L, mid, H).every(v => v >= -0.0002 && v <= 1.0002)) lo = mid; else hi = mid;
  }
  return lo;
}
export function topicColours(hue) {
  const cap = (L, C) => Math.min(C, maxChroma(L, hue));
  return {
    hue: Math.round(hue),
    bg: oklchToHex(0.943, cap(0.943, 0.025), hue),
    fg: oklchToHex(0.525, cap(0.525, 0.130), hue),
    dot: oklchToHex(0.665, cap(0.665, 0.130), hue),
    heat: oklchToHex(0.720, maxChroma(0.720, hue) * 0.85, hue)
  };
}
// The same topic on a dark canvas. Its stored bg/fg are pastel-on-ink and would glare, so dark
// mode reads a second set off the same hue: a deep tinted fill, a light label, a brighter dot.
// Derived at render time and never stored, so the taxonomy that syncs stays one set of colours.
const darkTones = {};
export function tone(t) {
  if (!isDark()) return t;
  const hue = Math.round(t.hue != null ? t.hue : hexHue(t.dot));
  if (!darkTones[hue]) {
    const cap = (L, C) => Math.min(C, maxChroma(L, hue));
    darkTones[hue] = {
      bg: oklchToHex(0.315, cap(0.315, 0.05), hue),
      fg: oklchToHex(0.85, cap(0.85, 0.085), hue),
      dot: oklchToHex(0.72, cap(0.72, 0.13), hue)
    };
  }
  return darkTones[hue];
}
// the other direction, for the seeded topics: they carry hex, not a hue, and the colour cycler
// in Settings has to know where on the wheel one of them currently sits.
export function hexHue(hex) {
  const n = parseInt(String(hex).replace("#", ""), 16);
  if (!isFinite(n)) return 257;
  const lin = c => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4));
  const r = lin(((n >> 16) & 255) / 255), g = lin(((n >> 8) & 255) / 255), b = lin((n & 255) / 255);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  const A = 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * s;
  const B = 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * s;
  const H = Math.atan2(B, A) * 180 / Math.PI;
  return H < 0 ? H + 360 : H;
}
// The hue for a new topic: the middle of the widest gap left on the wheel. With eleven colours
// already placed, picking at random is picking a near-duplicate of one of them about half the
// time — this is the one choice that reliably reads as a NEW colour.
export function nextFreeHue(taken) {
  const hs = (taken || TOPICS.map(t => t.hue != null ? t.hue : hexHue(t.dot)))
    .map(h => ((h % 360) + 360) % 360).sort((a, b) => a - b);
  if (!hs.length) return 257;
  let best = (hs[0] + 180) % 360, gap = -1;
  for (let i = 0; i < hs.length; i++) {
    const a = hs[i], b = i + 1 < hs.length ? hs[i + 1] : hs[0] + 360;
    if (b - a > gap) { gap = b - a; best = (a + (b - a) / 2) % 360; }
  }
  return best;
}

try { applyTaxonomy(JSON.parse(localStorage.getItem(TAX_KEY))); } catch (e) {}
reindexTaxonomy();

export const DAY_TOKENS = ["M", "T\u00B9", "W", "T\u00B2", "F", "S\u00B9", "S\u00B2"];
// spoken forms of the same seven, for anything a screen reader has to say out loud — "T¹" is a
// fine glyph and a poor word
export const DAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
