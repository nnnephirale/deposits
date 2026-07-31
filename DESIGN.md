# Deposits — design notes

State of the interface as of 30 Jul 2026, written for a future session (desktop upgrade in
particular). Everything here is *as built*, not aspirational. The app is one file,
`index.html`; there is no build step.

---

## 1. Tokens

```
--canvas   #F0F0F1   light neutral grey — the page. NOT warm; a warm cream was tried and rejected.
--card     #FFFFFF   the blocks that float on it
--field    #F4F4F6   inset surfaces (chips, pills, format buttons)
--hairline rgba(0,0,0,0.055)  near-invisible dividers
--ink      #1C1C1E
--subtle   #8A8A8E
--font     system sans (-apple-system …)
--mono     = --font                 — periods, pills, labels, all uppercase micro-copy
--day      'Lexend Exa' 500        — one use only: the day letter in an entry's badge
```

`--mono` **was** `SF Mono / ui-monospace`. Switching that declaration off in inspect and
comparing settled it: the label layer reads better in the body's own sans, so the token now
points at `--font`. It stays a separate token so the whole label layer is one edit away from a
face of its own again. Only two faces differ from the body anywhere now: the day badge's
Lexend Exa and the weekly summary's serif.

`--canvas-a` / `--canvas-0` are the same grey with alpha, for frosted surfaces. Reference the
token, never re-type the rgb — there were three hardcoded copies of the old canvas colour and
changing the background meant hunting them down.

`--mat` `#F4F4F5` (plus `--mat-a` / `--mat-0`) is **desktop only**, declared inside the
`min-width: 1080px` block: the middle grey between the wash and the white cards. See §5.

**Radii:** 24px cards · 20px sheets · 18px compose bar · 999px pills and format buttons ·
14px gallery cards · 12px arrow buttons.

**Elevation:** one recipe, `0 1px 2px rgba(0,0,0,.03), 0 6px 18px rgba(0,0,0,.045)`. Cards,
arrow buttons and the compose bar all use it or a slightly deeper variant. Nothing has a
hard border.

---

## 2. The layout as built (mobile — desktop is §5)

```
┌─────────────────────────────┐
│        27 Jul – 2 Aug       │  small grey date line, centred
│    ‹     W31 / 7月     ›    │  30px mono. arrows 35px off, lighter + smaller
├─────────────────────────────┤  header has 28px top / 52px bottom padding
│ ● WORK                      │  topic label lives INSIDE the white card
│ [M]│ entry text             │  day badge in a left gutter, hairline threading
│    ├──────────────          │  divider starts at the text, not the card edge
│ [T]│ entry text             │
└─────────────────────────────┘
        … cards, 18px apart …
  ▒▒▒ white fade ▒▒▒            frosted, 162px tall
┌─────────────────────────────┐
│ Start typing…      +  │  ⋮  │  the compose bar. shimmering placeholder.
└─────────────────────────────┘
```

**`W31 / 7月` is both the app's identity and its view switcher.** There is no title and no
week/month segmented control — the title was spending the best real estate on a word she
already knows. Tap the *other* token to switch view; tap the one you're already in to open
the picker. That puts all period navigation on plain taps.

**A green dot marks the live week** (31 Jul 2026), on the date range under the stepper and
nowhere else — `W31` reads identically whichever week you've stepped to, so the dates are the
only thing on screen that can say "you're in this one". Green `#55A862` with a 2px white ring,
the same mark as the rail's sync dot. It rides like a **degree point**, not on the baseline,
and that placement is *measured*: a real `°` in this face at 13px has its ink 4.70→8.94px above
the baseline (centre 6.82px, all but exactly the x-height), and a 5.1px dot hung from the top of
the 15px line box lands its centre at 6.61px — 0.21px off, so no nudge is carried. Two things
that don't work here: `vertical-align: middle` sits 1.6px low, and `align-self: baseline` on an
empty flex item pushes it *below* the text and stretches the row to 16.8px, because an empty
flex item has no baseline of its own and the synthesised one is its bottom edge. Use
`align-self: flex-start`. Re-measure if `.wk-range` ever leaves 13px.

**The compose bar is not a dock.** It's a resting text field. Tapping it unfolds the
composer *out of that same rectangle* (see §4). `+` opens the composer too; `⋮` opens the
menu, fenced off by a hairline so it doesn't read as part of the typing affordance.

**The menu (`⋮`)** is a centred floating modal holding what used to crowd the header:
a search field at the top — typing morphs the body below into matching entries — and
otherwise the settings list (Day view toggle, Export markdown, Settings).

**Layouts:** only two. The default topic grouping, and a "Day view" toggle. `mix` and
`dense` were experiments and are gone; "nothing selected" is a real, reachable state.

**Reading order** (`oldestFirst`, persisted, default false = newest first). Topic groups have
always floated the latest-touched to the top; from 30 Jul the entries *inside* them read the
same way. Flipping to oldest-first replays the week as it ran. The control lives in the `⋮`
menu on mobile and directly above Day view in the desktop icon rail.

Two sentinel traps when reversing, both of which float "anytime" to the top if missed:
`dayAsc` returns **99** for a day-less entry so it sorts last ascending, while `daySortKey`
returns **−1** so it sorts last *descending* — each direction needs its own comparator, not a
negated one. Same for weeks: descending uses `weekSortKey` (−1), ascending needs `weekAsc`
(999), or month-scoped entries jump to the top of month view.

### The day says itself once (30 Jul 2026)

A run of entries on the same day used to stamp the same badge on every one of them. Now the
run states the day once and the gutter thread carries it:

```
[M]│ entry text          badge, then a solid thread
   ╰─                    a 9px elbow turns toward the text where the next badge would be
   ┆                     …a gap, then dashes through the rest of the run
   ┆  entry text         no badge
[W]│ entry text          new day: badge and solid thread return
```

Same `--hairline` throughout — dashed, not a lighter colour — so it reads as the thread
pausing rather than as a second kind of rule. The gap before the dashes is `--badge-gap`,
the *same* breath a solid thread leaves under its badge, so the two are equal by
construction rather than by eye. Three details that matter:

- **The elbow's stub lands on the repeat's first line**, the same axis as the badge it stands
  in for: `bottom: calc(-1 * (var(--entry-pad-y) * 2 + var(--line-box) / 2))`. Two traps here.
  Kept inside its own row it gets ~11px of height on a single-line entry — not enough for a
  9px corner, and the curve disappears. And `.entry-gutter` is the entry's **content** box,
  so reaching the next row's first line means clearing *both* paddings (this row's bottom and
  the next row's top) before the half line box; measuring as if from the border box leaves it
  a full 30px high.
