// The menu behind the compose bar's lozenge.

import { S } from "./state.js";
import { el, sheetRoot } from "./dom.js";
import { daySortKey, getISOWeek, mondayOfISOWeek, pad2 } from "./dates.js";
import { plainText } from "./richtext.js";
import { groupLabel, weekSortKey } from "./grouping.js";
import { layout, oldestFirst, setLayout, setOldestFirst } from "./prefs.js";
import { lockPageScroll, unlockPageScroll } from "./viewport.js";
import { searchResultEl } from "./search.js";
import { openSettings } from "./settings.js";
import { doExport } from "./compose-bar.js";

// ---------- the menu (the lozenge on the compose bar) ----------
// one centred modal for the things that used to crowd the header. search is its top row and
// its primary purpose: type and the body below morphs into matching entries. leave it empty
// and the body is the settings list — day view among them.
export const SEARCH_GLYPH = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>';
export function openMenu() {
  lockPageScroll();
  const back = el("div", { class: "read-back" });
  const modal = el("div", { class: "menu-modal", onclick: ev => ev.stopPropagation() });

  const searchRow = el("div", { class: "menu-search" });
  searchRow.innerHTML = SEARCH_GLYPH;
  const input = el("input", { type: "search", placeholder: "search entries\u2026", autocomplete: "off" });
  searchRow.appendChild(input);
  modal.appendChild(searchRow);

  const body = el("div", { class: "menu-body" });
  modal.appendChild(body);

  const close = () => {
    back.classList.remove("show");
    document.removeEventListener("keydown", onKey);
    setTimeout(() => back.remove(), 200);
    unlockPageScroll();
  };
  const onKey = ev => { if (ev.key === "Escape") close(); };

  function row(label, state, onPick, glyph) {
    const r = el("button", { class: "menu-row" + (state ? " on" : ""), onclick: onPick });
    if (glyph) { const g = el("span"); g.innerHTML = glyph; r.appendChild(g.firstChild); }
    r.appendChild(el("span", { class: "mr-label" }, label));
    if (state) r.appendChild(el("span", { class: "mr-state" }, state));
    return r;
  }

  function renderSettings() {
    body.innerHTML = "";
    // day view's home, finally: a plain row that names its own state
    body.appendChild(row("Day view", layout === "day" ? "on" : "off", () => {
      setLayout(layout === "day" ? "topic" : "day");
      renderSettings();
    }));
    // named the same way the rail names it, so the two surfaces agree
    body.appendChild(row("Showing", oldestFirst ? "oldest" : "most recent", () => {
      setOldestFirst(!oldestFirst);
      renderSettings();
    }));
    body.appendChild(row("Export markdown", null, () => { close(); doExport(); }));
    body.appendChild(row("Settings", null, () => { close(); openSettings(); }));
  }

  function renderResults(q) {
    body.innerHTML = "";
    const hay = e => (plainText(e.text, "keep") + " " + e.tags.map(groupLabel).join(" ")).toLowerCase();
    const found = S.entries.filter(e => !e.segmented && hay(e).includes(q))
      .sort((a, b) => (b.year - a.year) || (weekSortKey(b) - weekSortKey(a))
        || (daySortKey(b) - daySortKey(a)) || b.createdAt.localeCompare(a.createdAt));
    body.appendChild(el("p", { class: "menu-count" }, found.length + " found"));
    if (!found.length) return;
    const card = el("div", { class: "group-card" });
    for (const e of found) {
      const r = searchResultEl(e, q);
      r.addEventListener("click", () => close(), { once: true }); // its own handler opens the composer
      card.appendChild(r);
    }
    body.appendChild(card);
  }

  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    if (q) renderResults(q); else renderSettings();
  });

  renderSettings();
  back.appendChild(modal);
  back.addEventListener("click", () => close());
  document.addEventListener("keydown", onKey);
  document.body.appendChild(back);
  requestAnimationFrame(() => back.classList.add("show"));
  setTimeout(() => back.classList.add("show"), 60); // rAF can be throttled where nothing paints
}

