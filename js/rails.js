// Desktop rails (>=1080px): the icon rail, the topics rail and its search, the rail calendar,
// and crossing the breakpoint.

import { S } from "./state.js";
import { el } from "./dom.js";
import { DAY_TOKENS, TOPICS, tone } from "./taxonomy.js";
import { daySortKey, entryDay, isTodayCell, mondayOfISOWeek, monthGridRows, monthLabel, pad2, stepMonth } from "./dates.js";
import { plainText } from "./richtext.js";
import { syncDotClass } from "./sync-ui.js";
import { entriesForMonth, groupLabel, weekSortKey } from "./grouping.js";
import { layout, oldestFirst, setLayout, setOldestFirst } from "./prefs.js";
import { entriesRoot, render } from "./render.js";
import { searchResultEl } from "./search.js";
import { SEARCH_GLYPH } from "./menu.js";
import { openSettings } from "./settings.js";
import { doExport } from "./compose-bar.js";

// ---------- desktop rails ----------
// Two panes that only exist at >=1080px. They hold nothing new \u2014 they're the \u22ee modal's
// contents and the period stepper, given room to be visible at once instead of stacked
// behind a tap. Everything here is a view over existing state; no new persistence.

const railL = document.getElementById("railL");
const railR = document.getElementById("railR");
export const deskMQ = window.matchMedia("(min-width: 1080px)");
export let deskQuery = "";   // right-rail search; non-empty takes over the centre pane
S.deskTopic = null; // right-rail topic filter; null = nothing selected, a real state
export let deskSearchInput = null;

// search scope flips through the period being browsed, then everything. Same rule the
// search sheet already uses: "a specific week/month" means navigate there first, and the
// chip names whichever one it is.
const DESK_SCOPES = ["week", "month", "all"];
export let deskScope = "all";
S.deskScopeOpen = false;
function scopeLabelFor(s) {
  if (s === "week") return "W" + pad2(S.wk.week);
  if (s === "month") return (S.mo.month + 1) + "月";
  return "ALL";
}
function scopeNameFor(s) {
  if (s === "week") return "this week";
  if (s === "month") return "this month";
  return "everything";
}
function scopeLabel() { return scopeLabelFor(deskScope); }
function scopeTitle() {
  if (deskScope === "week") return "Searching W" + pad2(S.wk.week) + " — click for the month";
  if (deskScope === "month") return "Searching " + monthLabel(S.mo.year, S.mo.month) + " — click for everything";
  return "Searching every entry — click to narrow to the week";
}
function scopedEntries() {
  if (deskScope === "week") return S.entries.filter(e => !e.segmented && e.year === S.wk.year && e.week === S.wk.week);
  if (deskScope === "month") return entriesForMonth(S.mo.year, S.mo.month);
  return S.entries.filter(e => !e.segmented);
}

function railRow(cls, onPick, ...kids) {
  const b = el("button", { class: "rail-row" + (cls ? " " + cls : ""), onclick: onPick });
  kids.forEach(k => k && b.appendChild(k));
  return b;
}

