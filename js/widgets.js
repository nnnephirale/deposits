// Pieces that live inside an entry card: the day-strip mark picker, photo galleries and the
// full-screen image preview.

import { S } from "./state.js";
import { el } from "./dom.js";
import { DAY_NAMES, DAY_TOKENS } from "./taxonomy.js";
import { saveEntries } from "./save.js";
import { wordCount } from "./anthropic.js";
import { CHECK_ICON, IMG_SIZES, LINE_MARK_RE, dayFromMark, markForDay, plainText, truncateWords } from "./richtext.js";
import { render } from "./render.js";

// ---------- long-press a checkbox for the day strip ----------
// A tap ticks an item; a HOLD asks which day it was done, and the answer takes the tick's place
// inside the same circle. The whole vocabulary of the strip is the week the app already talks
// in — the same seven tokens as the day badge and the composer's scrubber — plus the plain tick
// and a way back to empty, so every state an item can be in is reachable from one place.
let openMarkPop = null;
function closeMarkPop() {
  if (!openMarkPop) return;
  openMarkPop.remove();
  openMarkPop = null;
  document.removeEventListener("pointerdown", closeMarkPop, true);
}
function openMarkPicker(box, pick, current) {
  closeMarkPop();
  const pop = el("div", { class: "mark-pop", role: "group", "aria-label": "Mark done on a day" });
  const choose = mark => { closeMarkPop(); pick(mark); };
  // the seven days, then the two plain states — the days are the point of the strip, so they
  // lead, and the pair that isn't a day is set apart rather than dropped in among them
  DAY_TOKENS.forEach((tok, i) => {
    const mark = markForDay(i);
    const b = el("button", {
      class: "mp-day" + (dayFromMark(current) === i ? " on" : ""),
      "aria-label": DAY_NAMES[i]
    });
    const sup = tok.match(/^(.)([\u00B9\u00B2])$/);
    if (sup) { b.appendChild(document.createTextNode(sup[1]));
               b.appendChild(el("sup", null, sup[2] === "\u00B9" ? "1" : "2")); }
    else b.textContent = tok;
    b.addEventListener("click", ev => { ev.stopPropagation(); choose(mark); });
    pop.appendChild(b);
  });
  pop.appendChild(el("span", { class: "mp-div" }));
  const tick = el("button", { class: "mp-day mp-tick" + (/[xX]/.test(current) ? " on" : ""), "aria-label": "Done" });
  tick.innerHTML = CHECK_ICON;
  tick.addEventListener("click", ev => { ev.stopPropagation(); choose("x"); });
  pop.appendChild(tick);
  const clear = el("button", { class: "mp-day mp-clear", "aria-label": "Not done" });
  clear.addEventListener("click", ev => { ev.stopPropagation(); choose(" "); });
  pop.appendChild(clear);

  // Positioned in viewport coordinates against the circle it belongs to, and kept on screen:
  // a checklist item can sit anywhere in a card, including hard against either edge. Measured
  // after it is in the document, because its width depends on its own contents.
  document.body.appendChild(pop);
  const r = box.getBoundingClientRect(), pr = pop.getBoundingClientRect();
  const left = Math.min(Math.max(8, r.left + r.width / 2 - pr.width / 2), window.innerWidth - pr.width - 8);
  // above the circle by default; below it when there isn't room, so it never opens off the top
  const above = r.top - pr.height - 8;
  pop.style.left = Math.round(left) + "px";
  pop.style.top = Math.round(above >= 8 ? above : r.bottom + 8) + "px";
  requestAnimationFrame(() => pop.classList.add("show"));
  openMarkPop = pop;
  // capture, so a tap anywhere else dismisses before that tap does anything of its own
  setTimeout(() => document.addEventListener("pointerdown", closeMarkPop, true), 0);
}
// The hold itself. Deliberately NOT a long-press on the whole row: the row is the entry's own
// tap target (it opens the composer) and the circle is the only part of a checklist item that
// already means "the state of this item".
const MARK_HOLD = 420;   // ms — long enough not to fire on a slow tap, short enough to feel like a hold
export function attachMarkPress(box, pick, current) {
  let timer = null, fired = false, sx = 0, sy = 0;
  const cancel = () => { clearTimeout(timer); timer = null; };
  box.addEventListener("pointerdown", ev => {
    if (!ev.isPrimary) return;
    fired = false; sx = ev.clientX; sy = ev.clientY;
    clearTimeout(timer);
    timer = setTimeout(() => {
      fired = true;
      openMarkPicker(box, pick, current);
    }, MARK_HOLD);
  });
  // a finger that travels is scrolling the list, not holding a circle
  box.addEventListener("pointermove", ev => {
    if (timer && Math.hypot(ev.clientX - sx, ev.clientY - sy) > 8) cancel();
  });
  ["pointerup", "pointercancel", "pointerleave"].forEach(evt => box.addEventListener(evt, cancel));
  // the click that follows a hold would otherwise ALSO toggle the tick, so the hold eats it
  box.addEventListener("click", ev => {
    if (!fired) return;
    fired = false;
    ev.stopPropagation(); ev.preventDefault();
  }, true);
  // iOS puts its own callout on a long press over text; the circle has to be exempt or the
  // magnifier arrives on top of the strip
  box.addEventListener("contextmenu", ev => ev.preventDefault());
}