- **A repeat's dashed `::before` replaces the solid `::after`**, which is set to
  `display: none`. Drawing both stacks two lines in the same column.
- **Sameness is a full day key, not `entryDay()`.** Two Mondays from different weeks share
  weekday index 0 and would silently merge in month view. `entryDayKey()` is
  `year | week-or-month | weekday`.

### Day view (30 Jul 2026)

Day buckets have **no heading**. The day was being said twice — mono black text in the
heading and the grey badge in every entry's gutter — and the badge won: it's the same object
topic view uses, and it's the one that can sit centred on the first line beside the topic
pill. Its first entry's badge names the bucket and the repeat run carries it down.
`anytime` and month view's `W##` buckets aren't days and have no badge equivalent, so they
keep the label.

Topics ride on the entry's **own first row**, in line with the day badge — `[badge] [TOPIC]
[TOPIC…]` — and the text starts underneath at its **full measure**. Two earlier versions:
an absolutely positioned box holding a single pill (an entry with three tags spilled them
straight out of its bottom edge), then a real 78px third flex column at the right, which grew
to hold them but bought its clean right edge with 94px off *every line* — so the same text
wrapped earlier in day view than in topic view. The row costs one line's height once. The
pills keep the column's fixed 78px and its `…` truncation: a short label like WORK measures
the same as a long one, so a run reads as a row of equal marks rather than ragged labels.

**Badge, first line, and pills share one axis.** `.entry` carries `--line-box: 22.5px` (the
body text's own line box, 15px × 1.5) and `--pill-h: 18px`; the badge's `margin-top` is
`(--line-box - 22px) / 2`, and the tag row is a 22px box with `align-items: center` — the same
height as the badge, so the two land together with no second rule. Change the body font size
or line-height and `--line-box` is the one number to update.

---

## 3. Interaction rules learned the hard way

These cost real debugging. Don't re-derive them.

**Commit sheet controls on `pointerdown`, not `click`.** Tapping a non-focusable control in
a sheet blurs the textarea → the keyboard collapses → the sheet shifts → *then* the click is
dispatched, landing on whatever is now under the finger. Every format-bar button, day-strip
cell and calendar cell commits on pointerdown with `preventDefault()` to keep focus.
**Exception:** file pickers. `imgInput.click()` needs transient user activation, which
pointerdown does *not* grant on touch — the photo picker silently refused to open. That one
button commits on `click`.

**The composer notch remembers its height as a FRACTION of the viewport** (30 Jul 2026), not
as pixels — `weekly-deposits-composer-height-frac`, device-local, never synced. The notch is
really answering "how much of the screen should the composer take", so a fraction survives a
rotate, a window resize and the phone↔desktop jump, where a saved pixel height would either
clamp to the ceiling or open as a sliver. Verified: `0.591` gives 532px in a 900px window and
480px at 812px, same proportion both times. Three things to keep right if this is touched:

- **Save on `pointerup`, not in the move handler.** A drag is ~60 writes a second, and the
  height mid-drag isn't the one she chose.
- **Save `manualHeight`, not the raw drag delta**, so what's stored is the value *after*
  `SHEET_MIN`/`SHEET_MAX` clamping — never one that reopening would reject.
- **Guard the value on read.** `parseFloat` of a corrupted key gives `NaN`, and `NaN` survives
  both `Math.max` and `Math.min` — it would propagate into `--sheet-h` and collapse the sheet.
  The range test `> 0.2 && <= 1` rejects `NaN`, `0`, negatives and absurd values in one line.

Note a pre-existing disagreement this rides on: the JS ceiling is `0.98 * innerHeight` but the
desktop CSS caps `.sheet.expanse` at `100dvh - (--deck-x + --mat-y) * 2`, which is tighter. At
the very top of the range `--sheet-h` can read 882px while the sheet renders 860px (`--mat-y`
is now `0`, so the gap is the two `--deck-x` insets alone — it was 832px at `--mat-y: 14px`). It
round-trips to the same *visual* height, so the memory is stable — but the two numbers are not
the same number.

**`align-items: center` clips an oversized child out of reach in a scrolling container**
(30 Jul 2026). A long AI summary overflowed the reveal off both edges with no way to scroll
to either end. Adding `overflow-y: auto` alone does *not* fix it: centring is applied to the
oversized item too, so its top is pushed out through the container's start edge, which
scrolling can never reach — `scrollTop: 0` still shows the middle. The fix is to centre with
`margin: auto` on the CHILD instead. Auto margins resolve to 0 once the item is bigger than
the box, so a short card sits centred and a long one starts at the top and scrolls. One
declaration covers both. *Verified* at 2296 characters: `scrollTop 0` puts the first line at
y=98 (clear of the top bar) and the bottom is reachable at the other end.

**A stage that scrolls can no longer treat every click as a page turn.** The story deck
advances on tap; once it scrolled, a swipe to read also turned the page. Same 4px rule the
photo row uses — track `pointerdown`/`pointermove` and swallow the click if it moved.

**Fit the type to the text, then let scrolling be the safety net.** The reveal's 27px serif
was tuned against a 2–3 sentence summary; the model writes 900 too. `revealTextSize()` solves
`f = √(w · room / (0.61 · chars))` from the measure and the viewport height (0.61 = ~0.5em
per character × the 1.22 line-height), clamped to 15–27px. An 887-character summary lands
whole at 19px on a phone. A reading you have to scroll through isn't a reading.

**`pointercancel` is not a quiet `pointerup` — never share a commit path between them**
(30 Jul 2026). The wrapped chevron's scrub routed both through one `endPull`, so a gesture the
*system* took away past the commit threshold opened the wrapped on its own. `pointercancel`
fires when she never let go of anything: an edge-swipe back, a notification, the browser
deciding late that this was a scroll. It must always retreat. `endPull(ev, mayCommit)` now,
with `pointerup` passing true and `pointercancel` passing false — which also guarantees an
interrupted drag can't strand a half-bloomed screen over the list.

**Race every rAF animation with a timer.** A hidden tab gets *zero* `requestAnimationFrame`
callbacks — verified: 0 ticks in 400ms with `document.hidden === true`. The composer unfold
already knew this (`requestAnimationFrame(release)` + `setTimeout(release, 70)`); the heat
bloom had to learn it again. If she pulls the chevron halfway and the phone locks, the retreat
never runs and she comes back to a half-bloomed screen with no way out. `heatTo` runs both an
rAF loop and a `setTimeout(finish, ms + 120)`, with a `settled` flag so `done()` fires exactly
once whichever wins. *Testing note:* this is also why the preview harness makes rAF-driven
work look broken — check `document.visibilityState` before believing an animation bug.

**`selectionchange`, not `select`.** `select` fires when text *becomes* selected and never
when it clears, and on iOS the tap that dismisses a selection is swallowed by the callout, so
no pointerup arrives either. Bind `selectionchange` on both the element (newer engines) and
the document (Safari's long-standing path). Also gate on focus: a blurred textarea keeps its
`selectionStart`/`End`, which left the B/I/U row showing over nothing selected.

**FLIP needs the start state painted with transitions off.** Adding a `.folded` class to an
element that already has a transition on the animated property just animates *into* the start
state — the reveal then has nowhere to travel from and reads as a wobble. Add
`.folded` + a `no-anim` class, force a reflow (`void el.offsetHeight`), remove `no-anim`,
reflow again, then release. Even an inline literal value reads back as the old one mid-transition,
so verify with sampled intermediate values, not a single `getComputedStyle`.

**Ease with a toe for "watch it happen".** `cubic-bezier(0.16, 1, 0.3, 1)` (ease-out-expo)
spends half its travel in the first 60ms — it reads as a pop. For anything meant to be
*observed* growing, use an S-curve with a low first control point:
`cubic-bezier(0.77, 0.006, 0.078, 1)`.

**"Make the ease stronger" means moving x1 toward 1 and x2 toward 0** — not pushing y1
negative. The composer curve was strengthened 40% on 31 Jul (`0.62, 0.01, 0.13, 1` →
`0.77, 0.006, 0.078, 1`, each control point moved 40% of its remaining distance toward the
extreme that deepens the S). The other reading — driving y1 below 0 — adds *anticipation*, and
a `clip-path` box that shrinks slightly before it grows reads as a glitch rather than as ease.
Everything in one gesture shares the curve; see §4.

**`backdrop-filter` needs `mask-image`** or the blur ends on a hard vertical/horizontal seam
that looks like a rendering bug. Mask it in the same direction as the tint gradient.

**Frosted = blur + *light* tint.** A near-opaque white gradient defeats the blur entirely —
there's nothing left to see through. The white does the hiding; the blur only softens its
edge. Bottom fade landed at `blur(11px) saturate(180%)` with white at 0.98 → 0.72 → 0 — two
steps along that axis now (22px, then 14px, both still hazy enough to look broken). Each step
took the radius down and gave the white back the work.

**An absolutely positioned pseudo-element inside an `overflow` container scrolls with the
content.** Edge fades on a carousel must hang off a *non-scrolling wrapper*, or they drift
away from the visible edge. (`.rt-gal-wrap` exists purely for this.)

**Measure overflow, don't infer it.** "3+ items means it scrolls" is wrong the moment an item's
aspect ratio changes the row width, and a single render-time measurement is stale because
images settle their width after decode. Measure `scrollWidth - clientWidth`, and re-measure on
`load`, on `ResizeObserver`, and after any relayout.

**Never rebuild a sheet for a label change.** The composer's `build()` wipes `sheet.innerHTML`;
calling it when only a pill's text changed tore down and re-created the field, the styling row
and every chip — that's the flash. Update in place. *Test for this by node identity:* assert
the textarea is the **same element** afterwards.

**`requestAnimationFrame` can be throttled** wherever nothing paints (a backgrounded tab). Any
one-shot state release driven by rAF should race a `setTimeout` and be idempotent, or it can
strand the UI in its start state.

**Keyboard-safe placement beats a bottom dock.** The composer's styling row started life fixed
to the bottom of the screen; on a phone the keyboard owns that third. It now sits directly
under the day/week/Save row.

---

## 4. Signature motion

**The heat bloom — the door to the wrapped** (30 Jul 2026). One small `v` under the period,
dragged down. It replaced two magic wands (`weekSummaryBlock` and `monthRecapBlock`) that were
absolutely positioned over the *first entry card's* top-right corner, where they read as a
smudge on the entry rather than a control. There is one door now, it sits under the thing the
wrapped is about, and it is the same control in both views.

*The colours are her data.* Each field is one of the period's topics, sized by how often it
appeared — a month of nothing but work is one big blue field; a scattered month is six small
ones. Positions come from a fixed golden-angle spiral, not `Math.random()`, so the same period
always blooms the same way; random placement made a familiar month look like a new one.

*The palette is derived, not picked.* Each topic's `dot` was read in OKLCH, its **hue kept**,
and L + C replaced with one shared rule: `L = 0.72`, chroma at **85% of that hue's own sRGB
maximum**. Same L is what makes eleven colours read as one family. Same *%-of-max* chroma
(not the same absolute number) is what makes them equally vivid — the ceiling is 0.265 at
magenta and 0.123 at teal, so one flat value would have left the teal muted and clipped the
magenta. The source dots ranged L 0.605→0.826, which is why "just saturate the dots" would
have produced a bloom with holes in it. Stored as hex in `TOPICS[].heat`; the derivation is
written down beside it so it can be re-derived rather than re-guessed.

*Two rendering decisions that cost a rebuild:*

- **`mix-blend-mode: multiply` is wrong here.** It was the obvious choice — pigment, overlaps
  deepen, no wash-out. But six large fields all overlapping meant every pixel got multiplied
  five or six times, and the top half of the screen collapsed into grey-green mud: the exact
  opposite of "saturated". Soft-edged radial fields blended *normally* over a near-white wash
  keep each hue readable and let overlaps average into a new colour instead of racing to
  black. Multiply only behaves when the fields are sparse enough not to stack.
- **A radial-gradient falloff beats a hard disc + big blur** — smoother, cheaper, and the
  shape is controllable instead of being whatever a 60px blur does to a circle's edge.

*The bloom becomes the deck's sky.* `.recap` is opaque `var(--canvas)`, so tearing the bloom
down when the deck opened cut from a screen full of her colours to a flat near-white one in a
single frame. Now the deck opened *from the chevron* gets `.on-heat` — transparent background,
its own stock blobs off — and the bloom stays for the deck's whole life, retreating only when
she closes it. A deck opened any other way (the auto-reveal when a summary lands) never gets
that class and keeps its stock background.

**The status bar: `black-translucent`, and the clock goes white** (30 Jul 2026). Installed to
the home screen, `apple-mobile-web-app-status-bar-style` has exactly one value that lets the
page paint under the clock, and that is `black-translucent`. Every other value makes iOS
reserve an opaque strip and fill it — which reads as a hard band across the top whatever
colour goes in it. **Matching the colour instead does not work:** `theme-color` is not
re-read at runtime by an installed web app, so driving it per screen changed nothing on
device (tried first, 30 Jul — the band stayed grey). The cost of `black-translucent` is that
the clock and battery render white and are not controllable from CSS. Marilyn's call, asked
and answered directly: *"it has to look full screen at all times, not bothered by what colour
the clock and battery look."* Don't quietly revert it for legibility.

`setThemeColor()` is kept — it still drives Safari's own chrome and Android — but it is no
longer what removes the band.

**Everything that measures the viewport now has to subtract the inset.** `window.innerHeight`
includes the status bar once the page paints under it, and `env(safe-area-inset-top)` went
from 0 to ~59px. What that broke, all fixed together: the composer's `98dvh` ceiling slid the
grabber under the clock (now `100dvh - env(safe-area-inset-top) - 10px`, and `SHEET_MAX()`
matches it exactly); the reveal stage's flat `84px` top padding; and the two centred
full-screen overlays (`.read-back`, `.img-preview-back`).

**`env()` cannot be read from JS**, which matters because `SHEET_MAX()` and
`revealTextSize()` both need the number. It does *not* survive into a custom property —
unregistered custom properties are substituted as raw tokens, so `--sat: env(...)` comes back
out of `getComputedStyle` as the literal string `"env(safe-area-inset-top)"`. The fix is a
zero-size `#satProbe` whose `padding-top` **is** the inset: `getComputedStyle(probe).paddingTop`
resolves to real pixels. `safeTop()` wraps it.

