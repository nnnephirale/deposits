// Talking to Claude: the API key, short entry summaries, and cutting a ramble into deposits.

import { S } from "./state.js";
import { TOPICS, modeById, topicById } from "./taxonomy.js";
import { plainText } from "./richtext.js";
import { nextAiVersion, saveWeekRevealSeen, saveWeekSummaries, weekKey, weekRevealSeen, weekSummaries } from "./week-summary.js";
import { render } from "./render.js";
import { openWeekReveal } from "./week-reveal.js";

// ---------- summaries (zoomed-out view) ----------
// Entries over SUMMARY_MIN_WORDS get a short LLM summary, generated once in the
// background (on save, or backfilled from settings / on pinch) and cached on the
// entry. No key or no summary yet -> compact view falls back to first-words
// truncation. Key is user-supplied, stored only in this device's localStorage.
export const API_KEY_KEY = "weekly-deposits-anthropic-key";
export const SUMMARY_MIN_WORDS = 20;

// A ramble this long grows a quiet "break into deposits" offer in the composer.
// Segmentation cuts the entry into separate deposits at AI-found seams — the model
// only returns verbatim anchors, the app does the cutting, so the text is never
// rewritten. Needs the API key, like the week summary.
export const SEGMENT_MIN_LINES = 6;
export const SEGMENT_MIN_WORDS = 80;
S.apiKey = null;
try { S.apiKey = localStorage.getItem(API_KEY_KEY) || null; } catch (e) {}

export function wordCount(t) { return t.trim().split(/\s+/).length; }

// ---------- anthropic ----------
// one call shape for all three AI features. returns the assistant's text.
// note: find the text block rather than indexing content[0] — models that think before
// writing put thinking blocks first, so [0] is not the reply.
// A reading of a whole month, with the model thinking first, is slow — but not unbounded.
// Without a deadline a phone that loses signal mid-request leaves the promise pending for
// ever, and the in-flight guard above it never clears: every later tap on "read it again"
// then returns instantly and silently, and only a reload frees the month. That is exactly
// how a re-read came to look like a button that does nothing.
const TIMEOUT_AI = 180000;

function aiDeadline(ms) {
  if (typeof AbortSignal !== "undefined" && AbortSignal.timeout) return AbortSignal.timeout(ms);
  const c = new AbortController();
  setTimeout(() => c.abort(), ms);
  return c.signal;
}

async function anthropicRaw(body, ms = TIMEOUT_AI) {
  let r;
  try {
    r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": S.apiKey,
        "anthropic-version": "2023-06-01",
        "anthropic-dangerous-direct-browser-access": "true"
      },
      body: JSON.stringify(body),
      signal: aiDeadline(ms)
    });
  } catch (e) {
    if (e.name === "TimeoutError" || e.name === "AbortError") throw new Error("timed out after " + Math.round(ms / 1000) + "s");
    throw new Error("couldn't reach the api — " + (e.message || "no connection"));
  }
  if (!r.ok) {
    // The body says which it is: an expired key, a rate limit, a bad request. "api 400" on
    // its own has sent us looking for a console more than once.
    let detail = "";
    try { detail = ((JSON.parse(await r.text()).error) || {}).message || ""; } catch (e) {}
    throw new Error("api " + r.status + (detail ? ": " + detail : ""));
  }
  const data = await r.json();
  const block = (data.content || []).find(b => b.type === "text");
  return { text: ((block && block.text) || "").trim(), stop: data.stop_reason || null };
}

async function anthropic(body, ms) {
  return (await anthropicRaw(body, ms)).text;
}

// for the features that want JSON back — tolerates a model that wraps its reply in a
// ```json fence despite being told not to.
export async function anthropicJSON(body, ms) {
  const { text, stop } = await anthropicRaw(body, ms);
  // Truncation is fatal here in a way it isn't for a prose summary: half a JSON document
  // does not parse, and the parse error alone ("Unexpected end of JSON input") says nothing
  // about the cause. The model thinks before it writes and that thinking counts against
  // max_tokens, so this is what running out of room looks like — including the case where
  // it never got as far as a text block at all.
  if (stop === "max_tokens") throw new Error("ran out of room before it finished writing (max_tokens)");
  if (!text) throw new Error("came back empty" + (stop ? " (" + stop + ")" : ""));
  try {
    return JSON.parse(text.replace(/^```(json)?\s*/i, "").replace(/```\s*$/, "").trim());
  } catch (e) {
    throw new Error("didn't come back as json: " + text.slice(0, 80));
  }
}

