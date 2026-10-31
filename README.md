# SeatPop (hackathon edition)

Helps households find the right activity (free or paid, any kind) for each person in them, book it in time, and get confirmed bookings onto a family calendar. Pilot city: Ottawa, Canada. Built with Meta models for the Meta Global AI Developer Hackathon.

## Provenance

SeatPop (hackathon edition) is a new codebase written between Oct 27 and Nov 4, 2026.

## Status

Phase 0 skeleton: monorepo, model client with cost ledger, worker placeholder,
Next.js app with `/health`, Supabase migration 0001, CI. Not deployed yet.

## Development

Requires Node 20+. Copy `.env.example` to `.env` and fill it in (never commit
`.env`).

```sh
npm install
npm run typecheck
npm run lint
npm test
npm run smoke        # one tiny request per chat model; needs MODEL_API_KEY
```

## Supabase

Migrations live in `supabase/migrations`. The app does not need Supabase to
run in phase 0; when `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are set,
the model client also mirrors each cost-ledger row to the `llm_calls` table
(service role only; RLS blocks anon and authenticated callers).

Local:

```sh
npx supabase init     # once, if supabase/config.toml does not exist yet
npx supabase start    # applies supabase/migrations automatically
npx supabase stop     # when done
```

Hosted (https://supabase.com/dashboard):

```sh
npx supabase link --project-ref <project-ref>
npx supabase db push  # applies pending migrations
```

Table overview: `llm_calls` (ledger mirror, service role only), `profiles`
(one row per auth user, readable/writable by its owner only). Every table has
Row Level Security enabled.

## Recommendations (phases 4-5)

Guest-first: `POST /api/recommend` takes `{prefs}` (age bands, budget,
distance, area, availability, interests) and stores nothing, or
`{householdId}` for a signed-in user's saved household. `POST
/api/profile/parse` turns typed household text into editable chips (PII
redacted, raw text discarded). `GET/POST /api/households` manage saved
households behind a user JWT (`Authorization: Bearer`). Try it at
`/recommend`. Saving from the page reads a JWT from the
`seatpop_jwt` localStorage key; a sign-in UI is still open.

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