*Testing note:* a desktop preview always reports an inset of 0, so none of this is visible
there. Simulate it by injecting a stylesheet that substitutes a literal `59px` everywhere
`env(safe-area-inset-top)` appears, plus a tinted `body::after` strip marking where the real
status bar would sit — then check nothing lands under it.

**The composer unfold.** The sheet is `clip-path`-ed to the compose bar's *measured*
rectangle — same grey, same 18px rounding — then released, so the box physically opens
outward while the grey turns white and the content fades in behind it. 0.62s on
`cubic-bezier(0.77, 0.006, 0.078, 1)` — the run was 20% too slow at 0.78s, so every duration in
the open *and* close move was scaled by 0.8 together (clip 0.62, background 0.53, content 0.27
after 0.16, and the JS focus delay 520 → 420ms), then the curve itself was deepened 40% from
`0.62, 0.01, 0.13, 1`. **Four transitions share that curve** — the list recede, the clip, the
grey→white, and the desktop deck — and they only read as one gesture while they stay in that
ratio. Re-time or re-curve one and do all four.
The list behind it recedes in the same gesture:
`scale(0.93)` + `0.4` opacity from a top origin. That recede required *lightening* the
backdrop to `rgba(0,0,0,.18)` / `blur(2px)` — at 0.4 opacity it was happening behind
something too opaque to see through.

