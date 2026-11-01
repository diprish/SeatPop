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

## Step 2: City registration windows

`data/seed/city-registration-dates.json` now holds the three
owner-transcribed windows, all scoped to `City of Ottawa Recreation`:

- `listings_visible`, 2026-11-03 (date only): "View online November 3."
- `registration_opens`, 2026-11-17T21:00:00-05:00: "All winter swimming
  activities November 17 at 9 pm." (label: All winter swimming activities)
- `registration_opens`, 2026-11-19T21:00:00-05:00: "All winter
  activities November 19 at 9 pm." (label: All winter activities)

Migration `0020` adds the `registration_windows.label` column; scope
always names a listing source now. Matching (`matchWindow`, used by
recommend attach, reminder scheduling, and the sender):

- only `kind = 'registration_opens'` rows are returned — a
  `listings_visible` row is a viewing notice, and presenting it as a
  registration opening would mislabel the City's date;
- swim-labeled windows match only events whose title or category says
  swim; every other event falls back to the general window;
- soonest upcoming opening still wins; past windows never show.

```sh
npx supabase db push   # 0020 first (the loader writes label)
npm run seed:registration-windows --workspace @seatpop/worker -- --dry-run
npm run seed:registration-windows --workspace @seatpop/worker
```

## Step 3: registration badge on cards

Event cards (For you and Explore share the component) show the
attached window as a pill badge — "Registration opens Nov 17, 9:00 PM",
Toronto-local, date-only windows without a time — followed by the
verbatim City quote as the link to the source page. No window (or an
unparseable instant) hides the block instead of showing a made-up
date. The booking checklist and detail page keep their existing
`formatWindowOpens` text; the badge has its own formatter.
