// The composer (openComposer) and the ramble view.

import { S } from "./state.js";
import { confirmAction, el, sheetRoot } from "./dom.js";
import { DAY_TOKENS, MODES, TOPICS, modeById, tone, topicById } from "./taxonomy.js";
import { entryDay, getISOWeek, isTodayCell, mondayOfISOWeek, monthGridRows, monthLabel, pad2, stepMonth, weekdayIndex } from "./dates.js";
import { saveEntries } from "./save.js";
import { SEGMENT_MIN_LINES, SEGMENT_MIN_WORDS, segmentRamble, wordCount } from "./anthropic.js";
import { BULLET_ICON, CHECKBOX_ICON, CHECK_MARK, CHECK_RE, CROSS_ICON, FMT_LINK_ICON, FOLD_ICON, IMG_ICON, INDENT_ICON, LINES_ICON, OUTDENT_ICON, PIN_ICON, REDACT_ICON, TAG_ICON, domainOf, fileToDataUrl, imagesUsedIn, plainText, renderRichBlocks } from "./richtext.js";
import { pauseShimmerOnScroll } from "./widgets.js";
import { tombstoneEntry } from "./sync-ui.js";
import { unfoldK, unfoldStill } from "./prefs.js";
import { render } from "./render.js";
import { deskMQ } from "./rails.js";
import { bindFmtSelectionSync, caretLineIn, clearKeyboardReserve, lockPageScroll, reserveForKeyboard, resyncForKeyboard, saveSheetFrac, sheetFrac, unlockPageScroll, vvp } from "./viewport.js";
import { TICK_ICON } from "./compose-bar.js";