// a shimmering gradient fighting with moving content just reads as noise, so the sweep holds
// still while anything is scrolling and picks up where it left off ~220ms after it settles.
// paused rather than cancelled, so it never visibly restarts.
export function pauseShimmerOnScroll(target, scroller) {
  let idle = null;
  (scroller || window).addEventListener("scroll", () => {
    target.classList.add("paused");
    clearTimeout(idle);
    idle = setTimeout(() => target.classList.remove("paused"), 220);
  }, { passive: true });
}

// pinch a run of photos closed and they collapse into a fanned deck; spread it and they lay
// back out as a row. the state is remembered per run of markers, not stored on the entry, so
// it survives re-renders without becoming data.
export const stackedRuns = new Set();
export function attachGalleryPinch(gal, key) {
  let start = null;
  const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);
  gal.addEventListener("touchstart", ev => {
    if (ev.touches.length !== 2) return;
    ev.stopPropagation(); // the list's own pinch-to-compact must not also fire
    start = dist(ev.touches);
  }, { passive: true });
  gal.addEventListener("touchmove", ev => {
    if (start == null || ev.touches.length !== 2) return;
    ev.stopPropagation();
    ev.preventDefault(); // no page zoom while shaping the deck
    const ratio = dist(ev.touches) / start;
    if (ratio < 0.82) { gal.classList.add("stacked"); stackedRuns.add(key); start = null; }
    else if (ratio > 1.22) { gal.classList.remove("stacked"); stackedRuns.delete(key); start = null; }
    if (start === null) gal.dispatchEvent(new Event("galchange")); // let the edge fades re-measure
  }, { passive: false });
  gal.addEventListener("touchend", () => { start = null; }, { passive: true });
}

// each end gets a fade, shown only when there's actually content hidden that way — so they
// answer "is there more?" honestly at both edges. overflow is measured, not inferred from the
// photo count: two images normally fill the row exactly, but not once one of them is portrait
// enough to widen it, and a stale one-shot measurement was why the cue came and went.
// also flags the gallery as "mid-drag" for a beat so a fast flick's tail can't register as
// the tap that opens the size rail — belt-and-braces alongside the browser's own
// click-cancel-on-scroll behaviour.
// Drag-to-scroll for the photo row, MOUSE ONLY. Touch keeps native momentum scrolling and,
// more importantly, keeps the two-finger pinch that fans the row into a deck — claiming
// touch pointers here would fight it. A drag past the threshold swallows the click that
// follows, so dragging across an image doesn't also open its preview.
export function attachGalleryDrag(gal) {
  let id = null, startX = 0, startLeft = 0, moved = false;
  gal.addEventListener("pointerdown", ev => {
    if (ev.pointerType !== "mouse" || ev.button !== 0) return;
    if (gal.classList.contains("stacked")) return; // a fanned deck has nothing to scroll
    if (gal.scrollWidth - gal.clientWidth < 2) return;
    id = ev.pointerId; startX = ev.clientX; startLeft = gal.scrollLeft; moved = false;
  });
  gal.addEventListener("pointermove", ev => {
    if (ev.pointerId !== id) return;
    const dx = ev.clientX - startX;
    if (!moved && Math.abs(dx) < 4) return;
    if (!moved) {
      moved = true;
      gal.classList.add("dragging");
      // scroll-snap fights a live drag — it keeps yanking back to the nearest card
      gal.style.scrollSnapType = "none";
      gal.setPointerCapture(id);
    }
    ev.preventDefault();
    gal.scrollLeft = startLeft - dx;
  });
  const end = ev => {
    if (ev.pointerId !== id) return;
    if (moved) {
      gal.classList.add("swallow-click");
      setTimeout(() => gal.classList.remove("swallow-click"), 0);
    }
    id = null;
    gal.classList.remove("dragging");
    gal.style.scrollSnapType = "";
  };
  gal.addEventListener("pointerup", end);
  gal.addEventListener("pointercancel", end);
  // capture phase, so it lands before the image's own click handler opens the preview
  gal.addEventListener("click", ev => {
    if (gal.classList.contains("swallow-click")) { ev.stopPropagation(); ev.preventDefault(); }
  }, true);
}

