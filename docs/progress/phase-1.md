# Phase 1: Data model and ingestion, three tiers

Schema 0002, ingestion framework (tier-1 ICS/JSON-LD/RSS, tier-2 HTML stub,
tier-3 user), geocoding, source research in `docs/sources.md`, 10 approved
sources seeded, 141 upcoming events ingested. Tier-2 extraction is still a
stub; the 300-event / 5-category fallback target is not yet met.

## What was built

- Migration `0002_events.sql`: `sources`, `venues`, `events`,
  `event_sources` (one canonical event, one row per listing). RLS on, no
  policies (service-role only). Public views `public_events`/`public_venues`
  expose the allowlist only — never `raw_text`/`raw_hash`. No `event_pricing`
  yet (phase 2). Categories in `packages/shared` (12 values).
- `worker/src/ingest`: `Adapter` interface returning zod `EventDraft`;
  ICS (RRULE/EXDATE expansion, 90-day window), JSON-LD, RSS/Atom, generic
  HTML (visible text only, extraction stubbed for a later phase),
  user-submitted; shared fetcher (robots.txt, Crawl-Delay, 3 s/host, honest
  UA with contact URL, ETag/If-Modified-Since, timeouts, hard no-retry on
  403/401); dedupe (`raw_hash` within source, title+start+venue key across
  sources); runner (`--dry-run`, `--full`, `--source`), probe, seed.
- Geocoding: Nominatim at 1 req/s with honest UA, file cache, JSON
  overrides file (underscore keys stripped before validation). Venue time
  zone, default America/Toronto; `starts_at` stored in UTC.
- Source discovery: 26 Ottawa-area sources researched in `docs/sources.md`
  (name, URL, feed type, robots, terms link, tier, recommendation). No
  guessing: unfetchable robots/terms marked unknown, ToS-barred excluded,
  model-training ambiguity flagged.

## Approvals and access checks (2026-10-27)

- Approved: #1 OPL, #2 City, #4 OAG, #5 OFM, #8 Diefenbunker, #13 Nature,
  #14 War, #15 History, #16 GCTC, #17 Chamberfest, #19 OLT.
- #2 City: access check returned an empty bot-wall page (HTTP 200, 0 text
  chars) — dropped, recorded in `docs/sources.md`, not retried.
- #1 OPL: main listing reachable; upgraded to tier-1 ICS-index (per-event
  `.ics` links on the booking subdomain). Pagination investigated and
  abandoned: `?page=0,N` and `?page=N` both return page 1 to stateless
  fetches (faceted browser needs session state). Single index page only.
- #19 Diefenbunker: America/Toronto override verified against the event's
  own page (states UTC-4, feed tags America/Halifax).
- Fallback target in force (OPL+City blocked/partial): ≥300 upcoming
  events across ≥5 categories. NOT YET MET — see counts.

## Real-run counts (2026-10-27, `--full`)

Per source: OPL 123, OAG 13, Diefenbunker 3, OFM 2, six HTML stubs 0.
Total inserted: 141 upcoming, each with an official link and a venue.

Per category: library 123, arts 13, museums 3, markets 2 (4 categories;
music/others need tier-2 extraction).

Re-run: `inserted=0`, all unchanged — ETag + dedupe idempotency holds.
(Dry-run rounds earlier read 138/146/156; the variance is listing churn
plus a since-reverted pagination experiment.)

## Bugs found and fixed

- `store.ts rest()` called `response.json()` unconditionally, but
  `return=minimal` writes (`linkEventSource`, `recordSourceRun`) answer
  with an empty body — first real run died with "Unexpected end of JSON
  input". Empty bodies now resolve for minimal calls and throw a clear
  error for representation calls. Regression tests added (the old link
  test mocked a JSON body, which is why it passed).
- Geocode overrides: comment keys stripped before validation. RSS text:
  space-before-punctuation stripped. Fetcher 304 test: `Response`
  rejects 304 with a body, stub used instead.
- `EventCategory` imports fixed to `@seatpop/shared`.

## Verification (user terminal; agent shell was SIGKILLed throughout)

- `npm run typecheck && npm run lint && npm test`: green, 64/64.
- `npx supabase db push`: 0001 + 0002 applied (after dropping stray
  hand-made tables that collided with 0001).
- `npm run seed-sources`: 10 then 0 (idempotent).
- Dry-runs, `--full` real run (141 inserted), plain re-run (0 inserted).
- Per-category SQL check and commit: pending (see below).

## Open items

- Tier-2 extraction (contributor model, public listing text only) is the
  only path to 300/5 within approved sources: unlocks Nature/War/History
  (museums), GCTC/OLT (arts), Chamberfest (music = 5th category).
  Awaiting explicit authorization.
- OLT pages render thin text (possibly JS-heavy) — extraction may
  under-deliver there.
- INGEST_CONTACT_URL must stay set in `.env` for honest-UA runs.
