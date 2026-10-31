// The calendar picker.

import { S } from "./state.js";
import { el, sheetRoot } from "./dom.js";
import { DAY_TOKENS } from "./taxonomy.js";
import { isTodayCell, mondayOfISOWeek, monthGridRows, monthLabel, pad2, stepMonth } from "./dates.js";
import { navMonth, navWeek, render } from "./render.js";

// ---------- calendar picker ----------
// week view: long-press the W## label. month view: tap the month label.
// tap a week row = jump to that week (week view); tap the month title = jump to that month (month view).
function openCalendar() {
  let cm;
  if (S.view === "week") {
    const mon = mondayOfISOWeek(S.wk.year, S.wk.week);
    const thu = new Date(mon);
    thu.setUTCDate(mon.getUTCDate() + 3);
    cm = { year: thu.getUTCFullYear(), month: thu.getUTCMonth() };
  } else {
    cm = { ...S.mo };
  }

  sheetRoot.innerHTML = ""; // never stack a second sheet
  const overlay = el("div", { class: "overlay", onclick: dismiss });
  const sheet = el("div", { class: "sheet", onclick: e => e.stopPropagation() });
  overlay.appendChild(sheet);
  function close() { sheetRoot.innerHTML = ""; }
  // month view: browsing to another month and tapping away lands the view there —
  // no need to also hit the title. week view keeps its no-op dismiss.
  function dismiss() {
    if (S.view === "month" && (cm.year !== S.mo.year || cm.month !== S.mo.month)) {
      S.mo = { ...cm }; close(); render(); return;
    }
    close();
  }

  function build() {
    sheet.innerHTML = "";
    sheet.appendChild(el("div", { class: "grabber" }));

    sheet.appendChild(el("div", { class: "cal-head" },
      el("button", { class: "stepper-btn", onclick: () => { cm = stepMonth(cm, -1); build(); } }, "‹"),
      el("button", {
        class: "cal-title",
        onclick: () => { S.mo = { ...cm }; S.view = "month"; close(); render(); }
      }, monthLabel(cm.year, cm.month)),
      el("button", { class: "stepper-btn", onclick: () => { cm = stepMonth(cm, 1); build(); } }, "›")
    ));

    const dow = el("div", { class: "cal-row cal-dow" }, el("span", { class: "cal-wk" }, ""));
    DAY_TOKENS.forEach(t => dow.appendChild(el("span", null, t)));
    sheet.appendChild(dow);

    // the whole row commits, on click: this sheet closes and re-renders the list beneath
    // it, so a pointerdown commit would let the trailing click land on an entry.
    for (const { iso, days } of monthGridRows(cm.year, cm.month)) {
      const current = S.view === "week" && iso.year === S.wk.year && iso.week === S.wk.week;
      const row = el("div", {
        class: "cal-row wk-row" + (current ? " current" : ""),
        onclick: () => { S.wk = iso; S.view = "week"; close(); render(); }
      });
      row.appendChild(el("span", { class: "cal-wk" }, "W" + pad2(iso.week)));
      for (const d of days) {
        const cls = [d.getUTCMonth() !== cm.month ? "cal-out" : "", isTodayCell(d) ? "cal-today" : ""].filter(Boolean).join(" ");
        row.appendChild(el("span", cls ? { class: cls } : null, String(d.getUTCDate())));
      }
      sheet.appendChild(row);
    }
  }

  build();
  sheetRoot.appendChild(overlay);
}

// period tabs: tapping the OTHER one switches view; tapping the one you're already in
// opens the picker. that's the whole of period navigation on plain taps — no long-press to
// discover, and no separate calendar button competing for space in the dock.
S.titleLongFired = false; // set by the settings long-press below, so it can swallow this tap
function periodTap(target) {
  if (S.titleLongFired) { S.titleLongFired = false; return; }
  if (S.view !== target) { S.view = target; render(); return; }
  openCalendar();
}
navWeek.addEventListener("click", () => periodTap("week"));
navMonth.addEventListener("click", () => periodTap("month"));
[navWeek, navMonth].forEach(b => b.addEventListener("contextmenu", e => e.preventDefault()));
