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
but read the next paragraph before setting up an iPhone.

**On iOS, install from a setup link — not from the plain address.** Safari deletes every
scrap of a site's script-writable storage — `localStorage` *and* IndexedDB — after seven days
of Safari use without a visit, and the Worker address and secret live in `localStorage`. So a
phone left alone for a week comes back with no entries, no key and the connect form showing.

The app's answer is Settings → cloud sync → **keep this device connected**, which puts
`#w=<worker>&k=<secret>` back in the address bar so that Share → *Add to Home Screen* saves an
icon carrying the key. A bookmark is not script-writable storage and is never swept: that icon
re-seeds the config on every cold launch, so a wiped device opens, reconnects and pulls its
entries back down without anyone noticing it had been wiped. The fragment is stripped from the
address bar as soon as it is read, so it lives in the icon and nowhere else.

The secret field is also a real password field in a real form, so Safari offers to keep it in
the keychain — which means iCloud, and every other device you own.

## Staying under the daily limit

Workers' free plan allows **100,000 requests a day** across the whole account, and the edge
answers 429 with error 1027 for the rest of the UTC day once that is spent. That page is
Cloudflare's, not this Worker's, so it carries none of the CORS headers `cors()` adds — which
means a browser refuses to read it and the app sees only "Load failed". Both devices go dark
at once and nothing in the logs explains it. `curl -i https://<worker>/health` shows the 1027
plainly; a browser never will.

What used to spend them: the app re-`PUT`ing every photo on every push. No bytes moved — the
Worker `HEAD`s the key and skips — but the request was still spent, so 33 photos meant 34
requests per save on a 1.2s debounce. A photo object is immutable, so a confirmed id is
confirmed forever; the client now keeps a small ledger of ids the bucket has acknowledged and
skips them, and steady state is one request per save. The ledger is per device and
disposable: lose it and the next push re-confirms each id once.

If the limit is still being reached, look at Workers & Pages → deposits → Metrics for which
route is hot. `/s/:collection` (SSaved) is *unauthenticated on reads* by design, so a shared
link that gets crawled or polled is charged to this same 100,000.

## Free tier

Storage 10 GB, and downloads are never charged. At roughly 300 KB a photo that's about
33,000 photos. Writes are 1M/month, reads 10M/month; a journal makes a handful a day.

## Two Workers now

SSaved's `/s/…` routes are moving to `../worker-ssaved`. One Worker meant one daily request
budget for two apps, and SSaved's reads are unauthenticated by design — so a crawled share
link could spend the journal's quota, which is how both went dark at once on 28 Aug 2026.

Deploy order matters, because SSaved cannot be repointed from this repo:

1. `cd ../worker-ssaved && npx wrangler deploy` and `npx wrangler secret put DEPOSITS_SECRET`
   (the same secret). The old routes keep answering here in the meantime, so nothing breaks.
2. Point SSaved's client at `https://ssaved.<you>.workers.dev` and load a collection to check.
   Note that SSaved may be taking its address from the shared `cf-worker` localStorage record,
   which this app writes and which still holds *this* Worker's address — repointing means
   giving SSaved its own URL rather than that shared one.
3. Set `SSAVED_ROUTES = "off"` in `wrangler.toml` and `npx wrangler deploy` here. From then on
   the two apps cannot take each other down.

## Knowing before she notices

deposits is local-first, so an outage is silent: the app keeps working and quietly stops
syncing. Two checks, deliberately failing independently:

- `.github/workflows/health.yml` — every 30 minutes, from GitHub, i.e. outside Cloudflare. A
  failing run emails the repo owner. Add a `DEPOSITS_SECRET` repo secret and it also reads
  `/entries`, which proves the bucket and not just the Worker.
- `../worker-ssaved`'s hourly cron pings this Worker's `/health` and pushes to `ALERT_URL`
  (an ntfy.sh topic needs no account). It is on the same Cloudflare account, so the daily
  limit can silence it — which is exactly why the GitHub one exists too.

## The scheduled ping

Gone from this Worker — it was SSaved's uptime, not this one's, and it moved with the routes
it serves. See `../worker-ssaved`. `.github/workflows/keep-supabase-alive.yml` still pings the
same project every 4 days as a second line; GitHub disables scheduled workflows after 60 days
of repo quiet, which is how SSaved's original keep-alive died, so the Cloudflare cron is the
one to trust.

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