// Desktop-only page buttons for a gallery that scrolls. There is no measurement of its own here:
// the wrapper already carries show-left/show-right, kept in step with the scroll position by
// attachGalleryFade for the edge fades, so an arrow simply follows the fade on its side. That
// also means an arrow can never point somewhere there is nothing to scroll to.
const GAL_CHEV = d => '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
  + 'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="'
  + (d < 0 ? "M15 5 8 12l7 7" : "M9 5l7 7-7 7") + '"/></svg>';
export function attachGalleryNav(wrap, gal) {
  const step = dir => {
    // one image plus the row's gap, so a press lands the next image where the last one was
    const img = gal.querySelector(".rt-img");
    const w = img ? img.getBoundingClientRect().width + 8 : Math.round(gal.clientWidth * 0.7);
    gal.scrollBy({ left: dir * w, behavior: "smooth" });
  };
  for (const dir of [-1, 1]) {
    const b = el("button", {
      class: "rt-gal-nav " + (dir < 0 ? "gn-prev" : "gn-next"),
      "aria-label": dir < 0 ? "Previous photos" : "Next photos"
    });
    b.innerHTML = GAL_CHEV(dir);
    // the gallery's images open a lightbox on click, and the buttons sit on top of them —
    // without this a page press opens the photo underneath as well.
    b.addEventListener("click", ev => { ev.preventDefault(); ev.stopPropagation(); step(dir); });
    wrap.appendChild(b);
  }
}

export function attachGalleryFade(wrap, gal) {
  const sync = () => {
    if (gal.classList.contains("stacked")) { // a fanned deck doesn't scroll — no edges to hint at
      wrap.classList.remove("show-left", "show-right");
      return;
    }
    const max = gal.scrollWidth - gal.clientWidth;
    wrap.classList.toggle("show-left", gal.scrollLeft > 2);
    wrap.classList.toggle("show-right", max > 2 && gal.scrollLeft < max - 2);
  };
  let dragTimer = null;
  gal.addEventListener("scroll", () => {
    sync();
    gal.dataset.scrolling = "1";
    clearTimeout(dragTimer);
    dragTimer = setTimeout(() => { delete gal.dataset.scrolling; }, 150);
  }, { passive: true });
  // images settle their width after decode, and pinching re-lays the whole row out — one
  // measurement at render time is not enough to stay correct through either.
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(sync);
    ro.observe(gal);
    for (const img of gal.querySelectorAll("img")) ro.observe(img);
  }
  for (const img of gal.querySelectorAll("img")) {
    if (!img.complete) img.addEventListener("load", sync, { once: true });
  }
  gal.addEventListener("transitionend", sync); // the pinch/spread relayout
  gal.addEventListener("galchange", sync);     // ...and the moment the pinch commits
  sync();
  requestAnimationFrame(sync);
}

// tap a rendered image to open the full-screen preview (and its size rail). this was a
// press-and-hold, which lost the race on the phone too often — finger jitter past the move
// threshold, or Safari's own image gesture, cancelled the timer and the size rail felt gone.
// a single tap can't miss; the composer is still one tap away on the entry's text. cursor
// is zoom-in, so the image already advertises it.
export function attachImagePreview(img, src, id, size, onResize) {
  img.addEventListener("click", ev => {
    if (img.closest(".rt-gallery")?.dataset.scrolling === "1") return; // the tail of a drag, not a tap
    ev.stopPropagation(); // don't also open the composer
    ev.preventDefault();
    openImagePreview(src, id, size, onResize);
  });
  img.addEventListener("contextmenu", ev => ev.preventDefault()); // no iOS/desktop image callout on hold
}

