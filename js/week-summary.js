// The weekly AI summary: its stored readings and the block at the top of a week.

import { S } from "./state.js";
import { confirmAction, el, sheetRoot } from "./dom.js";
import { mondayOfISOWeek, pad2 } from "./dates.js";
import { generateWeekSummary, weekSumInFlight } from "./anthropic.js";
import { sentenceCase } from "./richtext.js";
import { saveTombstones, summaryTombstones, summaryUpdatedAt, syncPushSummaries, tombstoneSummary } from "./sync-ui.js";
import { render } from "./render.js";
import { openWeekReveal } from "./week-reveal.js";
import { openSettings } from "./settings.js";

// ---------- weekly AI summary (Dot-style) ----------
// never auto-generates: once entries span >= 3 distinct days (and a key is set), a magic
// wand appears — tap it, confirm, and the summary is written and cached in localStorage.
// eye icon toggles visibility; tap the text to edit or re-summarize.
const WEEK_SUM_KEY = "weekly-deposits-week-summaries";
export const SHOW_WSUM_KEY = "weekly-deposits-show-week-summary";
export let weekSummaries = {};
try { weekSummaries = JSON.parse(localStorage.getItem(WEEK_SUM_KEY)) || {}; } catch (e) {}
S.showWeekSummary = true;
try { S.showWeekSummary = localStorage.getItem(SHOW_WSUM_KEY) !== "0"; } catch (e) {}

// which weeks have already had their first-time reveal — so it fires once, then the
// week collapses to the quiet wsum line (with a replay affordance to summon it again)
const WEEK_REVEAL_SEEN_KEY = "weekly-deposits-week-reveal-seen";
export let weekRevealSeen = new Set();
try { weekRevealSeen = new Set(JSON.parse(localStorage.getItem(WEEK_REVEAL_SEEN_KEY)) || []); } catch (e) {}
export function saveWeekRevealSeen() {
  try { localStorage.setItem(WEEK_REVEAL_SEEN_KEY, JSON.stringify([...weekRevealSeen])); } catch (e) {}
}

// every take a week has ever had, keyed by its pill identity ("mine" / "v1" / "v2"…), so
// re-summarizing no longer discards the previous take — the pills toggle between them.
// device-local only: the cloud row stays one-summary-per-week (the currently chosen one),
// so the switch itself syncs, but the back-catalogue doesn't travel across devices.
const WEEK_SUM_VERS_KEY = "weekly-deposits-week-summary-versions";
export let weekSummaryVersions = {};
try { weekSummaryVersions = JSON.parse(localStorage.getItem(WEEK_SUM_VERS_KEY)) || {}; } catch (e) {}
export function saveWeekSummaryVersions() {
  try { localStorage.setItem(WEEK_SUM_VERS_KEY, JSON.stringify(weekSummaryVersions)); } catch (e) {}
}
export function summarySlot(rec) { return rec.origin === "mine" ? "mine" : "v" + (rec.version || 1); }
// next AI version counts across the whole back-catalogue, so V2 never overwrites an archived V2
export function nextAiVersion(k) {
  let v = 0;
  const cur = weekSummaries[k];
  if (cur && cur.origin !== "mine") v = cur.version || 1;
  for (const [slot, rec] of Object.entries(weekSummaryVersions[k] || {}))
    if (slot !== "mine") v = Math.max(v, rec.version || 1);
  return v + 1;
}

export function saveWeekSummaries() {
  // current record always lands in its version slot too, so no take is ever lost
  for (const [k, rec] of Object.entries(weekSummaries)) {
    (weekSummaryVersions[k] = weekSummaryVersions[k] || {})[summarySlot(rec)] = rec;
  }
  saveWeekSummaryVersions();
  try { localStorage.setItem(WEEK_SUM_KEY, JSON.stringify(weekSummaries)); } catch (e) {}
  if (typeof summaryTombstones === "object") { // a live summary supersedes any prior clear of the same week
    let touched = false;
    for (const k of Object.keys(weekSummaries)) if (summaryTombstones[k]) { delete summaryTombstones[k]; touched = true; }
    if (touched) saveTombstones();
  }
  if (typeof syncPushSummaries === "function") syncPushSummaries(); // best-effort cloud push
}
export function weekKey(year, week) { return year + "-" + pad2(week); }

// ---------- weekly summary block ----------
const EYE_ON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/></svg>';
const EYE_OFF = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z"/><circle cx="12" cy="12" r="3"/><path d="M4 4l16 16"/></svg>';

// which bucket the current summary falls in: MINE (hand-written), or V1/V2… (AI takes).
// legacy records predate origin/version — treat them as the first AI take.
function summaryPill(rec) {
  if (!rec) return "";
  return rec.origin === "mine" ? "MINE" : "V" + (rec.version || 1);
}

