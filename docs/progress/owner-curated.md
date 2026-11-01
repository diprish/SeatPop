# Owner-curated events and registration windows

City of Ottawa recreation facts the owner transcribes by hand. Nothing
here is crawled: no ottawa.ca or ActiveNet fetching, anywhere.

## Step 1: owner events seed

`data/seed/owner-curated-events.json` is an array of rows (empty until
the owner transcribes the first event):

```json
{
  "title": "Preschool Swim Lessons",
  "venue_name": "Nepean Sportsplex",
  "starts_at": "2026-12-05T10:00:00-05:00",
  "ends_at": "2026-12-05T10:30:00-05:00",
  "price_kind": "paid",
  "amount_min_cents": 5000,
  "amount_max_cents": 5000,
  "price_quote": "Fee: $50.00 per session.",
  "ages_quote": "Ages 3 to 5.",
  "age_min": 3,
  "age_max": 5,
  "source_url": "https://ottawa.ca/…official-page…",
  "category": "sports"
}
```

- `source_url` (https) is required: rows without the official link are
  rejected. Times need an explicit zone. `category` is one of the
  twelve event categories.
- Every value runs through the shared quote verifier, grounded in the
  transcription itself: amounts need digits + a currency token in
  `price_quote`, ages need their digits in `ages_quote` (month spans
  use the same floor rule as enrichment). Ages without a quote are
  rejected. Bad rows fail the run with every error listed — nothing is
  written until the file is clean.
- `npm run seed:owner-events --workspace @seatpop/worker [-- --dry-run]`
  upserts by `source_url` + `starts_at` (event + `event_sources` link +
  enrichment + pricing rows), resolves venues by exact name (creating
  missing ones, coordinates from the venue seed when it matches), and
  maintains the `City of Ottawa Recreation` source row: kind
  `user_submitted` (tier 3), `enabled = false`, and a provenance note
  (migration `0019`). A retimed event warns loudly about its stale key
  instead of deleting.
- Owner rows are never model-overwritten: enrichment (even `--force`)
  and months repair both skip `model = 'owner-transcribed'`, and the
  stored change hash equals the one enrichment computes, so scheduled
  runs also see the row as current. Amounts without an explicit
  USD/EUR/GBP token store `CAD`.

```sh
npx supabase db push   # 0019 first (the loader reads sources.notes)
npm run seed:owner-events --workspace @seatpop/worker -- --dry-run
npm run seed:owner-events --workspace @seatpop/worker
```