**Composer speed is a setting** (31 Jul 2026): four levels in one shared Settings sheet (the
desktop rail's Settings glyph and the mobile `⋮` → Settings both land in `openSettings`, so the
control is built once). Implemented as ONE multiplier, `--unfold-k`, over every duration in the
gesture — `UNFOLD_STEPS = [1, 0.71, 0.6, 0]` = 620 / 440 / 372 / 0ms, index **1** the default.
Multiplying rather than replacing is the point: the ratios between the four transitions survive
any setting, which is what keeps them one move. Level 4 is `0` — every duration collapses to
`0s` *and* `unfoldStill()` sends the JS down the same path `prefers-reduced-motion` takes, so the
sheet doesn't run a zero-length clip dance, it just appears. A segmented control, not a slider —
four notches isn't a value worth scrubbing, and the active cell is the state. Cells read
`1 2 3 🐇`.

The ladder was rebuilt the same day it shipped: the first cut was five rungs
(`[1.96, 1.4, 1, 0.71, 0]`, ×1.4 apart, default in the middle) and *nothing slower than the
default was ever wanted*. So the old level 4 became level 2 **and** the default, the two slowest
rungs went, and level 3 is only a nudge quicker than 2 rather than another full step. Two things
that had to move with it:
- **The storage key is versioned** (`weekly-deposits-unfold-v2`). `unfoldLevel` persists as an
  *index*, so a stored `3` used to mean 440ms and would now mean no-motion. The old value has to
  be dropped, not reinterpreted — the one real hazard in re-spacing a scale like this.
- **`620` in `unfoldNote()` is the `k = 1` baseline**, the same number as the CSS `0.62s`. It
  only stays honest because level 1 is still `k = 1`; rescale by editing the CSS base durations
  instead and this constant has to follow, or the sheet misreports its own duration.

**The keyboard must not move the composer** (31 Jul 2026). Reported as *"when I tap and the
keyboard comes in, it pushes the composer all the way up and I can't even see what I type."*
Three facts stack up to cause it:
1. **iOS does not shrink the layout viewport for the keyboard.** `100dvh` reads exactly the
   same with it open, so a `98dvh` sheet is taller than the room left above it.
2. Safari's answer is to **scroll the visual viewport** until the caret is visible.
3. A `position: fixed` overlay is placed against the **layout** viewport — which has just been
   scrolled out from under it. So the whole composer travels off the top of the screen.

The fix is to stop trusting `dvh` for anything a keyboard can cover. `syncViewportVars()`
publishes `--vvh` (`visualViewport.height`) and `--vvt` (`visualViewport.offsetTop`); every
full-screen overlay — `.overlay`, `.read-back` (which is also the `⋮` menu, and it holds a
search field), `.img-preview-back` — becomes `top: var(--vvt); height: var(--vvh)` instead of
`inset: 0`, and `.sheet.expanse` caps at `--vvh` rather than `100dvh`. Capped to what's visible
there is nothing left for Safari to scroll, so the field stays where it opened.

Two things that are easy to miss here:
- **`--sheet-h` is deliberately left alone.** The notch's remembered height keeps its meaning
  and comes straight back when the keyboard goes away; only the *rendered* ceiling moves. Had
  `SHEET_MAX()` been switched to the visual viewport instead, `saveSheetFrac` would have
  persisted the keyboard-shrunk height and her composer would have got shorter every session.
  Verified working end to end (31 Jul): dragged 796→616px, stored as the fraction 0.7586, and
  616px on both reopen and a full reload. The related hazard first flagged here — dragging *while
  the keyboard is up* persisting a clamped fraction — **stopped existing** once the box no longer
  shrank for the keyboard: `.sheet.expanse`'s ceiling doesn't reference `--kb`, so the dragged
  height is keyboard-independent (measured 683px with the keyboard and without). No guard needed.
