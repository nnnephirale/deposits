// The main render: period header, the list, keeping your place across a re-render, pinch to
// zoom the list.

import { S, currentWk } from "./state.js";
import { el, sheetRoot } from "./dom.js";
import { DAY_TOKENS, modeById, tone, topicById } from "./taxonomy.js";
import { entryDateStr, entryDay, monthLabel, pad2, weekRangeLabel } from "./dates.js";
import { SUMMARY_MIN_WORDS } from "./anthropic.js";
import { FOLD_LINE_RE, renderRichBlocks } from "./richtext.js";
import { compactText, entryWords, setImageSize, setLineMark } from "./widgets.js";
import { weekSummaryBlock } from "./week-summary.js";
import { activeEntries, groupLabel } from "./grouping.js";
import { LAYOUT_OPTIONS, layout, oldestFirst, setLayout } from "./prefs.js";
import { attachEntrySwipe, openReadModal, renderDayGroups, renderPinnedGroup, renderTopicGroups } from "./entries.js";
import { deskMQ, deskQuery, deskScope, renderDeskSearch, renderRails } from "./rails.js";
import { openComposer } from "./composer.js";
import { monthRecapBlock } from "./recap.js";
import { syncWrappedCue } from "./bloom.js";

// ---------- main render ----------
export const entriesRoot = document.getElementById("entriesRoot");
const periodLabel = document.getElementById("periodLabel");
export const navWeek = document.getElementById("navWeek");
export const navMonth = document.getElementById("navMonth");
const layoutBtns = document.getElementById("layoutBtns"); // absent for now: day view's entry point is still undecided

if (layoutBtns) for (const name of LAYOUT_OPTIONS) {
  layoutBtns.appendChild(el("button", {
    "data-name": name,
    onclick: () => {
      setLayout((layout === name) ? "topic" : name); // tap active again = back to baseline
    }
  }, name));
}

// the rail's two glyphs — bigger and stroked, where LOCK_ICON is a 10px meta-row marker
export const RAIL_LOCK_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4.5" y="10.5" width="15" height="9.5" rx="2.4"/><path d="M8 10.5V7.6a4 4 0 0 1 8 0v2.9"/></svg>';
export const RAIL_TRASH_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 6.5h16M9.5 6.5V4.8a1.3 1.3 0 0 1 1.3-1.3h2.4a1.3 1.3 0 0 1 1.3 1.3v1.7"/><path d="M6.5 6.5 7.6 20a1.4 1.4 0 0 0 1.4 1.3h6a1.4 1.4 0 0 0 1.4-1.3l1.1-13.5"/><path d="M10.5 10.5v7M13.5 10.5v7"/></svg>';
const LOCK_ICON = '<svg viewBox="0 0 12 12" width="10" height="10" aria-hidden="true"><rect x="2.5" y="5.2" width="7" height="4.8" rx="1.2" fill="none" style="stroke: var(--lock-stroke, #C7C7CC)" stroke-width="1.2"/><path d="M4 5.2V3.8a2 2 0 0 1 4 0v1.4" fill="none" style="stroke: var(--lock-stroke, #C7C7CC)" stroke-width="1.2"/></svg>';

// the grey rounded square with the day's initial. Shared by the entry gutter and — since
// 30 Jul — day view's group heading, which used to be mono black text saying the same thing.
function dayBadgeEl(tok) {
  const badge = el("span", { class: "day-badge" });
  const sup = tok.match(/^(.)([¹²])$/); // "T¹" -> T + a small raised 1
  if (sup) { badge.appendChild(document.createTextNode(sup[1]));
             badge.appendChild(el("sup", null, sup[2] === "¹" ? "1" : "2")); }
  else badge.textContent = tok;
  return badge;
}

// Identity of the actual calendar day, not just the weekday index: two Mondays from
// different weeks share entryDay() === 0 and must NOT collapse into one another in month
// view. Month-scoped entries (no week) key off their month instead.
export function entryDayKey(e) {
  return [e.year, e.week == null ? "m" + e.month : "w" + e.week, entryDay(e)].join("|");
}