export const weekSumInFlight = new Set();
export async function generateWeekSummary(year, week, list) {
  const k = weekKey(year, week);
  if (!S.apiKey || weekSumInFlight.has(k)) return;
  weekSumInFlight.add(k);
  try {
    const input = list.map(e => {
      const labels = e.tags.map(tg => (topicById[tg] || modeById[tg] || {}).label).filter(Boolean).join(", ");
      return "- " + plainText(e.text, "[…]") + (labels ? " (" + labels + ")" : "");
    }).join("\n");
    const s = await anthropic({
      model: "claude-haiku-4-5-20251001",
      max_tokens: 250,
      system: "You summarize a week of personal journal fragments into a 2-3 sentence recap. lowercase, plain and warm, mention concrete specifics from the fragments, no lists, no preamble, no filler like 'a busy week'. Reply with only the summary.",
      messages: [{ role: "user", content: input }]
    });
    if (!s) return;
    // version tracks AI takes only: first take is V1, each re-summarize bumps it —
    // counted across the week's whole back-catalogue so old takes are never overwritten
    const version = nextAiVersion(k);
    const nowIso = new Date().toISOString();
    weekSummaries[k] = { text: s, createdAt: nowIso, updatedAt: nowIso, edited: false, origin: "ai", version };
    saveWeekSummaries();
  } catch (err) {
    console.warn("week summary failed", err); // the wand comes back on re-render — tap to retry
  } finally {
    weekSumInFlight.delete(k);
    if (S.view === "week" && S.wk.year === year && S.wk.week === week) {
      render();
      // the very first reading of a week doesn't just appear as a line — it's revealed,
      // Wrapped-style. once seen, the week falls back to the quiet inline summary.
      if (weekSummaries[k] && !weekRevealSeen.has(k)) {
        weekRevealSeen.add(k); saveWeekRevealSeen();
        setTimeout(() => openWeekReveal(year, week, list), 80); // let the render settle first
      }
    }
  }
}

// ---------- ramble segmentation ----------
// breaks one long entry into several deposits. the model never writes anything: it only
// returns the verbatim first words of each proposed segment (plus a topic guess), and the
// app cuts the original string itself — so every deposit is exactly her words. anchors
// that can't be found verbatim simply dissolve into the previous segment.
function segmentAnchorsToRanges(text, items) {
  // whitespace/case-insensitive verbatim search: normalize the haystack once,
  // keeping a map from each normalized char back to its original index
  const map = []; let norm = "";
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (/\s/.test(c)) {
      if (!norm || norm.endsWith(" ")) continue;
      norm += " "; map.push(i);
    } else {
      norm += c.toLowerCase(); map.push(i);
    }
  }
  const starts = [{ at: 0, topic: null }]; // segment 1 always starts at the very beginning
  let from = 0;
  items.forEach((it, i) => {
    const topic = topicById[it.topic] ? it.topic : null;
    const nq = String(it.first_words || "").toLowerCase().replace(/\s+/g, " ").trim();
    if (!nq) return;
    const at = norm.indexOf(nq, from);
    if (at === -1) return;
    from = at + nq.length;
    const last = starts[starts.length - 1];
    if (i === 0 || map[at] <= last.at) {
      if (!last.topic) last.topic = topic; // seam collapses into the previous segment
      return;
    }
    starts.push({ at: map[at], topic });
  });
  return starts
    .map((s, i) => ({ start: s.at, end: i + 1 < starts.length ? starts[i + 1].at : text.length, topic: s.topic }))
    .filter(rg => text.slice(rg.start, rg.end).trim());
}

export async function segmentRamble(text) {
  const topicList = TOPICS.map(t => t.id + " (" + t.label + ")").join(", ");
  const parsed = await anthropicJSON({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 600,
    system: "You segment one long journal ramble into 2-6 self-contained deposits. Never rewrite, reorder, summarize or add words — you only decide where one thought ends and the next begins. Cut at genuine shifts of subject; prefer fewer, meatier segments over many tiny ones. Reply with only strict JSON, no code fences: {\"segments\":[{\"first_words\":string,\"topic\":string|null}]}. first_words is the exact first 4-8 words of that segment, copied verbatim from the input including punctuation and markdown markers. The first segment starts at the very beginning of the input. topic is the single best-fitting id from [" + topicList + "], or null if none fits.",
    messages: [{ role: "user", content: text }]
  });
  const list = Array.isArray(parsed) ? parsed : parsed.segments;
  if (!Array.isArray(list) || !list.length) throw new Error("bad segments payload");
  return segmentAnchorsToRanges(text, list);
}