- **`autoGrow` pins an explicit pixel height on the textarea**, so the field keeps its old size
  when the sheet shrinks under it and puts the caret straight back out of view — `min-height`
  can't fix that, only re-measuring can. Hence `sheetViewportSync`, registered by `build()` and
  dropped in `close()` (same one-at-a-time rule as `fmtSelSync`), called on visualViewport
  **resize** but *not* **scroll** — resize is the keyboard arriving; scroll is Safari chasing
  the caret dozens of times a keystroke.

Verified by shadowing `visualViewport.height`/`offsetTop` with `Object.defineProperty` and
firing the real `resize`/`scroll` events — setting the CSS vars by hand does *not* test it,
because the handler immediately overwrites them with the true values.

**Tap once, and don't bounce** (31 Jul 2026, the follow-up). The fix above stopped the composer
being *shoved* off-screen but left two things she then reported precisely: tapping "Start typing"
expanded the window and she had to tap "Start typing" *again* to get a keyboard, and that second
tap bounced the whole screen up once.

- **The double tap is iOS's user-activation rule.** A programmatic `.focus()` only raises the
  keyboard inside a real gesture's activation window; the focus was in `setTimeout(…, 420)`,
  outside it. iOS obliged by focusing the field — caret and all — and leaving the keyboard down,
  which is why the cue said "Start typing" at something that wouldn't. Focus now runs
  **synchronously** at the end of `openComposer`, still inside the click. The deferred call stays
  as a fallback, guarded on `document.activeElement` so a focus that already took isn't repeated
  (each repeat is another chance to trigger a scroll-into-view). **It must stay on `click`** —
  `pointerdown` grants activation only for `pointerType: "mouse"`, the same rule that stops the
  photo button committing on pointerdown.
- **The bounce was the sheet resizing after the keyboard arrived.** Sized against the full
  viewport, the sheet's bottom was under the keyboard, so iOS scrolled to reveal the caret. The
  cure is for the sheet to be its keyboard-up size *before* the keyboard exists: `kbHeight` is
  learned from the last time (iOS won't tell you before it opens) and cached in localStorage, and
  `reserveForKeyboard()` publishes it as `--kbr` before the fold is even measured. The sheet's
  ceiling is `--vvh - --kbr`, so when the keyboard lands `--vvh` drops by exactly what `--kbr`
  gives back and **the sheet does not move at all**. Measured: 410px before and 410px after.

Three details that are the whole design:
- **Overlays run to the SCREEN bottom, not the visual viewport's bottom** (corrected 31 Jul,
  second pass — see below). Top is `var(--vvt)`, bottom is `0`. (Desktop's `.overlay`
  overrides that padding, and has no keyboard anyway.)
- **The measurement always beats the prediction.** As soon as a real keyboard is seen, `--kbr`
  is handed back and `--vvh` rules. A stale cache costs one small correction (predicted 392,
  real 300 → a 92px adjustment) instead of the 386px bounce, and re-caches on the way through.
- **A keyboard that never comes** — hardware keyboard, or dismissed — would otherwise leave the
  composer permanently short, so the reserve self-releases after 1400ms.

First composer on a fresh install still adjusts once, because there is nothing to predict from
yet. Existing entries open to be read: no focus, no reserve.

**iOS draws its own accessory bar in the keyboard's region** (31 Jul, second pass). Sizing the
overlay and the sheet to `--vvh` — the visual viewport — was still wrong, just less obviously:
the visual viewport ends where the keyboard's region *begins*, and iOS paints its `^ ⌄ ✓`
form-navigation bar in that region, above the keys. So the sheet's white stopped short, the topic
pills were chopped mid-row, and the accessory bar sat on a see-through strip with the entry list
showing through behind it. Reported as *"a cutoff between the end of the actual window and a
clear space where the arrow up/down/tick reveals the layer behind — it should be a continuation
of the actual window."*

The correction separates **the box** from **the content**:

| | before | after |
|---|---|---|
| `.overlay` | `top: var(--vvt); height: var(--vvh)` | `top: var(--vvt); bottom: 0` |
| `.sheet.expanse` ceiling | `var(--vvh) - var(--kbr) - …` | `100dvh - var(--vvt) - …` |
| keyboard kept off content by | shortening the box | `padding-bottom` |

`--kb` (live band, `innerHeight - (--vvh + --vvt)`) and `--kbr` (the prediction) are never both
set, so `calc(var(--kb) + var(--kbr))` is the band either way. Every overlay's `padding-bottom`
carries it — bottom-anchored sheets to lift their content, and the centred `.read-back` /
`.img-preview-back` so `align-items: center` still centres in the part she can see.

A bonus from doing it this way: **the box no longer resizes when the keyboard lands at all** —
only its inner padding changes — so there is nothing left for Safari to scroll the caret into
view *from*. The reserve is now belt-and-braces for content stability rather than the thing
holding the bounce off.

**The band needs a floor and a device gate, or it fires on a window resize.** The first cut
learned from any "visual viewport is >80px shorter than `innerHeight`" reading. Resizing the
desktop window caught a transient 88px difference, cached it, and from then on padded the
desktop composer by 88px of nothing. Now: `SOFT_KB` (`(hover: none) and (pointer: coarse)`)
gates learning, reserving *and* `--kb` itself, and `KB_MIN` is 140px — Safari's collapsing URL
bar is ~60–90px and the accessory bar alone is ~50px, neither of which is a keyboard. Learning
also requires `--vvt < 4`: once Safari has scrolled, the band measures keyboard *plus* scroll,
and caching that would over-reserve next time. The key is versioned (`-v2`) so the bad value is
dropped. Consequence for testing: with `SOFT_KB` false in a desktop preview pane, the reserve
path can only be exercised on a real device — drive `--kb`/`--kbr` by hand to check the geometry.

**Pinch a photo run** closed and it fans into a deck (white ring per card so they stay
distinct); spread it back to a row. State is keyed by the run's markers so it survives the
re-render that follows an unrelated edit.

**Shimmering placeholder.** `background-clip: text` sweep, 3.6s, on both the compose bar's
hint and the composer's own. Three things it needs:
- `color: transparent`, which erases any SVG in the same element — so the class is
  added/removed with the bar's state, and the export/copied icons survive.
- The composer's hint is a real overlaid element (`.ta-ghost`), not a native placeholder:
  `::placeholder` can't carry a background-clip sweep. It mirrors the textarea's font and top
  padding so it's indistinguishable from typed text, and `aria-label` replaces the placeholder
  the field no longer has.
