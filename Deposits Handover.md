# deposits — project handover

Context doc for continuing development in Claude Code. Read this alongside `Deposits.html`, which is the canonical and only source file. (An earlier React version, `weekly-deposits.jsx`, exists but is stale — ignore it or delete it.) `index.html` in the `deposits` GitHub repo is a deploy copy of this file — when editing, update `Deposits.html` here and re-copy to `index.html` before pushing.

---

## What this is

A personal weekly journaling capture app for ML. iOS-inspired, phone-first, single-file HTML with vanilla JS. She writes reflections longhand in a physical notebook, then transcribes the relevant fragments into this app. The app's job is capture + rollup, not writing.

**The north star:** capture must be faster than opening Apple Notes. Every design and flow decision defers to this. If a feature adds friction to the capture path, it doesn't ship. The whole system fails if transcription feels like homework.

**Her two goals for the practice:**
1. Recognition that each month was well-lived (experienced, enjoyed, learned, gained)
2. Learnings that compound through the year — hence structured, taggable, exportable entries she can hand to AI for pattern analysis later

## The user

Senior art director, Singapore. Strong opinions on type and visual systems — she noticed and specifically requested the mono-caps treatment be extended, so typographic consistency matters to her. Has a vibe-coding practice (vanilla JS, React, has shipped Supabase-backed tools before). Comfortable reading code. Communicates in lowercase, direct, no corporate padding. Don't over-explain; do flag tradeoffs honestly.

## Core concepts & data model

Entries are atomic deposits: one thought, tagged, assigned to an ISO week and a day of week.

```js
{
  id: string,            // Date.now().toString(36)
  createdAt: string,     // ISO timestamp
  updatedAt: string,     // ISO timestamp, bumped on edit; may be absent on old entries
                         // (entryStamp() falls back to createdAt)
  text: string,
  tags: string[],        // mix of topic ids and mode ids
  year: number,          // ISO week-year (not calendar year — differs at year boundaries)
  week: number,          // ISO week number
  day: number | null     // 0–6, Monday = 0. null = deliberately no day ("–" in the
                         // scrubber, "anytime" bucket in day layout). Older entries may
                         // lack the key entirely; entryDay() falls back to weekday of
                         // createdAt for those (undefined ≠ null here).
}
```

**Two tag species, deliberately distinct:**
- **Topics** (9, fixed): work, notable eats, health & fitness, watched/watching, internet things, shopping, relationship, home, listening to. Each has a tint (bg/fg/dot hex values in the TOPICS array).
- **Modes** (3, fixed): i want to remember, weekly rundown, what i've learned. Rendered outlined/neutral; selected state = ink fill.

