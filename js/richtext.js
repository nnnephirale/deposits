// The inline marker dialect (bold, links, redaction, checklists, photos…): parsed while
// editing, rendered into cards.

import { el } from "./dom.js";
import { DAY_NAMES, DAY_TOKENS } from "./taxonomy.js";
import { attachGalleryDrag, attachGalleryFade, attachGalleryNav, attachGalleryPinch, attachImagePreview, attachMarkPress, stackedRuns } from "./widgets.js";

export function truncateWords(t, n) { return t.trim().split(/\s+/).slice(0, n).join(" "); }
// capitalizes the first letter of each sentence — display-only, never mutates stored text
export function sentenceCase(s) { return s.replace(/(^\s*\S|[.!?]\s+\S)/g, c => c.toUpperCase()); }

// ---------- inline formatting (Bear-style: raw markers while editing, rendered in cards) ----------
// dialect: [label](url) **bold** *italic* __underline__ `mono` ||redact|| ![photo:id]
// deliberately NO tilde rule — ~text~ renders literally (she likes her curly hyphens).
// link is first so its brackets/parens aren't mis-parsed by the emphasis rules.
// a photo marker may carry an optional display size (![photo:id@2x]); no suffix = full-width (3x).
// bold/underline/redact may run across line breaks — but not across a blank line, so one
// unclosed marker can't swallow the paragraphs after it. italic is the fussy one: a lone *
// is also a plain typographic character, so it only opens on a non-space, never closes on a
// space, never eats the ** of a neighbouring bold marker, and stays on one line. without
// those guards a stray "3 * 4" earlier in an entry silently ate the next **bold**.
export const RICH_RE = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*((?:[^\n]|\n(?!\s*\n))+?)\*\*|\*(?![\s*])([^*\n]*?[^\s*])\*(?!\*)|__((?:[^\n]|\n(?!\s*\n))+?)__|`([^`\n]+?)`|\|\|([\s\S]+?)\|\||!\[photo:([a-z0-9]+)(?:@(inline|1x|2x|3x))?\]/g;

// pasted images live out-of-band on the entry (entry.images = { id: dataURL }) so the
// raw-text editor shows a short marker instead of a thousand base64 characters.
const IMG_MARK_RE = /!\[photo:([a-z0-9]+)(?:@(?:inline|1x|2x|3x))?\]/g;
export const IMG_SIZES = ["inline", "1x", "2x", "3x"]; // 3x = full-width block (the default)
const IMG_MAX_DIM = 1100, IMG_QUALITY = 0.82;

// keep only the images the text still references — pasted-then-deleted ones don't persist
export function imagesUsedIn(text, images) {
  const out = {};
  if (!images) return out;
  let m;
  IMG_MARK_RE.lastIndex = 0;
  while ((m = IMG_MARK_RE.exec(text))) if (images[m[1]]) out[m[1]] = images[m[1]];
  return out;
}

// downscale + recompress a pasted image so entries stay small enough for localStorage/sync
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const scale = Math.min(1, IMG_MAX_DIM / Math.max(img.naturalWidth, img.naturalHeight));
      const w = Math.max(1, Math.round(img.naturalWidth * scale));
      const h = Math.max(1, Math.round(img.naturalHeight * scale));
      const c = document.createElement("canvas");
      c.width = w; c.height = h;
      const ctx = c.getContext("2d");
      ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, w, h); // jpeg has no alpha channel
      ctx.drawImage(img, 0, 0, w, h);
      URL.revokeObjectURL(url);
      resolve(c.toDataURL("image/jpeg", IMG_QUALITY));
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error("image decode failed")); };
    img.src = url;
  });
}

const LINK_ICON = '<svg viewBox="0 0 24 24" width="10" height="10" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14a4 4 0 0 0 6 .4l2.6-2.6a4 4 0 0 0-5.7-5.7L11.4 7.6"/><path d="M14 10a4 4 0 0 0-6-.4L5.4 12.2a4 4 0 0 0 5.7 5.7l1.5-1.5"/></svg>';

// format-bar line ops: proper icons instead of squished text glyphs
export const BULLET_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="6" r="1.6" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="5" cy="18" r="1.6" fill="currentColor" stroke="none"/><path d="M10.5 6h9M10.5 12h9M10.5 18h9"/></svg>';
export const INDENT_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16M12 12h8M4 19h16"/><path d="M4 9.2v5.6L7.6 12Z" fill="currentColor" stroke="none"/></svg>';
export const OUTDENT_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 5h16M12 12h8M4 19h16"/><path d="M7.6 9.2v5.6L4 12Z" fill="currentColor" stroke="none"/></svg>';
export const IMG_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3.5" y="5" width="17" height="14" rx="2.5"/><circle cx="9" cy="10.2" r="1.6"/><path d="m20.5 15.8-4.3-4.3a1.5 1.5 0 0 0-2.1 0L6.5 19"/></svg>';
export const CHECKBOX_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="4" width="16" height="16" rx="4"/><path d="m8.5 12.5 2.5 2.5 4.5-5"/></svg>';
export const LINES_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><circle cx="5" cy="6" r="1.5" fill="currentColor" stroke="none"/><circle cx="5" cy="12" r="1.5" fill="currentColor" stroke="none"/><circle cx="5" cy="18" r="1.5" fill="currentColor" stroke="none"/><path d="M10 6h9M10 12h6M10 18h9"/></svg>';
export const FOLD_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 8h16"/><path d="M8 13l4 4 4-4"/></svg>';
// the fmt bar's own two icon buttons — same stroke language as the set above (24 viewBox,
// currentColor, 1.8 stroke, round caps/joins) so they read as one family, not an import.
// FMT_ prefix because LINK_ICON is already taken, by the 10px glyph that marks a rendered link
// inside an entry (see its use in the card renderer). Same shape, but that one is drawn at 10px
// with a 2.2 stroke to survive being tiny inline; this one is a 24px toolbar icon at the 1.8
// stroke the rest of the button set uses. Two sizes of the same idea, not one reusable asset.
export const FMT_LINK_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 14.5 14.5 9.5"/><path d="M11 7.5 12.4 6.1a3.5 3.5 0 0 1 4.95 4.95L15.9 12.5"/><path d="M13 16.5 11.6 17.9a3.5 3.5 0 0 1-4.95-4.95L8.1 11.5"/></svg>';
// head controls: tag (folds the topic/mode chips away) and the dismiss half of the commit pair.
// The tick is the existing TICK_ICON further down — one tick for the whole app, rather than a
// second one here that would drift from it. Neither glyph carries its own circle: the ring is a
// CSS border on .head-act, so both buttons share one ring geometry and stay the same size
// whatever is inside them.
export const TAG_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.2 3.5H5a1.5 1.5 0 0 0-1.5 1.5v6.2a2 2 0 0 0 .6 1.4l7 7a1.5 1.5 0 0 0 2.1 0l6.2-6.2a1.5 1.5 0 0 0 0-2.1l-7-7a2 2 0 0 0-1.4-.6Z"/><circle cx="8" cy="8" r="1.4" fill="currentColor" stroke="none"/></svg>';
// the pin, for the composer head and the swipe rail. Drawn as a pushpin seen head-on: a head,
// a shaft, and the two shoulders that make it read as a pin rather than a balloon at 16px.
export const PIN_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 3.5h6M10 3.5v5.2L7.2 12a1 1 0 0 0 .8 1.6h8a1 1 0 0 0 .8-1.6L14 8.7V3.5"/><path d="M12 13.6V20.5"/></svg>';
export const CROSS_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 7l10 10M17 7 7 17"/></svg>';
// a bar wiping across the line — the ||redact|| marker's own idea (mask, not strike) rather
// than the highlighter-pen glyph a literal read of "highlight" would suggest.
export const REDACT_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M4.5 5.5h15" stroke-opacity="0.4"/><path d="M4.5 18.5h9" stroke-opacity="0.4"/><rect x="3.5" y="9.5" width="17" height="5" rx="2.5" fill="currentColor" stroke="none"/></svg>';

// derive a compact display domain from a url (drops scheme, www, and path)
export function domainOf(u) {
  try { return new URL(u).hostname.replace(/^www\./, ""); }
  catch (e) { return u.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0]; }
}

// flatten markers to plain text. redactedAs replaces redacted content ("keep" preserves it) —
// so truncation shows ▓▓▓ and the summarizer never sees redacted content at all. links flatten
// to their label so search/summaries see the readable text, never the raw url.
// redaction is masked in a pre-pass so ||…|| nested inside bold/italic (or spanning lines,
// which the per-rule regex can't reach) never leaks through to the summarizer either.
export function plainText(t, redactedAs) {
  if (redactedAs !== "keep") t = t.replace(/\|\|[\s\S]+?\|\|/g, () => redactedAs);
  return t.replace(IMG_MARK_RE, "")
    .replace(/^[ \t]*[-+]{3,}[ \t]*$/gm, "")          // "---" dividers and "+++" fold markers
    .replace(new RegExp("^[ \\t]*[-—] (?:\\[(?:" + CHECK_MARK + ")\\] ?)?", "gm"), "") // bullet + checkbox prefix
    .replace(RICH_RE, (m0, linkLabel, linkUrl, b, i, u, mono, red, img) => {
    if (linkLabel != null) return linkLabel;
    if (red != null) return redactedAs === "keep" ? red : redactedAs;
    if (img != null) return "";
    if (mono != null) return mono; // mono is literal — its content is not re-parsed
    // bold/italic/underline can nest — flatten the inside too so no *markers* leak into
    // summaries/search. safe with the shared global RICH_RE: String.replace finishes
    // collecting matches before any callback runs, so this re-entry can't disturb it.
    return plainText(b != null ? b : i != null ? i : u, redactedAs);
  });
}

// a photo marker hugged by style markers (**![photo:id]**) can't render — the bold rule wins
// the leftmost match and swallows it. wrapSel no longer creates these, but entries styled
// before that fix still carry them, so shed the wrapper here rather than lose the picture.
const PHOTO_WRAPPED_RE = /(\*\*|__|\*|`)(!\[photo:[a-z0-9]+(?:@(?:inline|1x|2x|3x))?\])\1/g;
function unwrapPhotoMarkers(t) { return t.replace(PHOTO_WRAPPED_RE, "$2"); }