// ---- the icon rail ----
// Glyphs are drawn from the thing they select, not from a generic metaphor: a week is one
// strip of day cells, a month is the grid of them, day view is the badge-gutter layout.
// same frame box as the month glyph (x3 y4.5 18×16 r3) so the pair reads as one family and
// one doesn't sit visually shorter than the other — week is columns, month adds the rows
const ICO_WEEK = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M9 4.5v16M15 4.5v16"/></svg>';
const ICO_MONTH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="4.5" width="18" height="16" rx="3"/><path d="M3 9.6h18M9 9.6v10.9M15 9.6v10.9M3 15h18"/></svg>';
const ICO_DAY = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 6.5h2.6M4 12h2.6M4 17.5h2.6"/><path d="M10.5 6.5h9.5M10.5 12h6.5M10.5 17.5h9.5"/></svg>';
// bars shortening downward with an arrow to match: the list runs newest → oldest, and the
// mirrored pair runs the other way. Same frame, so the two read as one control flipping.
const ICO_NEWEST = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6.5h9M4 12h6.5M4 17.5h4"/><path d="M18 5.5v13"/><path d="M15.2 15.6 18 18.5l2.8-2.9"/></svg>';
const ICO_OLDEST = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6.5h4M4 12h6.5M4 17.5h9"/><path d="M18 18.5v-13"/><path d="M15.2 8.4 18 5.5l2.8 2.9"/></svg>';
const ICO_EXPORT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15.5V4"/><path d="M7.8 8.2 12 4l4.2 4.2"/><path d="M5 14v4.6A1.4 1.4 0 0 0 6.4 20h11.2a1.4 1.4 0 0 0 1.4-1.4V14"/></svg>';
const ICO_SETTINGS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" aria-hidden="true"><path d="M4 7.5h8.2M17.2 7.5H20M4 16.5h2.8M11.8 16.5H20"/><circle cx="14.7" cy="7.5" r="2.4"/><circle cx="9.3" cy="16.5" r="2.4"/></svg>';
// the fast end of the composer-speed scale. Head plus two ears and nothing else — at 18px any
// more detail (legs, tail, a face) turns to mush, and the ears alone already say rabbit.
export const ICO_RABBIT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10.3 13.2C8.5 10.8 7.7 7 8.4 5.5c.6-1.3 1.9-.6 2.5 1.2.6 1.6.9 3.7.9 5.3"/><path d="M14.2 12.7c1-2.4 2.6-4.2 3.7-4.1 1.1.1 1.1 1.7-.1 3.3-.8 1.1-1.9 2-2.9 2.6"/><circle cx="12" cy="16.7" r="3.6"/></svg>';

function icoRow(label, glyph, on, onPick, dot) {
  const b = el("button", {
    class: "ico-row" + (on ? " on" : ""), onclick: onPick,
    "aria-label": label, "aria-pressed": on ? "true" : "false"
  });
  const g = el("span", { class: "ico-glyph" });
  g.innerHTML = glyph;
  if (dot) g.appendChild(dot);
  b.appendChild(g);
  b.appendChild(el("span", { class: "ico-label" }, label));
  return b;
}

function renderIconRail() {
  railL.innerHTML = "";
  const bar = el("div", { class: "iconbar" });

  // period navigation stays in the header (\u2039 W31 / 7\u6708 \u203a) \u2014 these two only pick which
  // of the two the header is showing, the same switch tapping the inactive tab makes
  bar.appendChild(icoRow("Week", ICO_WEEK, S.view === "week",
    () => { if (S.view !== "week") { S.view = "week"; S.deskTopic = null; render(); } }));
  bar.appendChild(icoRow("Month", ICO_MONTH, S.view === "month",
    () => { if (S.view !== "month") { S.view = "month"; S.deskTopic = null; render(); } }));

  bar.appendChild(el("div", { class: "ico-div" }));

  // Both toggles name themselves the way the mobile menu's rows do, so a status label can't be
  // misread as a command: the bare "Newest first" was already the CURRENT order, but sitting
  // among Week / Month / Export it read like the thing a click would DO. The order names what
  // it's showing rather than an on/off, because "Oldest view: Off" makes you work out that off
  // means newest — "Showing: Most recent" just says it. The arrow still points the way the list
  // reads: down = newest at the top, up = oldest at the top.
  bar.appendChild(icoRow("Showing: " + (oldestFirst ? "Oldest" : "Most recent"),
    oldestFirst ? ICO_OLDEST : ICO_NEWEST, oldestFirst,
    () => setOldestFirst(!oldestFirst)));
  bar.appendChild(icoRow("Day view: " + (layout === "day" ? "On" : "Off"), ICO_DAY, layout === "day",
    () => setLayout(layout === "day" ? "topic" : "day")));
  bar.appendChild(icoRow("Export markdown", ICO_EXPORT, false, () => doExport()));
  bar.appendChild(icoRow("Settings", ICO_SETTINGS, false, () => openSettings(),
    el("span", { class: "ico-dot" + syncDotClass() })));

  railL.appendChild(bar);
}

