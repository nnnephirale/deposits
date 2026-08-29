# ssaved — its own Worker

Split out of `../worker` on 28 Aug 2026. Both apps were behind one Worker, so they shared one
daily request budget; when it ran out (Cloudflare error 1027, 100,000 requests a day on the
free plan) *both* went dark at once, on every device, with nothing in either app to say why.
SSaved's reads are unauthenticated by design, so a crawled share link or a left-open tab could
spend a journal's quota.

Two Workers, one bucket. The data is untouched — `ssaved/…` keys are exactly where they were.

## Deploy

```bash
cd worker-ssaved
npx wrangler deploy
npx wrangler secret put DEPOSITS_SECRET     # the same secret deposits uses
```

Then point SSaved's client at `https://ssaved.<you>.workers.dev` and check a collection loads.
**Only then** flip `SSAVED_ROUTES = "off"` in `../worker/wrangler.toml` and redeploy that one —
until you do, the old `/s/…` routes keep answering there and nothing breaks in the meantime.

## The cron

Hourly, and it does two things that are both somebody else's uptime:

- **Pings Supabase**, which SSaved still reads from. A free project pauses after ~7 days idle,
  and SSaved keeps no local copy of its cards, so a paused project means SSaved is down.
- **Checks `deposits/health`** and pushes a message to `ALERT_URL` when it isn't 200. deposits
  is local-first: an outage there is invisible for days, because the app keeps working and
  simply stops syncing.

`ALERT_URL` is any endpoint that takes a POST body. [ntfy.sh](https://ntfy.sh) needs no account:
pick an unguessable topic, set `ALERT_URL = "https://ntfy.sh/<that-topic>"`, install the ntfy
app and subscribe to it.

**To get it as email**, set `ALERT_EMAIL` as well — ntfy forwards the same message to that
address. It is their free forwarding, so it is rate-limited and arrives from ntfy rather than
from you; for something more yours, Cloudflare Email Routing plus a `send_email` binding sends
direct from this Worker, but that needs a domain on the account and a verified destination.

Try it without waiting for a failure:

```bash
curl -H "Email: you@example.com" -H "Title: deposits" \
     -d "test" https://ntfy.sh/<that-topic>
```

This watch runs on the same Cloudflare account it is watching, so a daily-limit rejection can
stop the cron as well — which is exactly the failure it exists to catch. That is why
`.github/workflows/health.yml` checks the same endpoint from outside Cloudflare. Two cheap
checks that fail independently beat one good one.
