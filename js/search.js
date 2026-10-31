// Search.

import { currentWk } from "./state.js";
import { el } from "./dom.js";
import { DAY_TOKENS, modeById, tone, topicById } from "./taxonomy.js";
import { entryDay, pad2 } from "./dates.js";
import { RICH_RE } from "./richtext.js";
import { openComposer } from "./composer.js";

// ---------- search ----------
// flatten raw text into display segments: bold flagged (for the highlight rule),
// redacted content replaced with a mask so search results can never unveil it
function segmentText(raw) {
  const segs = [];
  let last = 0, m;
  RICH_RE.lastIndex = 0;
  while ((m = RICH_RE.exec(raw))) {
    if (m.index > last) segs.push({ t: raw.slice(last, m.index) });
    if (m[1] != null) segs.push({ t: m[1] });                     // link: show its label as plain text
    else if (m[3] != null) segs.push({ t: m[3], bold: true });
    else if (m[7] != null) segs.push({ t: "▓▓▓", redacted: true });
    else if (m[8] != null) segs.push({ t: "" });                  // image: nothing to show in a text snippet
    else segs.push({ t: m[4] != null ? m[4] : (m[5] != null ? m[5] : m[6]) }); // italic/underline/mono: plain in snippets
    last = m.index + m[0].length;
  }
  if (last < raw.length) segs.push({ t: raw.slice(last) });
  return segs;
}

// truncated snippet centred on the first match; every match in the window is
// bolded — or underlined when it sits inside already-bold text
export function searchResultEl(e, q) {
  const segs = segmentText(e.text);
  const disp = segs.map(s => s.t).join("");
  const lower = disp.toLowerCase();
  const ranges = [];
  if (q) {
    let idx = 0;
    while ((idx = lower.indexOf(q, idx)) !== -1) { ranges.push([idx, idx + q.length]); idx += q.length; }
  }
  const first = ranges.length ? ranges[0][0] : 0;
  let start = Math.max(0, first - 34);
  if (start > 0) {
    const sp = disp.indexOf(" ", start);
    if (sp !== -1 && sp < first) start = sp + 1; // snap to a word boundary
  }
  const end = Math.min(disp.length, start + 120);

  const p = el("p", { class: "search-snippet" });
  if (start > 0) p.appendChild(document.createTextNode("…"));
  let off = 0;
  for (const s of segs) {
    const sStart = off, sEnd = off + s.t.length;
    off = sEnd;
    if (sEnd <= start || sStart >= end) continue;
    const from = Math.max(sStart, start), to = Math.min(sEnd, end);
    const emit = (a, b, hl) => {
      if (b <= a) return;
      const txt = disp.slice(a, b);
      if (hl) p.appendChild(el("span", { class: s.bold ? "rt-b hl-b" : "hl" }, txt));
      else if (s.bold) p.appendChild(el("span", { class: "rt-b" }, txt));
      else if (s.redacted) p.appendChild(el("span", { class: "snip-mask" }, txt));
      else p.appendChild(document.createTextNode(txt));
    };
    let cur = from;
    for (const [a, b] of ranges) {
      const ia = Math.max(a, cur), ib = Math.min(b, to);
      if (ib <= ia) continue;
      emit(cur, ia, false);
      emit(ia, ib, true);
      cur = ib;
    }
    emit(cur, to, false);
  }
  if (end < disp.length) p.appendChild(document.createTextNode("…"));

  const entry = el("div", { class: "entry", onclick: () => openComposer(e) });
  entry.appendChild(p);
  const meta = el("div", { class: "entry-meta" });
  const d = entryDay(e);
  const bits = [];
  if (d != null) bits.push(DAY_TOKENS[d]);
  if (e.week != null) bits.push("W" + pad2(e.week));
  else bits.push(new Date(e.year, e.month, 1).toLocaleDateString("en-SG", { month: "short" })); // month-scoped
  if (e.year !== currentWk.year) bits.push(String(e.year));
  meta.appendChild(el("span", { class: "entry-day" }, bits.join(" · ")));
  for (const tg of e.tags) {
    const tt = topicById[tg], mm = modeById[tg];
    if (tt) meta.appendChild(el("span", { class: "pill", style: { background: tone(tt).bg, color: tone(tt).fg } }, tt.label));
    else if (mm) meta.appendChild(el("span", { class: "pill mode" }, mm.label));
  }
  entry.appendChild(meta);
  return entry;
}