// bold / italic / underline recurse into their own content, so *italic* inside **bold**
// (and any other combination the markers allow) renders as both, not as one style wrapping
// the other's literal asterisks. a PRIVATE matcher is essential: renderRich drives a manual
// exec loop, and recursing on the shared global RICH_RE mid-loop would clobber its lastIndex
// and drop the rest of the outer text. mono/redaction/links stay literal — no recursion.
function renderRich(text, images, onResize) {
  text = unwrapPhotoMarkers(text);
  const frag = document.createDocumentFragment();
  const re = new RegExp(RICH_RE.source, "g");
  let last = 0, m;
  while ((m = re.exec(text))) {
    if (m.index > last) frag.appendChild(document.createTextNode(text.slice(last, m.index)));
    if (m[1] != null) {
      const a = el("a", {
        class: "rt-link", href: m[2], target: "_blank", rel: "noopener noreferrer",
        onclick: ev => ev.stopPropagation() // navigate, but don't also open the composer
      });
      a.innerHTML = LINK_ICON;
      a.appendChild(document.createTextNode(m[1]));
      frag.appendChild(a);
    }
    else if (m[3] != null) frag.appendChild(el("span", { class: "rt-b" }, renderRich(m[3], images, onResize)));
    else if (m[4] != null) frag.appendChild(el("span", { class: "rt-i" }, renderRich(m[4], images, onResize)));
    else if (m[5] != null) frag.appendChild(el("span", { class: "rt-u" }, renderRich(m[5], images, onResize)));
    else if (m[6] != null) frag.appendChild(el("span", { class: "rt-m" }, m[6]));
    else if (m[8] != null) {
      const src = images && images[m[8]];
      // no stored data (e.g. synced before the cloud grew its images column): show the marker as-is
      if (src) {
        const size = m[9] || "3x";
        const img = el("img", { class: "rt-img" + (size === "3x" ? "" : " sz-" + size), src, alt: "photo" });
        attachImagePreview(img, src, m[8], size, onResize);
        frag.appendChild(img);
      } else frag.appendChild(document.createTextNode(m[0]));
    }
    else {
      const r = el("span", {
        class: "redacted",
        onclick: ev => { ev.stopPropagation(); r.classList.toggle("revealed"); } // reveal without opening the composer
      }, m[7]);
      frag.appendChild(r);
    }
    last = m.index + m[0].length;
  }
  if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}