- It **pauses while anything scrolls** (`pauseShimmerOnScroll`, 220ms idle) — an animated
  gradient competing with moving content is noise. `animation-play-state: paused`, not
  `animation: none`, so it resumes where it left off instead of visibly restarting.

---

## 5. Desktop — icon rail · mat · topics (30 Jul 2026)

At `min-width: 1080px` the app becomes an icon rail, a floating mat, and a topics rail.
Adapted from references she picked, the AI client most of all: a narrow column of glyphs on
the left, the content as its own rounded surface, a quiet panel on the right.

```
┌────┬──────────────────────────┬────────────┐
│ ▤  │ ╭──────────────────────╮ │ ⌕ … [ALL]  │
│ ▦  │ │    27 Jul – 2 Aug    │ │            │
│ ── │ │   ‹ W31 / 7月 ›      │ │            │
│ ☰  │ │  ┌────────────────┐  │ │ TOPICS     │
│ ↥  │ │  │ ● WORK         │  │ │ ● work   4 │
│ ⚌• │ │  │ [M]│ entry text│  │ │ ● eats   2 │
│    │ │  └────────────────┘  │ │            │
│    │ │  ▒▒▒ fade ▒▒▒        │ │            │
│    │ │  [ Start typing…  + ]│ │            │
│    │ ╰──────────────────────╯ │            │
└────┴──────────────────────────┴────────────┘
  64px          600px             248px
```

**The icon rail has no panel.** It's a column of glyphs on the wash; the row under the
pointer names itself and nothing else moves — opening a whole panel to answer one question
brought four blank rows along for the ride. The bar is absolutely positioned within the rail
so the naming overlays the mat rather than reflowing it: widening in the grid would re-wrap
every line of every entry as the pointer crossed. `:focus-visible` names it too, so tabbing
works.

**The name is a pill, not a lozenge** (30 Jul 2026). The first version grew the whole *row*
into a white capsule at a fixed `--rail-x: 212px` and clipped it — so a three-letter label
and a twelve-letter one got the same slab, most of it empty. Now `.ico-label` *is* the pill:
white, `999px`, the same 38px height as the glyph's circle, `padding: 0 15px`, and therefore
cut to the length of the word. It sits **2px** from the circle, not `gap: 8px` (read as a gap)
and not 0 — on an *active* row the circle is white too, and flush they merge back into the
one-piece lozenge this replaced. The travel is 4px for the same reason: 6px started the pill
underneath the circle it's 2px from. The row itself never changes size or paints anything — it
stays exactly `--rail-i` wide and lets the pill overflow it to the right, which is why
`.ico-row` is `overflow: visible` (an `overflow: hidden` capsule clipped the pill's own
shadow) and why there is no `width` transition left to animate. The reveal is
`opacity` + a 6px `translateX`. Two consequences worth remembering:

- **The pill is `pointer-events: none`.** It hangs over the mat, and without this it would
  catch clicks aimed at a card underneath — and it would keep catching them at `opacity: 0`,
  since a transparent element still hit-tests. The 64px row stays the only target.
- **The glyph gets its own hover circle back.** It had dropped it because the lozenge behind
  it was the feedback; with no lozenge, hover paints `rgba(0,0,0,0.05)` on the circle. An
  *active* glyph keeps its white circle on hover — the reason it used to switch to grey was
  to stay visible against the white lozenge, and that's gone.

**Haptics were tried and removed** (30 Jul 2026). The `web-haptics` vocabulary was inlined
against `navigator.vibrate`, with a hidden `<input type="checkbox" switch>` fallback for
iOS. It didn't land on her phone, so all of it is gone — don't re-add it without a device
that can actually be felt to test on. `navigator.vibrate` is Android-only; the switch trick
needs iOS 17.4+ and only ever produces one fixed tap.

**Week and Month share one frame box** (`x3 y4.5 18×16 r3`) — week draws the columns, month
adds the rows. Drawing them at different heights made one look like the lesser control.

**The rail's toggles name their own state** (31 Jul 2026): `Showing: Most recent` / `Showing:
Oldest`, and `Day view: On/Off` — the same shape the mobile menu's rows use, and the mobile row
was renamed to match (`Showing` · `most recent`/`oldest`). The bare `Newest first` it started as
was *already* the current order, but sitting in a column with Week / Month / Export / Settings it
read as the thing a click would *do*. A status label among command labels has to say it's a
status. The order went through `Oldest view: On/Off` on the way and that was still wrong for a
different reason: an on/off makes you work out that *off* means newest. Name the state, not the
switch — an on/off is only right when one of the two states is genuinely "nothing".

**The `⋮` menu is gone on desktop.** All four of its items have a visible home now, so the
button was a second route to nothing. It stays on mobile, where it's the only route. Sizing
note for the mobile pair: matching the `+` SVG's 19px *box* was the old mistake — the drawn
glyph spans 13 of 24 viewBox units, i.e. ≈10.3px, so a 19px dot stack read nearly twice its
height. Dots are 2.6px with 1.3px gaps = 10.4px, measured against the path's own rect.

**Search has a scope chip** that flips week → month → all, labelled in the app's own tokens
(`W31` / `7月` / `ALL`) rather than words. Same rule the search sheet already used: "a
specific week" means navigate there first. A zero-result miss names the scope, or a narrowed
search reads as "this word is nowhere".

**The chip scopes the whole rail, not just search** (31 Jul 2026). The topics list and its
counts read `scopedEntries()` — so if the chip says `W31` the topics are W31's topics whether
the centre panel is on that week, its month, or somewhere else entirely. They used to read
`activeEntries()`, the period being browsed, which made the chip look like it was lying about
its own column. `renderRails()` / `renderRightRail()` take **no argument** on purpose: the
`all` that used to be passed in was the coupling.

Two consequences of decoupling the two axes, both intended:
- A topic filter can now name a topic with nothing in the panel's period — the counts prove
  the entries exist, just not here. The empty state was already honest about it ("nothing
  under listening to *this week*. pick another topic, or clear the filter"), and the lit row
  keeps the filter visible and clearable.
- `deskTopic` is cleared when its row leaves the *scope*, not the period. With the chip on
  `ALL` a filter now survives navigating the panel anywhere, which is the point.

**`display: contents` is what keeps the phone safe.** `.deck` and `.deck-main` wrap
`.wrap` / `.bottom-frost` / `.compose-dock` in the markup, and below the breakpoint they
leave the box tree entirely — the three lay out as the body children they used to be, with
the fixed ones still fixed to the viewport. Verified: at 375px `.wrap` is static at 520px,
the dock is `position: fixed`, the header is back to its grey `--canvas-a` frost, the `⋮` is
reachable, and the rails are `display: none` *and* emptied of children.

**There is no window frame.** The deck is a bare transparent grid — no background, no shadow,
no overflow clip (the icon rail has to expand over the mat). Both rails sit directly on the
canvas wash and paint no surface of their own.

**The mat is floor-to-ceiling: `--mat-y: 0`, `--mat-x: 12px`.** It steps in from the rails and
nowhere else, so its only inset from the viewport is the deck's own `--deck-x`. It carried
`--mat-y: 14px` first; switched off in inspect, full height was plainly the one that reads as
a window — the vertical inset just made the wash above and below look like a missed edge.
`--mat-y` stays declared rather than being deleted because four other things derive from it
(`.iconbar` `top`, `.rail-r` `padding-top`, the composer overlay's `padding-bottom`, and
`.sheet.expanse`'s `max-height`); at `0` they all still line up on the mat's edges by
construction, and a future inset is one number again.

**Three greys, darkest outward** (30 Jul 2026): the wash the rails sit on, then the mat, then
the white cards on it. The mat was originally `--card` white, which made the cards it carried
invisible — on the phone a white card reads because the canvas behind it is grey, and the
desktop had thrown that away. So the mat steps down to `--mat: #F4F4F5` and the wash steps
down again below it (base `#E9E9EC`, `#EEEEF0` at its lightest corner, `#DFDFE2` at its
darkest). The wash's *highlights* matter as much as its shadows here: they have to stay under
the mat too, or the composition inverts in whichever corner the light falls. Everything stays
in the `--canvas` family, lightness only — no hue introduced, and no text colour that mobile
doesn't have.