export function entryEl(e, opts) {
  opts = opts || {};
  // day view hoists the entry's topics out of the meta row and onto a row of their own at
  // the top, in line with the day badge — fixed-width and truncated so they line up, while
  // the text keeps the same full measure it has in topic view.
  const sideTopics = opts.sidePill
    ? (e.tags || []).map(tg => topicById[tg]).filter(t => t && t.id !== opts.skipTag)
    : [];
  // a run of entries on the same day shows the badge once; the rest are marked as repeats
  // and the gutter thread carries the day forward instead (elbow + dashes, see the CSS)
  const entry = el("div", {
    class: "entry" + (opts.repeat ? " rep" : ""),
    onclick: () => openComposer(e)
  });
  // the day rides in a badge in the left gutter, with a hairline threading down to the next
  // one. it replaces the day token that used to sit in the meta row.
  const dayIdx = entryDay(e);
  const gutter = el("div", { class: "entry-gutter" });
  if (!opts.repeat) gutter.appendChild(dayBadgeEl(dayIdx == null ? "–" : DAY_TOKENS[dayIdx]));
  entry.appendChild(gutter);
  const body = el("div", { class: "entry-body" });
  // day view's topics: the body's first row, so they sit beside the badge in the gutter and
  // the text below them runs the entry's full width
  if (sideTopics.length) {
    const tagRow = el("div", { class: "entry-tags" });
    for (const t of sideTopics) {
      tagRow.appendChild(el("span", { class: "pill", style: { background: tone(t).bg, color: tone(t).fg } }, t.label));
    }
    body.appendChild(tagRow);
  }
  const collapse = S.compactView && entryWords(e) > SUMMARY_MIN_WORDS;
  const onResize = (imgId, size) => setImageSize(e.id, imgId, size);
  const onCheck = (li, mark) => setLineMark(e.id, li, mark);
  const p = el("p");
  // a "+++" line folds everything below it behind a Read-more that floats the whole entry
  // in a centred modal — but only in the normal card; the pinch-collapsed view is its own
  // truncation, and a fold with nothing under it is just a stray marker.
  const fold = collapse ? null : FOLD_LINE_RE.exec(e.text);
  const foldHasBody = fold && e.text.slice(fold.index + fold[0].length).trim();
  if (collapse) p.textContent = compactText(e);
  else if (foldHasBody) {
    const above = e.text.slice(0, fold.index).replace(/\n+$/, "");
    p.appendChild(renderRichBlocks(above, e.images, onResize, onCheck));
  } else {
    p.appendChild(renderRichBlocks(e.text, e.images, onResize, onCheck));
  }
  body.appendChild(p);
  if (foldHasBody) {
    const more = el("button", { class: "read-more",
      onclick: ev => { ev.stopPropagation(); openReadModal(e); } }, "Read more");
    body.appendChild(more);
  }
  const meta = el("div", { class: "entry-meta" });
  if (e.locked) {
    const lock = el("span", { class: "entry-lock", "aria-label": "locked" });
    lock.innerHTML = LOCK_ICON;
    meta.appendChild(lock);
  }
  const bits = [];
  // the gutter badge already says which day it was, so meta only adds what it can't:
  // the calendar date in month view, plus week/year when those aren't implied by the view.
  if (opts.showDate && dayIdx != null) {
    const dstr = entryDateStr(e);
    if (dstr) bits.push(dstr);
  }
  // week-tagged entries (day or not) show their W## in month view; month-scoped ones
  // have no week to show — the view itself is their scope
  if (opts.showWeek && e.week != null) bits.push("W" + pad2(e.week));
  if (opts.showWeek && e.year !== currentWk.year) bits.push(String(e.year));
  if (bits.length) meta.appendChild(el("span", { class: "entry-day" }, bits.join(" · ")));
  for (const tg of e.tags) {
    if (tg === opts.skipTag) continue;
    const tt = topicById[tg], mm = modeById[tg];
    if (tt) {
      if (sideTopics.some(s => s.id === tt.id)) continue; // already riding on the top row
      meta.appendChild(el("span", { class: "pill", style: { background: tone(tt).bg, color: tone(tt).fg } }, tt.label));
    }
    else if (mm) meta.appendChild(el("span", { class: "pill mode" }, mm.label));
  }
  if (meta.children.length) body.appendChild(meta);
  entry.appendChild(body);
  if (!opts.noSwipe) attachEntrySwipe(entry, e);
  return entry;
}

// ---------- keeping your place across a re-render ----------
// `entriesRoot.innerHTML = ""` collapses the scroller's content to nothing, and the browser
// clamps the scroll offset to the new maximum \u2014 0 \u2014 on the spot. Re-adding the content does NOT
// put it back. So saving, deleting or ticking anything threw the list to the top, which is
// worst in day view where the list is longest. Measured: scrolled to 600, cleared, scrollY reads
// 0 before a single row is re-added.
// The offset is only worth keeping when it still means the same thing, so it's restored when the
// view's IDENTITY is unchanged and dropped when it isn't. Doing it that way needs no changes at
// the ~40 render() call sites: a mutation leaves the identity alone and keeps your place, while
// stepping the period or flipping the order changes it and starts at the top, as before.
function viewIdentity() {
  return [S.view, layout, oldestFirst, S.deskTopic, deskQuery, deskScope,
          S.view === "week" ? S.wk.year + "w" + S.wk.week : S.mo.year + "m" + S.mo.month].join("|");
}
// desktop scrolls .wrap internally; the phone scrolls the window. Queried live rather than
// captured, because render() runs before the module-level wrapEl const is initialised.
function listScroller() {
  return deskMQ.matches ? document.querySelector(".wrap") : null;
}
function listScrollTop() {
  const el = listScroller();
  return el ? el.scrollTop : window.scrollY;
}
function setListScrollTop(y) {
  const el = listScroller();
  if (el) el.scrollTop = y;
  else window.scrollTo(0, y);
}
export let lastViewId = null;