// line-level pass over renderRich: "- " at line start renders as a bullet row (hanging
// indent via flex), leading two-space units as indentation, a lone "---" as a divider,
// a "- [ ] "/"- [x] " bullet as a tappable checklist item. entries with none of these
// take the plain renderRich path untouched, so nothing existing changes appearance.
// a line of 3+ hyphens on its own = a horizontal rule (Notion/Obsidian's "---"). the space
// after the first hyphen is what tells it apart from a "- " bullet, so no space here.
const HR_LINE_RE = /^[ \t]*-{3,}[ \t]*$/;
export const FOLD_LINE_RE = /^[ \t]*\+{3,}[ \t]*$/m;        // the "read more" cut — handled by the card
                                                     // (m flag: entryEl execs it against the whole entry)
// A checklist item's mark. Three states, not two: empty, done, or done ON A DAY — the last
// written as the weekday's own token, so "- [M] call the vet" is an item ticked off on Monday
// and reads as that in the raw text as much as on screen.
//   T and S have to carry their number: T alone cannot say Tuesday or Thursday, and the app has
// used T¹/T² everywhere since the day strip. The digit form is what gets WRITTEN (¹ is not on a
// keyboard and this text is typed by hand), but the superscript is accepted too, so an item
// pasted back from anywhere the app rendered it still parses.
export const CHECK_MARK = "[ xX]|[MmWwFf]|[TtSs][12\u00B9\u00B2]";
export const CHECK_RE = new RegExp("^\\[(" + CHECK_MARK + ")\\] ?([\\s\\S]*)$");
// the same class, for finding the mark at the head of a raw line
export const LINE_MARK_RE = new RegExp("^(\\s*[-—] )\\[(?:" + CHECK_MARK + ")\\]");
// mark -> weekday index, or null when it is not a day (" ", "x"). The letter identifies the day
// and the digit only separates the two T's and the two S's, so case is irrelevant.
export function dayFromMark(mark) {
  const m = String(mark).toUpperCase().replace("\u00B9", "1").replace("\u00B2", "2");
  const idx = { M: 0, T1: 1, W: 2, T2: 3, F: 4, S1: 5, S2: 6 }[m];
  return idx == null ? null : idx;
}
// weekday index -> the mark that gets written. Derived from DAY_TOKENS rather than spelled out
// again, so the two cannot drift.
export function markForDay(idx) {
  return DAY_TOKENS[idx].replace("\u00B9", "1").replace("\u00B2", "2");
}
function isDoneMark(mark) { return /[xX]/.test(mark) || dayFromMark(mark) != null; }
const PHOTO_ONLY_LINE_RE = /^[ \t]*!\[photo:[a-z0-9]+(?:@(?:inline|1x|2x|3x))?\][ \t]*$/; // a line that is just a photo
// just the tick — the filled box is the .rt-box.on container itself, so no inner rect
// (that "box in a box" read cluttered). iOS-clean: white checkmark on a solid fill.
export const CHECK_ICON = '<svg viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5 10 17.5 19.5 7"/></svg>';
// onCheck(lineIndex, nextChecked) — supplied only where a toggle should persist (the card,
// the read-more modal). left out of read-only previews, where the box renders but is inert.
export function renderRichBlocks(text, images, onResize, onCheck) {
  const needsBlocks = /^[ \t]*[-—] |^(?: {2,}|\t)|^[ \t]*[-+]{3,}[ \t]*$/m.test(text)
    || /!\[photo:[a-z0-9]+(?:@(?:inline|1x|2x|3x))?\][ \t]*\n[ \t]*!\[photo:/.test(text); // a photo run
  if (!needsBlocks) return renderRich(text, images, onResize);
  const frag = document.createDocumentFragment();
  const lines = text.split("\n");
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    if (FOLD_LINE_RE.test(line)) continue;                        // the fold marker itself never shows
    if (HR_LINE_RE.test(line)) { frag.appendChild(el("hr", { class: "rt-hr" })); continue; }
    // photos added back to back gather into one row of rounded cards rather than stacking
    // full-width. consume the whole run here so each image isn't its own block.
    if (PHOTO_ONLY_LINE_RE.test(line)) {
      const run = [];
      while (li < lines.length && PHOTO_ONLY_LINE_RE.test(lines[li])) {
        run.push(lines[li].trim()); li++;
      }
      li--; // the for-loop's own increment steps past the last one
      if (run.length > 1) {
        // keyed by the run's own markers, so a pinch survives the re-render that follows
        // ticking a checkbox elsewhere in the entry
        const key = run.join("|");
        const gal = el("div", { class: "rt-gallery" + (stackedRuns.has(key) ? " stacked" : "") });
        for (const r of run) gal.appendChild(renderRich(r, images, onResize));
        attachGalleryPinch(gal, key);
        // the fades hang off a wrapper so they don't scroll away with the images
        const galWrap = el("div", { class: "rt-gal-wrap" }, gal);
        attachGalleryFade(galWrap, gal);
        attachGalleryDrag(gal);
        // three or more is where the row stops fitting and starts scrolling (two are sized to
        // fill the width exactly — see .rt-gallery:has(> :nth-child(2):last-child)). Below that
        // there is nothing to page through, so the arrows would be decoration.
        if (run.length >= 3) attachGalleryNav(galWrap, gal);
        frag.appendChild(galWrap);
        continue;
      }
      frag.appendChild(el("div", { class: "rt-line" }, renderRich(run[0], images, onResize)));
      continue;
    }
    const m = /^([ \t]*)([-—] )?(.*)$/.exec(line);
    const ind = Math.floor(m[1].replace(/\t/g, "  ").length / 2);
    const check = m[2] ? CHECK_RE.exec(m[3]) : null;              // "[ ] label" inside a bullet
    // an indented line (that isn't a bullet) reads as a blockquote — a quiet left bar.
    // it's driven purely by the leading indent, so backspacing the indent away removes it.
    const quote = ind >= 1 && !m[2];
    const row = el("div", { class: "rt-line" + (m[2] ? " rt-bullet" : "") + (quote ? " rt-quote" : "")
      + (check ? " rt-check" + (isDoneMark(check[1]) ? " done" : "") : "") });
    if (ind) row.style.setProperty("--ind", ind);
    if (check) {
      const day = dayFromMark(check[1]);
      const on = isDoneMark(check[1]);
      const box = el("span", {
        class: "rt-box" + (on ? " on" : "") + (day == null ? "" : " rt-box-day"),
        role: "checkbox", "aria-checked": String(on)
      });
      // only when there IS a day to name — el() stringifies whatever it is given, so passing
      // undefined through the attrs above would set the literal text "undefined"
      if (day != null) box.setAttribute("aria-label", "done " + DAY_NAMES[day]);
      // the day takes the tick's place inside the same filled circle — same box, same fill,
      // different glyph. The token is drawn the way the day badge draws it (T with a raised 1)
      // so the two never disagree about what Tuesday looks like.
      if (day != null) {
        const tok = DAY_TOKENS[day], sup = tok.match(/^(.)([\u00B9\u00B2])$/);
        if (sup) { box.appendChild(document.createTextNode(sup[1]));
                   box.appendChild(el("sup", null, sup[2] === "\u00B9" ? "1" : "2")); }
        else box.textContent = tok;
      } else if (on) box.innerHTML = CHECK_ICON;
      if (onCheck) {
        const idx = li; // captured per row so the right line toggles
        box.classList.add("live");
        box.addEventListener("click", ev => { ev.stopPropagation(); onCheck(idx, on ? " " : "x"); });
        // long-press the circle for the day strip — see attachMarkPress
        attachMarkPress(box, mark => onCheck(idx, mark), check[1]);
      }
      row.appendChild(box);
      const body = el("span", { class: "rt-body" });
      body.appendChild(renderRich(check[2], images, onResize));
      row.appendChild(body);
    } else if (m[2]) {
      row.appendChild(el("span", { class: "rt-dot" }, "•"));
      const body = el("span", { class: "rt-body" });
      body.appendChild(renderRich(m[3], images, onResize));
      row.appendChild(body);
    } else {
      row.appendChild(renderRich(m[3], images, onResize));
    }
    frag.appendChild(row);
  }
  return frag;
}