let imgPreviewClose = null;
function openImagePreview(src, id, size, onResize) {
  if (imgPreviewClose) imgPreviewClose();
  const back = el("div", { class: "img-preview-back" });
  const stage = el("div", { class: "img-preview-stage" });
  const frame = el("div", { class: "img-preview-frame" }); // gives the photo a shrinkable box
  frame.appendChild(el("img", { class: "img-preview-img", src, alt: "photo" }));
  stage.appendChild(frame);
  back.appendChild(stage);

  // size rail — only when the caller can persist a change (i.e. a real entry, not a preview view)
  if (onResize) {
    let current = size;
    const rail = el("div", { class: "img-size-rail" });
    rail.appendChild(el("div", { class: "img-size-title" }, "size"));
    const labels = { inline: "Inline", "1x": "1×", "2x": "2×", "3x": "3×" };
    const btns = {};
    for (const s of IMG_SIZES) {
      const b = el("button", { class: "img-size-btn" + (s === current ? " active" : ""),
        onclick: ev => {
          ev.stopPropagation();
          current = s;
          for (const k in btns) btns[k].classList.toggle("active", k === s);
          onResize(id, s); // rewrites the marker + re-renders the list underneath
        } }, labels[s]);
      btns[s] = b;
      rail.appendChild(b);
    }
    stage.appendChild(rail);
  }

  const close = () => {
    back.classList.remove("show");
    document.removeEventListener("keydown", onKey);
    imgPreviewClose = null;
    setTimeout(() => back.remove(), 220);
  };
  const onKey = ev => { if (ev.key === "Escape") close(); };
  // short guard so the tap that opened the preview can't also dismiss it. it used to be 260ms,
  // to outlast the finger-up of a long-press; a tap is over by the time we get here.
  let armed = false;
  setTimeout(() => { armed = true; }, 100);
  back.addEventListener("click", ev => {
    if (armed && (ev.target === back || ev.target === stage || ev.target === frame)) close(); // tapping beside the photo
  });
  document.addEventListener("keydown", onKey);
  imgPreviewClose = close;
  document.body.appendChild(back);
  requestAnimationFrame(() => back.classList.add("show"));
}

// persist a chosen display size by rewriting the marker in the owning entry's text
// (size travels in the text, so it syncs with no extra column). 3x is the default -> no suffix.
export function setImageSize(entryId, imgId, size) {
  const re = new RegExp("!\\[photo:" + imgId + "(?:@(?:inline|1x|2x|3x))?\\]", "g");
  const mark = size === "3x" ? "![photo:" + imgId + "]" : "![photo:" + imgId + "@" + size + "]";
  S.entries = S.entries.map(e => e.id === entryId
    ? { ...e, text: e.text.replace(re, mark), updatedAt: new Date().toISOString() }
    : e);
  saveEntries(S.entries);
  render();
}

// Set a checklist item's mark in place by rewriting the box on that exact line (line index, so
// identical item text can't cross wires). The state lives in the text, so it syncs for free.
// `mark` is what goes between the brackets: " ", "x", or a day token like "M" or "T2".
export function setLineMark(entryId, lineIndex, mark) {
  S.entries = S.entries.map(e => {
    if (e.id !== entryId) return e;
    const lines = e.text.split("\n");
    if (lineIndex >= lines.length) return e;
    lines[lineIndex] = lines[lineIndex].replace(LINE_MARK_RE, "$1[" + mark + "]");
    return { ...e, text: lines.join("\n"), updatedAt: new Date().toISOString() };
  });
  saveEntries(S.entries);
  render();
}

// per-entry LLM summaries were tried and removed (5 Jul 2026) — truncation is enough
// for the zoomed-out view. old e.summary fields in stored data are simply ignored.
export function compactText(e) { return truncateWords(plainText(e.text, "▓▓▓"), 12) + "…"; }
export function entryWords(e) { return wordCount(plainText(e.text, "▓")); }