Those are the first cut's values with **20% of each one's distance from `#FFF` taken back
out** — the first pass (mat `#F1F1F3`, wash `#E4E4E7`) was right in structure and too strong
in degree. Scaling toward white rather than re-picking by eye is what keeps the three steps
proportional to each other; if it needs moving again, scale it again. Note the ratio this
leaves: the card→mat step is ~11 levels and mat→wash ~11 more, so **the mat is the fragile
one** — anything painted on it needs to be white or clearly darker, never near-white.

Anything frosted over the mat is tinted to the mat, never to white: `--mat-a` / `--mat-0`
exist for exactly that, and both the header frost and the bottom fade use them. A white
frost over a grey mat reads as a band.

**`--field` is `#F4F4F6` and the mat is `#F4F4F5` — the same colour.** So *anything `--field`
that sits directly on the mat disappears entirely.* Two things do, and both are overridden to
`--card` in the desktop block: `.stepper-btn` (which also gained a shadow) and `.wsum-pill`
(the week summary has no card of its own — it sits straight on the mat, and its MINE/V1/V2
pills went invisible). Every other `--field` surface in the app lives inside a white card or a
sheet and is unaffected — that's the list to re-check if the mat value ever moves again.

**A re-render must not lose your place** (31 Jul 2026). Reported as *"when viewing by days,
deleting or creating new entries causes the screen to jump up back to the top."*
`entriesRoot.innerHTML = ""` collapses the scroller's content to nothing, and **the browser
clamps the scroll offset to the new maximum — 0 — on the spot.** Re-adding the rows does not put
it back. Measured directly: scroll to 600, clear, and `scrollY` reads 0 before a single row
returns. Worst in day view because that list is longest, but it was every view and every
mutation.

The offset is only worth keeping when it still *means* the same thing, so `render()` compares a
`viewIdentity()` key — `view · layout · oldestFirst · deskTopic · deskQuery · deskScope ·
period` — against the previous render's. Same identity (any mutation: save, delete, a ticked
checkbox, a sync pull) restores the offset; different identity (stepping the period, flipping the
order, switching layout) starts at the top, exactly as it did before. **That's why this needed no
changes at the ~40 `render()` call sites** — the rule reads the state rather than trusting each
caller to say what it meant.

Two mechanical notes:
- `render()` is now a thin wrapper around `renderView()` purely so the restore covers all three
  of its `return`s (search takeover, empty state, normal). Restoring at each one is the kind of
  thing the next `return` forgets.
- **Restore AFTER the rebuild.** A scroller with no content cannot hold an offset — that is the
  bug itself, so doing it in the wrong order is a no-op that looks like a fix.
- The scroller differs by viewport: `.wrap` scrolls internally on desktop, the window on the
  phone. `listScroller()` resolves it live rather than caching `wrapEl`, because `render()` is
  defined before that `const` is initialised.

**`unlockPageScroll` had the same staleness in reverse.** The `⋮` menu locks the page, so
toggling day view or the order *from the menu* re-rendered underneath a locked body and then
restored the pre-menu offset — leaving her partway down a list that had just been reordered,
while the header's own week/month tabs (no lock involved) correctly went to the top. It now
records the view identity at lock time and only restores the offset if it still matches. Same
rule on both paths.

Things that cost real debugging, or that will bite the next change:

- **A CSS grid's implicit row is `auto` = max-content.** A tall rail sized the row to 1293px
  inside a 680px fixed deck and everything below the fold vanished (compose bar, account
  row). `grid-template-rows: minmax(0, 1fr)` + `min-height: 0` on the panes.
- **The composer sheet must be *wider* than the compose bar.** The unfold clips the sheet to
  the bar's measured rect; a 600px bar inside a 520px sheet clamped `--ml`/`--mr` to 0 and the
  box only opened vertically. Sheet is 680, bar 600, so there's 40px of travel a side.
  (CSS `inset()` *does* accept negative values — verified — they just can't help: clipping
  only removes area from an element's own box, so there is nothing outside the sheet to
  reveal.) *Test it by reconstructing:* `sheet.left + --ml` etc. must equal the bar's rect.
- **The overlay needs asymmetric padding now the rails differ** (64px vs 248px). The sheet is
  a viewport-level fixed element, so `justify-content: center` centres it on the *viewport*,
  not the mat — it unfolded lopsided until the overlay was padded by the real gutters
  (`max(--deck-x, (100vw - --deck-cap)/2)` plus each rail).
- **`matchMedia`'s `change` event does not fire on every viewport path** — it doesn't under
  devtools viewport emulation. The CSS flipped to the desktop grid while the rails still held
  no children: two dead panes. The watcher listens to `resize` as well.
