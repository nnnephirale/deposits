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
--mono     SF Mono / ui-monospace  — periods, pills, labels, all uppercase micro-copy
--day      'Lexend Exa' 500        — one use only: the day letter in an entry's badge
```

`--canvas-a` / `--canvas-0` are the same grey with alpha, for frosted surfaces. Reference the
token, never re-type the rgb — there were three hardcoded copies of the old canvas colour and
changing the background meant hunting them down.

**Radii:** 24px cards · 20px sheets · 18px compose bar · 999px pills and format buttons ·
14px gallery cards · 12px arrow buttons.

**Elevation:** one recipe, `0 1px 2px rgba(0,0,0,.03), 0 6px 18px rgba(0,0,0,.045)`. Cards,
arrow buttons and the compose bar all use it or a slightly deeper variant. Nothing has a
hard border.

---

## 2. The layout as built (mobile)

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

**The compose bar is not a dock.** It's a resting text field. Tapping it unfolds the
composer *out of that same rectangle* (see §4). `+` opens the composer too; `⋮` opens the
menu, fenced off by a hairline so it doesn't read as part of the typing affordance.

**The menu (`⋮`)** is a centred floating modal holding what used to crowd the header:
a search field at the top — typing morphs the body below into matching entries — and
otherwise the settings list (Day view toggle, Export markdown, Settings).

**Layouts:** only two. The default topic grouping, and a "Day view" toggle. `mix` and
`dense` were experiments and are gone; "nothing selected" is a real, reachable state.

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
`cubic-bezier(0.62, 0.01, 0.13, 1)`.

**`backdrop-filter` needs `mask-image`** or the blur ends on a hard vertical/horizontal seam
that looks like a rendering bug. Mask it in the same direction as the tint gradient.

**Frosted = blur + *light* tint.** A near-opaque white gradient defeats the blur entirely —
there's nothing left to see through. The white does the hiding; the blur only softens its
edge. Bottom fade landed at `blur(14px) saturate(180%)` with white at 0.94 → 0.6 → 0.

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

**The composer unfold.** The sheet is `clip-path`-ed to the compose bar's *measured*
rectangle — same grey, same 18px rounding — then released, so the box physically opens
outward while the grey turns white and the content fades in behind it. 0.78s on
`cubic-bezier(0.62, 0.01, 0.13, 1)`. The list behind it recedes in the same gesture:
`scale(0.93)` + `0.4` opacity from a top origin. That recede required *lightening* the
backdrop to `rgba(0,0,0,.18)` / `blur(2px)` — at 0.4 opacity it was happening behind
something too opaque to see through.

**Pinch a photo run** closed and it fans into a deck (white ring per card so they stay
distinct); spread it back to a row. State is keyed by the run's markers so it survives the
re-render that follows an unrelated edit.

**Shimmering placeholder.** `background-clip: text` sweep, 3.6s. Note it needs
`color: transparent`, which erases any SVG in the same element — the class is added/removed
with the bar's state so the export/copied icons survive.

---

## 5. Desktop upgrade — what's actually in the way

The app has never been designed for a wide viewport. `.wrap` is `max-width: 520px` centred,
so desktop today is a phone-width column on a big grey field. The open questions, roughly in
order of leverage:

1. **What fills the width?** The obvious candidates: a 7-column week grid (one column per day,
   which the day badges already imply), or a two-pane layout with weeks/months in a left rail
   and entries on the right. The current single-column topic grouping doesn't scale sideways —
   topic cards would become very wide and short.
2. **The composer is a bottom sheet** (`.overlay` is `align-items: flex-end`, sheet is
   `98dvh`). On desktop it probably wants to be a centred modal — but the unfold animation is
   built around the compose bar's rectangle at the bottom of the screen. If the bar moves
   (inline? a left rail?), the FLIP geometry follows it automatically (it measures the real
   element), but the *direction* of the growth will want rethinking.
3. **Two gestures are touch-only** and have no desktop equivalent: pinch-to-stack a gallery,
   and pinch-to-compact the list. Both need a visible affordance on desktop. (The notch drag
   and both long-presses use pointer events and already work with a mouse.)
4. **Hover is almost entirely unused** — the app is mobile-first, so there's very little
   hover state to build on. This is the cheapest visible win on desktop: card lift on hover,
   revealed row actions, the "invisible interface" pattern from her global preferences.
5. **No keyboard shortcuts** beyond ⌘B/I/U in the composer. Week navigation (←/→), new entry
   (⌘N), search (⌘K) are all missing and all natural on desktop.
6. **The header hides on scroll** — a mobile pattern that's usually wrong on desktop.
7. `@media (min-width: 700px)` exists for the composer textarea but is now superseded by the
   full-height expanse. Check it before relying on it.

**Don't break:** the sync layer (localStorage-first, one Supabase row per doc,
last-write-wins) is untouched by all of this and easy to damage — see the
`deposits-sync-data-loss-guards` skill before touching persistence.

---

## 6. Verification habits that caught real bugs

- **Assert node identity** to prove something wasn't rebuilt.
- **Sample intermediate values** across an animation, not one `getComputedStyle` — a
  transition makes the computed value at t=0 the *old* one, which reads as "nothing applied".
- **Measure, don't eyeball**, for "does this match that": pill heights, gaps, cap heights.
- **In a backgrounded preview tab, rAF and CSS transitions don't tick, and `.focus()`/`.blur()`
  change `document.activeElement` without dispatching focus events.** Several "bugs" were this.
  Force paints with a screenshot, or dispatch the events by hand.
- Seed `localStorage` directly for fixtures, and **clear it afterwards** — it's the same
  origin the real app uses.
