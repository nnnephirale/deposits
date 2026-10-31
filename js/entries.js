// Entry cards: an entry and its groups, the swipe-open action rail and the read-more modal.

import { S } from "./state.js";
import { el } from "./dom.js";
import { DAY_TOKENS, tone, topicById } from "./taxonomy.js";
import { entryDay, pad2 } from "./dates.js";
import { saveEntries } from "./save.js";
import { PIN_ICON, renderRichBlocks } from "./richtext.js";
import { setImageSize, setLineMark } from "./widgets.js";
import { tombstoneEntry } from "./sync-ui.js";
import { groupByTopic, groupLabel } from "./grouping.js";
import { oldestFirst, orderGroupsForDisplay } from "./prefs.js";
import { RAIL_LOCK_ICON, RAIL_TRASH_ICON, entriesRoot, entryDayKey, entryEl, render } from "./render.js";
import { lockPageScroll, unlockPageScroll } from "./viewport.js";

// ---------- swipe an entry open ----------
// Drag an entry left and a rail of three comes out from under its right edge: pin, lock,
// delete. The card is what moves — the rail sits parked just off its right edge (left: 100%)
// and is revealed by the card sliding over it, so nothing has to be measured or animated into
// place and .group-card's own overflow does the clipping for free.
//
// Only ONE is open at a time. Two open rails means the next tap is ambiguous, and the second
// swipe reads as "I've changed my mind about the first" far more often than "both".
let openSwipe = null;
function closeOpenSwipe() {
  if (!openSwipe) return;
  openSwipe.classList.remove("swiped");
  openSwipe.style.transform = "";
  openSwipe = null;
}
// the whole list stands down when a tap lands anywhere that isn't the open rail
document.addEventListener("pointerdown", ev => {
  if (openSwipe && !ev.target.closest(".entry-rail") && !openSwipe.contains(ev.target)) closeOpenSwipe();
}, true);

