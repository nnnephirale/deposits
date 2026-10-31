// Grouping entries for the list, and the markdown export.

import { S } from "./state.js";
import { DAY_TOKENS, MODES, TOPICS, modeById, topicById } from "./taxonomy.js";
import { dayAsc, daySortKey, entryDay, mondayOfISOWeek, monthLabel, pad2, weekRangeLabel } from "./dates.js";
import { oldestFirst } from "./prefs.js";

// ---------- grouping + markdown ----------
export function activeEntries() {
  if (S.view === "week") {
    const list = S.entries.filter(e => !e.segmented && e.year === S.wk.year && e.week === S.wk.week);
    // NOTE the two different day comparators. Ascending uses dayAsc, whose 99 sentinel sends
    // no-day entries to the END; descending uses daySortKey, whose -1 sentinel does the same
    // once the order is flipped. Swapping one for the other floats "anytime" to the top.
    return oldestFirst
      ? list.sort((a, b) => (dayAsc(a) - dayAsc(b)) || a.createdAt.localeCompare(b.createdAt))
      : list.sort((a, b) => (daySortKey(b) - daySortKey(a)) || b.createdAt.localeCompare(a.createdAt));
  }
  return entriesForMonth(S.mo.year, S.mo.month);
}
export function entriesForMonth(year, month) {
  return S.entries
    .filter(e => {
      if (e.segmented) return false; // ramble originals live behind their segments, not in views
      if (e.week == null) return e.year === year && e.month === month; // month-scoped entry
      const mon = mondayOfISOWeek(e.year, e.week);
      const thu = new Date(mon);
      thu.setUTCDate(mon.getUTCDate() + 3); // week belongs to the month its Thursday is in
      return thu.getUTCFullYear() === year && thu.getUTCMonth() === month;
    })
    .sort(oldestFirst
      ? (a, b) => (weekAsc(a) - weekAsc(b)) || (dayAsc(a) - dayAsc(b)) || a.createdAt.localeCompare(b.createdAt)
      : (a, b) => (weekSortKey(b) - weekSortKey(a)) || (daySortKey(b) - daySortKey(a)) || b.createdAt.localeCompare(a.createdAt));
}
// week-less (month-scoped) entries belong at the END in either direction, so ascending needs
// a HIGH sentinel where descending's weekSortKey uses -1. Reusing -1 here floats them to the top.
function weekAsc(e) { return e.week == null ? 999 : e.week; }
export function weekSortKey(e) { return e.week == null ? -1 : e.week; } // month-scoped entries land last, like no-day ones
export function groupByTopic(list) {
  const groups = {};
  const order = [...TOPICS.map(t => t.id), ...MODES.map(m => m.id), "untagged"];
  for (const e of list) {
    const key = e.tags.find(t => topicById[t]) || e.tags.find(t => modeById[t]) || "untagged";
    (groups[key] = groups[key] || []).push(e);
  }
  return order.filter(k => groups[k]).map(k => ({ key: k, entries: groups[k] }));
}
export function groupLabel(key) {
  return (topicById[key] && topicById[key].label) || (modeById[key] && modeById[key].label) || "untagged";
}
export function exportHeading() {
  return S.view === "week"
    ? "Week " + S.wk.week + " \u00B7 " + weekRangeLabel(S.wk.year, S.wk.week) + " " + S.wk.year
    : monthLabel(S.mo.year, S.mo.month);
}
export function toMarkdown(list, heading) {
  let md = "# " + heading + "\n\n";
  for (const g of groupByTopic(list)) {
    md += "## " + groupLabel(g.key) + "\n\n";
    for (const e of g.entries) {
      const modes = e.tags.filter(t => modeById[t]).map(t => modeById[t].label);
      const d = entryDay(e);
      md += "- " + e.text
        + (modes.length ? " _(" + modes.join(", ") + ")_" : "")
        + " \u2014 " + (e.week == null
          ? monthLabel(e.year, e.month)
          : (d == null ? "" : DAY_TOKENS[d] + ", ") + "W" + pad2(e.week)) + "\n";
    }
    md += "\n";
  }
  return md;
}