// The search field is built ONCE and never rebuilt \u2014 the same lesson as the composer's
// build(): re-creating a focused input on every keystroke drops the caret and breaks IME
// composition (this app has \u6708 in its own title). Only the lists below it get refilled.
let railRScroll = null, railScopeBtn = null, railScopeWrap = null, railScopeList = null;
function buildRightRail() {
  railR.innerHTML = "";
  const search = el("div", { class: "rail-search" });
  search.innerHTML = SEARCH_GLYPH;
  const input = el("input", { type: "search", placeholder: "Search\u2026", autocomplete: "off" });
  input.addEventListener("input", () => {
    deskQuery = input.value.trim();
    if (deskQuery) S.deskTopic = null;
    render();
  });
  input.addEventListener("keydown", ev => {
    if (ev.key === "Escape") { ev.stopPropagation(); input.value = ""; deskQuery = ""; render(); input.blur(); }
  });
  search.appendChild(input);
  // built once alongside the input; only its label is refreshed per render, so opening the
  // scope never re-creates the field the caret is sitting in — and, just as importantly,
  // the pull-down below keeps the same nodes so its transition actually has somewhere to
  // travel from instead of being rebuilt mid-flight
  railScopeBtn = el("button", { class: "rail-scope", onclick: () => {
    S.deskScopeOpen = !S.deskScopeOpen;
    render();
  } });
  search.appendChild(railScopeBtn);
  deskSearchInput = input;
  railR.appendChild(search);

  railScopeWrap = el("div", { class: "rail-scope-wrap" });
  const inner = el("div", { class: "rail-scope-inner" });
  railScopeList = el("div", { class: "rail-scope-list" });
  inner.appendChild(railScopeList);
  railScopeWrap.appendChild(inner);
  railR.appendChild(railScopeWrap);

  railRScroll = el("div", { class: "rail-scroll" });
  railR.appendChild(railRScroll);
}

// The whole rail answers to the scope pill, not to the main panel: the pill says what this
// column is about, so if it reads W31 the topics are W31's topics whether the panel is showing
// that week, its month, or a different one entirely. Search already worked this way — the list
// underneath was the one part still counting the period being browsed, which made the pill look
// like it was lying.
function renderRightRail() {
  if (!deskSearchInput || !deskSearchInput.isConnected) buildRightRail();
  railScopeBtn.textContent = scopeLabel();
  railScopeBtn.title = scopeTitle();
  railScopeBtn.setAttribute("aria-label", scopeTitle());
  railScopeBtn.setAttribute("aria-expanded", S.deskScopeOpen ? "true" : "false");
  railScopeBtn.classList.toggle("open", S.deskScopeOpen);
  railScopeWrap.classList.toggle("open", S.deskScopeOpen);
  // refilled, never rebuilt — the wrapper it lives in owns the open/close transition
  railScopeList.innerHTML = "";
  for (const s of DESK_SCOPES) {
    railScopeList.appendChild(el("button", {
      class: "rail-scope-opt" + (s === deskScope ? " on" : ""),
      tabindex: S.deskScopeOpen ? "0" : "-1",
      onclick: () => { deskScope = s; S.deskScopeOpen = false; render(); if (deskSearchInput) deskSearchInput.focus(); }
    },
      el("span", { class: "so-key" }, scopeLabelFor(s)),
      el("span", null, scopeNameFor(s))
    ));
  }

  const scroll = railRScroll;
  scroll.innerHTML = "";
  scroll.appendChild(el("p", { class: "rail-head" }, "topics"));

  // counted off the SCOPE, unfiltered, in the order TOPICS declares \u2014 the same order the
  // composer's chips use, so the two lists never disagree about what comes first. Unfiltered
  // still matters for a different reason: a count that collapsed to whatever topic is active
  // would leave no way to see what clearing the filter gets you.
  const counts = {};
  for (const e of scopedEntries()) for (const t of e.tags) counts[t] = (counts[t] || 0) + 1;
  const present = TOPICS.filter(t => counts[t.id]);
  if (S.deskTopic && !counts[S.deskTopic]) S.deskTopic = null; // filter can't outlive its own row

  if (!present.length) {
    scroll.appendChild(el("p", { class: "rail-empty" }, "\u2014"));
  } else {
    for (const t of present) {
      // the same .pill the entries wear in the middle panel — a topic looks like one thing
      // across the app, not like a list item here and a tag over there
      scroll.appendChild(railRow(S.deskTopic === t.id ? "on" : "",
        () => { S.deskTopic = S.deskTopic === t.id ? null : t.id; render(); },
        el("span", { class: "pill", style: { background: tone(t).bg, color: tone(t).fg } }, t.label),
        el("span", { class: "rr-count" }, String(counts[t.id]))
      ));
    }
  }

  // the calendar sits under the topics: the list is what the rail is for, and the month is the
  // thing you drop to when you want to go somewhere else
  scroll.appendChild(el("p", { class: "rail-head rail-head-gap" }, "month"));
  scroll.appendChild(railCalendarEl());
}