export function attachEntrySwipe(entry, e) {
  const rail = el("div", { class: "entry-rail" });
  // Rebuilt per action rather than re-rendered from state: every one of these calls render(),
  // which throws this element away and makes a new one. Nothing here has to stay in sync.
  const act = (cls, label, iconHtml, run) => {
    const b = el("button", { class: "er-btn " + cls, "aria-label": label });
    b.innerHTML = iconHtml;
    b.addEventListener("click", ev => { ev.stopPropagation(); closeOpenSwipe(); run(); });
    return b;
  };
  const patch = fields => {
    S.entries = S.entries.map(x => x.id === e.id
      ? { ...x, ...fields, updatedAt: new Date().toISOString() } : x);
    saveEntries(S.entries);
    render();
  };
  rail.appendChild(act("er-pin" + (e.pinned ? " on" : ""),
    e.pinned ? "Unpin" : "Pin", PIN_ICON, () => patch({ pinned: !e.pinned })));
  rail.appendChild(act("er-lock" + (e.locked ? " on" : ""),
    e.locked ? "Unlock" : "Lock", RAIL_LOCK_ICON, () => patch({ locked: !e.locked })));
  // Locked means locked: the composer already refuses to show Delete on a locked entry, and a
  // rail that deleted one anyway would make the lock worth less than the gesture that ignores
  // it. Shown disabled rather than hidden so the rail is the same three slots every time.
  const del = act("er-del", "Delete", RAIL_TRASH_ICON, () => {
    tombstoneEntry(e.id);              // so the deletion syncs, not just locally
    S.entries = S.entries.filter(x => x.id !== e.id);
    saveEntries(S.entries);
    render();
  });
  del.disabled = !!e.locked;
  rail.appendChild(del);
  entry.appendChild(rail);

  // ---- the gesture ----
  // touch-action: pan-y on .entry (see the CSS) hands vertical scrolling to the browser and
  // horizontal movement to us, so the list still scrolls natively while this is listening.
  const RAIL_W = 132;      // three 44px slots — kept in step with the CSS by --rail-w
  const LOCK = 6;          // px of travel before the gesture's axis is decided
  const HBIAS = 0.75;      // how much less than the vertical the horizontal may be and still win

  // ---- one drag, two input paths ----
  // TOUCH IS DRIVEN BY TOUCH EVENTS, NOT POINTER EVENTS, and that is the whole fix for "it moves
  // a little and snaps back". Two things go wrong with the pointer path on iOS:
  //   1. iOS decides who owns a gesture on the FIRST touchmove. Preventing only after the swipe
  //      had been claimed — 8px and two or three frames in — was always too late: Safari had
  //      already committed to its own recogniser and answered with pointercancel, which arrives
  //      as a short drag and springs the card home.
  //   2. setPointerCapture on a TOUCH pointer is the thing iOS drops the moment that recogniser
  //      engages, and lostpointercapture ends the drag the same way.
  // Touch events have no capture semantics to lose, and a preventDefault on the move that
  // decides the axis locks the gesture for the rest of its life. The pointer path stays for the
  // mouse, where none of this applies and capture is genuinely useful.
  let dx = 0, wasOpen = false, active = false, suppressClick = false;

  const begin = { x: 0, y: 0 };
  const startAt = (cx, cy) => { begin.x = cx; begin.y = cy; wasOpen = entry.classList.contains("swiped"); dx = 0; };
  const claim = () => {
    active = true;
    closeOpenSwipe();
    if (wasOpen) { entry.classList.add("swiped"); openSwipe = entry; }
    entry.classList.add("swiping");
  };
  const moveTo = mx => {
    // rubber-band past the ends rather than stopping dead: an edge that refuses to move reads
    // as a broken gesture, one that resists reads as an edge
    const raw = (wasOpen ? -RAIL_W : 0) + mx;
    dx = raw > 0 ? raw * 0.25 : (raw < -RAIL_W ? -RAIL_W + (raw + RAIL_W) * 0.25 : raw);
    entry.style.transform = "translateX(" + dx.toFixed(1) + "px)";
  };
  const settle = () => {
    if (!active) return;
    active = false;
    entry.classList.remove("swiping");
    // past a third of the way is a commitment either direction — the same threshold both ways,
    // so opening and closing take the same amount of travel
    const open = dx < -RAIL_W / 3;
    entry.style.transform = "";
    entry.classList.toggle("swiped", open);
    openSwipe = open ? entry : (openSwipe === entry ? null : openSwipe);
    suppressClick = true;   // eaten by the click this drag is about to produce, if any
  };
  // a photo row scrolls itself sideways, and the checkboxes/links/read-more are all targets
  // whose own gesture this must not eat
  const offLimits = t => !!(t && t.closest && t.closest(".rt-gallery, .rt-check, .rt-link, .read-more, .entry-rail"));

  // ---- touch ----
  let tid = null, axis = null;
  entry.addEventListener("touchstart", ev => {
    if (ev.touches.length !== 1 || offLimits(ev.target)) { tid = null; return; }
    const t = ev.changedTouches[0];
    tid = t.identifier; axis = null; suppressClick = false;
    startAt(t.clientX, t.clientY);
  }, { passive: true });
  entry.addEventListener("touchmove", ev => {
    if (tid === null) return;
    const t = [...ev.touches].find(x => x.identifier === tid);
    if (!t) return;
    const mx = t.clientX - begin.x, my = t.clientY - begin.y;
    if (!axis) {
      // Wait for real movement before judging — the first sample of a real finger is noise, and
      // reading an intent out of two pixels is what threw good swipes away before. Then lock the
      // axis ONCE, with a bias toward horizontal: a thumb swiping across a phone pivots at its
      // base and arcs, so an honest sideways swipe carries real vertical travel with it. Losing
      // the axis race by a quarter still counts as horizontal.
      if (Math.hypot(mx, my) < LOCK) return;
      axis = Math.abs(mx) >= Math.abs(my) * HBIAS ? "x" : "y";
      if (axis === "y") { tid = null; return; }   // it's a scroll — hands off, and stay off
      claim();
    }
    ev.preventDefault();   // ours for the rest of this gesture; iOS cannot take it back now
    moveTo(mx);
  }, { passive: false });
  const endTouch = ev => {
    if (tid === null) return;
    if ([...ev.changedTouches].every(t => t.identifier !== tid)) return;
    tid = null; axis = null;
    settle();
  };
  entry.addEventListener("touchend", endTouch);
  entry.addEventListener("touchcancel", endTouch);

  // ---- mouse ----
  // Pointer events, capture and all: on a mouse there is no rival recogniser to lose the gesture
  // to, and capture is what keeps the drag alive when the cursor leaves the card.
  let mid = null;
  entry.addEventListener("pointerdown", ev => {
    if (ev.pointerType === "touch") return;           // the touch path above owns those
    if (!ev.isPrimary || ev.button !== 0 || offLimits(ev.target)) return;
    mid = ev.pointerId; suppressClick = false;
    startAt(ev.clientX, ev.clientY);
  });
  entry.addEventListener("pointermove", ev => {
    if (ev.pointerId !== mid) return;
    const mx = ev.clientX - begin.x, my = ev.clientY - begin.y;
    if (!active) {
      if (Math.hypot(mx, my) < LOCK) return;
      if (Math.abs(mx) < Math.abs(my) * HBIAS) { mid = null; return; }
      claim();
      try { entry.setPointerCapture(mid); } catch (err) {}
    }
    moveTo(mx);
  });
  const endMouse = ev => {
    if (ev.pointerId !== mid) return;
    mid = null;
    try { entry.releasePointerCapture(ev.pointerId); } catch (err) {}
    settle();
  };
  ["pointerup", "pointercancel", "lostpointercapture"].forEach(evt =>
    entry.addEventListener(evt, endMouse));
  // Two jobs, in order. A drag's trailing click is swallowed outright; after that, a tap on a
  // card whose rail is open closes the rail instead of opening the composer — the rail is the
  // question on screen, and the first tap anywhere should answer it.
  entry.addEventListener("click", ev => {
    // Consumed either way, so a press on the rail can't leave the flag armed for the next tap
    // on the card body.
    const trailing = suppressClick;
    suppressClick = false;
    // The rail is a child of the entry and this listener is on CAPTURE, so without this the
    // card would eat the very clicks the rail exists to receive — pin, lock and delete all
    // silently doing nothing. The rail's buttons stop their own propagation.
    if (ev.target.closest(".entry-rail")) return;
    if (trailing) { ev.stopPropagation(); ev.preventDefault(); return; }
    if (entry.classList.contains("swiped")) {
      ev.stopPropagation(); ev.preventDefault();
      closeOpenSwipe();
    }
  }, true);
}

