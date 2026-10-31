// The weekly reveal: the monthly recap's lighter sibling.

import { S } from "./state.js";
import { el } from "./dom.js";
import { DAY_TOKENS, tone, topicById } from "./taxonomy.js";
import { entryDay, pad2, weekRangeLabel } from "./dates.js";
import { generateWeekSummary } from "./anthropic.js";
import { sentenceCase } from "./richtext.js";
import { summarySlot, weekKey, weekSummaries, weekSummaryVersions } from "./week-summary.js";
import { lockPageScroll } from "./viewport.js";
import { revealTextSize, storyDeck } from "./recap.js";

// ---------- the weekly reveal: openRecap's lighter sibling ----------
// a first reading of the week arrives here — four slow breaths, then it collapses to the
// quiet wsum line. same stories grammar (tap forward, tap the left edge to step back),
// fewer panels than the month, one crescendo, and no keep/let-go verdicts.
export function openWeekReveal(year, week, list, take) {
  const k = weekKey(year, week);
  // `take` lets you replay the reading behind a specific version (V1/V2/V3/MINE)
  // without touching which one is current — default is the week's current take.
  const rec = take || weekSummaries[k];
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  const range = weekRangeLabel(year, week);

  // days touched (0–6) and the week's top topics — all from the entries, no new AI
  const filled = new Set(list.map(entryDay).filter(d => d != null));
  const tally = {};
  list.forEach(e => (e.tags || []).forEach(tg => { if (topicById[tg]) tally[tg] = (tally[tg] || 0) + 1; }));
  const topTopics = Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([id]) => topicById[id]);

  // the plan — a thin week earns fewer cards
  const panels = ["cover", "shape"];
  if (topTopics.length >= 2) panels.push("topics");
  if (rec && rec.text) panels.push("summary");
  panels.push("still");
  const total = panels.length;

  lockPageScroll();
  let timer = null, raf = null, snap = null;
  function stopTimers() { clearTimeout(timer); clearInterval(timer); cancelAnimationFrame(raf); snap = null; }
  const deck = storyDeck({
    rootClass: "recap week", blobs: 2, label: "W" + pad2(week) + " · " + range, total,
    buildCard: i => buildCard(i),
    stopTimers,
    tapGuard: () => { // a tap mid count-up settles it instead of stepping on
      if (!snap) return false;
      snap(); // settle() clears snap itself
      return true;
    }
  });
  const { root, stage, show, close } = deck;

  // half the monthly's dust — the week earns a whisper, not the full burst
  function dustWhisper(c) {
    deck.dust(c.querySelector(".recap-head") || c, { count: 5, dx: 20, dyMin: -24, dyVar: 36, minH: 24 });
  }

  function buildCard(i) {
    const kind = panels[i];
    const c = el("div", { class: "recap-card" });

    if (kind === "cover") {
      c.appendChild(el("p", { class: "recap-head", style: { fontSize: "64px" } }, "W" + pad2(week)));
      c.appendChild(el("p", { class: "recap-sub" }, range));
      c.appendChild(el("p", { class: "recap-meta recap-ev-btn", style: { cursor: "pointer" } }, "tap to look back"));

    } else if (kind === "shape") {
      const num = el("p", { class: "wk-count" }, reduceMotion ? String(list.length) : "0");
      c.appendChild(num);
      c.appendChild(el("p", { class: "wk-count-label" }, list.length === 1 ? "deposit" : "deposits"));
      const days = el("div", { class: "wk-days" });
      DAY_TOKENS.forEach(tok => days.appendChild(el("span", null, tok)));
      c.appendChild(days);
      c.appendChild(el("p", { class: "wk-count-label", style: { marginTop: "18px", opacity: "0.85" } },
        filled.size + (filled.size === 1 ? " day" : " days") + " touched"));

      const order = DAY_TOKENS.map((_, di) => di).filter(di => filled.has(di));
      function lightDays() {
        let n = 0;
        (function step() {
          if (!days.isConnected || n >= order.length) return;
          days.children[order[n]].classList.add("on");
          n++;
          timer = setTimeout(step, 110);
        })();
      }
      if (reduceMotion) {
        order.forEach(di => days.children[di].classList.add("on"));
      } else {
        // numbers arriving, not spinning — ease-out expo, then the days light left→right
        const target = list.length, dur = 850, t0 = performance.now();
        const settle = () => { cancelAnimationFrame(raf); num.textContent = String(target); snap = null; lightDays(); };
        (function tick(now) {
          const p = Math.min(1, ((now || t0) - t0) / dur);
          num.textContent = String(Math.round((1 - Math.pow(2, -10 * p)) * target));
          if (p < 1) raf = requestAnimationFrame(tick); else settle();
        })(t0);
        snap = settle; // a tap mid count-up settles it instead of advancing
      }

    } else if (kind === "topics") {
      c.appendChild(el("p", { class: "recap-sub", style: { margin: "0 0 6px" } }, "you kept coming back to…"));
      const chips = el("div", { class: "wk-chips" });
      topTopics.forEach((t, ti) => {
        const chip = el("span", { class: "wk-chip" + (ti === 0 ? " lead" : ""),
          style: { background: tone(t).bg, color: tone(t).fg } }, t.label);
        chip.style.animationDelay = (0.15 + ti * 0.12) + "s";
        chips.appendChild(chip);
      });
      c.appendChild(chips);

    } else if (kind === "summary") {
      // 27px was tuned against a 2-3 sentence summary. A long one at that size overflowed
      // the screen in both directions; the stage scrolls now, but a reading you have to
      // scroll through isn't a reading. Step the size down so most summaries still land
      // whole, and let scrolling be the safety net rather than the reading experience.
      c.appendChild(el("p", { class: "recap-head", style: { fontSize: revealTextSize(rec.text) } },
        sentenceCase(rec.text)));
      // the one and only crescendo — a beat after the words settle, the world brightens
      timer = setTimeout(() => {
        if (!c.isConnected) return;
        root.classList.add("lit");
        if (!reduceMotion) dustWhisper(c);
      }, 750);

    } else { // still — the keepable final frame
      const still = el("div", { class: "wk-still" });
      still.appendChild(el("p", { class: "wk-still-num" }, "W" + pad2(week)));
      still.appendChild(el("p", { class: "wk-still-range" }, range));
      still.appendChild(el("p", { class: "wk-still-stat" },
        list.length + (list.length === 1 ? " deposit" : " deposits") + " · "
        + filled.size + (filled.size === 1 ? " day" : " days")));
      if (topTopics.length) {
        const dots = el("div", { class: "wk-still-dots" });
        topTopics.forEach(t => { const d = el("i"); d.style.background = tone(t).dot; dots.appendChild(d); });
        still.appendChild(dots);
      }
      if (rec && rec.text) {
        const first = sentenceCase(rec.text).split(/(?<=[.!?])\s+/)[0];
        still.appendChild(el("p", { class: "wk-still-line" }, first));
      }
      c.appendChild(still);

      const meta = el("div", { class: "recap-meta" });
      // every take the week holds — tap another to replay it (mirrors the wsum pill row)
      const slots = { ...(weekSummaryVersions[k] || {}) };
      if (rec) slots[summarySlot(rec)] = rec;
      const ids = Object.keys(slots).sort((a, b) =>
        ((a === "mine") - (b === "mine")) || (parseInt(a.slice(1), 10) - parseInt(b.slice(1), 10)));
      if (ids.length > 1) {
        // each take's own reading — tap to replay the reveal for that version. purely a
        // viewing switch: the week's current take (and the whole back-catalogue) is untouched.
        const pills = el("div", { style: { marginBottom: "14px" } });
        ids.forEach(id => {
          const on = rec && id === summarySlot(rec);
          pills.appendChild(el("span", {
            class: "wsum-pill" + (on ? " on" : ""),
            onclick: ev => {
              ev.stopPropagation();
              if (on) return;
              close();
              openWeekReveal(year, week, list, slots[id]);
            }
          }, id === "mine" ? "MINE" : id.toUpperCase()));
        });
        meta.appendChild(pills);
      }
      meta.appendChild(el("button", { class: "recap-ev-btn", style: { marginBottom: "8px" },
        onclick: ev => { ev.stopPropagation(); close(); } }, "done"));
      if (S.apiKey) meta.appendChild(el("button", {
        class: "recap-ev-btn",
        onclick: async ev => {
          ev.stopPropagation();
          close();
          await generateWeekSummary(year, week, list); // arrives as the next take
          openWeekReveal(year, week, list);
        }
      }, "read it again, fresh"));
      c.appendChild(meta);
    }
    return c;
  }

  document.body.appendChild(root);
  show(0);
}