function openSearch() {
  sheetRoot.innerHTML = "";
  lockPageScroll();
  let q = "", scope = "all";

  // scope targets = whatever week/month is currently being browsed, so "a specific
  // week/month" = navigate there first; the chips name themselves accordingly
  const scopeWk = { year: S.wk.year, week: S.wk.week };
  const monOfWk = mondayOfISOWeek(S.wk.year, S.wk.week);
  const thuOfWk = new Date(monOfWk);
  thuOfWk.setUTCDate(monOfWk.getUTCDate() + 3);
  const scopeMo = S.view === "month" ? { ...S.mo } : { year: thuOfWk.getUTCFullYear(), month: thuOfWk.getUTCMonth() };
  const nowYear = getISOWeek(new Date()).year;
  const moName = new Date(scopeMo.year, scopeMo.month, 1).toLocaleDateString("en-SG", { month: "long" })
    + (scopeMo.year !== nowYear ? " " + scopeMo.year : "");

  const overlay = el("div", { class: "overlay", onclick: close });
  const sheet = el("div", { class: "sheet search-sheet", onclick: e => e.stopPropagation() });
  overlay.appendChild(sheet);
  function close() { sheetRoot.innerHTML = ""; unlockPageScroll(); }

  sheet.appendChild(el("div", { class: "grabber" }));
  sheet.appendChild(el("div", { class: "sheet-head" }, el("span"), el("span", { class: "title" }, "Search"), el("span")));

  const input = el("input", { class: "search-input", type: "search", placeholder: "search entries…", autocomplete: "off" });
  input.addEventListener("input", () => { q = input.value.trim().toLowerCase(); renderResults(); });
  sheet.appendChild(input);

  const chips = el("div", { class: "chips" });
  const scopes = [["all", "all"], ["week", "W" + pad2(scopeWk.week) + (scopeWk.year !== nowYear ? " " + scopeWk.year : "")], ["month", moName]];
  for (const [id, label] of scopes) {
    chips.appendChild(el("button", {
      class: "chip mode" + (scope === id ? " on" : ""),
      onclick: () => {
        scope = id;
        Array.from(chips.children).forEach((c, i) => c.classList.toggle("on", scopes[i][0] === id));
        renderResults();
      }
    }, label));
  }
  sheet.appendChild(chips);

  const resultsRoot = el("div", { class: "search-results" });
  sheet.appendChild(resultsRoot);

  function inScope(e) {
    if (scope === "week") return e.year === scopeWk.year && e.week === scopeWk.week;
    if (scope === "month") {
      if (e.week == null) return e.year === scopeMo.year && e.month === scopeMo.month; // month-scoped entry
      const mon = mondayOfISOWeek(e.year, e.week);
      const thu = new Date(mon);
      thu.setUTCDate(mon.getUTCDate() + 3);
      return thu.getUTCFullYear() === scopeMo.year && thu.getUTCMonth() === scopeMo.month;
    }
    return true;
  }
  function matches(e) {
    const hay = (plainText(e.text, "keep") + " " + e.tags.map(groupLabel).join(" ")).toLowerCase();
    return hay.includes(q);
  }
  function renderResults() {
    resultsRoot.innerHTML = "";
    if (!q) {
      resultsRoot.appendChild(el("p", { class: "search-hint" }, "search " + S.entries.filter(e => !e.segmented && inScope(e)).length + " entries…"));
      return;
    }
    const found = S.entries.filter(e => !e.segmented && inScope(e) && matches(e))
      .sort((a, b) => (b.year - a.year) || (weekSortKey(b) - weekSortKey(a)) || (daySortKey(b) - daySortKey(a)) || b.createdAt.localeCompare(a.createdAt));
    resultsRoot.appendChild(el("p", { class: "search-count" }, found.length + " found"));
    if (!found.length) return;
    const card = el("div", { class: "group-card" });
    for (const e of found) card.appendChild(searchResultEl(e, q));
    resultsRoot.appendChild(card);
  }

  renderResults();
  sheetRoot.appendChild(overlay);
  setTimeout(() => input.focus(), 120);
}