// the hand-write invite only wakes at the week's own sunday 10:00 (local time) — a
// sunday-morning reflection ritual. (the AI path no longer waits for sunday: the wand
// shows as soon as 3 days are filled, and generates only on an explicit tap+confirm.)
function weekSummaryUnlocked(year, week) {
  const mon = mondayOfISOWeek(year, week);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6); // Mon + 6 = Sun (last day of the ISO week)
  const unlockAt = new Date(sun.getUTCFullYear(), sun.getUTCMonth(), sun.getUTCDate(), 10, 0, 0, 0);
  return new Date() >= unlockAt;
}

export function weekSummaryBlock(list) {
  const k = weekKey(S.wk.year, S.wk.week);
  const rec = weekSummaries[k];

  if (!rec) {
    // a requested summary is on its way — hold the pending line
    if (weekSumInFlight.has(k)) {
      const wrap = el("div", { class: "wsum" });
      wrap.appendChild(el("p", { class: "wsum-text pending" }, "Summarizing the week…"));
      return wrap;
    }
    // The invite waits for the week to reach its sunday 10am — before that the whole surface
    // stays dormant (no invite, no eye). Suppressed when hidden too. The chevron is not bound
    // by this and never was: mid-week the gesture is still there for anyone who wants it.
    if (!S.showWeekSummary || !weekSummaryUnlocked(S.wk.year, S.wk.week)) return null;
    const wrap = el("div", { class: "wsum" });
    // Named, in the place she was already looking. This block used to disappear entirely
    // whenever the AI route existed, which left the chevron as the only door to it — an
    // 22px control at 1.5:1 contrast that fades out on scroll. One unlabelled gesture is not
    // a way to offer a feature; the chevron stays as the shortcut, not as the whole path.
    if (S.apiKey) {
      wrap.appendChild(el("button", {
        class: "wsum-add wsum-ai",
        onclick: () => {
          confirmAction("Create a summary of this week?", "Summarize", () => {
            S.showWeekSummary = true; // she asked for it — don't let it land hidden
            try { localStorage.setItem(SHOW_WSUM_KEY, "1"); } catch (e) {}
            generateWeekSummary(S.wk.year, S.wk.week, list);
            render();
          });
        }
      }, "summarize with ai"));
    }
    wrap.appendChild(el("button", {
      class: "wsum-add",
      onclick: () => openWeekSummaryEditor(S.wk.year, S.wk.week, list)
    }, "+ write a summary"));
    // A week whose current summary is gone can still have takes in the back-catalogue: the
    // version slots are a separate, LOCAL store that a sync deletion does not always reach.
    // Nothing surfaced them once the current record was missing, so a recoverable summary was
    // indistinguishable from one that had never been written. Newest take wins.
    const orphans = Object.entries(weekSummaryVersions[k] || {});
    if (orphans.length) {
      const best = orphans.map(([, r]) => r)
        .sort((a, b) => new Date(summaryUpdatedAt(b)) - new Date(summaryUpdatedAt(a)))[0];
      wrap.appendChild(el("button", {
        class: "wsum-add wsum-restore",
        onclick: () => {
          weekSummaries[k] = { ...best, updatedAt: new Date().toISOString() };
          delete summaryTombstones[k]; saveTombstones(); // a restore outranks any prior clear
          saveWeekSummaries();
          render();
        }
      }, "\u00B7 restore last summary"));
    }
    // No key, no AI route — and until now nothing on screen said so. The absence was silent in
    // both directions at once: the block quietly offered only the hand-written invite, and the
    // chevron quietly did not appear, so "why can't I summarise this week" had no answer
    // anywhere in the interface. A missing precondition should name itself.
    if (!S.apiKey) {
      wrap.appendChild(el("button", {
        class: "wsum-add wsum-nokey",
        onclick: () => openSettings()
      }, "\u00B7 add a key for ai"));
    }
    return wrap;
  }

  const wrap = el("div", { class: "wsum" + (S.showWeekSummary ? "" : " collapsed") });
  const eye = el("button", { class: "wsum-eye", "aria-label": "Toggle week summary" });
  eye.innerHTML = S.showWeekSummary ? EYE_ON : EYE_OFF;
  eye.addEventListener("click", () => {
    S.showWeekSummary = !S.showWeekSummary;
    try { localStorage.setItem(SHOW_WSUM_KEY, S.showWeekSummary ? "1" : "0"); } catch (e) {}
    render();
  });
  wrap.appendChild(eye);

  if (S.showWeekSummary) {
    // the replay wand that lived here is gone too — the chevron under the period replays
    // the reveal now, so there is one door instead of two in different corners.
    const open = () => openWeekSummaryEditor(S.wk.year, S.wk.week, list);
    // every take the week has: V1…Vn then MINE. active pill opens the editor,
    // any other pill switches the week to that take (and the choice persists/syncs).
    const slots = { ...(weekSummaryVersions[k] || {}) };
    slots[summarySlot(rec)] = rec;
    const ids = Object.keys(slots).sort((a, b) =>
      ((a === "mine") - (b === "mine")) || (parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10)));
    const cur = summarySlot(rec);
    for (const id of ids) {
      const on = id === cur;
      wrap.appendChild(el("span", {
        class: "wsum-pill" + (on && ids.length > 1 ? " on" : ""),
        onclick: on ? open : () => switchWeekSummary(k, slots[id])
      }, id === "mine" ? "MINE" : id.toUpperCase()));
    }
    wrap.appendChild(el("p", { class: "wsum-text", onclick: open }, sentenceCase(rec.text)));
  }
  return wrap;
}

