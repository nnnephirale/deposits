// ISO weeks, months and the date labels built from them.

// ---------- date helpers (ISO week) ----------
export function getISOWeek(date) {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNum = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d - yearStart) / 86400000 + 1) / 7);
  return { year: d.getUTCFullYear(), week };
}
export function mondayOfISOWeek(year, week) {
  const simple = new Date(Date.UTC(year, 0, 1 + (week - 1) * 7));
  const dow = simple.getUTCDay();
  const monday = new Date(simple);
  if (dow <= 4) monday.setUTCDate(simple.getUTCDate() - simple.getUTCDay() + 1);
  else monday.setUTCDate(simple.getUTCDate() + 8 - simple.getUTCDay());
  return monday;
}
export function weekRangeLabel(year, week) {
  const mon = mondayOfISOWeek(year, week);
  const sun = new Date(mon);
  sun.setUTCDate(mon.getUTCDate() + 6);
  const fmt = d => d.toLocaleDateString("en-SG", { day: "numeric", month: "short", timeZone: "UTC" });
  return fmt(mon) + " \u2013 " + fmt(sun);
}
export function shiftWeek(year, week, delta) {
  const mon = mondayOfISOWeek(year, week);
  mon.setUTCDate(mon.getUTCDate() + delta * 7);
  return getISOWeek(new Date(mon.getUTCFullYear(), mon.getUTCMonth(), mon.getUTCDate()));
}
export function monthLabel(year, month) {
  return new Date(year, month, 1).toLocaleDateString("en-SG", { month: "long", year: "numeric" });
}
export function stepMonth(m, delta) { // {year, month} ± n months, rolling the year over
  const n = m.month + delta;
  return { year: m.year + Math.floor(n / 12), month: ((n % 12) + 12) % 12 };
}
// the rows a month's calendar grid shows: each is an ISO week plus the seven UTC dates
// under it (the first and last rows spill into the neighbouring months). shared by the
// composer's week popover and the calendar sheet — they render and bind differently, but
// this arithmetic has to agree, so it lives in one place.
export function monthGridRows(year, month) {
  const lastDay = new Date(Date.UTC(year, month + 1, 0));
  const first = new Date(Date.UTC(year, month, 1));
  const start = new Date(first);
  start.setUTCDate(first.getUTCDate() - ((first.getUTCDay() + 6) % 7)); // back to Monday
  const rows = [];
  for (let mon = new Date(start); mon <= lastDay; mon.setUTCDate(mon.getUTCDate() + 7)) {
    const rowMon = new Date(mon);
    const iso = getISOWeek(new Date(rowMon.getUTCFullYear(), rowMon.getUTCMonth(), rowMon.getUTCDate()));
    const days = [];
    for (let i = 0; i < 7; i++) {
      const d = new Date(rowMon);
      d.setUTCDate(rowMon.getUTCDate() + i);
      days.push(d);
    }
    rows.push({ iso, days });
  }
  return rows;
}
// grid cells are UTC dates; "today" is local — compare the parts, not the timestamps
export function isTodayCell(d) {
  const t = new Date();
  return d.getUTCFullYear() === t.getFullYear()
    && d.getUTCMonth() === t.getMonth()
    && d.getUTCDate() === t.getDate();
}
export function pad2(n) { return String(n).padStart(2, "0"); }
export function weekdayIndex(date) { return (date.getDay() + 6) % 7; } // Mon=0 … Sun=6
export function entryDay(e) {
  if (e.day === undefined) return weekdayIndex(new Date(e.createdAt)); // legacy entries
  return e.day; // may be null = no day chosen
}
// ascending-order day key: no-day entries go to the very end (daySortKey's -1 only lands
// last when sorting descending)
export function dayAsc(e) { const d = entryDay(e); return d == null ? 99 : d; }
export function daySortKey(e) {
  const d = entryDay(e);
  return d == null ? -1 : d; // sorted descending, so no-day entries land last
}
// actual calendar date of an entry's chosen day, as DD/MM (month view shows it beside the day token)
export function entryDateStr(e) {
  const d = entryDay(e);
  if (d == null || e.year == null || e.week == null) return null;
  const dt = mondayOfISOWeek(e.year, e.week);
  dt.setUTCDate(dt.getUTCDate() + d);
  return pad2(dt.getUTCDate()) + "/" + pad2(dt.getUTCMonth() + 1);
}
export function entryStamp(e) {
  return Date.parse(e.updatedAt || e.createdAt);
}
