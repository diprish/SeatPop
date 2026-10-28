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