// ---------- the rail calendar (desktop) ----------
// The composer's date picker, given a permanent home in the right rail. Same grid, same week
// column, same tokens — it is the one place on desktop where a month is a SHAPE rather than a
// number in a tab, and where "which week was that" has an answer you can point at.
//
// It carries its own month cursor rather than reading `mo` directly. Browsing forward to see
// what is coming should not drag the middle panel along with it; the cursor re-centres itself
// whenever the app's own month moves, so the period tabs still put the rail back where the
// panel is. railCalSeen is what makes that "whenever" observable — there is no event for it.
let railCalMonth = null, railCalSeen = "";
function syncRailCalMonth() {
  const key = S.mo.year + "-" + S.mo.month;
  if (railCalMonth && railCalSeen === key) return;
  railCalSeen = key;
  railCalMonth = { ...S.mo };
}
// Which calendar dates carry deposits. A week-scoped entry with a day resolves to one real
// date; a month-scoped one has no day and belongs to no cell, so it is left out rather than
// smeared across the month. Keyed by date so two entries on one day count once for the dot.
function entryDateCounts() {
  const counts = {};
  for (const e of S.entries) {
    if (e.segmented || e.week == null) continue;
    const d = entryDay(e);
    if (d == null) continue;
    const dt = mondayOfISOWeek(e.year, e.week);
    dt.setUTCDate(dt.getUTCDate() + d);
    const k = dt.getUTCFullYear() + "-" + dt.getUTCMonth() + "-" + dt.getUTCDate();
    counts[k] = (counts[k] || 0) + 1;
  }
  return counts;
}
function railCalendarEl() {
  syncRailCalMonth();
  const cm = railCalMonth;
  const counts = entryDateCounts();
  const wrap = el("div", { class: "rail-cal" });

  const head = el("div", { class: "cal-head" });
  head.appendChild(el("button", { class: "stepper-btn", "aria-label": "Previous month",
    onclick: () => { railCalMonth = stepMonth(cm, -1); renderRails(); } }, "\u2039"));
  // tapping the title returns to the month the panel is on — the same "back to now" the
  // composer's picker offers, pointed at the app's own position rather than at today
  head.appendChild(el("button", { class: "cal-title", title: "Back to " + monthLabel(S.mo.year, S.mo.month),
    onclick: () => { railCalMonth = { ...S.mo }; renderRails(); } }, monthLabel(cm.year, cm.month)));
  head.appendChild(el("button", { class: "stepper-btn", "aria-label": "Next month",
    onclick: () => { railCalMonth = stepMonth(cm, 1); renderRails(); } }, "\u203A"));
  wrap.appendChild(head);

  const dow = el("div", { class: "cal-row cal-dow" }, el("span", { class: "cal-wk" }, ""));
  DAY_TOKENS.forEach(t => dow.appendChild(el("span", null, t)));
  wrap.appendChild(dow);

  for (const { iso, days } of monthGridRows(cm.year, cm.month)) {
    const current = S.view === "week" && iso.year === S.wk.year && iso.week === S.wk.week;
    const row = el("div", { class: "cal-row wk-row" + (current ? " current" : "") });
    // the week number is the row's own control: it takes the panel to that week, which is the
    // thing this calendar is for
    const wkCell = el("button", { class: "cal-wk", title: "Go to W" + pad2(iso.week) },
      "W" + pad2(iso.week));
    wkCell.addEventListener("click", () => { S.wk = iso; S.view = "week"; render(); });
    row.appendChild(wkCell);
    days.forEach(d => {
      const k = d.getUTCFullYear() + "-" + d.getUTCMonth() + "-" + d.getUTCDate();
      const cls = ["cal-day",
        d.getUTCMonth() !== cm.month ? "cal-out" : "",
        isTodayCell(d) ? "cal-today" : "",
        counts[k] ? "has-dep" : ""].filter(Boolean).join(" ");
      const cell = el("button", { class: cls,
        title: counts[k] ? counts[k] + " deposit" + (counts[k] === 1 ? "" : "s") : undefined },
        String(d.getUTCDate()));
      // a day belongs to a week, and the week is what the panel can show — so tapping any date
      // lands on its week rather than doing nothing
      cell.addEventListener("click", () => { S.wk = iso; S.view = "week"; render(); });
      row.appendChild(cell);
    });
    wrap.appendChild(row);
  }
  return wrap;
}

