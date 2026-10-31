// The monthly recap: the takes, the title, the story deck and the reveal.

import { S } from "./state.js";
import { el, safeTop } from "./dom.js";
import { modeById, topicById } from "./taxonomy.js";
import { entryDateStr, entryDay, pad2 } from "./dates.js";
import { anthropicJSON } from "./anthropic.js";
import { plainText, truncateWords } from "./richtext.js";
import { weekSummaries } from "./week-summary.js";
import { entriesForMonth } from "./grouping.js";
import { render } from "./render.js";
import { lockPageScroll, unlockPageScroll } from "./viewport.js";

// ---------- monthly recap: the month, read back ----------
// one sonnet call reads the whole month and returns observation cards, each citing
// the entry ids it grew from. cards that can't cite don't survive — the app drops
// them before she ever sees one. verdicts (keep / let it go) are stored and fed to
// the next month's reading, so the AI learns what rings true. device-local for now
// (a recap is regenerable, so losing it costs one api call, not data).
const RECAP_KEY = "weekly-deposits-month-recaps";
export const RECAP_MIN_ENTRIES = 5;
export let monthRecaps = {};
try { monthRecaps = JSON.parse(localStorage.getItem(RECAP_KEY)) || {}; } catch (e) {}
// a month now holds TAKES (V1, V2… like the weekly pills) — normalize any recap
// saved under the original flat single-take shape
for (const [mk_, r_] of Object.entries(monthRecaps)) {
  if (r_ && r_.cards) monthRecaps[mk_] = {
    cur: 0,
    takes: [{ version: 1, cards: r_.cards, title: r_.title, verdicts: r_.verdicts || {}, createdAt: r_.createdAt }]
  };
}
function saveMonthRecaps() {
  try { localStorage.setItem(RECAP_KEY, JSON.stringify(monthRecaps)); } catch (e) {}
}
// ---------- the takes, and the cut ----------
// A reading is generated; the cut is chosen. Every card she kept, from every reading of the
// month, gathered into one — which is the version worth keeping once three takes have each
// found two good things and four she let go.

export function currentRecapTake(rec) {
  if (!rec || !rec.takes) return null;
  if (rec.showCut) { const cut = keptTake(rec); if (cut) return cut; }
  return rec.takes[rec.cur] || null;
}

/** The month's kept cards, deduped, in the order they were written. Null when nothing has
 *  been kept yet — there is no cut of an undecided month. */