- **…and it must read `matches` on a timer, not inline.** A `resize` can arrive *before*
  matchMedia re-evaluates, so `if (matches === deskWas) return` compares a stale value,
  returns early, and — since `deskWas` never advances — the crossing is missed permanently
  until the next resize. Debounced ~60ms, which also stops it re-rendering on every pixel of
  a live window drag.
- **The scope pull-down animates `grid-template-rows: 0fr → 1fr`**, not `max-height`. It's the
  only way to transition to a *content* height, so TOPICS below is displaced by the list's
  real height at the real rate. Its nodes are built once and refilled — rebuilding them per
  render would restart the transition mid-flight.
- **The photo row's grab cursor comes with actual drag-to-scroll**, mouse-only: touch keeps
  native momentum *and* the two-finger pinch that fans the row into a deck. A drag past 4px
  swallows the click that follows, so dragging across an image doesn't also open its preview,
  and `scroll-snap-type` is suspended during the drag or it keeps yanking back to a card. The
  cursor is gated on the wrapper's `show-left`/`show-right` — the same overflow measurement
  the edge fades use — so it never promises a drag on a row that doesn't scroll.
- **`elementFromPoint` will not find the bottom frost** — it's `pointer-events: none`, so a
  hit test reports the entry text underneath as topmost and reads like a z-order bug. Tint
  the element instead of hit-testing it.
- **A wedged preview compositor can fake a layout bug for a long time.** A strip of stale
  content under the compose bar survived opaque-white, opaque-red, `z-index: 999`, and
  `backdrop-filter: none` completely unchanged — and an outline added to the mat refused to
  draw along its bottom edge. Every measurement said the layout was correct; a forced full
  repaint (navigate + resize) cleared it. When five different style states produce a
  pixel-identical region, suspect the compositor, not the CSS.
- **The compose bar's width must equal the reading column's** (both 600) or the bar's edges
  stop lining up with the cards'. Change one, change the other.
- **The page no longer scrolls; `.wrap` does.** `html, body` are `overflow: hidden`, so the
  frost and the dock can be absolute siblings that simply don't move. The header's
  hide-on-scroll listens on `window` and is therefore inert — deliberately, it's a phone
  pattern — and `.header.hidden` is neutralised so nothing can strand it off-screen.
- **The deck is capped at 1400px and centred.** Past that the centre pane just grows white
  margin around a fixed reading column — the same "column stranded on a field" the rails were
  meant to solve. Beyond the cap the extra width becomes field the window floats on.
- **The rail's search field is built once and never rebuilt** (`buildRightRail`), the same
  lesson as the composer's `build()`: re-creating a focused input every keystroke drops the
  caret and breaks IME composition — and this app has 月 in its own title. Only the lists
  below it refill. *Verified by node identity:* `document.activeElement === inp` still holds
  after a render.
- **Rail state doesn't survive the breakpoint.** Crossing below 1080 clears `deskQuery`,
  `deskTopic` and `deskScope`, or the phone layout stays silently filtered with no control on
  screen to clear it.
- **The bottom frost is opaque at its base on desktop.** The 0.94 white was tuned to let the
  grey canvas glow through on a phone; inside the mat there is nothing behind it worth seeing
  through, and the translucency just let entries peek out under the compose bar. It fades
  `--mat → --mat-a → --mat-0`, so it stays invisible against whatever the mat is.

Still open:

1. **Two gestures are touch-only** with no desktop equivalent: pinch-to-stack a gallery, and
   pinch-to-compact the list. Both still need a visible affordance. (The notch drag and both
   long-presses use pointer events and already work with a mouse.)
2. **Hover is in, lightly** — rail rows, entry rows, stepper, compose controls, all under
   `@media (hover: hover)`. No card lift yet; lifting a whole topic card when the pointer
   crosses any one of its entries is a lot of motion in a list.
3. **Keyboard is deliberately small**: ←/→ steps the period, ⌘N opens the composer, ⌘K
   focuses the rail search (falls back to `openMenu()` on mobile widths). Guarded on
   `typingTarget()` and `anySheetOpen()`. Everything else already has a visible control.
   **⌘K is claimed twice, by depth.** In the composer it's paste-a-link — the same op as the
   bar's `L`, but it asks for the url straight away instead of needing words selected first
   (with a selection those words are the label; with a bare cursor the url labels itself with
   its domain). The composer's handler `stopPropagation`s *and* the document handler bails on
   `anySheetOpen()`: either alone leaves a hole, because ⌘K pressed on a chip rather than in
   the textarea never reaches the composer's listener, and used to focus the rail search
   behind the overlay.
4. `@media (min-width: 700px)` on the composer textarea is superseded twice over now — by the
   full-height expanse and by the desktop block. Check it before relying on it.
5. **The week/month jump list is gone**, removed 30 Jul. Period navigation on desktop is the
   header's `‹ W31 / 7月 ›` and ←/→ only; there is no way to leap several weeks back in one
   move. If that starts to bite, it wants to return as a picker off the header, not as a rail.

**Don't break:** the sync layer (localStorage-first, one Supabase row per doc,
last-write-wins) is untouched by all of this and easy to damage — see the
`deposits-sync-data-loss-guards` skill before touching persistence.

---

## 6. Verification habits that caught real bugs

- **Assert node identity** to prove something wasn't rebuilt.
- **Sample intermediate values** across an animation, not one `getComputedStyle` — a
  transition makes the computed value at t=0 the *old* one, which reads as "nothing applied".
- **Measure, don't eyeball**, for "does this match that": pill heights, gaps, cap heights.
- **To measure a first LINE box, range the first text node — not `el.getClientRects()[0]`.**
  That returns *block* boxes, so on an entry `<p>` (whose rich-text renderer wraps content in
  a child block) it hands back the whole paragraph. A two-line paragraph then reads as half a
  line box "misaligned" and sends you chasing an alignment bug that isn't there:
  `r.setStart(firstTextNode, 0); r.setEnd(firstTextNode, 3); r.getBoundingClientRect()`.
- **Match icons by their drawn ink, not their SVG box.** A 19px `<svg>` whose path spans 13
  of 24 viewBox units draws ~10.3px of glyph; sizing a neighbouring mark to 19px makes it
  read twice as large. Measure `path.getBoundingClientRect()`.
- **In a backgrounded preview tab, rAF and CSS transitions don't tick, and `.focus()`/`.blur()`
  change `document.activeElement` without dispatching focus events.** Several "bugs" were this.
  Force paints with a screenshot, or dispatch the events by hand.
- Seed `localStorage` directly for fixtures, and **clear it afterwards** — it's the same
  origin the real app uses.