// Read-more opens the whole entry — above AND below the fold — floating in a centred modal
// (her modal spec: dark blurred backdrop, white card, heavy shadow, 20px radius). read-only,
// but the checklists stay live; toggling one rewrites the text and rebuilds the modal body
// in place. tapping the entry card itself is still the way into the editor.
export function openReadModal(entry) {
  const id = entry.id;
  lockPageScroll();
  const back = el("div", { class: "read-back" });
  const modal = el("div", { class: "read-modal", onclick: ev => ev.stopPropagation() });
  const body = el("div", { class: "read-body" });
  const renderBody = () => {
    const e = S.entries.find(x => x.id === id) || entry; // re-read: a toggle may have changed it
    body.innerHTML = "";
    // renderRichBlocks already drops the "+++" fold line, so the modal shows above+below seamlessly
    body.appendChild(renderRichBlocks(e.text, e.images,
      (imgId, size) => { setImageSize(id, imgId, size); renderBody(); },
      (li, mark) => { setLineMark(id, li, mark); renderBody(); }));
  };
  renderBody();
  const close = () => {
    back.classList.remove("show");
    document.removeEventListener("keydown", onKey);
    setTimeout(() => back.remove(), 200);
    unlockPageScroll();
  };
  const onKey = ev => { if (ev.key === "Escape") close(); };
  modal.appendChild(el("button", { class: "read-x", "aria-label": "Close", onclick: close }, "×"));
  modal.appendChild(body);
  back.appendChild(modal);
  back.addEventListener("click", () => close()); // tap the backdrop to dismiss
  document.addEventListener("keydown", onKey);
  document.body.appendChild(back);
  requestAnimationFrame(() => back.classList.add("show"));
}