export function openComposer(existing) {
  let text = existing ? existing.text : "";
  let tags = existing ? [...existing.tags] : [];
  let images = existing && existing.images ? { ...existing.images } : {};
  let locked = existing ? !!existing.locked : false;
  // pinned rides with the entry like `locked` does: set in the head, saved with Save, and read
  // by the list to lift it clear of the groups. See pinnedFirst.
  let pinned = existing ? !!existing.pinned : false;
  // month mode: entries born in the month view belong to the month itself — no week, no
  // day. an entry keeps its scope for life: editing a month entry never grows week pills.
  const monthMode = existing ? (existing.week == null && existing.month != null) : S.view === "month";
  const cmo = monthMode
    ? (existing ? { year: existing.year, month: existing.month } : { ...S.mo })
    : null;
  let cw = existing
    ? { year: existing.year, week: existing.week }
    : (S.view === "week" ? { year: S.wk.year, week: S.wk.week } : getISOWeek(new Date()));
  let day = existing ? entryDay(existing) : weekdayIndex(new Date());
  const nowWk = getISOWeek(new Date());
  // the fields that pin an entry to its spot in time — month scope or week(+day) scope
  const scopeFields = () => monthMode
    ? { year: cmo.year, month: cmo.month, week: null, day: null }
    : { year: cw.year, week: cw.week, day };
  // segmentation proposal: null | { busy: true } | { ranges: [{start, end, topic}] }
  let segState = null, segErr = null, segTagOpen = -1;
  // manual composer height (px) set by dragging the notch; persists across rebuilds, and
  // now across opens too — seeded from the remembered fraction of THIS viewport
  let manualHeight = sheetFrac != null ? Math.round(sheetFrac * window.innerHeight) : null;
  // build()'s applySheetHeight, published so the open path can run it again once the sheet is
  // actually in the document — inside build() there is nothing to measure yet.
  let reapplySheetHeight = null;
  // once the format bar has shown, keep it shown (survives rebuilds too — no reflow jump)
  let barShown = false;
  // the tag popover's open state. Lives out here, not in build(), because picking a tag calls
  // build() — a rebuild would otherwise slam the popover shut on every single selection, which
  // makes choosing two topics impossible without reopening it each time.
  let tagPopOpen = false;
  // the fmt bar is fixed-position and docked to the keyboard, so it lives OUTSIDE `sheet` —
  // sheet.innerHTML = "" at the top of every build() would otherwise never touch it, and
  // build() runs on every tag toggle, day change, segmentation offer... every one of those
  // would leave the old bar behind and append a fresh one on top of it. This is the one
  // element build() has to clean up by hand instead of getting the wipe for free.
  let fmtBarEl = null;

  sheetRoot.innerHTML = ""; // never stack on another sheet (composer can open from search results)
  lockPageScroll();
  const overlay = el("div", { class: "overlay", onclick: requestClose });
  const sheet = el("div", { class: "sheet expanse", onclick: e => e.stopPropagation() });
  overlay.appendChild(sheet);
  // build() clears sheet's children but not sheet's own listeners, and it re-runs on every
  // day/week/tag/lock change — so the tap-away handler is swapped, never stacked.
  let sheetTapAway = null;

  // ---- the head pins, and shrinks as the text runs under it ----
  // The grabber and the day/week/tag/dismiss/commit row ride in one sticky block, so a long
  // entry never scrolls its own controls off the top. As the text moves under it the row scales
  // down — the left group toward the top-left corner and the right group toward the top-right,
  // so the two ends draw back into their own corners instead of both drifting toward the middle.
  // It is scrubbed by scroll rather than played as an animation: a transition here would lag a
  // finger that is still moving, and the whole point is that the bar tracks the text.
  // Layout is deliberately untouched — a transform costs no reflow, so this stays smooth at 60fps
  // where re-measuring a row on every scroll frame would fight the scroll itself.
  const HEAD_FLOOR = 0.82;   // how small the row gets, at rest against the top
  const HEAD_RUN = 120;      // px of scroll it takes to get there
  // Registered ONCE per composer, not per build(): the sheet outlives every rebuild, so a
  // listener added in build() would stack one more copy on every tag pick and day change.
  // Written straight from the scroll handler with no requestAnimationFrame in between. The rAF
  // was there out of habit and it was wrong twice over: scroll already fires at most once a
  // frame, so it batches nothing, and deferring the write by a frame is exactly what makes a
  // scroll-linked transform trail the content it is supposed to be tracking. Nothing here forces
  // layout either — scrollTop is read after layout has settled, and a custom property plus a
  // class that only drives opacity are both write-only as far as geometry is concerned.
  let headWrapEl = null;
  function syncHeadScale() {
    if (!headWrapEl) return;
    const run = Math.min(1, Math.max(0, sheet.scrollTop) / HEAD_RUN);
    headWrapEl.style.setProperty("--head-k", (1 - run * (1 - HEAD_FLOOR)).toFixed(3));
    // the fade only exists while there is something to fade — nothing under the bar means no
    // reason to put a gradient over it
    headWrapEl.classList.toggle("stuck", sheet.scrollTop > 2);
  }
  sheet.addEventListener("scroll", syncHeadScale, { passive: true });

  function close() {
    document.body.classList.remove("composing"); // let the list come back forward
    bindFmtSelectionSync(null); S.sheetViewportSync = null; clearKeyboardReserve();
    S.composerFmtReattach = null; fmtBarEl = null;
    // clears the bar along with everything else: on a phone it is a direct child of sheetRoot,
    // on desktop it is nested inside the sheet — either way this is its ancestor.
    sheetRoot.innerHTML = ""; unlockPageScroll();
  }
  // tapping away with unsaved work is an easy way to lose a thought — warn first. covers a
  // brand-new entry with text AND edits to an existing one; an unchanged entry (just opened
  // to read) or an empty new composer dismisses without friction.
  function isDirty() {
    if (segState && segState.ranges) return true; // an unsaved cut proposal counts as work
    if (!existing) return !!text.trim();
    if (text.trim() !== (existing.text || "").trim()) return true;
    if (locked !== !!existing.locked) return true;
    if (pinned !== !!existing.pinned) return true;
    if (day !== entryDay(existing)) return true;
    if (cw.year !== existing.year || cw.week !== existing.week) return true;
    const a = [...tags].sort(), b = [...(existing.tags || [])].sort();
    return a.length !== b.length || a.some((t, i) => t !== b[i]);
  }
  function requestClose() {
    if (isDirty()) {
      confirmAction(
        existing ? "Discard your changes to this entry?" : "Discard this entry? Your unsaved text will be lost.",
        "Discard", close);
    } else {
      close();
    }
  }

  function build() {
    sheet.innerHTML = "";
    if (fmtBarEl) { fmtBarEl.remove(); fmtBarEl = null; } // see the note on fmtBarEl above
    const grabber = el("div", { class: "grabber", title: "Drag to resize" });
    // the sticky block: grabber and head together, so the resize notch stays reachable from
    // anywhere in a long entry rather than being stranded at the top of the scroll
    const headWrap = el("div", { class: "composer-top" }, grabber);
    headWrapEl = headWrap;
    sheet.appendChild(headWrap);

    // ---- header: day scrubber | title | save ----
    const head = el("div", { class: "sheet-head" });

    // strip = 7 day tokens + a trailing "–" cell meaning "no day"
    const NO_DAY = DAY_TOKENS.length;
    const stripTokens = [...DAY_TOKENS, "–"];
    const dayPill = el("button", { class: "day-pill" }, day == null ? "–" : DAY_TOKENS[day]);
    let strip = null, dragging = false, moved = false, hot = (day == null ? NO_DAY : day), startX = 0;

    // day/week changes only alter the two pill labels — rebuilding the whole sheet for them
    // tore down and re-created the field, the styling row and every chip, which is the flash.
    // (weekPill is declared further down; this only runs after build() has finished.)
    function refreshScopePills() {
      dayPill.textContent = day == null ? "\u2013" : DAY_TOKENS[day];
      hot = (day == null ? NO_DAY : day);
      weekPill.textContent = "W" + pad2(cw.week)
        + (cw.year !== nowWk.year ? "\u00B7" + String(cw.year).slice(2) : "");
    }

    function commitDay(i) {
      day = (i === NO_DAY) ? null : i;
      closeStrip();
      refreshScopePills();
    }
    function openStrip() {
      if (strip) return;
      const todayIdx = weekdayIndex(new Date());
      strip = el("div", { class: "day-strip" });
      stripTokens.forEach((tok, i) => {
        const cls = [i === hot ? "hot" : "", i === todayIdx ? "today" : ""].filter(Boolean).join(" ");
        const s = el("span", { class: cls }, tok);
        // commit on pointerdown, not click: a click arrives only after the textarea has
        // blurred and the keyboard collapse has shifted the whole sheet, so it used to
        // land on the wrong element — the tap "didn't take" and needed a second attempt.
        // preventDefault also keeps the textarea focused, so nothing moves at all.
        s.addEventListener("pointerdown", ev => {
          ev.preventDefault();
          ev.stopPropagation();
          commitDay(i);
        });
        s.addEventListener("click", ev => ev.stopPropagation()); // late click on a replaced sheet must not bubble anywhere
        strip.appendChild(s);
      });
      head.appendChild(strip);
    }
    function closeStrip() { if (strip) { strip.remove(); strip = null; } }
    function highlight(i) {
      hot = i;
      if (!strip) return;
      Array.from(strip.children).forEach((c, j) => c.classList.toggle("hot", j === i));
    }
    function idxFromX(x) {
      const r = strip.getBoundingClientRect();
      const i = Math.floor((x - r.left) / (r.width / stripTokens.length));
      return Math.max(0, Math.min(stripTokens.length - 1, i));
    }

    dayPill.addEventListener("pointerdown", ev => {
      ev.preventDefault();
      closeCalPop();
      if (strip && !dragging) { closeStrip(); return; } // second tap toggles closed
      dragging = true; moved = false; hot = (day == null ? NO_DAY : day); startX = ev.clientX;
      openStrip();
      try { dayPill.setPointerCapture(ev.pointerId); } catch (e) {}
    });
    dayPill.addEventListener("pointermove", ev => {
      if (!dragging || !strip) return;
      if (Math.abs(ev.clientX - startX) > 8) moved = true;
      if (moved) highlight(idxFromX(ev.clientX));
    });
    dayPill.addEventListener("pointerup", () => {
      if (!dragging) return;
      dragging = false;
      if (moved) commitDay(hot);
      // no movement: strip stays open for tapping a day
    });
    dayPill.addEventListener("pointercancel", () => { dragging = false; closeStrip(); });

    // ---- week pill: the wk-picker section collapsed into a W## button beside the day
    // pill. tapping it drops an inline month calendar; a date picks week + day, the W##
    // cell picks just the week (day untouched). collapse animates before committing. ----
    let calPop = null, calMonth = null;
    const weekPill = el("button", { class: "day-pill" },
      "W" + pad2(cw.week) + (cw.year !== nowWk.year ? "·" + String(cw.year).slice(2) : ""));
    weekPill.addEventListener("pointerdown", ev => ev.preventDefault()); // keep the textarea focused
    weekPill.addEventListener("click", ev => {
      ev.stopPropagation();
      if (calPop) closeCalPop(); else openCalPop();
    });

    function openCalPop() {
      if (calPop) return;
      closeStrip();
      const mon = mondayOfISOWeek(cw.year, cw.week);
      const thu = new Date(mon);
      thu.setUTCDate(mon.getUTCDate() + 3);
      calMonth = { year: thu.getUTCFullYear(), month: thu.getUTCMonth() }; // month the chosen week belongs to
      calPop = el("div", { class: "cal-pop" });
      // same keyboard rule as the day strip: preventDefault on pointerdown so the textarea
      // never blurs — the sheet stays perfectly still under the picker
      calPop.addEventListener("pointerdown", ev => { ev.preventDefault(); ev.stopPropagation(); });
      calPop.addEventListener("click", ev => ev.stopPropagation());
      renderCalPop();
      head.appendChild(calPop);
    }
    function closeCalPop(after) {
      const p = calPop;
      calPop = null;
      if (!p) { if (after) after(); return; }
      let fired = false;
      const done = () => { if (fired) return; fired = true; p.remove(); if (after) after(); };
      p.classList.add("closing");
      p.addEventListener("animationend", done, { once: true });
      setTimeout(done, 240); // reduced-motion / safety net
    }
    function pickWeek(iso, dayIdx) {
      closeCalPop(() => {
        cw = { year: iso.year, week: iso.week };
        if (dayIdx != null) day = dayIdx;
        refreshScopePills();
      });
    }
    function renderCalPop() {
      calPop.innerHTML = "";
      calPop.appendChild(el("div", { class: "cal-head" },
        el("button", { class: "stepper-btn", onclick: () => {
          calMonth = stepMonth(calMonth, -1);
          renderCalPop();
        } }, "‹"),
        el("button", { class: "cal-title", onclick: () => { // tap the title = back to the current month
          const t = new Date();
          calMonth = { year: t.getFullYear(), month: t.getMonth() };
          renderCalPop();
        } }, monthLabel(calMonth.year, calMonth.month)),
        el("button", { class: "stepper-btn", onclick: () => {
          calMonth = stepMonth(calMonth, 1);
          renderCalPop();
        } }, "›")
      ));
      const dow = el("div", { class: "cal-row cal-dow" }, el("span", { class: "cal-wk" }, ""));
      DAY_TOKENS.forEach(t => dow.appendChild(el("span", null, t)));
      calPop.appendChild(dow);

      // commits on pointerdown: this popover lives above a focused textarea, so a click
      // would land after the keyboard collapses the sheet. see the day-strip picker.
      for (const { iso, days } of monthGridRows(calMonth.year, calMonth.month)) {
        const current = iso.year === cw.year && iso.week === cw.week;
        const row = el("div", { class: "cal-row wk-row" + (current ? " current" : "") });
        const wkCell = el("span", { class: "cal-wk" }, "W" + pad2(iso.week));
        wkCell.addEventListener("pointerdown", () => pickWeek(iso, null)); // week only — day stays
        row.appendChild(wkCell);
        days.forEach((d, i) => {
          const cls = [
            d.getUTCMonth() !== calMonth.month ? "cal-out" : "",
            isTodayCell(d) ? "cal-today" : "",
            current && i === day ? "cal-sel" : ""
          ].filter(Boolean).join(" ");
          const cell = el("span", cls ? { class: cls } : null, String(d.getUTCDate()));
          cell.addEventListener("pointerdown", () => pickWeek(iso, i)); // a date sets week + day together
          row.appendChild(cell);
        });
        calPop.appendChild(row);
      }
    }

    // tap anywhere else in the sheet closes an open strip / calendar. swapped rather than
    // added, so a long editing session doesn't accumulate one handler per rebuild.
    if (sheetTapAway) sheet.removeEventListener("click", sheetTapAway);
    sheetTapAway = ev => {
      if (strip && !strip.contains(ev.target) && ev.target !== dayPill) closeStrip();
      if (calPop && !calPop.contains(ev.target) && ev.target !== weekPill) closeCalPop();
    };
    sheet.addEventListener("click", sheetTapAway);

    function doSave() {
      const imgs = imagesUsedIn(text, images); // pasted-then-deleted images don't persist
      const imgVal = Object.keys(imgs).length ? imgs : undefined;
      if (existing) {
        S.entries = S.entries.map(e => e.id === existing.id
          ? { ...e, text: text.trim(), tags, ...scopeFields(), locked, pinned,
              images: imgVal, updatedAt: new Date().toISOString() }
          : e);
      } else {
        const stamp = new Date().toISOString();
        S.entries = [...S.entries, {
          id: Date.now().toString(36),
          createdAt: stamp, updatedAt: stamp,
          text: text.trim(), tags, ...scopeFields(), locked, pinned,
          images: imgVal
        }];
      }
      saveEntries(S.entries);
      close();
      render();
    }

    // saving a segmentation writes the ramble as a hidden source entry plus one
    // deposit per block — every block is a verbatim slice of the original text.
    function doSaveSegments() {
      const ranges = segState.ranges;
      const stamp = new Date().toISOString();
      const base = Date.now().toString(36);
      const srcImgs = imagesUsedIn(text, images);
      let src;
      if (existing) {
        src = { ...existing, text: text.trim(), tags, ...scopeFields(), locked, pinned,
          images: Object.keys(srcImgs).length ? srcImgs : undefined, segmented: true, updatedAt: stamp };
        S.entries = S.entries.map(e => e.id === existing.id ? src : e);
      } else {
        src = { id: base, createdAt: stamp, updatedAt: stamp, text: text.trim(), tags,
          ...scopeFields(), locked, pinned, segmented: true,
          images: Object.keys(srcImgs).length ? srcImgs : undefined };
        S.entries = [...S.entries, src];
      }
      const modeTags = tags.filter(t => modeById[t]); // modes chosen for the ramble carry to every deposit
      const segs = ranges.map((rg, i) => {
        const segText = text.slice(rg.start, rg.end).trim();
        const segImgs = imagesUsedIn(segText, images); // each deposit keeps only the images its slice references
        return {
          id: base + "s" + i, createdAt: stamp, updatedAt: stamp,
          text: segText,
          tags: [...(rg.topic ? [rg.topic] : []), ...modeTags],
          ...scopeFields(), locked: false, sourceId: src.id,
          images: Object.keys(segImgs).length ? segImgs : undefined
        };
      });
      S.entries = [...S.entries, ...segs];
      saveEntries(S.entries);
      close();
      render();
    }

    // The commit, as a function rather than inline on the button: ⌘/ctrl+Enter is a second way
    // to reach it, and the week-move confirm has to stand in front of BOTH of them.
    function commitEntry() {
      if (!text.trim()) return;
      const save = (segState && segState.ranges) ? doSaveSegments : doSave;
      // moving an existing entry to a different week is easy to do by accident — confirm it
      if (existing && (cw.year !== existing.year || cw.week !== existing.week)) {
        const from = "W" + pad2(existing.week) + (existing.year !== cw.year ? " " + existing.year : "");
        const to = "W" + pad2(cw.week) + (existing.year !== cw.year ? " " + cw.year : "");
        confirmAction("Move this entry from " + from + " to " + to + "?", "Move", save);
      } else {
        save();
      }
    }
    const saveBtn = el("button", {
      class: "head-act act-save",
      "aria-label": "Save",
      onclick: commitEntry
    });
    saveBtn.innerHTML = TICK_ICON;
    saveBtn.disabled = !text.trim();
    // the dismiss half of the pair. requestClose, not close: the discard confirm still stands
    // between an unsaved ramble and losing it — this is a shortcut to the backdrop tap, not a
    // new way to throw work away. preventDefault on pointerdown so the keyboard doesn't collapse
    // under the sheet on the way to a confirm that might be declined.
    const closeBtn = el("button", { class: "head-act act-close", "aria-label": "Close", onclick: requestClose });
    closeBtn.innerHTML = CROSS_ICON;
    closeBtn.addEventListener("pointerdown", ev => ev.preventDefault());
    const headActs = el("div", { class: "head-acts" }, closeBtn, saveBtn);

    // the topic/mode chips used to be two labelled rows standing open at the foot of the sheet,
    // where they took most of the visible composer below the fold. They fold into this one
    // lozenge instead: it carries the count, so what's on the entry is still legible at a glance
    // without the rows being permanently unpacked.
    const tagCount = tags.length;
    const tagBtn = el("button", {
      class: "head-tag" + (tagCount ? " has-tags" : ""),
      "aria-label": tagCount ? tagCount + " tags" : "Add tags",
      "aria-expanded": String(tagPopOpen)
    });
    tagBtn.innerHTML = TAG_ICON;
    if (tagCount) tagBtn.appendChild(el("span", { class: "ht-count" }, String(tagCount)));
    // pointerdown + preventDefault, like every other head control: a tap here must not pull focus
    // out of the textarea, or the keyboard collapses and the sheet resizes under the popover.
    tagBtn.addEventListener("pointerdown", ev => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      tagPopOpen = !tagPopOpen;
      build();
    });

    // the pin, beside the tag lozenge and built to the same grammar: quiet and grey while it is
    // off, filled with ink once it is on, so the head reads its own state without a label. One
    // tap either way — this is a toggle, not a menu.
    const pinBtn = el("button", {
      class: "head-tag head-pin" + (pinned ? " on" : ""),
      "aria-label": pinned ? "Pinned — tap to unpin" : "Pin this entry",
      "aria-pressed": String(pinned)
    });
    pinBtn.innerHTML = PIN_ICON;
    // same rule as the tag lozenge: commit on pointerdown with preventDefault, or the tap pulls
    // focus out of the textarea and the keyboard collapses the sheet on the way to the click.
    pinBtn.addEventListener("pointerdown", ev => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      pinned = !pinned;
      build();
    });

    const pills = monthMode
      // month entries carry no week/day — a single quiet pill names the month instead
      ? (() => {
          const monthPill = el("button", { class: "day-pill", style: { cursor: "default" } },
            new Date(cmo.year, cmo.month, 1).toLocaleDateString("en-SG", { month: "short" }).toUpperCase()
            + (cmo.year !== nowWk.year ? "·" + String(cmo.year).slice(2) : ""));
          monthPill.addEventListener("pointerdown", ev => ev.preventDefault()); // keep the textarea focused
          return el("div", { class: "head-pills" }, monthPill);
        })()
      : el("div", { class: "head-pills" }, dayPill, el("span", { class: "scope-div" }), weekPill);
    head.appendChild(el("div", { class: "head-left" }, pills, tagBtn, pinBtn));
    // no "New entry" label: an empty field that says "Start typing…" is already the message.
    if (segState && segState.ranges) {
      head.appendChild(el("span", { class: "title" }, segState.ranges.length + " deposits"));
    }
    head.appendChild(headActs);
    headWrap.appendChild(head);
    syncHeadScale(); // a rebuild mid-scroll must come back at the size the scroll had it at

    // ---- segmentation preview: the ramble cut into blocks, nothing else on the sheet ----
    if (segState && segState.ranges) { buildSegPreview(); return; }

    // ---- text ----
    // no native placeholder: ::placeholder can't carry a background-clip:text sweep, so the
    // hint is a real element laid over the empty field, matching its font and top padding.
    const ta = el("textarea", { rows: "4", class: "ta-entry", "aria-label": "Entry text" });
    ta.value = text;
    const taGhost = el("div", { class: "ta-ghost shimmer" }, "Start typing\u2026");
    const syncGhost = () => taGhost.classList.toggle("gone", !!ta.value);
    // grows with content up to the CSS max-height, then scrolls internally \u2014 so
    // "topic" stays peeking below rather than getting pushed off-screen entirely.
    // once the notch has been dragged, that height wins and content just scrolls within it.
    // manualHeight is the SHEET's height now, not the field's — the field takes its size from
    // the --sheet-h-derived min-height and simply grows with content past that.
    function autoGrow() {
      ta.style.height = "auto"; ta.style.height = ta.scrollHeight + "px";
    }
    // ---- the screen follows the caret ----
    // See caretLineIn for why nothing does this on its own. The band the caret has to stay
    // inside is bounded below by the format pill (measured off the pill itself, so it can never
    // drift from where the bar actually is) and above by the pinned head — which is a real
    // obstruction now that it stays put, so the ceiling is its bottom edge rather than the
    // sheet's top. Measured live, because that edge moves: the head shrinks as it is scrolled.
    // Deliberately the SHEET's scrollTop and nothing else: the pill is fixed and docked to the
    // keyboard, outside the sheet, so scrolling the text never takes the bar with it. That is
    // the whole point — the caret comes back into view and the row of controls stays put.
    const CARET_PAD = 26;   // a line of air either side, so the caret is followed rather than pinned
    function keepCaretInView() {
      if (document.activeElement !== ta) return;
      const c = caretLineIn(ta);
      const top = ta.getBoundingClientRect().top - ta.scrollTop + c.top;
      const bottom = top + c.height;
      const barShowing = fmtBar.classList.contains("show") && !fmtBar.classList.contains("tag-open");
      // Whichever comes first: the pill, or the bottom of the visible viewport (which with the
      // keyboard up IS the top of the keyboard, since --vvh already excludes it). Both, rather
      // than the pill alone, because the pill is only an obstruction on a phone — on desktop it
      // is an ordinary row inside the sheet that scrolls along with the text, and its top is not
      // a floor at all. Taking the lower of the two is right at both breakpoints without either
      // needing to know which one it is.
      const seen = vvp ? vvp.offsetTop + vvp.height : window.innerHeight;
      const floor = Math.min(barShowing ? fmtBar.getBoundingClientRect().top : seen, seen) - CARET_PAD;
      const ceil = (headWrap ? headWrap.getBoundingClientRect().bottom
                             : sheet.getBoundingClientRect().top) + CARET_PAD;
      if (bottom > floor) sheet.scrollTop += bottom - floor;
      else if (top < ceil) sheet.scrollTop -= ceil - top;
    }
    // re-measure when the keyboard comes or goes: the pinned height above is measured against
    // whatever the sheet was then, and --vvh has just moved the ceiling under it. The caret is
    // chased afterwards, not before — the keyboard's arrival is exactly when the room under the
    // caret disappears, and re-measuring first means the chase is against the new geometry.
    // The scroll position has to be carried across by hand: clearing the field's height collapses
    // it to its min-height for an instant, the sheet's scrollable content collapses with it, and
    // the browser clamps scrollTop to 0 on the spot — putting her back at the top of a long entry
    // every time the keyboard is dismissed and brought back. autoGrow restores the height but
    // nothing restores the scroll, and the caret chase below can't either when the re-measure
    // happens while the field is blurred.
    S.sheetViewportSync = () => {
      const keep = sheet.scrollTop;
      ta.style.height = ""; autoGrow();
      sheet.scrollTop = keep;
      keepCaretInView();
    };
    ta.addEventListener("input", () => {
      text = ta.value; saveBtn.disabled = !text.trim(); autoGrow(); syncGhost();
      keepCaretInView(); // after autoGrow: the field has to be its new height before it's measured
    });
    // typing is not the only way the caret moves — arrow keys and a tap into the middle of the
    // text both get here, and the format bar's presses go through fmtPress. A caret already
    // inside the band makes this a no-op, so it costs a measurement and nothing else.
    ["keyup", "pointerup"].forEach(evt => ta.addEventListener(evt, keepCaretInView));
    syncGhost();
    sheet.appendChild(el("div", { class: "ta-wrap" }, ta, taGhost));
    pauseShimmerOnScroll(taGhost, sheet); // the sweep holds still while the sheet moves
    requestAnimationFrame(autoGrow); // ta isn't attached to the document until after build() returns

    // ---- notch = resize handle: drag it up to grow the sheet, down to shrink ----
    // it used to stretch the textarea, which does nothing now that the sheet is a fixed-height
    // expanse. it resizes the SHEET instead, and the field follows via --sheet-h.
    // There is deliberately NO SHEET_MAX here. Two attempts (31 Jul) tried to keep a JS copy of
    // the ceiling in step with the CSS one — first `innerHeight - safeTop() - 10`, then the same
    // less --vvt — and both were wrong on a real phone in different directions: the first stored
    // heights the CSS then clamped, so every upward drag came back as "max" no matter where it
    // ended; the second moved the ceiling underneath a live drag. The ceiling depends on dvh, the
    // safe-area inset and the caret-chase offset, all of which CSS already resolves and JS can
    // only approximate. So it isn't approximated any more: `max-height` is the single source of
    // truth, JS asks for a height and then MEASURES what was actually rendered. Whatever CSS says
    // it is, is what gets remembered — which makes the two-ceilings-disagree bug unrepresentable
    // rather than merely fixed.
    const SHEET_MIN = () => Math.min(300, Math.round(window.innerHeight * 0.45));
    // Belt and braces for the memory: a debounced write means the height persists even if the
    // drag never ends in an event we hear — a pointercancel we somehow miss, the app being killed
    // mid-gesture, a rebuild. 250ms after the last move, so it is still one write per drag rather
    // than the ~60/second the release-only version was avoiding, and the value written is the
    // final one rather than a mid-drag frame.
    let sheetFracTimer = null;
    // manualHeight is the height the sheet was MEASURED at, never the raw drag delta — so what's
    // stored is always a height the sheet actually rendered, and reopening reproduces it exactly.
    function commitSheetFrac() {
      clearTimeout(sheetFracTimer);
      if (manualHeight != null) saveSheetFrac(manualHeight / window.innerHeight);
    }
    function rememberSheetHeight() {
      clearTimeout(sheetFracTimer);
      sheetFracTimer = setTimeout(commitSheetFrac, 250);
    }
    // Apply a height WITHOUT remembering it. The restore-on-open path has to use this one: it runs
    // inside build(), and build() is called before the overlay is appended (see below), so the
    // sheet may not be measurable yet — and more importantly, a restore is not a choice. When
    // setSheetHeight did the persisting, merely opening the composer rewrote the stored value from
    // whatever the viewport happened to be mid-open, so a transient ceiling could quietly shrink
    // her preference a little on every single open.
    function applySheetHeight(h) {
      const want = Math.max(SHEET_MIN(), Math.round(h));
      sheet.style.setProperty("--sheet-h", want + "px");
      // Read back what CSS actually rendered — max-height may have clamped it. A detached or
      // not-yet-painted sheet measures 0, which is not a clamp: trust the request in that case
      // rather than writing a zero height into the variable.
      const got = Math.round(sheet.getBoundingClientRect().height);
      const applied = got > 0 ? got : want;
      // keep --sheet-h in agreement with reality: the textarea's min-height is derived from it,
      // so leaving it at an over-tall `want` would size the field past the box it lives in.
      if (applied !== want) sheet.style.setProperty("--sheet-h", applied + "px");
      manualHeight = applied;
      // autoGrow pins an explicit pixel height on the field; left alone it keeps the height
      // it had at the OLD sheet size and overflows once the sheet shrinks under it.
      // Same scroll-clamp trap as sheetViewportSync: the field collapses for an instant, the
      // sheet's scroll range collapses with it, and a drag of the notch would otherwise throw a
      // long entry back to its first line.
      const keep = sheet.scrollTop;
      ta.style.height = "";
      autoGrow();
      sheet.scrollTop = keep;
    }
    // the drag's entry point: apply, then remember — dragging IS the choice.
    function setSheetHeight(h) {
      applySheetHeight(h);
      rememberSheetHeight();
    }
    reapplySheetHeight = applySheetHeight; // for the post-append re-measure in openComposer
    grabber.addEventListener("pointerdown", ev => {
      ev.preventDefault();
      const startY = ev.clientY;
      const startH = sheet.getBoundingClientRect().height;
      grabber.style.cursor = "grabbing";
      try { grabber.setPointerCapture(ev.pointerId); } catch (e) {}
      const onMove = e => setSheetHeight(startH + (startY - e.clientY)); // up = taller, 1:1
      // pointerUP is not the only way a drag ends. iOS ends one with pointerCANCEL whenever it
      // reinterprets the gesture or the visual viewport shifts under it — and in the composer the
      // keyboard is up, which is exactly when that happens. The resize itself still applied on
      // every pointermove, so the notch LOOKED like it worked and only the memory was missing;
      // the listeners leaked too. Every terminal event has to run the same teardown.
      const onEnd = e => {
        grabber.removeEventListener("pointermove", onMove);
        grabber.removeEventListener("pointerup", onEnd);
        grabber.removeEventListener("pointercancel", onEnd);
        grabber.removeEventListener("lostpointercapture", onEnd);
        grabber.style.cursor = "";
        try { grabber.releasePointerCapture(e.pointerId); } catch (err) {}
        // written on release, not on every pointermove — a drag is ~60 writes a second, and the
        // value mid-drag isn't the one she chose. Same function the debounce calls, so the release
        // path and the belt-and-braces path can't drift apart on what counts as worth storing.
        commitSheetFrac();
      };
      grabber.addEventListener("pointermove", onMove);
      grabber.addEventListener("pointerup", onEnd);
      grabber.addEventListener("pointercancel", onEnd);
      grabber.addEventListener("lostpointercapture", onEnd);
    });
    // a height chosen earlier survives a rebuild (day/week change) and an earlier session.
    // applySheetHeight, not setSheetHeight: restoring is not choosing, so it must not write back.
    if (manualHeight != null) applySheetHeight(manualHeight);

    // shared image pipeline: ⌘V paste and the format-bar photo button both land here.
    // the image is downscaled (max 1100px), stored on the entry, and referenced inline
    // as a short ![photo:id] marker — never as base64 soup in the editor.
    async function insertImageFile(file) {
      try {
        const dataUrl = await fileToDataUrl(file);
        let id;
        do { id = Date.now().toString(36) + Math.floor(Math.random() * 1296).toString(36); }
        while (images[id]); // a batch of photos can land inside one millisecond
        images[id] = dataUrl;
        const s = ta.selectionStart, en = ta.selectionEnd, v = ta.value;
        const before = v.slice(0, s), after = v.slice(en);
        const mark = (before && !before.endsWith("\n") ? "\n" : "")
          + "![photo:" + id + "]"
          + (!after || after.startsWith("\n") ? "" : "\n");
        ta.value = before + mark + after;
        const pos = before.length + mark.length;
        ta.setSelectionRange(pos, pos);
        text = ta.value;
        saveBtn.disabled = !text.trim();
        ta.focus(); // the file picker stole focus — hand it back so she can keep typing
        autoGrow();
        updateBar();
      } catch (err) { console.warn("image insert failed", err); }
    }

    // several photos at once — one after another, in the order she picked them, so the
    // markers land in that order too (each insert moves the cursor past its own marker)
    async function insertImageFiles(files) {
      for (const f of files) await insertImageFile(f);
    }

    // ⌘V an image (screenshot, copied photo) — or a clipboard holding several
    ta.addEventListener("paste", ev => {
      const items = ev.clipboardData ? ev.clipboardData.items : null;
      if (!items) return;
      const files = [...items]
        .filter(it => it.kind === "file" && it.type.startsWith("image/"))
        .map(it => it.getAsFile())
        .filter(Boolean);
      if (!files.length) return; // plain text pastes stay untouched
      ev.preventDefault();
      insertImageFiles(files);
    });

    // desktop: ⌘B / ⌘I / ⌘U (ctrl elsewhere). with a selection they wrap it, same as the
    // format bar. with just a cursor they now open the style — the markers appear with the
    // cursor between them, typing lands inside, and the same combo steps back out.
    ta.addEventListener("keydown", ev => {
      if (!(ev.metaKey || ev.ctrlKey) || ev.altKey) return;
      // ⌘/ctrl+Enter commits the entry — the keyboard's version of the tick. It goes through
      // commitEntry, so a week move still asks first rather than the shortcut being a quieter
      // path past the confirm. preventDefault or the newline lands before the save reads `text`.
      if (ev.key === "Enter") { ev.preventDefault(); commitEntry(); return; }
      const key = ev.key.toLowerCase();
      // ⌘K is the link, the same op as the bar's L: it asks for the url straight away rather
      // than needing words selected first. stopPropagation as well as preventDefault — the
      // document-level ⌘K (rail search on desktop, menu on a phone) is listening too, and
      // without it the paste prompt arrives with focus already yanked out of the composer.
      if (key === "k") { ev.preventDefault(); ev.stopPropagation(); linkSel(); return; }
      const pair = { b: ["**", "**"], i: ["*", "*"], u: ["__", "__"] }[key];
      if (!pair) return;
      ev.preventDefault();
      if (ta.selectionStart !== ta.selectionEnd) wrapSel(pair[0], pair[1]);
      else toggleAtCursor(pair[0], pair[1]);
    });
    // the "*** ahead" check keeps ⌘I usable inside bold: a lone * or the *** of
    // italic-then-bold closers counts as an italic closer; a bare ** does not.
    function toggleAtCursor(pre, post) {
      const s = ta.selectionStart, v = ta.value;
      const closerAhead = v.slice(s, s + post.length) === post
        && (post !== "*" || v.slice(s, s + 2) !== "**" || v.slice(s, s + 3) === "***");
      if (closerAhead) {
        if (v.slice(Math.max(0, s - pre.length), s) === pre) {
          // nothing was typed between the markers — remove the empty pair instead of leaving ****
          ta.value = v.slice(0, s - pre.length) + v.slice(s + post.length);
          ta.setSelectionRange(s - pre.length, s - pre.length);
        } else {
          ta.setSelectionRange(s + post.length, s + post.length); // step out of the style
        }
      } else {
        ta.value = v.slice(0, s) + pre + post + v.slice(s);
        ta.setSelectionRange(s + pre.length, s + pre.length); // type straight into the style
      }
      text = ta.value;
      saveBtn.disabled = !text.trim();
      ta.focus();
      updateBar();
    }

    // ---- format bar: line ops (• ⇥ ⇤) while just typing, span ops (B I U M R L)
    // once text is selected — the row swaps contents rather than growing ----
    const fmtBar = el("div", { class: "fmt-bar" });
    // the actual pill: fmtBar itself is the fixed-position, full-width positioning shell
    // (centred, docked to the keyboard); this is the floating white capsule inside it that
    // the buttons live on and that the "sel-only"/"line-only" swap toggles the contents of.
    const fmtBarPill = el("div", { class: "fmt-bar-pill" });
    fmtBar.appendChild(fmtBarPill);
    // once the bar has appeared it stays put for the life of the composer: hiding it on
    // blur reflows the sheet, and the height jump made it easy to tap the backdrop by
    // accident and trip the discard prompt. it still swaps line-ops <-> span-ops.
    // span ops belong to a live selection in *this* field, so the swap keys off focus too:
    // a blurred textarea keeps its selectionStart/End, which used to leave B I U showing
    // over nothing selected.
    const updateBar = () => {
      const focused = document.activeElement === ta;
      const hasSel = focused && ta.selectionStart !== ta.selectionEnd;
      fmtBar.classList.toggle("has-sel", hasSel);
      if (focused || hasSel) barShown = true;
      fmtBar.classList.toggle("show", barShown);
      fmtBar.classList.toggle("tag-open", tagPopOpen); // stand down under the tag popover
      // the docked bar floats over the sheet, so the sheet reserves the room it covers — but
      // only once it's actually showing, or every composer opens with a band of dead space.
      sheet.classList.toggle("has-fmt", barShown);
    };
    // selectionchange is the only event that fires for BOTH making and clearing a selection:
    // `select` fires only when text becomes selected — never when it collapses — and on iOS
    // the tap that dismisses a selection is swallowed by the callout/handles, so no pointerup
    // reaches the textarea either. that's the row getting stuck on the wrong ops. bound on
    // the element (newer engines) and on the document (Safari's long-standing path).
    ta.addEventListener("selectionchange", updateBar);
    bindFmtSelectionSync(updateBar);
    ["keyup", "pointerup", "input", "focus", "blur"].forEach(evt => ta.addEventListener(evt, updateBar));
    // Every focus, not just the composer's first: openComposer only predicts the band for the
    // keyboard it raises itself, so tapping away and back left the bar sitting under the keyboard
    // until some unrelated event happened to re-measure. See resyncForKeyboard.
    ta.addEventListener("focus", resyncForKeyboard);

    // markers have to hug the words they style, one line at a time — that's what makes the
    // difference between a style that renders and one that shows its asterisks. a selection
    // dragged to the end of a line carries the newline with it (and iOS loves to hand back a
    // trailing space), so whitespace at either edge stays *outside* the pair, and a selection
    // spanning lines gets its own pair per line rather than one straddling the break.
    const LINE_RUN = /[^\n]+/g;
    // [, lead, core, trail] — a line's indent and its bullet marker count as lead, so
    // styling a run of bullets styles the words and leaves the • alone
    const runParts = r => /^(\s*(?:[-—] )?)([\s\S]*?)(\s*)$/.exec(r);
    // a line that is nothing but a photo marker is never styled: **![photo:id]** would be
    // eaten by the bold rule in RICH_RE (leftmost match wins, so the photo branch never runs)
    // and the picture would render as its raw marker instead.
    const PHOTO_RUN = /^\s*!\[photo:[a-z0-9]+(?:@(?:inline|1x|2x|3x))?\]\s*$/;
    function wrapSel(pre, post) {
      const s = ta.selectionStart, en = ta.selectionEnd;
      if (s === en) return;
      const v = ta.value, sel = v.slice(s, en);
      const pl = pre.length, ql = post.length;
      const runs = (sel.match(LINE_RUN) || []).filter(r => !PHOTO_RUN.test(r));
      const cores = runs.map(r => runParts(r)[2]).filter(Boolean);
      const wrapped = c => c.startsWith(pre) && c.endsWith(post) && c.length > pl + ql;
      let ns, ne;
      if (cores.length && cores.every(wrapped)) {
        // every styled line in the selection already carries the markers -> unwrap them all
        ta.value = v.slice(0, s) + sel.replace(LINE_RUN, r => {
          if (PHOTO_RUN.test(r)) return r;
          const m = runParts(r);
          return m[2] ? m[1] + m[2].slice(pl, m[2].length - ql) + m[3] : r;
        }) + v.slice(en);
        ns = s; ne = s + (en - s) - cores.length * (pl + ql);
      } else if (v.slice(Math.max(0, s - pl), s) === pre && v.slice(en, en + ql) === post) {
        // markers sit just outside the selection -> unwrap
        ta.value = v.slice(0, s - pl) + sel + v.slice(en + ql);
        ns = s - pl; ne = ns + sel.length;
      } else if (cores.length) {
        const out = sel.replace(LINE_RUN, r => {
          if (PHOTO_RUN.test(r)) return r;
          const m = runParts(r);
          return m[2] ? m[1] + pre + m[2] + post + m[3] : r;
        });
        ta.value = v.slice(0, s) + out + v.slice(en);
        ns = s; ne = s + out.length; // selection keeps the markers, so pressing again toggles off
      } else return; // whitespace-only selection: nothing to style
      text = ta.value;
      saveBtn.disabled = !text.trim();
      ta.focus();
      ta.setSelectionRange(ns, ne);
      updateBar();
    }

    // link: wrap the selection as [label](url). if the selection is itself a url, it
    // becomes a domain-labelled pill with no typing; otherwise prompt for the url and
    // keep the selected words as the label. either way the label stays editable in raw text.
    // The bar's L only shows with a selection, but ⌘K fires on a bare cursor too — that path
    // has no words to label with, so the url labels itself with its domain, exactly as a
    // pasted-and-selected url does. Nothing is inserted if the prompt is dismissed.
    function linkSel() {
      const s = ta.selectionStart, en = ta.selectionEnd;
      const v = ta.value, sel = v.slice(s, en).trim();
      const looksUrl = /^(https?:\/\/\S+|www\.\S+|\S+\.[a-z]{2,}(\/\S*)?)$/i.test(sel);
      let url, label;
      if (looksUrl) {
        url = /^https?:\/\//i.test(sel) ? sel : "https://" + sel;
        label = domainOf(url);
      } else {
        let u = prompt("paste the link url");
        if (!u || !u.trim()) return;
        u = u.trim();
        url = /^https?:\/\//i.test(u) ? u : "https://" + u;
        label = sel || domainOf(url);
      }
      const md = "[" + label + "](" + url + ")";
      ta.value = v.slice(0, s) + md + v.slice(en);
      text = ta.value;
      saveBtn.disabled = !text.trim();
      ta.focus();
      ta.setSelectionRange(s + 1, s + 1 + label.length); // land on the label so it's easy to rename
      autoGrow();
      updateBar();
    }

    // every format-bar press commits on pointerdown. the press already has to preventDefault
    // to keep the field focused and the selection alive; a click arrives a beat later, by which
    // time the row may have swapped its contents out from under her finger — which is exactly
    // how a tap ends up doing nothing, or the wrong thing. same rule as the day strip.
    function fmtPress(b, run) {
      b.addEventListener("pointerdown", ev => {
        if (ev.button !== 0) return; // left/primary press only — a right-click isn't a format op
        ev.preventDefault();
        run();
        // a format op re-places the selection and can add a line (bullets, the fold marker), so
        // the caret can end up under the pill from a press rather than a keystroke
        keepCaretInView();
      });
      return b;
    }

    // line ops act on the line the cursor sits in — no selection needed.
    // marker is captured (group 2) so continuation preserves "- " or "— " as typed.
    const BULLET_LINE = /^([ \t]*)([-—] )(.*)$/;
    function lineOp(transform) {
      const v = ta.value, s = ta.selectionStart;
      const ls = v.lastIndexOf("\n", s - 1) + 1;
      let le = v.indexOf("\n", s); if (le === -1) le = v.length;
      const line = v.slice(ls, le);
      const nl = transform(line);
      if (nl !== line) {
        ta.value = v.slice(0, ls) + nl + v.slice(le);
        const pos = Math.min(Math.max(ls, s + nl.length - line.length), ls + nl.length);
        text = ta.value;
        saveBtn.disabled = !text.trim();
        ta.setSelectionRange(pos, pos);
        autoGrow();
      }
      ta.focus();
      updateBar();
    }
    // ---- line ops collapse into one button + a vertical popover ----
    // six side-by-side icons was a wall of glyphs; the related ones (bullet, checkbox,
    // indent, outdent) now live in a labelled vertical list, which also names what they do.
    let linePop = null;
    function closeLinePop() { if (linePop) { linePop.remove(); linePop = null; } }
    function openLinePop(anchor, items) {
      if (linePop) { closeLinePop(); return; }
      linePop = el("div", { class: "line-pop" });
      for (const [icon, label, transform] of items) {
        const r = el("button", { class: "line-pop-row" });
        const g = el("span", { class: "lp-icon" }); g.innerHTML = icon;
        r.appendChild(g);
        r.appendChild(el("span", { class: "lp-label" }, label));
        r.addEventListener("pointerdown", ev => {
          if (ev.button !== 0) return;
          ev.preventDefault();
          lineOp(transform);
          closeLinePop();
        });
        linePop.appendChild(r);
      }
      anchor.parentElement.appendChild(linePop);
    }
    // a tap anywhere else in the sheet puts it away
    sheet.addEventListener("pointerdown", ev => {
      if (linePop && !linePop.contains(ev.target) && !ev.target.closest(".fmt-lines")) closeLinePop();
      // same for the tag popover — but NOT when the tap is the lozenge itself, or this would close
      // it a moment before the lozenge's own handler toggles it back open.
      if (tagPopOpen && !ev.target.closest(".tag-pop") && !ev.target.closest(".head-tag")) {
        tagPopOpen = false;
        build();
      }
    }, true);

    // checklist toggle is its own transform, shared by the standalone button below and by
    // Bullet's "return to plain text" case in the popover
    const checkboxTransform = line => {
      // the mark class, not just [ ] and [x] — a line already marked with a day is already a
      // checklist item, and reading it as plain text put a SECOND box in front of the first
      const m = new RegExp("^([ \\t]*)(?:([-—] )(\\[(?:" + CHECK_MARK + ")\\] ?)?)?([\\s\\S]*)$").exec(line);
      return m[3] ? m[1] + m[4] : m[1] + "- [ ] " + m[4];
    };
    const LINE_OPS = [
     [BULLET_ICON, "Bullet", line => {
        const m = BULLET_LINE.exec(line);
        // a checklist counts as a bullet — toggling the dot returns it to plain text too
        return m ? m[1] + m[3].replace(CHECK_RE, "$2") : line.replace(/^([ \t]*)/, "$1- ");
      }],
     [INDENT_ICON, "Indent", line => "  " + line],
     [OUTDENT_ICON, "Outdent", line => line.startsWith("  ") ? line.slice(2) : line.replace(/^[ \t]/, "")]
    ];
    // one button stands for bullet/indent/outdent; it opens the list rather than doing
    // anything itself. checkbox gets used often enough on its own to earn a direct tap.
    const linesBtn = el("button", { class: "fmt-btn line-only fmt-lines", "aria-label": "Lists & indent" });
    linesBtn.innerHTML = LINES_ICON;
    linesBtn.addEventListener("pointerdown", ev => {
      if (ev.button !== 0) return;
      ev.preventDefault();
      openLinePop(linesBtn, LINE_OPS);
    });
    fmtBarPill.appendChild(linesBtn);
    const checkBtn = el("button", { class: "fmt-btn line-only", "aria-label": "Checkbox" });
    checkBtn.innerHTML = CHECKBOX_ICON;
    fmtBarPill.appendChild(fmtPress(checkBtn, () => lineOp(checkboxTransform)));

    // fold: drop a "+++" cut on its own line. everything below it collapses in the card
    // behind a Read-more that floats the whole entry in a centred modal.
    function insertFold() {
      const v = ta.value, s = ta.selectionStart;
      let le = v.indexOf("\n", s); if (le === -1) le = v.length;
      const head = v.slice(0, le), tail = v.slice(le);
      const ins = "\n+++" + (tail.startsWith("\n") ? "" : "\n");
      ta.value = head + ins + tail;
      const pos = head.length + ins.length;
      ta.setSelectionRange(pos, pos);
      text = ta.value;
      saveBtn.disabled = !text.trim();
      autoGrow();
      ta.focus();
      updateBar();
    }
    const foldBtn = el("button", { class: "fmt-btn line-only", "aria-label": "Fold (read more)" });
    foldBtn.innerHTML = FOLD_ICON;
    fmtBarPill.appendChild(fmtPress(foldBtn, insertFold));

    // photo button: pick from disk / photo library — the same pipeline as ⌘V,
    // for the phone (and anyone who doesn't live on the clipboard)
    const imgInput = el("input", { type: "file", accept: "image/*", multiple: true, style: { display: "none" } });
    imgInput.addEventListener("change", () => {
      const files = imgInput.files ? [...imgInput.files] : [];
      imgInput.value = ""; // so the same photo can be picked again later
      if (files.length) insertImageFiles(files);
    });
    const imgBtn = el("button", { class: "fmt-btn line-only", "aria-label": "Add photo" });
    imgBtn.innerHTML = IMG_ICON;
    // deliberately NOT fmtPress: opening a file picker needs transient user activation, and
    // pointerdown only grants that for a mouse (on touch it's pointerup/touchend). committing
    // on pointerdown made the picker silently refuse to open on the phone. preventDefault still
    // keeps focus in the textarea, so the keyboard doesn't collapse and the click lands here.
    imgBtn.addEventListener("pointerdown", ev => ev.preventDefault());
    imgBtn.addEventListener("click", () => imgInput.click());
    fmtBarPill.appendChild(imgBtn);
    sheet.appendChild(imgInput);

    // enter continues the current line's structure: a bullet keeps its marker+indent, an
    // indented blockquote keeps its indent. an empty one of either ends it (drops the
    // marker/indent instead of carrying a dangling one to the next line).
    const INDENT_LINE = /^([ \t]+)(.*)$/;
    ta.addEventListener("keydown", ev => {
      // a MODIFIED Enter is the save shortcut above, not a new line — carrying a bullet into a
      // line that is never typed would leave a dangling marker in the saved text
      if (ev.metaKey || ev.ctrlKey) return;
      if (ev.key !== "Enter" || ta.selectionStart !== ta.selectionEnd) return;
      const v = ta.value, s = ta.selectionStart;
      const ls = v.lastIndexOf("\n", s - 1) + 1;
      let le = v.indexOf("\n", s); if (le === -1) le = v.length;
      const line = v.slice(ls, le);
      const bm = BULLET_LINE.exec(line);
      const cm = bm ? CHECK_RE.exec(bm[3]) : null; // a checklist item continues as a fresh unchecked box
      const im = bm ? null : INDENT_LINE.exec(line);
      let carry, rest;
      if (cm) { carry = bm[1] + "- [ ] "; rest = cm[2]; }
      else if (bm) { carry = bm[1] + bm[2]; rest = bm[3]; }
      else if (im && (im[1].length >= 2 || im[1].includes("\t"))) { carry = im[1]; rest = im[2]; }
      else return; // ordinary line: let Enter do its normal thing
      ev.preventDefault();
      if (!rest.trim()) {
        ta.value = v.slice(0, ls) + v.slice(le); // empty bullet/quote: end it, don't carry the marker
        ta.setSelectionRange(ls, ls);
      } else {
        const ins = "\n" + carry; // continue with the same marker/indent
        ta.value = v.slice(0, s) + ins + v.slice(s);
        ta.setSelectionRange(s + ins.length, s + ins.length);
      }
      text = ta.value;
      saveBtn.disabled = !text.trim();
      autoGrow();
    });

    // backspace while the cursor sits inside a line's leading indent clears one whole level
    // (a 2-space unit, or a tab) in a single press — so the blockquote she just made comes
    // off as easily as it went on, matching the outdent button. mid-text backspace is
    // untouched: this only fires when everything from line-start to the cursor is whitespace.
    ta.addEventListener("keydown", ev => {
      if (ev.key !== "Backspace" || ev.metaKey || ev.ctrlKey || ev.altKey) return;
      if (ta.selectionStart !== ta.selectionEnd) return;
      const v = ta.value, s = ta.selectionStart;
      const ls = v.lastIndexOf("\n", s - 1) + 1;
      const before = v.slice(ls, s);
      if (!before || !/^[ \t]+$/.test(before)) return; // cursor must be within the leading indent
      ev.preventDefault();
      const unit = before[0] === "\t" ? 1 : Math.min(2, before.length); // one level = 2 spaces (or a tab)
      ta.value = v.slice(0, ls) + v.slice(ls + unit);
      const ns = s - unit;
      ta.setSelectionRange(ns, ns);
      text = ta.value;
      saveBtn.disabled = !text.trim();
      autoGrow();
      updateBar();
    });

    // B I U M stay plain styled letters — that's the part already spot on, nothing to change.
    // Redact swapped from a bare "R" to REDACT_ICON: once the row is a fixed pictorial pill
    // rather than a row of labelled chips, a letter reads as an abbreviation to decode rather
    // than a mark, and it's now sitting next to an actual pictogram (link) with no third state
    // to make "which kind of button is this" obvious. aria-label carries what the glyph no
    // longer spells out.
    [["B", "**", "**", "fmt-b", "Bold"], ["I", "*", "*", "fmt-i", "Italic"],
     ["U", "__", "__", "fmt-u", "Underline"], ["M", "`", "`", "fmt-m", "Code"]]
      .forEach(([label, pre, post, cls, aria]) => {
        const b = el("button", { class: "fmt-btn sel-only " + cls, "aria-label": aria }, label);
        fmtBarPill.appendChild(fmtPress(b, () => wrapSel(pre, post)));
      });
    const redactBtn = el("button", { class: "fmt-btn sel-only fmt-r fmt-icon", "aria-label": "Redact" });
    redactBtn.innerHTML = REDACT_ICON;
    fmtBarPill.appendChild(fmtPress(redactBtn, () => wrapSel("||", "||")));
    const linkBtn = el("button", { class: "fmt-btn sel-only fmt-l fmt-icon", "aria-label": "Link" });
    linkBtn.innerHTML = FMT_LINK_ICON;
    fmtBarPill.appendChild(fmtPress(linkBtn, linkSel));

    // Where the bar lives depends on the breakpoint, because the two versions of it are
    // positioned in genuinely different ways and neither can be reached from the other's parent:
    //  - phone: fixed and docked to the keyboard, so it must NOT be inside the sheet — the sheet
    //    scrolls its own content and clips to a rounded rect during the unfold, and clip-path
    //    clips fixed descendants too, so a bar inside it would be cut off. sheetRoot is used
    //    rather than overlay because sheetRoot has no transformed ancestor: `position: fixed`
    //    resolves against the real screen there, and an ancestor that later gained a transform
    //    would silently re-anchor it and stop it tracking the keyboard.
    //  - desktop: an ordinary in-flow row under the head, which means it has to be inside the
    //    sheet to sit in that flow at all.
    // fmtBarEl is only set in the phone case: that is the one build()'s `sheet.innerHTML = ""`
    // cannot reach, so it is the one that has to be removed by hand.
    const attachFmtBar = () => {
      // after the WRAPPER, not after the head: the head lives inside the sticky block now, and
      // "afterend" of the head would put the desktop format row inside it — pinning a row that
      // has always scrolled with the text, and putting it above the block's own fade.
      if (deskMQ.matches) { headWrap.insertAdjacentElement("afterend", fmtBar); fmtBarEl = null; }
      else { sheetRoot.appendChild(fmtBar); fmtBarEl = fmtBar; }
    };
    attachFmtBar();
    // build() makes a NEW bar each time, and the show/has-sel/tag-open classes are only applied by
    // updateBar's event handlers — so without this a rebuild (any tag pick, day change, or
    // segmentation offer) hands back a bar with none of them until the next keystroke.
    updateBar();
    // Crossing the breakpoint does NOT rebuild the composer (onBreakpointCross calls render(),
    // which redraws the list behind it), so a live bar has to be told to re-home itself — an
    // in-flow row left parked in sheetRoot would render adrift at the foot of the page.
    S.composerFmtReattach = attachFmtBar;

    // ---- segmentation offer: appears once the ramble is long enough (and a key exists) ----
    const segOffer = segState && segState.busy
      ? el("p", { class: "seg-offer pending" }, "finding the seams…")
      : el("button", { class: "seg-offer", onclick: runSegmentation }, "break into deposits");
    sheet.appendChild(segOffer);
    if (segErr && !(segState && segState.busy)) sheet.appendChild(el("p", { class: "seg-note" }, segErr));
    updateSegOffer();
    function updateSegOffer() {
      const lines = text.split("\n").filter(l => l.trim()).length;
      const long = lines >= SEGMENT_MIN_LINES || wordCount(plainText(text, "x")) >= SEGMENT_MIN_WORDS;
      segOffer.style.display = (S.apiKey && long) ? "" : "none";
    }
    ta.addEventListener("input", updateSegOffer);

    async function runSegmentation() {
      if (segState) return;
      segErr = null; segState = { busy: true }; build();
      try {
        const ranges = await segmentRamble(text);
        if (ranges.length < 2) throw new Error("only one thought found");
        segState = { ranges }; segTagOpen = -1;
      } catch (err) {
        console.warn("segmentation failed", err);
        segState = null;
        segErr = "couldn't find clean seams — try again";
      }
      build();
    }

    // ---- topics + modes, inside the tag popover ----
    // Built only while it's open, and hung off `head` (which is position: relative) so it drops
    // from the lozenge rather than sitting in the sheet's scroll flow. Chips commit on
    // pointerdown for the same reason the lozenge does — a click would blur the textarea first.
    if (tagPopOpen) {
      const tagPop = el("div", { class: "tag-pop" });
      const chipPress = (chip, id) => {
        chip.addEventListener("pointerdown", ev => {
          if (ev.button !== 0) return;
          ev.preventDefault();
          toggleTag(id);
          build(); // tagPopOpen is still true, so the popover comes straight back with the new state
        });
        return chip;
      };
      tagPop.appendChild(el("p", { class: "field-label" }, "topic"));
      const topicChips = el("div", { class: "chips" });
      for (const t of TOPICS) {
        const on = tags.includes(t.id);
        // A topic's colour is what identifies it, so it carries that colour whether or not it is
        // on — unselected chips used to be uniformly grey, which made the palette something you
        // only discovered by selecting things. Selection is now carried by the FILL (tinted bg +
        // weight) against a plain surface, rather than by colour-vs-no-colour.
        const chip = el("button", {
          class: "chip",
          style: on
            ? { background: tone(t).bg, color: tone(t).fg, borderColor: tone(t).dot, fontWeight: "600" }
            : { background: "transparent", color: tone(t).fg, borderColor: tone(t).bg }
        }, t.label);
        topicChips.appendChild(chipPress(chip, t.id));
      }
      tagPop.appendChild(topicChips);

      tagPop.appendChild(el("p", { class: "field-label" }, "mode"));
      const modeChips = el("div", { class: "chips" });
      for (const m of MODES) {
        const chip = el("button", { class: "chip mode" + (tags.includes(m.id) ? " on" : "") }, m.label);
        modeChips.appendChild(chipPress(chip, m.id));
      }
      tagPop.appendChild(modeChips);
      head.appendChild(tagPop);
    }

    if (existing && existing.sourceId) {
      // this deposit was cut from a longer ramble — the untouched original is two taps away
      const src = S.entries.find(e => e.id === existing.sourceId);
      if (src) {
        sheet.appendChild(el("button", {
          class: "back-link",
          style: { display: "block", marginTop: "18px" },
          onclick: () => {
            if (isDirty()) confirmAction("Discard your changes to this entry?", "Discard", () => openRambleView(src));
            else openRambleView(src);
          }
        }, "view the full ramble"));
      }
    }

    if (existing) {
      // lock guards against accidental deletion: delete only shows while unlocked.
      // the lock state itself saves with Save, like every other field.
      sheet.appendChild(el("button", {
        class: "lock-btn",
        onclick: () => { locked = !locked; build(); }
      }, locked ? "Unlock entry" : "Lock entry"));
      if (!locked) {
        sheet.appendChild(el("button", {
          class: "delete-btn",
          onclick: () => {
            tombstoneEntry(existing.id); // so the deletion syncs to the cloud, not just locally
            S.entries = S.entries.filter(e => e.id !== existing.id);
            saveEntries(S.entries);
            close();
            render();
          }
        }, "Delete entry"));
      }
    }

    // preview of the proposed cuts: entry-like blocks, each with its suggested topic
    // pill (tap to retag) and a JOIN control on every divider to merge neighbours.
    function buildSegPreview() {
      const ranges = segState.ranges;
      sheet.appendChild(el("p", { class: "seg-note", style: { margin: "2px 0 12px" } },
        "your words, cut apart — nothing rewritten"));
      const card = el("div", { class: "group-card seg-list" });
      ranges.forEach((rg, i) => {
        if (i) {
          const join = el("div", { class: "seg-join" });
          join.appendChild(el("button", {
            onclick: () => {
              ranges[i - 1].end = rg.end;
              if (!ranges[i - 1].topic) ranges[i - 1].topic = rg.topic;
              ranges.splice(i, 1);
              if (ranges.length < 2) { segState = null; segErr = null; } // merged back into one — plain composer returns
              segTagOpen = -1;
              build();
            }
          }, "join"));
          card.appendChild(join);
        }
        const block = el("div", { class: "seg-block" });
        const p = el("p");
        p.appendChild(renderRichBlocks(text.slice(rg.start, rg.end).trim(), images));
        block.appendChild(p);
        const meta = el("div", { class: "entry-meta" });
        const tt = topicById[rg.topic];
        meta.appendChild(el("button", {
          class: "pill" + (tt ? "" : " mode"),
          style: tt ? { background: tone(tt).bg, color: tone(tt).fg } : {},
          onclick: () => { segTagOpen = segTagOpen === i ? -1 : i; build(); }
        }, tt ? tt.label : "untagged"));
        block.appendChild(meta);
        if (segTagOpen === i) {
          const chips = el("div", { class: "chips", style: { marginTop: "10px" } });
          for (const t of TOPICS) {
            const on = rg.topic === t.id;
            chips.appendChild(el("button", {
              class: "chip",
              style: on ? { background: tone(t).bg, color: tone(t).fg, borderColor: tone(t).dot, fontWeight: "600" } : {},
              onclick: () => { rg.topic = on ? null : t.id; segTagOpen = -1; build(); }
            }, t.label));
          }
          block.appendChild(chips);
        }
        card.appendChild(block);
      });
      sheet.appendChild(card);
      sheet.appendChild(el("button", {
        class: "back-link",
        onclick: () => { segState = null; segErr = null; segTagOpen = -1; build(); }
      }, "keep as one entry"));
    }
  }

  function toggleTag(id) {
    tags = tags.includes(id) ? tags.filter(t => t !== id) : [...tags, id];
  }

  build();
  sheetRoot.appendChild(overlay);
  // unfold from the compose bar: clip the sheet to that grey rectangle's real measured box,
  // then release it so the clip opens outward into the full sheet. two frames because the
  // folded state has to be painted before the transition has anything to travel from.
  // a new deposit types straight away; an existing one opens to be read, so no keyboard
  const wantsFocus = !existing;
  // Hold back the keyboard's band BEFORE the fold is measured, so the sheet's box is already
  // its keyboard-up size and the clip insets are computed against the box it will actually
  // settle into. This is what stops the one-off bounce: the caret is inside the visible area
  // from the first frame, so iOS has no reason to scroll anything into view.
  if (wantsFocus) reserveForKeyboard();
  // Now the sheet is in the document and the keyboard's band is already held back, so this is the
  // first moment a measurement means anything. Re-apply the restored height against the real box:
  // whatever max-height does to it here is what --sheet-h settles to, which also has to happen
  // BEFORE the fold is measured below, or the unfold would travel to a height the sheet then
  // leaves. Re-applying never persists — a restore still isn't a choice.
  if (reapplySheetHeight && manualHeight != null) reapplySheetHeight(manualHeight);
  const barEl = document.querySelector(".compose-bar");
  const still = unfoldStill(); // OS reduced-motion, or the rabbit end of the speed setting
  if (barEl && !still) {
    const b = barEl.getBoundingClientRect(), s = sheet.getBoundingClientRect();
    const inset = v => Math.max(0, Math.round(v)) + "px";
    sheet.style.setProperty("--mt", inset(b.top - s.top));
    sheet.style.setProperty("--mr", inset(s.right - b.right));
    sheet.style.setProperty("--mb", inset(s.bottom - b.bottom));
    sheet.style.setProperty("--ml", inset(b.left - s.left));
    document.body.classList.add("composing"); // the list shrinks + fades as this unfolds
    sheet.classList.add("folded", "no-anim");
    void sheet.offsetHeight;              // paint the folded rectangle with transitions off
    sheet.classList.remove("no-anim");
    void sheet.offsetHeight;              // transition armed, style unchanged
    // ...and open out. rAF alone can be throttled (a backgrounded tab never paints), which
    // would strand the composer as a grey bar — so a timer races it, whichever lands first.
    const release = () => sheet.classList.remove("folded");
    requestAnimationFrame(release);
    setTimeout(release, 70);
  }
  // iOS raises the keyboard for a programmatic focus() ONLY inside a real gesture's activation
  // window, and a setTimeout is outside it — the field took focus and showed a caret while the
  // keyboard stayed down, which is exactly the "tap Start typing, then tap Start typing again"
  // she hit. This runs synchronously, still inside the click that opened the composer, so the
  // activation is live. It must stay on `click`: pointerdown grants activation only when
  // pointerType is "mouse", so moving it earlier would break it on touch for the same reason
  // the photo button can't commit on pointerdown.
  const taNow = sheet.querySelector("textarea");
  if (taNow && wantsFocus) taNow.focus();
  // belt and braces for anything that refused the synchronous focus (and for the caret when the
  // unfold is animating). Guarded on activeElement so a focus that already took isn't repeated,
  // which on iOS is another chance to trigger a scroll-into-view.
  setTimeout(() => {
    const ta = sheet.querySelector("textarea");
    if (ta && wantsFocus && document.activeElement !== ta) ta.focus();
  }, still ? 120 : Math.round(420 * unfoldK()));
}

