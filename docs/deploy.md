# Deploying the SeatPop web app

## What the host needs

Set these as environment variables (names only — values stay in your
secret manager; `.env` is git-ignored and never committed):

- `SUPABASE_URL` (required) and `SUPABASE_ANON_KEY` (required): the app
  reads listings through the public views and the recommend RPC with the
  anon key. RLS plus the view allowlists scope everything.
- `MODEL_API_KEY` (recommended): Meta Model API key for the rerank and
  the describe-your-family parse. `MODEL_API_BASE` only if it differs
  from the default. Without a key the app still works: recommendations
  fall back to match order with templated reasons.
- `MODEL_SPARK`, `MODEL_WONDER`: only to override the default model ids.
- `RECOMMEND_MAX_PER_IP_PER_DAY` (optional, default 100): per-IP daily
  cap on the live API paths.
- `LLM_MAX_USD_TOTAL`, `LLM_MAX_USD_PER_RUN`, `LLM_MAX_USD_DAILY_LIVE`
  (optional): spend guardrails, shared with the worker config.
- `LLM_CACHE_DIR`, `LLM_LEDGER_PATH` (optional): model cache and cost
  ledger locations. On ephemeral filesystems leave the defaults; the
  cache just starts cold.

Explicitly NOT needed by the web app: `SUPABASE_SERVICE_ROLE_KEY`
(worker scripts only — it never appears in `apps/web`, audited),
`BASETEN_API_KEY`, `RESEND_API_KEY`, and the `INGEST_*`, `ENRICH_*`,
`EVAL_*` vars (ingest/enrich/eval operators only).

## Build and run

```sh
npm ci
npm run build --workspace @seatpop/web
npm start --workspace @seatpop/web
```

`prebuild` copies `worker/recommend/eval-report*.json` into `public/`
for the Trust page; missing files are skipped and the page shows
"pending". Apply migrations first with `npx supabase db push` (through
`0013_user_id_defaults.sql`).

## Notes

- No `NEXT_PUBLIC_*` variables exist: the client bundle reads no
  secrets. `process.env` appears only in API routes, the server-only
  `lib/recommend-server.ts`, and `next.config.ts`.
- The app is stateless except localStorage (guest household, saves,
  hides, theme). Rate limits are per process and in-memory.