// A wrapper, so the restore covers renderView's three separate `return`s (search takeover,
// empty state, normal) without having to remember it at each one.
export function render() {
  const viewId = viewIdentity();
  // compared against the PREVIOUS render's identity: callers mutate state before calling in
  const keepPlace = viewId === lastViewId;
  const prevScroll = keepPlace ? listScrollTop() : 0;
  lastViewId = viewId;
  renderView();
  // AFTER the rebuild: a scroller with no content can't hold an offset, which is the whole bug
  setListScrollTop(prevScroll);
}

function renderView() {
  // the period tabs are both the identity and the switcher: W## reads the week being
  // viewed, 7\u6708 the month. the active one is dark, the other recedes.
  navWeek.textContent = "W" + pad2(S.wk.week);
  navMonth.textContent = (S.mo.month + 1) + "\u6708";
  navWeek.classList.toggle("on", S.view === "week");
  navMonth.classList.toggle("on", S.view === "month");
  if (layoutBtns) Array.from(layoutBtns.children).forEach(b => {
    const name = b.getAttribute("data-name");
    if (name) b.classList.toggle("on", name === layout);
  });

  periodLabel.innerHTML = "";
  if (S.view === "week") {
    let sub = weekRangeLabel(S.wk.year, S.wk.week);
    if (S.wk.year !== currentWk.year) sub += " \u00B7 " + S.wk.year;
    const range = el("div", { class: "wk-range" }, sub);
    // "this is the week you're actually in" \u2014 the dates are the only thing on screen that
    // could say it, since W31 reads the same whichever week you've stepped to. Live only:
    // a dot on every week would say nothing.
    const live = S.wk.year === currentWk.year && S.wk.week === currentWk.week;
    // role=img so the label is actually announced — aria-label on a bare span isn't
    if (live) range.appendChild(el("span", { class: "wk-now", role: "img", "aria-label": "this week" }));
    periodLabel.appendChild(range);
  } else {
    periodLabel.appendChild(el("div", { class: "wk-range" }, monthLabel(S.mo.year, S.mo.month)));
  }

  entriesRoot.innerHTML = "";
  const all = activeEntries();
  // the rails are on their own axis — the scope pill's, not this panel's. They read no
  // argument on purpose: passing `all` in was what tied the topic list to the period.
  renderRails();

  // desktop only: the right rail's search takes over the centre pane entirely
  if (deskQuery) { syncWrappedCue(null); renderDeskSearch(); return; }

  const list = S.deskTopic ? all.filter(e => e.tags.includes(S.deskTopic)) : all;
  // the wrapped is about the whole period, so a topic-filtered slice has no door to it
  syncWrappedCue(S.deskTopic ? null : list);
  if (list.length === 0) {
    const empty = el("div", { class: "empty" });
    empty.innerHTML = S.deskTopic
      ? "nothing under " + groupLabel(S.deskTopic) + " " + (S.view === "week" ? "this week" : "this month") + ".<br/>pick another topic, or clear the filter."
      : "nothing deposited " + (S.view === "week" ? "this week" : "this month") + " yet.<br/>start typing below to file a thought.";
    entriesRoot.appendChild(empty);
    return;
  }
  // a summary is about the whole period, so it has no business in a topic-filtered slice
  if (!S.deskTopic) {
    if (S.view === "week") {
      const wsum = weekSummaryBlock(list);
      if (wsum) entriesRoot.appendChild(wsum);
    } else {
      const recap = monthRecapBlock(list); // the month's wand: read it back / replay the reading
      if (recap) entriesRoot.appendChild(recap);
    }
  }
  // Pinned entries lift clear of the grouping into a block of their own at the top. Undated
  // ones are the case this is really for: with no day to sort by they sink to the "anytime"
  // bucket at the very bottom, which is the worst place for the running list or the standing
  // note that is exactly the kind of thing you'd pin. A pinned DATED entry rises too — one
  // toggle that means the same thing everywhere beats one that silently does nothing on most
  // entries. They come out of the groups below, so nothing is listed twice.
  const pins = list.filter(e => e.pinned);
  if (pins.length) renderPinnedGroup(pins);
  const rest = pins.length ? list.filter(e => !e.pinned) : list;
  if (layout === "day") renderDayGroups(rest);
  else renderTopicGroups(rest, false);
}

// ---------- pinch to zoom the list ----------
// pinch out (fingers apart) = full text; pinch in = compact view with summaries.
// only active on the list itself — ignored while any sheet is open.
(() => {
  let startDist = null;
  const dist = touches => Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY
  );
  document.addEventListener("touchstart", ev => {
    if (ev.touches.length === 2 && !sheetRoot.childElementCount) startDist = dist(ev.touches);
  }, { passive: true });
  document.addEventListener("touchmove", ev => {
    if (ev.touches.length !== 2 || startDist == null) return;
    ev.preventDefault();
    const ratio = dist(ev.touches) / startDist;
    if (ratio < 0.75 && !S.compactView) {
      S.compactView = true;
      startDist = dist(ev.touches); // re-baseline so the same gesture doesn't flap
      render();
    } else if (ratio > 1.33 && S.compactView) {
      S.compactView = false;
      startDist = dist(ev.touches);
      render();
    }
  }, { passive: false });
  ["touchend", "touchcancel"].forEach(evt =>
    document.addEventListener(evt, () => { startDist = null; }));
})();