export function renderTopicGroups(list, dense) {
  for (const g of orderGroupsForDisplay(groupByTopic(list))) {
    const t = topicById[g.key];
    const group = el("div", { class: "group" + (dense ? " dense" : "") });
    let head = null;
    if (!dense) {
      head = el("div", { class: "group-head" });
      if (t) head.appendChild(el("span", { class: "group-dot", style: { background: tone(t).dot } }));
      head.appendChild(el("span", { class: "group-label", style: { color: t ? tone(t).fg : "var(--subtle)" } }, groupLabel(g.key)));
    }
    const card = el("div", { class: "group-card" });
    if (head) card.appendChild(head); // the topic reads as the block's own heading now
    let prevKey = null;
    for (const e of g.entries) {
      const key = entryDayKey(e);
      card.appendChild(entryEl(e, {
        skipTag: dense ? null : g.key, // dense: every entry carries its own topic pill, headers or no
        showWeek: S.view === "month",
        showDate: S.view === "month",
        repeat: key === prevKey
      }));
      prevKey = key;
    }
    group.appendChild(card);
    entriesRoot.appendChild(group);
  }
}

// the pinned block: the same card as any other group, headed by the pin rather than a topic.
// Order is whatever the view already sorted them into, so it follows the reading direction
// she set rather than inventing a second rule for the top of the list.
export function renderPinnedGroup(list) {
  const card = el("div", { class: "group-card" });
  const head = el("div", { class: "group-head" });
  const ico = el("span", { class: "group-pin" });
  ico.innerHTML = PIN_ICON;
  head.appendChild(ico);
  head.appendChild(el("span", { class: "group-label" }, "pinned"));
  card.appendChild(head);
  for (const e of list) {
    card.appendChild(entryEl(e, { showWeek: S.view === "month", showDate: S.view === "month" }));
  }
  entriesRoot.appendChild(el("div", { class: "group pinned-group" }, card));
}

export function renderDayGroups(list) {
  const buckets = [];
  if (S.view === "week") {
    // the buckets follow the same direction as the entries inside them
    const days = DAY_TOKENS.map((_, i) => i);
    if (!oldestFirst) days.reverse();
    for (const d of days) {
      buckets.push({ label: DAY_TOKENS[d], entries: list.filter(e => entryDay(e) === d), opts: { showDay: false, sidePill: true } });
    }
    buckets.push({ label: "anytime", entries: list.filter(e => entryDay(e) == null), opts: { showDay: false, sidePill: true } });
  } else {
    for (const w of [...new Set(list.map(e => e.week))]) {
      // the null-week bucket holds the month-scoped entries — "anytime", like week view's
      buckets.push({ label: w == null ? "anytime" : "W" + pad2(w), entries: list.filter(e => e.week === w), opts: { showDate: true, sidePill: true } });
    }
  }
  for (const b of buckets) {
    if (!b.entries.length) continue;
    const card = el("div", { class: "group-card" });
    // The day used to be said twice: mono black text in the heading, and the grey badge in
    // every entry's gutter. The badge wins — it's the same object the topic view uses, and
    // it's the one that can sit centred on the first line beside the topic pill. So a day
    // bucket has no heading at all; its first entry's badge names it, and the repeat run
    // below carries it down. "anytime" and month view's W## buckets aren't days and have no
    // badge equivalent, so they keep the label.
    if (!DAY_TOKENS.includes(b.label)) {
      card.appendChild(el("div", { class: "group-head" },
        el("span", { class: "group-label", style: { color: "var(--ink)" } }, b.label)));
    }
    let prevKey = null;
    for (const e of b.entries) {
      const key = entryDayKey(e);
      card.appendChild(entryEl(e, Object.assign({ repeat: key === prevKey }, b.opts)));
      prevKey = key;
    }
    entriesRoot.appendChild(el("div", { class: "group" }, card));
  }
}
