# deposits — the Cloudflare Worker

The whole backend: one private R2 bucket behind a shared secret. Nothing to keep warm,
nothing that pauses, no database to provision.

## What lives in the bucket

```
entries.json    every entry, without photos — small, rewritten whole on each push
images/<id>     one object per photo, written once and never rewritten
```

Photos are separate objects on purpose. The Supabase setup kept them as base64 inside the
rows and pulled every row on every launch, so each app start re-downloaded every photo ever
pasted. That is what ran the shared free tier out of transfer. Here a photo is fetched at
most once per device, kept in that device's IndexedDB, and never asked for again. Steady
state is one small JSON GET per launch.

## Setup

You need a Cloudflare account. R2 generally asks for a card on file to switch on, even
though nothing below goes near the free allowance.

```bash
cd worker
npx wrangler login
npx wrangler r2 bucket create deposits
npx wrangler secret put DEPOSITS_SECRET     # paste a long random string; keep a copy
npx wrangler deploy
```

Generate the secret with something you won't have to remember:

```bash
openssl rand -base64 32
```

Deploy prints the Worker's address. Open the app → Settings → cloud sync, paste that address
and the same secret, and press connect. Repeat on each device. Nothing on this side expires —
but see the seven-day clock below, which is what actually disconnects a phone.

**Add the app to the home screen on iOS.** Safari deletes every scrap of a site's
script-writable storage — `localStorage` *and* IndexedDB — after seven days of Safari use
without a visit to that site. The Worker address and secret live in `localStorage`, so a
phone left alone for a week comes back with no entries, no key, and the connect form showing,
as though it had never been set up. A home-screen install is exempt (and is also how Safari
decides to grant persistent storage, which the app requests on every launch). Nothing is lost
when it happens — the entries are in the bucket — but the key has to be re-entered, and the
easy way is Settings → **copy setup link** on a device that still works, then open that link
on the phone.

Settings now says which of these a device is in: a green dot and "last synced …" when
requests are landing, amber when they are not, and a line naming the seven-day clock on any
device still exposed to it.

Before deploying, set `ALLOWED_ORIGIN` in `wrangler.toml` to wherever the app is served from.
It's defence in depth — the secret is the actual lock — but it stops any other page from
using a leaked secret from a browser.

## Free tier

Storage 10 GB, and downloads are never charged. At roughly 300 KB a photo that's about
33,000 photos. Writes are 1M/month, reads 10M/month; a journal makes a handful a day.

## The scheduled ping

`crons` fires every 4 days and pokes the Supabase project SSaved still uses. SSaved keeps no
local copy of its cards, so whenever that project pauses, SSaved is simply down. Its own
keep-alive is a GitHub workflow, and GitHub disables scheduled workflows after 60 days of
repo quiet — which is how it died the first time. Cloudflare's scheduler has no such rule.

Watch it with `npx wrangler tail`; it logs the status and says plainly when the project is
paused or over its limits.

If you later move SSaved off Supabase too, delete the `[triggers]` block and the two
`SUPABASE_*` vars.

## API

All routes except `/health` need `Authorization: Bearer <DEPOSITS_SECRET>`.

| | |
|---|---|
| `GET /health` | liveness, no auth |
| `GET /entries` | `{ entries, tombstones, summaries, etag }` |
| `PUT /entries` | send `If-Match: <etag>`; `412` means another device wrote first |
| `GET /images/:id` | the photo, cached immutably |
| `PUT /images/:id` | upload; an id already present is skipped |
| `HEAD /images/:id` | existence check |

`PUT /entries` is conditional so two devices can't silently overwrite each other. On a `412`
the client re-reads, re-merges by `updatedAt`, and writes once more.
