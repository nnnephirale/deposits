# deposits: working notes for agents

A weekly journal PWA. Plain HTML, CSS and ES modules, **no build step**, served from `main`
by GitHub Pages (`nnnephirale.github.io/deposits`). Data lives in IndexedDB on the device
and optionally syncs through a Cloudflare Worker (`worker/`).

[DESIGN.md](DESIGN.md) holds the *why* (decisions, tuned numbers, bugs already fought). Read
the section for the area you're touching before changing it. This file is the *where*.

## Where to change what

| to change… | look in |
|---|---|
| colours, tokens, page and header | `css/base.css` (`:root`), `css/dark.css` |
| dark mode | `css/dark.css`, `js/prefs.js` (appearance), `tone()` in `js/taxonomy.js` (pill colours) |
| the list: period row, groups, entry cards, day gutter | `css/list.css`, `js/render.js`, `js/entries.js` |
| day view, topic pills on an entry, the weekly summary block | `css/summary.css`, `js/entries.js`, `js/week-summary.js` |
| rich text: markers, checklists, links, photos, redaction | `css/richtext.css`, `js/richtext.js`, `js/widgets.js` |
| read-more modal, the ⋮ menu, full-screen image preview | `css/overlays.css`, `js/entries.js`, `js/menu.js`, `js/widgets.js` |
| the compose bar and the composer sheet (head, chips, pickers) | `css/composer.css`, `js/compose-bar.js`, `js/composer.js` |
| the formatting row and line-ops popover | `css/format-bar.css`, `js/composer.js` |
| phone keyboard, caret, sheet height | `js/viewport.js` |
| Settings sheet, tag editor | `css/settings.css`, `js/settings.js`, `js/taxonomy.js` |
| a new preference | `js/prefs.js` (state + `localStorage`), a row in `js/settings.js` |
| the chevron, heat bloom, status-bar tint | `css/bloom.css`, `js/bloom.js` |
| monthly recap, weekly reveal | `css/recap.css`, `js/recap.js`, `js/week-reveal.js` |
| desktop (≥1080px): rails, mat, calendar, search scope | `css/desktop.css`, `js/rails.js` |
| search | `js/search.js` (sheet CSS is at the end of `css/bloom.css`) |
| Claude calls (summaries, ramble cutting) | `js/anthropic.js` |
| saving, storage, sync | `js/save.js`, `js/store.js` (IndexedDB), `js/sync.js` (transport), `js/sync-ui.js` |
| dates and weeks | `js/dates.js` |
| boot, global wiring, keyboard shortcuts | `js/main.js` |
| gradient tuner (TEMPORARY) | `css/tuner.css`, `js/tuner.js` |

Every JS file opens with a comment saying what's in it.

## Rules that will bite

- **CSS load order is the cascade.** The `<link>` order in `index.html` is deliberate:
  `desktop.css` and `dark.css` override earlier files at equal specificity. A new rule goes in
  the file for its area; don't reorder the links.
- **Literal colour in a light rule → add its dark twin in `css/dark.css`.** If a state
  variant (`.on`, `.open`, `:active`) recolours that element, guard the twin with
  `:not(.on)` and the like, because `:root[data-theme="dark"] .x` outranks `.x.on`.
- **Shared state lives on `S` (`js/state.js`).** An imported value is read-only. If a second
  file needs to *reassign* a module's `let`, move it onto `S` (`S.entries`, `S.view`, `S.wk`…).
  Mutating an object in place is fine without that.
- **Startup code stays local.** Code that runs at load (not in a function) may only read its
  own module, `state.js`, `dates.js` and `dom.js`. Modules import each other in cycles, so
  another module may not have run yet. Calling functions is fine, reading their consts is not.
  Put cross-module work in a function that runs later (listener, `render()`, boot).
- **Sheet controls commit on `pointerdown`**, not `click` (the keyboard would collapse
  first). A synthetic `.click()` in a test won't fire them; use real taps.
- **Topic colours aren't stored per theme.** Render pills through `tone(t)`, never `t.bg` directly.

## Checking a change

- Preview: `.claude/launch.json` → `deposits` (http-server on port 4173).
- Check phone width and ≥1080px, light and dark (Settings → appearance), and the console.
- `window.__deposits` in the console: `entries`, `export()`, `read(y, m)` opens a month's
  recap without the chevron drag, `recap()`, `sync()`.
- Nothing here calls Claude or the Worker without a key and Worker URL, so say when those paths
  weren't exercised.

## Shipping

Commit or push only when she asks. Pushing `main` deploys. Bigger changes go on a branch with
a PR. After a push, confirm the Pages deploy landed before calling it live.