// read-only view of the original ramble a deposit was cut from. restoring swaps the
// deposits back out for the single original entry — they're all verbatim slices of it,
// so only edits made to the deposits afterwards would be lost, hence the confirm.
function openRambleView(src) {
  sheetRoot.innerHTML = "";
  lockPageScroll();
  const overlay = el("div", { class: "overlay", onclick: close });
  const sheet = el("div", { class: "sheet", onclick: e => e.stopPropagation() });
  overlay.appendChild(sheet);
  function close() { sheetRoot.innerHTML = ""; unlockPageScroll(); }

  sheet.appendChild(el("div", { class: "grabber" }));
  const head = el("div", { class: "sheet-head" });
  head.appendChild(el("span", { class: "title" }, "Full ramble"));
  sheet.appendChild(head);

  const segs = S.entries.filter(e => e.sourceId === src.id);
  const d = entryDay(src);
  sheet.appendChild(el("p", { class: "seg-note", style: { margin: "0 0 12px" } },
    "kept as written · "
    + (src.week == null
      ? monthLabel(src.year, src.month)
      : (d == null ? "" : DAY_TOKENS[d] + ", ") + "W" + pad2(src.week))
    + " · now " + segs.length + " deposits"));

  const body = el("p", { class: "ramble-text" });
  body.appendChild(renderRichBlocks(src.text, src.images));
  sheet.appendChild(body);

  sheet.appendChild(el("button", {
    class: "delete-btn",
    onclick: () => confirmAction(
      "Restore the full ramble? Its " + segs.length + " deposits will be replaced by the original entry.",
      "Restore",
      () => {
        segs.forEach(sg => tombstoneEntry(sg.id)); // so the removals sync, not just locally
        S.entries = S.entries
          .filter(e => e.sourceId !== src.id)
          .map(e => e.id === src.id ? { ...e, segmented: false, updatedAt: new Date().toISOString() } : e);
        saveEntries(S.entries);
        close();
        render();
      })
  }, "Restore as one entry"));

  sheetRoot.appendChild(overlay);
}
