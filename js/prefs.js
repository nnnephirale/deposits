// Preferences: layout, order, composer unfold speed, appearance (system / light / dark).

import { entryStamp } from "./dates.js";
import { render } from "./render.js";

// ---------- layout ----------
// the experiment settled (29 Jul 2026): "topic" is the baseline and the default on every
// open — full header on every group. "day" is the one alternative worth keeping: day headers
// in week view, week headers in month view. mix and dense are gone.
// tapping the active toggle returns to the baseline, so "nothing selected" is a real state.
export const LAYOUT_OPTIONS = ["day"];
// Day view survives a kill, the same way the reading order already did — it's a way of looking at
// the week, not a per-visit mode, and having to switch it back on every launch made it feel like
// a toy. Only "day" is remembered as such; anything else in storage falls back to topic, so a
// junk value can't leave the app in a layout it can't render.
const LAYOUT_KEY = "weekly-deposits-layout";
export let layout = "topic";
try { if (localStorage.getItem(LAYOUT_KEY) === "day") layout = "day"; } catch (e) {}
export function setLayout(v) {
  layout = v === "day" ? "day" : "topic";
  try { localStorage.setItem(LAYOUT_KEY, layout); } catch (e) {}
  render();
}

// Reading order WITHIN a group. Default newest first — the thing you just wrote is the thing
// you want to see, and it matches the way the topic groups themselves are ordered
// (latest-touched at the top). Flipping to oldest-first replays the week as it actually ran.
const ORDER_KEY = "weekly-deposits-oldest-first";
export let oldestFirst = false;
try { oldestFirst = localStorage.getItem(ORDER_KEY) === "1"; } catch (e) {}
export function setOldestFirst(v) {
  oldestFirst = !!v;
  try { localStorage.setItem(ORDER_KEY, oldestFirst ? "1" : "0"); } catch (e) {}
  render();
}

// ---------- composer unfold speed ----------
// Four levels, as one multiplier over every duration in the unfold (--unfold-k, see :root).
// The ladder was rebuilt on 31 Jul around the old level 4: it became level 2 and the default,
// because nothing slower than the old default was ever wanted. So 1 is the old default (620ms),
// 2 is the old level 4 (440ms), 3 is only slightly quicker again (372ms — a nudge, not a step,
// which is what was asked for), and 4 is 0. The two slowest rungs of the old scale are gone.
// Level 4 is not just 0s durations: unfoldStill() sends the JS down the same path
// prefers-reduced-motion takes, so the sheet doesn't run a zero-length clip dance, it appears.
// The key is versioned because the INDICES changed meaning — a stored 3 used to be 440ms and
// would now be no-motion, so the old value has to be dropped rather than reinterpreted.
const UNFOLD_KEY = "weekly-deposits-unfold-v2";
export const UNFOLD_STEPS = [1, 0.71, 0.6, 0];
const UNFOLD_DEFAULT = 1;
export let unfoldLevel = UNFOLD_DEFAULT;
try {
  const raw = parseInt(localStorage.getItem(UNFOLD_KEY), 10);
  if (raw >= 0 && raw < UNFOLD_STEPS.length) unfoldLevel = raw; // rejects NaN and junk in one test
} catch (e) {}
export function unfoldK() { return UNFOLD_STEPS[unfoldLevel]; }
// no animation at all, either because she asked for it or because the OS did
export function unfoldStill() {
  return unfoldK() === 0 || window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}
function applyUnfoldSpeed() {
  document.documentElement.style.setProperty("--unfold-k", String(unfoldK()));
}
// the note under the scale states the real duration rather than a vague word — the whole point
// of the setting is that she can feel the difference, so name the thing she's changing
export function unfoldNote() {
  if (unfoldK() === 0) {
    return "no animation — the composer appears at once and the keyboard comes straight up.";
  }
  const ms = Math.round(620 * unfoldK());
  return "how long the composer takes to unfold out of the compose bar: " + ms + "ms"
    + (unfoldLevel === UNFOLD_DEFAULT ? ", the tuned default." : ".");
}
export function setUnfoldLevel(i) {
  unfoldLevel = Math.max(0, Math.min(UNFOLD_STEPS.length - 1, i));
  try { localStorage.setItem(UNFOLD_KEY, String(unfoldLevel)); } catch (e) {}
  applyUnfoldSpeed();
}
applyUnfoldSpeed();

// ---------- appearance ----------
// "system" follows the OS live; light and dark pin it. The <head> script has already written
// data-theme before first paint — this keeps it current and redraws, because topic pills carry
// their colours inline (see tone() in taxonomy.js) and have to be rebuilt to change them.
const THEME_KEY = "weekly-deposits-theme";
export const THEME_MODES = ["system", "light", "dark"];
export let themeMode = "system";
try { const v = localStorage.getItem(THEME_KEY); if (THEME_MODES.includes(v)) themeMode = v; } catch (e) {}
const darkMQ = window.matchMedia("(prefers-color-scheme: dark)");
export function isDark() { return themeMode === "dark" || (themeMode === "system" && darkMQ.matches); }
function applyTheme() {
  const t = isDark() ? "dark" : "light";
  // the status bar's resting colour is set here, first load included (bloom.js tints it later)
  const meta = document.querySelector('meta[name="theme-color"]');
  if (meta) meta.setAttribute("content", t === "dark" ? "#0E0E0F" : "#F0F0F1");
  if (document.documentElement.getAttribute("data-theme") === t) return false;
  document.documentElement.setAttribute("data-theme", t);
  return true;
}
export function setThemeMode(m) {
  themeMode = m;
  try { localStorage.setItem(THEME_KEY, m); } catch (e) {}
  if (applyTheme()) render();
}
// also on return to the app: an installed web app that sat in the background while the OS
// went dark at sunset is not guaranteed to have heard the change event
const followSystem = () => { if (themeMode === "system" && applyTheme()) render(); };
darkMQ.addEventListener("change", followSystem);
document.addEventListener("visibilitychange", () => { if (!document.hidden) followSystem(); });
applyTheme();

// topic group display order: latest-updated first
export function orderGroupsForDisplay(groups) {
  const stamp = g => Math.max(...g.entries.map(entryStamp));
  return [...groups].sort((a, b) => stamp(b) - stamp(a));
}