function keptTake(rec) {
  if (!rec || !rec.takes) return null;
  const cards = [], srcs = [], seen = new Set();
  rec.takes.forEach(t => {
    (t.cards || []).forEach((cd, ci) => {
      if ((t.verdicts || {})[ci] !== "keep") return;
      // the same observation kept in two readings is one card, not two. Her rewordings are
      // already on the card object itself, so the cut shows her words, not the model's.
      const key = (cd.headline || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
      if (seen.has(key)) return;
      seen.add(key);
      cards.push(cd);
      srcs.push({ take: t, ci });   // so a verdict changed here writes back to its reading
    });
  });
  if (!cards.length) return null;
  // A cut is not a reading and does not get a title of its own; it borrows the newest one.
  const titled = [...rec.takes].reverse().find(t => takeTitle(t));
  return { version: "kept", cut: true, cards, srcs, verdicts: {}, title: titled ? takeTitle(titled) : "" };
}

/** How many cards the cut would hold — for the pill, without building it. */
function keptCount(rec) {
  if (!rec || !rec.takes) return 0;
  const seen = new Set();
  rec.takes.forEach(t => (t.cards || []).forEach((cd, ci) => {
    if ((t.verdicts || {})[ci] !== "keep") return;
    seen.add((cd.headline || "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim());
  }));
  return seen.size;
}

// ---------- the title, which is its own small thing ----------
// The one-liner is the part most worth another roll and the part least worth waiting for a
// whole re-reading to get. A take keeps every title it has been given; `title` stays in step
// with the current one so nothing else has to know about the list.

function takeTitle(take) {
  if (!take) return "";
  if (take.titles && take.titles.length) return take.titles[take.titleCur || 0] || "";
  return take.title || "";
}

function setTakeTitle(take, i) {
  if (!take.titles || !take.titles.length) return;
  take.titleCur = ((i % take.titles.length) + take.titles.length) % take.titles.length;
  take.title = take.titles[take.titleCur];
}

function addTakeTitle(take, title) {
  if (!take.titles) take.titles = take.title ? [take.title] : [];
  take.titles.push(title);
  setTakeTitle(take, take.titles.length - 1);
}
export function monthKey(year, month) { return year + "-M" + pad2(month + 1); }
export function monthNameOf(year, month) {
  return new Date(year, month, 1).toLocaleDateString("en-SG", { month: "long" });
}

// loading verbs, claude-code style — one at random while the month is being read
const LOADING_VERBS = ["Accomplishing","Actioning","Actualizing","Architecting","Baking","Beaming","Beboppin'","Befuddling","Billowing","Blanching","Bloviating","Boogieing","Boondoggling","Booping","Bootstrapping","Brewing","Burrowing","Calculating","Canoodling","Caramelizing","Cascading","Catapulting","Cerebrating","Channelling","Choreographing","Churning","Clauding","Coalescing","Cogitating","Composing","Computing","Concocting","Considering","Contemplating","Cooking","Crafting","Creating","Crystallizing","Cultivating","Crunching","Deciphering","Deliberating","Dilly-dallying","Discombobulating","Doodling","Drizzling","Ebbing","Effecting","Elucidating","Embellishing","Enchanting","Envisioning","Evaporating","Fermenting","Fiddle-faddling","Finagling","Flambéing","Flibbertigibbeting","Flowing","Flummoxing","Fluttering","Forging","Forming","Frosting","Frolicking","Gallivanting","Galloping","Garnishing","Generating","Germinating","Gitifying","Grooving","Gusting","Harmonizing","Hashing","Hatching","Herding","Hibernating","Honking","Hullaballooing","Hyperspacing","Ideating","Imagining","Improvising","Incubating","Inferring","Infusing","Ionizing","Jitterbugging","Julienning","Kneading","Leavening","Levitating","Lollygagging","Manifesting","Marinating","Meandering","Metamorphosing","Misting","Moonwalking","Moseying","Mulling","Mustering","Musing","Nebulizing","Nesting","Noodling","Nucleating","Orbiting","Orchestrating","Osmosing","Perambulating","Percolating","Perusing","Philosophising","Photosynthesizing","Pollinating","Pontificating","Pondering","Pouncing","Precipitating","Prestidigitating","Processing","Proofing","Propagating","Puttering","Puzzling","Quantumizing","Razzle-dazzling","Razzmatazzing","Recombobulating","Reticulating","Roosting","Ruminating","Sautéing","Scampering","Scheming","Schlepping","Scurrying","Seasoning","Shenaniganing","Shimmying","Simmering","Skedaddling","Sketching","Slithering","Smooshing","Sock-hopping","Spelunking","Spinning","Sprouting","Stewing","Sublimating","Sussing","Swirling","Swooping","Symbioting","Synthesizing","Tempering","Thinking","Thundering","Tinkering","Tomfoolering","Topsy-turvying","Transfiguring","Transmuting","Twisting","Undulating","Unfurling","Unravelling","Vibing","Waddling","Wandering","Warping","Whatchamacalliting","Whirlpooling","Whirring","Whisking","Wibbling","Working","Wrangling","Zesting","Zigzagging"];

// strict schema — the api guarantees the reply parses; grounding is still checked app-side
const RECAP_SCHEMA = {
  type: "object",
  properties: {
    cards: {
      type: "array",
      items: {
        type: "object",
        properties: {
          headline: { type: "string" },
          support: { type: "string" },
          evidence: { type: "array", items: { type: "string" } },
          earned: { type: "boolean" }
        },
        required: ["headline", "support", "evidence", "earned"],
        additionalProperties: false
      }
    },
    title: { type: "string" }
  },
  required: ["cards", "title"],
  additionalProperties: false
};

const RECAP_SYSTEM = "You are reading one month of Marilyn's personal journal entries to write her monthly recap: a handful of observations that show her the month's patterns — things she might not have noticed herself. Rules: 3 to 8 cards; a thin or scattered month earns fewer, and when no single thread runs through the month it is fine for the cards to be small specific moments instead of themes. Every card must be grounded in specific entries and cite 1-4 of their ids in evidence — an observation you cannot cite must not be written. headline is one short sentence, an observation rather than a statistic. support is 1-3 short lines expanding it; borrowing her own words is good. earned is true on at most 2 cards that deserve a moment of weight — a real shift, a milestone, something worth sitting with — and false on everything else. title is what the month would be called if it had a title: a short phrase (2-6 words) only this month could produce, defensible from the entries. Voice: plain, concrete, warm but dry, written in sentence case with normal capitalization. Never use: quietly, gently, softly, simply, truly, journey, chapter, embrace, whirlwind. No exclamation marks, no horoscope vagueness — name the actual things. When her past reactions are provided (kept, let go, rewrote, notes), her rewordings and notes are the standard to write toward — never repeat an observation she let go or rewrote.";

// one line per card she reacted to — verdicts, rewrites, and notes teach the next reading
function recapTakeLines(take, onlyReacted) {
  const out = [];
  (take.cards || []).forEach((cd, i) => {
    const v = (take.verdicts || {})[i];
    if (onlyReacted && !v && !cd.original && !cd.feedback) return;
    let line = cd.original
      ? '- "' + cd.original.headline + '" — she rewrote it to: "' + cd.headline + '"'
      : '- "' + cd.headline + '"';
    const notes = [];
    if (v === "keep") notes.push("kept");
    if (v === "letgo") notes.push("let go — this one missed");
    if (cd.feedback) notes.push("her note: " + cd.feedback);
    if (notes.length) line += " (" + notes.join("; ") + ")";
    out.push(line);
  });
  return out;
}

export const recapInFlight = new Set();
export const recapErrors = {};   // month key -> why the last reading didn't happen

// ---------- rerolling just the title ----------
// A whole re-reading is a minute of waiting and a few cents; the one-liner is one sentence.
// Same model as the reading it belongs to, so the voice matches — this is a second attempt
// at one line of that reading, not a cheaper substitute for it.

const TITLE_SCHEMA = {
  type: "object",
  properties: { title: { type: "string" } },
  required: ["title"],
  additionalProperties: false
};

const titleInFlight = new Set();

/** Another name for the month. Returns the new title, or throws with something sayable. */
async function rerollTitle(year, month, take) {
  const k = monthKey(year, month);
  if (!S.apiKey || titleInFlight.has(k)) return null;
  titleInFlight.add(k);
  try {
    // the reading itself is the brief — the title has to be defensible from these cards,
    // and they are a fraction of the month's text, so this call is small
    const cards = take.cards.map(cd => "- " + cd.headline + (cd.support ? " — " + cd.support : "")).join("\n");
    const past = (take.titles && take.titles.length ? take.titles : [take.title]).filter(Boolean);
    const parsed = await anthropicJSON({
      model: "claude-sonnet-5",
      max_tokens: 2000,   // it thinks first, and that counts against this
      output_config: { format: { type: "json_schema", schema: TITLE_SCHEMA } },
      system: "You name one month of Marilyn's personal journal, given the observations already written about it. "
        + "The title is what the month would be called if it had one: a short phrase, 2 to 6 words, that only this "
        + "month could produce and that is defensible from the observations. Sentence case. Plain, concrete, warm "
        + "but dry. Never use: quietly, gently, softly, simply, truly, journey, chapter, embrace, whirlwind. No "
        + "exclamation marks, no horoscope vagueness. Reply with only the title.",
      messages: [{ role: "user", content: "THE MONTH: " + monthNameOf(year, month) + " " + year
        + "\n\nTHE OBSERVATIONS:\n" + cards
        + (past.length ? "\n\nALREADY USED — write a different one, not a rewording of these:\n" + past.map(t => "- " + t).join("\n") : "") }]
    }, 60000);
    const title = String(parsed.title || "").trim();
    if (!title) throw new Error("came back empty");
    return title;
  } finally {
    titleInFlight.delete(k);
  }
}
export async function startMonthRecap(year, month) {
  const k = monthKey(year, month);
  if (!S.apiKey || recapInFlight.has(k)) return;
  delete recapErrors[k];
  recapInFlight.add(k);
  if (S.view === "month") render(); // the "reading…" line appears
  try {
    const list = entriesForMonth(year, month);
    const lines = list.map(e => {
      const labels = e.tags.map(tg => (topicById[tg] || modeById[tg] || {}).label).filter(Boolean).join(", ");
      const when = e.week == null ? "month-wide"
        : (entryDay(e) != null && entryDateStr(e)) ? entryDateStr(e) : "W" + pad2(e.week);
      return e.id + " | " + when + " | " + (labels || "untagged") + " | " + plainText(e.text, "[…]");
    });
    // her hand-written week summaries are the purest voice reference available
    const mine = Object.values(weekSummaries)
      .filter(r => r.origin === "mine" && r.text).slice(-5).map(r => "- " + r.text);
    // her reactions teach the reading: last month's take, and — on a re-read —
    // every earlier take of this same month
    const pm = month === 0 ? { year: year - 1, month: 11 } : { year, month: month - 1 };
    const prevTake = currentRecapTake(monthRecaps[monthKey(pm.year, pm.month)]);
    let feedback = "";
    if (prevTake) {
      const pl = recapTakeLines(prevTake, true);
      if (pl.length) feedback += "\n\nLAST MONTH'S READING — HER REACTIONS:\n" + pl.join("\n");
    }
    const thisRec = monthRecaps[k];
    if (thisRec && thisRec.takes.length) {
      feedback += "\n\nTHIS IS A RE-READ. EARLIER READINGS OF THIS SAME MONTH:";
      thisRec.takes.forEach(t => {
        feedback += "\nV" + t.version + ":\n" + recapTakeLines(t, false).join("\n");
      });
      feedback += "\nWrite a genuinely fresh take — different angles, not the same cards reworded.";
    }
    const input = "THE MONTH: " + monthNameOf(year, month) + " " + year
      + "\n\nENTRIES (id | when | topics | text):\n" + lines.join("\n")
      + (mine.length ? "\n\nHER OWN WORDS, FOR VOICE (week summaries she wrote herself):\n" + mine.join("\n") : "")
      + feedback;

    const parsed = await anthropicJSON({
      model: "claude-sonnet-5", // reads a month better than haiku; one call a month, a few cents
      // Sonnet 5 thinks before it writes and that thinking counts against this, so the cap is
      // not "how long is the reading" but "thinking plus the reading". 6000 was enough for a
      // first take of a quiet month and not for August: a re-read carries every earlier take
      // back in as feedback, so each version has more to read and more to avoid repeating,
      // and V3 was the one that ran out. Truncated JSON does not parse, and the failure was a
      // console warning on a phone.
      max_tokens: 16000,
      output_config: { format: { type: "json_schema", schema: RECAP_SCHEMA } },
      system: RECAP_SYSTEM,
      messages: [{ role: "user", content: input }]
    });

    // grounding pass: evidence ids must resolve to real entries; snapshots of her words
    // are stored on the card so a later edit/delete never breaks a saved recap
    const byId = new Map(list.map(e => [e.id, e]));
    const cards = (parsed.cards || []).map(cd => ({
      headline: String(cd.headline || "").trim(),
      support: String(cd.support || "").trim(),
      earned: !!cd.earned,
      evidence: [...new Set(cd.evidence || [])].map(id => byId.get(id)).filter(Boolean)
        .map(e => ({ id: e.id, text: truncateWords(plainText(e.text, "▓▓▓"), 28) }))
    })).filter(cd => cd.headline && cd.evidence.length); // can't cite it → she never sees it
    let earnedCount = 0; // spectacle budget enforced here, not left to the model's enthusiasm
    for (const cd of cards) if (cd.earned && ++earnedCount > 2) cd.earned = false;
    if (!cards.length) throw new Error("no grounded cards");

    // a new reading never replaces an old one — it lands as the next take (V2, V3…)
    const rec = monthRecaps[k];
    const version = rec ? Math.max(...rec.takes.map(t => t.version || 1)) + 1 : 1;
    const t0 = String(parsed.title || "").trim();
    const take = { version, cards, title: t0, titles: t0 ? [t0] : [], titleCur: 0,
                   createdAt: new Date().toISOString(), verdicts: {} };
    if (rec) { rec.takes.push(take); rec.cur = rec.takes.length - 1; rec.showCut = false; }
    else monthRecaps[k] = { cur: 0, takes: [take] };
    saveMonthRecaps();
    if (S.view === "month" && S.mo.year === year && S.mo.month === month) openRecap(year, month);
  } catch (err) {
    console.warn("month recap failed", err);
    // and say so on the screen she is looking at. Every failure here used to be a warning in
    // a console she would need a Mac and a cable to read, so a reading that failed and a
    // reading that never started looked identical: nothing happened.
    recapErrors[k] = (err && err.message) || "something went wrong";
  } finally {
    recapInFlight.delete(k);
    if (S.view === "month" && S.mo.year === year && S.mo.month === month) render();
  }
}

// month view: nothing but the "still reading…" line while one is being written. The control
// itself moved out to the chevron under the period — see syncWrappedCue in bloom.js.
export function monthRecapBlock(list) {
  const k = monthKey(S.mo.year, S.mo.month);
  if (recapInFlight.has(k)) {
    // claude-code style: a random loading verb, swapped every couple of seconds
    const wrap = el("div", { class: "wsum" });
    const p = el("p", { class: "wsum-text pending" });
    const tick = () => { p.textContent = LOADING_VERBS[Math.floor(Math.random() * LOADING_VERBS.length)] + "…"; };
    tick();
    const t = setInterval(() => { if (!p.isConnected) { clearInterval(t); return; } tick(); }, 2200);
    wrap.appendChild(p);
    return wrap;
  }
  const failed = recapErrors[k];
  if (failed) {
    const wrap = el("div", { class: "wsum" });
    wrap.appendChild(el("p", { class: "wsum-text recap-failed" }, "the reading didn't come back \u2014 " + failed));
    wrap.appendChild(el("button", { class: "wsum-pill", onclick: () => {
      delete recapErrors[k];
      startMonthRecap(S.mo.year, S.mo.month);
    } }, "try again"));
    return wrap;
  }
  // the month's wand lived here; the chevron under the period is the door now. Nothing
  // else in this block was ever visible, so in the settled case it renders nothing at all.
  return null;
}

// A reveal's body type steps down with its length, so a rambling summary still lands on one
// screen instead of running off both edges. Keyed off the available height as well as the
// character count — the same 900-character summary is a wall on a phone and comfortable in a
// desktop window. Bounded at both ends: never bigger than the 27px the short ones were tuned
// at, never below 15px, where the serif stops being a voice and starts being fine print.
export function revealTextSize(text) {
  const chars = (text || "").length;
  if (!chars) return "27px";
  const w = Math.min(460, window.innerWidth - 60);      // .recap-card's real measure
  // the stage minus its own padding — and the status bar, which innerHeight now includes
  const room = Math.max(360, window.innerHeight - safeTop() - 190);
  // this serif averages ~0.5em a character and .recap-head sets 1.22 line-height, so
  //   height ≈ (chars · 0.5f / w) · 1.22f   →   f = √(w · room / (0.61 · chars))
  const fit = Math.sqrt((w * room) / (0.61 * chars));
  return Math.round(Math.max(15, Math.min(27, fit))) + "px";
}

// ---------- the story deck ----------
// the chrome both reveals share: blobs/veil/grain, the dash progress row with its label and
// close ×, the stage, and the stories tap grammar (left 22% steps back, anywhere else
// forward). the caller owns what a card looks like and what its timers are.
//   opts: { rootClass, blobs, label, total, buildCard(i), stopTimers(), tapGuard(), again() }
// again, when given, adds a second control beside the × — see the arming comment below.
// tapGuard returns true to swallow a tap (a long-press that opened an editor, a count-up
// that a tap should settle instead of advancing). the deck is NOT shown until show(0).
export function storyDeck(opts) {
  const root = el("div", { class: opts.rootClass });
  for (let i = 1; i <= opts.blobs; i++) root.appendChild(el("div", { class: "recap-blob b" + i }));
  root.appendChild(el("div", { class: "recap-veil" }));
  root.appendChild(el("div", { class: "recap-grain" }));

  const dashes = el("div", { class: "recap-dashes" });
  for (let i = 0; i < opts.total; i++) dashes.appendChild(el("span"));
  // The right-hand controls live in one group so the dashes stay centred however many
  // there are. `again` is the month's "read it again, fresh", which until now existed only
  // on the end card — three or four swipes in, which is a long way to go for a control you
  // are looking for by name.
  const acts = el("div", { class: "recap-acts" });
  if (opts.again) {
    // Two taps. It sits a thumb's width from the × and it spends an API call, so a single
    // mis-tap must not start a reading. The arming lapses on its own rather than staying
    // armed behind her while she reads.
    let armed = null;
    const again = el("button", { class: "recap-again", "aria-label": "Read it again, fresh",
      onclick: ev => {
        ev.stopPropagation();
        if (armed) { clearTimeout(armed); opts.again(); return; }
        again.textContent = "again?";
        again.classList.add("armed");
        armed = setTimeout(() => {
          armed = null;
          if (!again.isConnected) return;
          again.textContent = "\u21BB";
          again.classList.remove("armed");
        }, 3200);
      } }, "\u21BB");
    acts.appendChild(again);
  }
  acts.appendChild(el("button", { class: "recap-x", "aria-label": "Close", onclick: ev => { ev.stopPropagation(); close(); } }, "\u00D7"));

  root.appendChild(el("div", { class: "recap-top" },
    el("span", { class: "recap-month" }, opts.label),
    dashes,
    acts
  ));

  const stage = el("div", { class: "recap-stage" });
  root.appendChild(stage);

  // The dashes are the one thing at the top of a stories deck that already means "where am
  // I in this" — so they are also where "which of these am I reading" belongs. Tapping them
  // drops the list of versions, the cut among them, without swiping to either end of a deck
  // to find a pill. `versions` is optional: a deck that has only one never grows the affordance.
  let verMenu = null;
  function closeVersions() { if (verMenu) { verMenu.remove(); verMenu = null; dashes.classList.remove("open"); } }
  function toggleVersions() {
    if (verMenu) return closeVersions();
    const items = (opts.versions && opts.versions()) || [];
    if (!items.length) return;
    dashes.classList.add("open");
    verMenu = el("div", { class: "recap-vermenu", onclick: ev => ev.stopPropagation() });
    items.forEach(it => verMenu.appendChild(el("button", {
      class: "recap-verrow" + (it.on ? " on" : ""),
      onclick: ev => { ev.stopPropagation(); closeVersions(); it.pick(); }
    }, it.label)));
    root.appendChild(verMenu);
  }
  if (opts.versions) {
    dashes.classList.add("pickable");
    dashes.setAttribute("role", "button");
    dashes.setAttribute("tabindex", "0");
    dashes.setAttribute("aria-label", "Which version");
    dashes.addEventListener("click", ev => { ev.stopPropagation(); toggleVersions(); });
    dashes.addEventListener("keydown", ev => {
      if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); toggleVersions(); }
    });
  }

  let idx = 0, card = null;
  const stopTimers = () => { if (opts.stopTimers) opts.stopTimers(); };

  function close() { stopTimers(); closeVersions(); root.remove(); unlockPageScroll(); }
  function setDashes() { Array.from(dashes.children).forEach((d, i) => d.classList.toggle("on", i <= idx)); }
  function show(i) {
    idx = Math.max(0, Math.min(opts.total - 1, i));
    setDashes();
    stopTimers();
    root.classList.remove("lit");
    if (card) {
      const old = card;
      old.classList.add("out"); // recedes while the next one arrives — nothing teleports
      setTimeout(() => old.remove(), 380);
    }
    card = opts.buildCard(idx);
    stage.appendChild(card);
  }

  // now that the stage scrolls, a swipe to read a long card must not also turn the page.
  // Same 4px rule the photo row already uses: past that it was a drag, not a tap.
  // the scrim under the top row is only earned once something is actually behind it
  stage.addEventListener("scroll", () => root.classList.toggle("scrolled", stage.scrollTop > 8),
    { passive: true });
  let tapX = 0, tapY = 0, tapDrag = false;
  stage.addEventListener("pointerdown", ev => { tapX = ev.clientX; tapY = ev.clientY; tapDrag = false; });
  stage.addEventListener("pointermove", ev => {
    if (Math.abs(ev.clientY - tapY) > 4 || Math.abs(ev.clientX - tapX) > 4) tapDrag = true;
  });
  stage.addEventListener("click", ev => {
    if (tapDrag) { tapDrag = false; return; }
    if (verMenu) { closeVersions(); return; }   // dismissing the list is not turning the page
    if (opts.tapGuard && opts.tapGuard()) return;
    const r = stage.getBoundingClientRect();
    if (ev.clientX - r.left < r.width * 0.22) { if (idx > 0) show(idx - 1); }
    else if (idx < opts.total - 1) show(idx + 1);
  });

  const deck = { root, stage, show, close, get idx() { return idx; } };
  // motes drifting off a card. the month bursts, the week whispers — same emitter,
  // different dose. anchor is resolved by the caller so each keeps its own fallback.
  deck.dust = (anchor, { count, dx, dyMin, dyVar, minH = 0 }) => {
    const r = anchor.getBoundingClientRect();
    for (let i = 0; i < count; i++) {
      const d = el("span", { class: "recap-dust" });
      d.style.left = (r.left + Math.random() * r.width) + "px";
      d.style.top = (r.top + Math.random() * Math.max(minH, r.height)) + "px";
      d.style.setProperty("--dx", (Math.random() * dx * 2 - dx) + "px");
      d.style.setProperty("--dy", (dyMin - Math.random() * dyVar) + "px");
      d.style.animationDelay = (Math.random() * 0.5) + "s";
      root.appendChild(d);
      setTimeout(() => d.remove(), 2700);
    }
  };
  return deck;
}

// ---------- the reveal itself ----------
export function openRecap(year, month) {
  const k = monthKey(year, month);
  const rec = monthRecaps[k];
  const take = currentRecapTake(rec); // the deck shows the current take (V1, V2…)
  if (!take || !take.cards || !take.cards.length) return;
  take.verdicts = take.verdicts || {};
  const monthName = monthNameOf(year, month);
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  lockPageScroll();
  const total = take.cards.length + 3; // intro + cards + title + end
  let titleTimer = null, editHeld = false;
  const deck = storyDeck({
    rootClass: "recap", blobs: 3, total,
    // which reading this is, when there is more than one. The V pills are on the end card;
    // the number belongs where you can see it from the first.
    label: monthName + " " + year
      + (take.cut ? " \u00B7 kept"
        : rec.takes.length > 1 ? " \u00B7 V" + (take.version || rec.cur + 1) : ""),
    buildCard: i => buildCard(i),
    // Every version of this month, from the dashes. Built when the list is opened so a
    // verdict changed a moment ago is already counted in "kept".
    versions: () => {
      const list = rec.takes.map((t, ti) => ({
        label: "V" + (t.version || ti + 1),
        on: !take.cut && ti === rec.cur,
        pick: () => { rec.cur = ti; rec.showCut = false; saveMonthRecaps(); close(); openRecap(year, month); }
      }));
      const n = keptCount(rec);
      if (n) list.push({
        label: "kept \u00B7 " + n,
        on: !!take.cut,
        pick: () => { rec.showCut = true; saveMonthRecaps(); close(); openRecap(year, month); }
      });
      return list.length > 1 ? list : [];
    },
    // No key, no reading — startMonthRecap would return silently, and a control that does
    // nothing is worse than one that isn't there.
    again: S.apiKey ? () => { close(); startMonthRecap(year, month); } : null,
    stopTimers: () => clearInterval(titleTimer),
    tapGuard: () => { // the tap that ended a long-press isn't a step
      if (!editHeld) return false;
      editHeld = false;
      return true;
    }
  });
  const { root, stage, show, close } = deck;
  stage.addEventListener("contextmenu", ev => ev.preventDefault()); // long-press belongs to the editor, not iOS

  function dustBurst(c) {
    const head = c.querySelector(".recap-head");
    if (!head) return;
    deck.dust(head, { count: 14, dx: 30, dyMin: -30, dyVar: 50 });
  }

  // long-press an observation card to reword it — with a field for telling claude
  // what didn't land. rewrites keep the original for teaching, notes feed the next reading.
  function holdToEdit(node, ci) {
    let t = null;
    node.addEventListener("pointerdown", () => {
      clearTimeout(t);
      t = setTimeout(() => { editHeld = true; openCardEditor(ci); }, 500);
    });
    ["pointerup", "pointerleave", "pointercancel"].forEach(evt =>
      node.addEventListener(evt, () => clearTimeout(t)));
  }
  function openCardEditor(ci) {
    const cd = take.cards[ci];
    const ov = el("div", { class: "overlay", style: { zIndex: "80" }, onclick: () => ov.remove() });
    const sheet = el("div", { class: "sheet", onclick: ev => ev.stopPropagation() });
    ov.appendChild(sheet);
    sheet.appendChild(el("div", { class: "grabber" }));
    sheet.appendChild(el("div", { class: "sheet-head" },
      el("span"),
      el("span", { class: "title" }, "Edit card"),
      el("button", {
        class: "save",
        onclick: () => {
          const h = taH.value.trim(), s = taS.value.trim(), f = taF.value.trim();
          if (h && (h !== cd.headline || s !== (cd.support || ""))) {
            cd.original = cd.original || { headline: cd.headline, support: cd.support }; // the AI's take, kept for teaching
            cd.headline = h;
            cd.support = s;
            cd.edited = true;
          }
          if (f) cd.feedback = f; else delete cd.feedback;
          saveMonthRecaps();
          ov.remove();
          show(deck.idx); // re-render the card in her wording
        }
      }, "Save")));
    sheet.appendChild(el("p", { class: "field-label", style: { marginTop: "6px" } }, "the observation"));
    const taH = el("textarea", { rows: "2", style: { minHeight: "56px" } });
    taH.value = cd.headline;
    sheet.appendChild(taH);
    sheet.appendChild(el("p", { class: "field-label" }, "supporting lines"));
    const taS = el("textarea", { rows: "3", style: { minHeight: "72px" } });
    taS.value = cd.support || "";
    sheet.appendChild(taS);
    sheet.appendChild(el("p", { class: "field-label" }, "tell claude"));
    const taF = el("textarea", { rows: "3", style: { minHeight: "72px" }, placeholder: "what didn't land about the original? this note teaches the next reading…" });
    taF.value = cd.feedback || "";
    sheet.appendChild(taF);
    if (cd.original) sheet.appendChild(el("p", { class: "settings-note" }, "originally: " + cd.original.headline));
    root.appendChild(ov);
  }

  function buildCard(i) {
    const c = el("div", { class: "recap-card" });
    if (i === 0) {
      // intro: nothing arrives immediately
      c.appendChild(el("p", { class: "recap-head", style: { fontSize: "44px" } }, monthName + ","));
      c.appendChild(el("p", { class: "recap-sub" }, take.cut ? "what you kept." : "read back."));
      c.appendChild(el("p", { class: "recap-meta recap-ev-btn", style: { cursor: "pointer" } }, "tap to begin"));

      // The cut and the readings are separate versions of the month, and either is one tap
      // from the other. Both doors used to be on the LAST card, which meant swiping through
      // a whole reading to reach the thing assembled from all of them.
      const cutSize0 = keptCount(rec);
      if (cutSize0) {
        const swap = el("button", { class: "recap-ev-btn", style: { marginTop: "18px" }, onclick: ev => {
          ev.stopPropagation();
          rec.showCut = !take.cut;
          saveMonthRecaps();
          close();
          openRecap(year, month);
        } }, take.cut
          ? "or the reading it came from"
          : "or the " + cutSize0 + " you kept, from every reading");
        c.appendChild(swap);
      }
    } else if (i <= take.cards.length) {
      const cd = take.cards[i - 1], ci = i - 1;
      holdToEdit(c, ci); // long-press = reword + tell claude why
      c.appendChild(el("p", { class: "recap-head" }, cd.headline));
      if (cd.support) c.appendChild(el("p", { class: "recap-sub" }, cd.support));
      const meta = el("div", { class: "recap-meta" });
      // progressive disclosure: the receipts unfold only when asked for
      const evWrap = el("div", { class: "recap-ev", style: { display: "none" } });
      cd.evidence.forEach(sv => evWrap.appendChild(el("p", null, sv.text + "…")));
      meta.appendChild(el("button", {
        class: "recap-ev-btn",
        onclick: ev => {
          ev.stopPropagation();
          evWrap.style.display = evWrap.style.display === "none" ? "" : "none";
        }
      }, "from your words"));
      meta.appendChild(evWrap);
      // On the cut, a card is a borrowed reference to the reading that produced it — so the
      // verdict has to be written where it is actually stored, or letting one go here would
      // be forgotten the moment the cut is rebuilt.
      const vTake = take.srcs ? take.srcs[ci].take : take;
      const vIdx = take.srcs ? take.srcs[ci].ci : ci;
      const verdicts = el("div", { class: "recap-verdicts" });
      [["keep", "keep"], ["letgo", "let it go"]].forEach(([id, label]) => {
        verdicts.appendChild(el("button", {
          class: vTake.verdicts[vIdx] === id ? "on" : "",
          onclick: ev => {
            ev.stopPropagation();
            if (vTake.verdicts[vIdx] === id) delete vTake.verdicts[vIdx]; // tap again = undecided
            else vTake.verdicts[vIdx] = id;
            saveMonthRecaps();
            Array.from(verdicts.children).forEach((b, j) =>
              b.classList.toggle("on", vTake.verdicts[vIdx] === (j === 0 ? "keep" : "letgo")));
          }
        }, label));
      });
      meta.appendChild(verdicts);
      c.appendChild(meta);
      if (cd.earned) {
        // one second of silence first — then the world brightens and dust catches the light
        setTimeout(() => {
          if (!c.isConnected) return;
          root.classList.add("lit");
          if (!reduceMotion) dustBurst(c);
        }, 1000);
      }
    } else if (i === take.cards.length + 1 && takeTitle(take)) {
      c.appendChild(el("p", { class: "recap-sub", style: { margin: "0 0 14px" } }, "If " + monthName + " had a title…"));
      const t = el("p", { class: "recap-head" }, " ");
      c.appendChild(t);

      // One line is the part most worth another roll and the part least worth waiting a
      // whole re-reading for. Every title the take has had stays reachable — a name you
      // rolled past is exactly the one you want back.
      const titleMeta = el("div", { class: "recap-meta" });
      const note = el("p", { class: "recap-title-note" });
      const paintNote = () => {
        const n = (take.titles || []).length;
        note.textContent = n > 1 ? "tap the title for the other " + (n - 1) : "";
      };
      const roll = el("button", { class: "recap-ev-btn", onclick: async ev => {
        ev.stopPropagation();
        if (roll.disabled) return;
        roll.disabled = true; roll.textContent = "naming…";
        try {
          const title = await rerollTitle(year, month, take);
          if (title) {
            addTakeTitle(take, title);
            saveMonthRecaps();
            clearInterval(titleTimer);
            t.textContent = takeTitle(take);
            paintNote();
          } else {
            note.textContent = "no key set on this device";
          }
        } catch (err) {
          console.warn("title reroll failed", err);
          note.textContent = "didn’t come back — " + ((err && err.message) || "try again");
        }
        roll.disabled = false; roll.textContent = "another name";
      } }, "another name");
      // the cut borrows its title from a reading; it is not the cut's to reroll
      if (S.apiKey && !take.cut) titleMeta.appendChild(roll);
      titleMeta.appendChild(note);
      paintNote();
      c.appendChild(titleMeta);

      t.style.cursor = "pointer";
      t.addEventListener("click", ev => {
        if (!take.titles || take.titles.length < 2) return;
        ev.stopPropagation();          // stepping through names is not stepping through cards
        clearInterval(titleTimer);
        setTakeTitle(take, (take.titleCur || 0) + 1);
        saveMonthRecaps();
        t.textContent = takeTitle(take);
      });

      if (reduceMotion) t.textContent = takeTitle(take);
      else {
        // a beat of silence, then the title types itself out. clearInterval works on
        // timeout ids too, so show()/close() cancel whichever phase is live; the
        // isConnected guard covers a card swapped out mid-race.
        let pos = 0;
        titleTimer = setTimeout(() => {
          titleTimer = setInterval(() => {
            if (!t.isConnected) { clearInterval(titleTimer); return; }
            pos++;
            const full = takeTitle(take);
            t.textContent = full.slice(0, pos);
            if (pos >= full.length) clearInterval(titleTimer);
          }, 60);
        }, 900);
      }
    } else if (i === take.cards.length + 1 && !takeTitle(take)) {
      // no title came back — jump the pacing straight to the end card's content
      return buildCard(i + 1);
    } else {
      const cutSize = keptCount(rec);
      c.appendChild(el("p", { class: "recap-head" }, "That's " + monthName + "."));
      c.appendChild(el("p", { class: "recap-sub" }, take.cut
        ? cutSize + " kept, from " + rec.takes.length + " reading" + (rec.takes.length === 1 ? "" : "s")
          + ".\nThis is the cut — what you chose, not what was generated."
        : take.cards.length + " observations"
          + (cutSize ? " · " + cutSize + " kept across the month" : "")
          + "\nWhat you keep, let go, and reword shapes the next reading."));
      const meta = el("div", { class: "recap-meta" });
      if (rec.takes.length > 1 || cutSize) {
        // every take the month has had, like the weekly V1/V2 pills — tap to revisit one.
        // "kept" sits at the end because it is the one assembled from all of them.
        const pills = el("div", { style: { marginBottom: "14px" } });
        const openAs = fn => ev => { ev.stopPropagation(); fn(); saveMonthRecaps(); close(); openRecap(year, month); };
        if (rec.takes.length > 1) rec.takes.forEach((t, ti) => {
          pills.appendChild(el("span", {
            class: "wsum-pill" + (!take.cut && ti === rec.cur ? " on" : ""),
            onclick: openAs(() => { rec.cur = ti; rec.showCut = false; })
          }, "V" + (t.version || ti + 1)));
        });
        if (cutSize) {
          // the choice persists: from here on the chevron opens the cut, not the last reading
          pills.appendChild(el("span", {
            class: "wsum-pill" + (take.cut ? " on" : ""),
            onclick: openAs(() => { rec.showCut = true; })
          }, "kept · " + cutSize));
        }
        meta.appendChild(pills);
      }
      meta.appendChild(el("button", { class: "recap-ev-btn", style: { marginBottom: "8px" }, onclick: ev => { ev.stopPropagation(); close(); } }, "done"));
      meta.appendChild(el("button", {
        class: "recap-ev-btn",
        onclick: ev => {
          ev.stopPropagation();
          close();
          startMonthRecap(year, month); // arrives as the next take — this one stays in the pills
        }
      }, take.cut ? "read the month again" : "read it again, fresh"));
      c.appendChild(meta);
    }
    return c;
  }

  document.body.appendChild(root);
  show(0);
}