// bring an earlier take back: it becomes the week's current record with a fresh
// updatedAt, so the choice both survives reloads and wins last-write-wins in sync
function switchWeekSummary(k, target) {
  const cur = weekSummaries[k];
  if (cur) (weekSummaryVersions[k] = weekSummaryVersions[k] || {})[summarySlot(cur)] = cur;
  weekSummaries[k] = { ...target, updatedAt: new Date().toISOString() };
  saveWeekSummaries();
  render();
}

function openWeekSummaryEditor(year, week, list) {
  const k = weekKey(year, week);
  sheetRoot.innerHTML = "";
  const overlay = el("div", { class: "overlay", onclick: () => sheetRoot.innerHTML = "" });
  const sheet = el("div", { class: "sheet", onclick: e => e.stopPropagation() });
  overlay.appendChild(sheet);

  sheet.appendChild(el("div", { class: "grabber" }));
  const pill = el("span", { class: "wsum-pill", style: { cursor: "default", margin: "0" } });
  const refreshPill = () => {
    const p = summaryPill(weekSummaries[k]);
    pill.textContent = p;
    pill.style.display = p ? "inline-block" : "none";
  };
  const saveBtn = el("button", {
    class: "save",
    onclick: () => {
      const v = ta.value.trim();
      if (v) {
        const prev = weekSummaries[k];
        const nowIso = new Date().toISOString();
        // editing an existing take keeps its bucket (V1 stays V1); a fresh write is MINE
        weekSummaries[k] = prev
          ? { ...prev, text: v, edited: true, updatedAt: nowIso }
          : { text: v, createdAt: nowIso, updatedAt: nowIso, edited: true, origin: "mine" };
      } else {
        tombstoneSummary(k);     // sync the clear, not just locally
        delete weekSummaries[k]; // cleared = forget it; a fresh one generates on next render
        delete weekSummaryVersions[k]; // start over means the back-catalogue goes too
        saveWeekSummaryVersions();
      }
      saveWeekSummaries();
      sheetRoot.innerHTML = "";
      render();
    }
  }, "Save");
  sheet.appendChild(el("div", { class: "sheet-head" },
    pill, el("span", { class: "title" }, "Week summary"), saveBtn));

  const ta = el("textarea", { rows: "5", placeholder: "this week, in your words…" });
  ta.value = sentenceCase((weekSummaries[k] || {}).text || "");
  sheet.appendChild(ta);
  refreshPill();

  if (S.apiKey) {
    const resum = el("button", {
      class: "lock-btn",
      onclick: async () => {
        resum.disabled = true;
        resum.textContent = "summarizing…";
        await generateWeekSummary(year, week, list); // increments the version off the prior take
        resum.disabled = false;
        resum.textContent = "re-summarize";
        // a fresh take isn't just a new line — replay it Wrapped-style, the same reveal the
        // week's first reading gets. close the editor first so the deck isn't behind it.
        if (weekSummaries[k]) {
          sheetRoot.innerHTML = "";
          render();
          setTimeout(() => openWeekReveal(year, week, list), 80); // let the render settle first
        }
      }
    }, "re-summarize");
    sheet.appendChild(resum);
  }

  // explicit authorship: plain Save keeps the current take's provenance (a light edit of
  // V3 stays V3), so claiming a hand-written take is its own deliberate action. archives
  // the current AI take into the pill row and makes a distinct MINE the current one.
  const curRec = weekSummaries[k];
  if (curRec && curRec.origin !== "mine") {
    sheet.appendChild(el("button", {
      class: "lock-btn",
      onclick: () => {
        const v = ta.value.trim();
        if (!v) return;
        const nowIso = new Date().toISOString();
        (weekSummaryVersions[k] = weekSummaryVersions[k] || {})[summarySlot(curRec)] = curRec; // keep the AI take
        weekSummaries[k] = { text: v, createdAt: nowIso, updatedAt: nowIso, edited: true, origin: "mine" };
        saveWeekSummaries();
        sheetRoot.innerHTML = "";
        render();
      }
    }, "save as my own"));
  }

  sheetRoot.appendChild(overlay);
}
