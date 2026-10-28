# Phase 1: Data model and ingestion, three tiers

Schema 0002, ingestion framework (tier-1 ICS/JSON-LD/RSS, tier-2 extraction,
tier-3 user), geocoding, source research in `docs/sources.md`, 12 sources
seeded, 261 upcoming events ingested across 5 categories. The 300-event /
5-category fallback target is met on categories; volume closed at 261 by
explicit decision (option B, see below).

## What was built

- Migration `0002_events.sql`: `sources`, `venues`, `events`,
  `event_sources` (one canonical event, one row per listing). RLS on, no
  policies (service-role only). Public views `public_events`/`public_venues`
  expose the allowlist only — never `raw_text`/`raw_hash`. No `event_pricing`
  yet (phase 2). Categories in `packages/shared` (12 values).
- `worker/src/ingest`: `Adapter` interface returning zod `EventDraft`;
  ICS (RRULE/EXDATE expansion, 90-day window), JSON-LD, RSS/Atom, tier-2
  HTML extraction (`listing_extraction` task, contributor model only,
  verbatim evidence quotes, $2/run cap, content-hash cache),
  user-submitted; shared fetcher (robots.txt, Crawl-Delay, 3 s/host, honest
  UA with contact URL, ETag/If-Modified-Since, timeouts, hard no-retry on
  403/401); dedupe (`raw_hash` within source, title+start+venue key across
  sources); runner (`--dry-run`, `--full`, `--source`), probes, seed.
- Geocoding: Nominatim at 1 req/s with honest UA, file cache, JSON
  overrides file (underscore keys stripped before validation). Venue time
  zone, default America/Toronto; `starts_at` stored in UTC.
- Source discovery: 26 Ottawa-area sources researched in `docs/sources.md`
  (name, URL, feed type, robots, terms link, tier, recommendation). No
  guessing: unfetchable robots/terms marked unknown, ToS-barred excluded,
  model-training ambiguity flagged.

## Approvals and access checks (2026-10-27)

- Approved: #1 OPL, #2 City, #4 OAG, #5 Nature, #8 War, #13 OFM,
  #14 GCTC, #15 Chamberfest, #16 History, #17 OLT, #19 Diefenbunker
  (numbers match `docs/sources.md`; an earlier revision mismapped #5+).
- #2 City: access check returned an empty bot-wall page (HTTP 200, 0 text
  chars) — dropped, recorded in `docs/sources.md`, not retried.
- #1 OPL: main listing reachable; upgraded to tier-1 ICS-index (per-event
  `.ics` links on the booking subdomain). Pagination investigated and
  abandoned: `?page=0,N` and `?page=N` both return page 1 to stateless
  fetches (faceted browser needs session state). Single index page only.
- #19 Diefenbunker: America/Toronto override verified against the event's
  own page (states UTC-4, feed tags America/Halifax).
- Fallback target in force (OPL+City blocked/partial): ≥300 upcoming
  events across ≥5 categories. Closed at 261/5 by explicit decision
  (option B) — see the extraction section.

## Real-run counts (2026-10-27, `--full`)

Per source: OPL 123, OAG 13, Diefenbunker 3, OFM 2, six HTML stubs 0.
Total inserted: 141 upcoming, each with an official link and a venue.

Per category: library 123, arts 13, museums 3, markets 2 (4 categories;
music/others need tier-2 extraction).

Re-run: `inserted=0`, all unchanged — ETag + dedupe idempotency holds.
(Dry-run rounds earlier read 138/146/156; the variance is listing churn
plus a since-reverted pagination experiment.)

## Tier-2 extraction + OPL slices (2026-10-28)

Authorized: extraction for the six HTML sources (Nature, War, History,
GCTC, Chamberfest, OLT), public listing text only, `listing_extraction`
task (confirmed the only task on the contributor model), $2/run budget,
verbatim evidence quotes (field null without one; event dropped without a
title or start quote), no free/paid or age inference (no such schema
fields; free text must be a substring of its quote), page-content-hash
cache (re-runs make zero model calls).

- `worker/src/ingest/extract.ts`: deterministic prompt (page text + links
  + date), per-field evidence validation, wall-time → UTC with
  impossible-date rejection, event links validated by link-set membership
  (fallback: listing page), unknown keys stripped. Wired through the html
  adapter and `run.ts` (dry-runs extract too, warming the cache).
- OPL: robots re-checked (booking crawl-delay 10, filtered URLs allowed);
  `probe:opl` tried 4 single-filter URLs. English (1-20 of 385) and Adult
  (1-20 of 328) differ from baseline and were configured as extra tier-1
  ICS-index sources; branch "Other Locations" (1 junk event) and category
  2SLGBTQIA+ (0 events) skipped.
- Chamberfest listing yields 0 correctly (dated entries are past posts,
  upcoming concerts dateless — the rule refuses to invent dates).
  Detail-page extraction (`linkPattern /event/20\d\d/`) explicitly
  approved: 24 drafts → 12 events, unlocking music.
- OLT seed URL `/calendar/` → `/2026-season/` (calendar is an empty JS
  shell; approved same-source fix, DB row updated by SQL since seed
  matches by URL).

Final DB counts (SQL): 261 events. Per source: OPL 174, OPL-Adults 28,
OAG 14, Chamberfest 12, OPL-English 9, War 7, GCTC 5, Nature 4,
Diefenbunker 3, OFM 2, History 2, OLT 1. Per category: library 211,
arts 20, museums 16, music 12, markets 2 — 5 categories.

Dedupe at scale: the top-up run linked 302 listings to canonical events
(English slice 100% overlap on first pass) with zero duplicates.
Live-page variance observed (OPL page-1 rotation +9 on re-run, War page
4→7→4 across runs); runs only ever add newly-seen listings.

Fallback verdict: categories 5/5, volume 261/300. Closed by explicit
decision (option B: accept 261/5). Re-opening needs OPL branch slices
(same method, one more probe cycle) or new approved sources.

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
- `probe-opl.ts` ran `main()` on import, so its test suite executed a live
  probe and `process.exit` killed the run. Entrypoint now guarded to
  direct execution only (the accidental run still produced the valid
  filter findings, polluting nothing: memory ETags, no DB writes).

## Verification (user terminal; agent shell was SIGKILLed throughout)

- `npm run typecheck && npm run lint && npm test`: green, 95/95.
- `npx supabase db push`: 0001 + 0002 applied (after dropping stray
  hand-made tables that collided with 0001).
- `npm run seed-sources`: 10, then 0, then 2 (idempotent; OPL slices).
- OLT URL fix by SQL (seed matches by URL, so no re-seed).
- Dry-runs (383 → 408 projected with fixes), `--full` top-up real run
  (110 inserted, 197 linked), plain re-run (+10 from live-page rotation).
- Per-source and per-category SQL counts confirm 261/5. Commit: below.

## Open items

- INGEST_CONTACT_URL must stay set in `.env` for honest-UA runs.
- Real runs must use `--full` until HTML extraction learns ETag-aware
  re-extraction: a plain run 304-skips unchanged listing pages and would
  miss re-extraction (dry-runs always fetch fresh, so counts stay true).
