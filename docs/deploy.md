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
`0018_hardened_creates.sql`).

## Reminder emails

`.github/workflows/reminders.yml` runs `send:reminders` every 15
minutes plus on manual dispatch: unsent rows with `remind_at` reached
send oldest-first through Resend, then mark `sent_at` (idempotent —
sent rows are never re-selected; at-least-once by design). Any
failure fails the run with the failed ids; dry-run with
`npm run send:reminders --workspace @seatpop/worker -- --dry-run`
(masked recipients, sends nothing).

Repo secrets required (names only):

- `RESEND_API_KEY`: Resend sending key.
- `RESEND_FROM`: sender identity, e.g. `SeatPop <reminders@…>`.
- `APP_BASE_URL`: public app origin, e.g. `https://seatpop.example.com`
  (no trailing slash) — builds the token delete link in each footer.
- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: reminder reads are
  service-role-only by RLS (no SELECT policy).

Abuse rails: the sender never exceeds 200 sends per run
(`--limit` can only ask for fewer); creates are capped in SQL
(3 unsent per email, 20 per hour globally).

## Notes

- No `NEXT_PUBLIC_*` variables exist: the client bundle reads no
  secrets. `process.env` appears only in API routes, the server-only
  `lib/recommend-server.ts`, `lib/registration-server.ts`, and
  `next.config.ts`.
- The app is stateless except localStorage (guest household, saves,
  hides, theme). Rate limits are per process and in-memory.

## Scheduled crawl

`.github/workflows/crawl.yml` runs ingest then enrich daily at 06:17
UTC, plus on manual dispatch. Both steps run `--strict`: any source
error (ingest) or event with no usable pass (enrich) fails the run
with exit 1 — a broken source never goes green. `robots-disallowed`
stays a recorded, non-failing skip; enrich budget stops already exit
1; transient no-training-route skips stay loud warnings and retry on
the next run.

Repo secrets required (names only — values stay in the repo's secret
store, never in the workflow file):

- `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY`: crawl reads/writes the
  ingest tables directly (no policies on that path by design).
- `MODEL_API_KEY`: rerank-free crawl still spends model budget on
  tier-2 HTML extraction and enrichment.
- `BASETEN_API_KEY`: default enrichment provider (falls back to the
  contributor model on errors or cap).
- `LLM_MAX_USD_TOTAL`, `LLM_MAX_USD_DAILY_LIVE`: global spend caps
  binding both steps; the run stops and reports when one is reached.
- `BASETEN_MAX_USD_TOTAL`: Baseten-only spend cap.

Not wired (deliberate): `LLM_MAX_USD_PER_RUN` does not bind the
crawl — extraction forces its $2 and enrich its $5 per-run cap in
code, so a secret of that name would be silently ignored.
`INGEST_CONTACT_URL` needs no secret: the workflow sets it to the
repo URL for the crawler's User-Agent. `ENRICH_PROVIDER` is optional
(code default: baseten).

Politeness is enforced in code (`worker/src/ingest/fetcher.ts`):
robots.txt and crawl delays honored, at most one request per 3
seconds per host, identifiable User-Agent with contact URL, 403 and
login walls never bypassed. Every ingested event keeps its official
page link.