Topics are "what is this about", modes are "what kind of thought is this". An entry can carry both (e.g. work + what i've learned). Tag set is intentionally closed — she derived the 9 topics from scanning months of real weekly rundowns. Do not add tag-creation UI without her asking.

**Grouping rule:** entries group under their *first* topic tag; entries with only a mode group under that mode; otherwise "untagged". Everything is chronological **newest first**: within groups, day descending then createdAt descending (no-day entries last). Topic groups order by latest-updated-first (max entryStamp per group); day/week groups chronological. No manual reordering — see below. Markdown export ignores all of this and stays in fixed taxonomy order.

**Layout experiment (temporary):** mono-caps toggles next to the h1 — day / mix / dense. Rejected along the way: flat, and a "dense↑" variant (in-card top label for single-entry groups only, headers kept for multi-entry — she found the inconsistency between the two treatments irksome). **Baseline (no toggle active) is the default on every open** — deliberate: layout choice does not persist across launches. Dense is now headerless entirely: every entry, regardless of group size, carries its topic pill in the bottom meta row next to the day token — consistent tag position was the point. Group headers (baseline/day/mix) have no counts. Once she settles, strip the toggle row.

**Group drag-to-reorder — tried and reverted (3 Jul 2026).** Built manual drag-reordering of groups (drag by the group label, threshold to distinguish from tap-to-edit, order persisted in localStorage, reset button). Pulled after real testing: felt glitchy, and doesn't scale — with many entries/groups a long list is unwieldy to drag across. Removed entirely rather than left half-working. If revisited, worth designing for the actual failure mode (long lists) from the start — e.g. a dedicated reorder mode / edit-list screen instead of live drag on the main view, or up/down nudge buttons instead of continuous drag.

**Weeks and months:** ISO weeks throughout (getISOWeek / mondayOfISOWeek / shiftWeek helpers). A week belongs to whichever month its Thursday falls in — keeps weeks whole in monthly rollups, nothing splits across two months.

**Day notation:** her personal journal system — M, T¹, W, T², F, S¹, S² (superscripts are \u00B9 \u00B2). Used on the composer day pill, entry metadata, and markdown export.

## Current features

- **Capture:** floating + (bottom center), bottom sheet slides up, textarea autofocused. Chips for topics/modes, week stepper with Mon–Sun date range + "back to this week" link. Save top-right. New entries default to the week currently being browsed (week view) rather than always today's real week — lets her catch up on past weeks without re-stepping the picker each time. Day still defaults to today's real weekday regardless of browsed week.
- **Day scrubber:** top-left of sheet header (replaced the Cancel button — overlay tap dismisses instead). Press-hold-drag: strip of 7 day tokens slides out, drag highlights, release commits. Quick tap opens the strip sticky for tapping. Pointer-captured with an 8px movement threshold distinguishing scrub from tap. Today's token is marked with a small red dot in the strip. **Untested on real device as of handover — she may want the threshold tuned.**
- **Views:** week/month segmented control. Both group by topic, iOS grouped-inset-list style. Month view shows W## per entry.
- **Export md:** long-press the + FAB (500ms) to swap it to a share icon, tap to copy current view as grouped markdown (fallback: selectable textarea sheet). FAB auto-reverts to + after export or 5s untouched. Format: `- text _(modes)_ — T², W27` under `## topic` headings (day part omitted for no-day entries). This is her hand-to-AI artifact and her backup.
- **Edit/delete:** tap any entry to reopen the composer; delete button appears in edit mode.
- **Storage:** localStorage, key `weekly-deposits-entries`, single JSON array, with in-memory fallback if blocked.

## Design system

Everything in CSS variables at the top of the file:
- Canvas #F2F2F7 (iOS system grey 6), cards white, ink #1C1C1E, subtle #8A8A8E, hairline #E5E5EA, field #F6F6F8
- System font stack for body; SF Mono / ui-monospace for all "apparatus" — week numbers, day tokens, group labels, chips, timestamps
- **The typographic rule she cares about:** all labels/chips/tokens are mono, uppercase, 11–13px, letter-spaced. Grey when idle, coloured only when selected/active. Keep this consistent in anything new.
- Topic tints are muted pastels with darker fg — see TOPICS array. Modes never get colour; their active state is ink fill.
- iOS conventions: bottom sheets with grabbers, segmented controls, grouped inset lists with hairline dividers, frosted sticky header (backdrop-filter), safe-area insets respected, prefers-reduced-motion respected.

## Decisions already made (don't relitigate)

- localStorage now, **Supabase when it reaches good-enough beta** (she's built with Supabase before — SSaved project)
- Phone-first, desktop occasional; mobile view is priority
- Tag set fixed for now
- The app replaces Apple Notes for quick capture — this framing wins any UX tradeoff
- Vanilla JS single file, zero dependencies, works offline. She may lift it into her own hosted setup; keep it portable.

## Known issues / open threads

1. **~~The Quick Look trap~~ — resolved:** deployed to GitHub Pages at `nnnephirale.github.io/deposits` (public repo `nnnephirale/deposits`, `index.html` at root, Pages serving from `main`). Open in Safari, Add to Home Screen, avoids the Quick Look localStorage issue. Client cache is 10 min on top of build time — after pushing, verify the deploy actually landed before telling her it's live (see the `github-pages-stale-deploy-debugging` skill).
2. **Speed test pending:** home screen icon → composer should be under ~2 seconds. If it doesn't beat her Notes reflex in week one of real use, revisit the capture flow before adding features.
3. **Day scrubber feel:** 8px drag threshold, untested under a real thumb.
4. **Device-scoped data:** until Supabase, entries live on one device. Export md is the interim safety net — she should copy months out periodically.
5. **Timezone:** week/day math uses the device's local clock/timezone (not a hardcoded SGT offset) — deliberate choice, confirmed with her. Assumes the phone's timezone is set correctly to Singapore.

## Deliberately deferred (candidates for later, in rough order of prior discussion)

- Supabase swap (storage functions are isolated: `loadEntries` / `saveEntries` — designed as the single swap point)
- PWA polish: manifest, service worker for true offline + proper home-screen behavior
- Weekly/monthly reflection field (a freeform "what did this period teach me" text atop each rollup — discussed in early planning, cut from v1)
- Search
- Nothing gamified. No streaks. She didn't ask and it doesn't fit the practice.

## Working style notes

- Talk through the idea before building when the change is structural; just build when it's a tweak
- Flag tradeoffs plainly (she explicitly asked to be corrected when wrong — e.g. the physical-notebook-to-AI question)
- She'll iterate via real use and come back with specific, well-observed change requests — build exactly what's asked, note side effects, keep v-next suggestions to a sentence or two
