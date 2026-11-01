# SeatPop (hackathon edition)

SeatPop helps households find the right activity — free or paid, any
kind — for each person in them, register in time, and get confirmed
bookings onto a family calendar. Guest-first: results in seconds with
no sign-up; signed-in users may save a household. Pilot city: Ottawa,
Canada. Built with Meta models for the Meta Global AI Developer
Hackathon.

Live: https://seat-pop.vercel.app (Trust page:
https://seat-pop.vercel.app/trust)

## How it works

1. The LLM proposes, the verifier disposes: every model-extracted value must ground in a verbatim quote from the event's own text, or it is dropped.
2. Hard constraints run in SQL: age fit, budget, distance, time windows, language, and accessibility filter candidates before any ranking.
3. Privacy by design: age bands only — never names, birth dates, full postal codes, or addresses; typed household text is redacted and discarded.
4. Graceful fallback: rerank failures return the stage-2 order with templated reasons, and the app shows honest empty and error states instead of blank pages or invented numbers.
5. Polite crawling: robots.txt honored, rate limits, an honest user agent, loud failures — and owner-transcribed facts are never crawled at all.

## Run locally

Requires Node 20+. Secrets live in the repo-root `.env` (never
committed; the client bundle reads none).

```sh
npm install
cp .env.example .env   # fill in: SUPABASE_URL, SUPABASE_ANON_KEY, ...
npx supabase db push   # linked project; applies supabase/migrations
npm run dev --workspace @seatpop/web   # http://localhost:3000
```

Without Supabase credentials the app still runs but shows
not-configured states instead of data. Gates:
`npm run typecheck && npm run lint && npm test`. Deploy notes are in
`docs/deploy.md`; per-phase build notes in `docs/progress/`.

## Eval results

Recommend eval, 20 synthetic households, relevance graded by Muse
Wonder (labeled model-graded): **0 constraint violations** in every
top 10, mean NDCG@10 **0.990 reranked** vs 0.766 date-order and 0.895
stage-2-only baselines (14/20 households graded), policy probe ok, and
the no-key fallback proven by a key-removed run. Details:
[docs/eval-report.md](docs/eval-report.md). The [Trust
page](https://seat-pop.vercel.app/trust) renders the same reports; the
enrichment eval shows pending there until its run completes.

## Meta models and tools

- **Muse Spark 1.3** (Meta, standard): reranks the top 30 with
  stated-vs-inferred reasons; `profile_parse` turns typed household
  text into editable chips; `booking_parse` reads redacted booking
  confirmations. Household and email tasks are gated to standard Meta
  models — never contributor, never Baseten.
- **Muse Spark 1.3 contributor** (Meta): listing extraction and
  enrichment voting over public listing text.
- **Muse Spark Open on Baseten**: serves the no-training route
  exclusively (never falls back to contributor) and shares
  public-text extraction otherwise, under spend caps.
- **Muse Wonder 1.0** (Meta): eval judge producing NDCG relevance
  grades, always labeled model-graded.
- Interest embeddings are local bge-small vectors, not a hosted model
  call.

## Attribution

- Home-area centroids (migration 0008) are FSA rows used directly from
  the GeoNames free postal code dump (FSA-level lat/lng)
  (https://download.geonames.org/export/zip, © GeoNames contributors,
  CC BY 4.0, https://creativecommons.org/licenses/by/4.0/).
  Ottawa-area K-prefixed FSAs only; method and operator steps in
  `supabase/seeds/ottawa_fsa_from_geonames.py`.
- Venue coordinates (`data/seed/venue-coordinates.json`) for Ottawa
  Public Library branches contain information licensed under the City
  of Ottawa Open Data Licence v2.0
  (https://ottawa.ca/en/city-hall/get-know-your-city/open-data#open-data-licence-version-2-0).
  Museum, theatre, and market coordinates cite the venues' Wikipedia
  pages per entry (`source`); three entries are marked `"verified":
  false` pending a map check.

## Provenance

SeatPop (hackathon edition) was built between Oct 27 and Nov 4, 2026,
from scratch in this repository. It follows an earlier private concept
by the same author (working name RegWatch); no code from it was
carried over. Golden labels were drafted by AI and reviewed by the
author.