export function renderRails() {
  if (!deskMQ.matches) {
    // dropping below the breakpoint takes the rails' state with it, or the phone layout
    // would silently stay filtered with no control left on screen to clear it
    deskQuery = ""; S.deskTopic = null; deskScope = "all"; S.deskScopeOpen = false;
    deskSearchInput = null; railScopeBtn = null; railScopeWrap = null; railScopeList = null;
    railL.innerHTML = ""; railR.innerHTML = "";
    return;
  }
  renderIconRail();
  renderRightRail();
}

// the centre pane, when the rail's search field has something in it
export function renderDeskSearch() {
  const q = deskQuery.toLowerCase();
  const hay = e => (plainText(e.text, "keep") + " " + e.tags.map(groupLabel).join(" ")).toLowerCase();
  const found = scopedEntries().filter(e => hay(e).includes(q))
    .sort((a, b) => (b.year - a.year) || (weekSortKey(b) - weekSortKey(a))
      || (daySortKey(b) - daySortKey(a)) || b.createdAt.localeCompare(a.createdAt));
  const where = deskScope === "all" ? "" : " in " + scopeLabel();
  entriesRoot.appendChild(el("p", { class: "search-count" }, found.length + " found" + where));
  if (!found.length) {
    // name the scope in the miss, or a narrowed search reads as "this word is nowhere"
    entriesRoot.appendChild(el("p", { class: "search-hint" },
      deskScope === "all"
        ? "nothing matches \u201c" + deskQuery + "\u201d."
        : "nothing matches \u201c" + deskQuery + "\u201d in " + scopeLabel() + ". flip the scope to widen it."));
    return;
  }
  const card = el("div", { class: "group-card" });
  for (const e of found) card.appendChild(searchResultEl(e, q));
  entriesRoot.appendChild(card);
}

// Crossing the breakpoint rebuilds both sides — the rails' state doesn't survive it.
// Driven off a remembered boolean rather than the event's own payload, and watched on
// `resize` as well: matchMedia's change event does not fire under every viewport path
// (it doesn't under devtools viewport emulation), and the CSS flipping to the desktop
// grid while the rails still hold no children leaves two dead panes on screen.
let deskWas = deskMQ.matches, bpTimer = null;
function onBreakpointCross() {
  // Deferred, NOT read inline: on a resize the event can arrive before matchMedia has
  // re-evaluated, so an inline `matches === deskWas` compares a stale value, returns early,
  // and — because deskWas never advances — the crossing is missed for good. Reading it once
  // the resize has settled also avoids re-rendering on every pixel of a live window drag.
  clearTimeout(bpTimer);
  bpTimer = setTimeout(() => {
    if (deskMQ.matches === deskWas) return;
    deskWas = deskMQ.matches;
    render();
    if (S.composerFmtReattach) S.composerFmtReattach(); // the open composer's bar changes parent here
  }, 60);
}
deskMQ.addEventListener("change", onBreakpointCross);
window.addEventListener("resize", onBreakpointCross, { passive: true });

// a pull-down that only closes via its own trigger is a trap — anywhere else dismisses it
document.addEventListener("pointerdown", ev => {
  if (!S.deskScopeOpen) return;
  if (ev.target.closest && ev.target.closest(".rail-scope, .rail-scope-wrap")) return;
  S.deskScopeOpen = false;
  render();
}, true);
