# Phase 0: Foundations

Empty but real skeleton: monorepo, model client with cost ledger, worker
placeholder, Next.js app with `/health`, Supabase migration, CI. Not deployed.

## What was built

- Monorepo (`npm workspaces`): `apps/web`, `worker`, `packages/shared`,
  `packages/llm`. Strict TypeScript (shared base config), ESLint flat config,
  Vitest. Workspace packages are source-distributed (`main` points at
  `src/index.ts`; web uses `transpilePackages`), so there is no build step
  outside Next.js.
- `packages/llm`: one fetch-only client (`POST {MODEL_API_BASE}/chat/completions`,
  no SDK). Model per task from env (defaults: `muse-spark-1.3`,
  `muse-spark-1.3-contributor`, `muse-wonder-1.0`, `muse-image-1.0`,
  `muse-voice-transcribe-1.0`); only `listing_extraction` (public event text)
  uses the contributor model — `extraction`, `classification` and `parsing`
  use standard Spark, plan uses Spark, judge uses Wonder.
- Reasoning: top-level `reasoning_effort` per the
  [Reasoning docs](https://dev.meta.ai/docs/reasoning); `minimal` (lowest
  usable, `none` returns 400) for extraction/classification/parsing/smoke,
  `high` for plan, `max` for the Wonder judge.
- Length failures (null content + `finish_reason "length"`): logged, recorded
  as a `length_retry` ledger row with the attempt's real usage, retried once
  with doubled `max_tokens` (floor 512), then a typed `length` error.
- zod validation of every response, one backoff retry for transient failures
  (network/timeout/408/429/5xx), configurable request timeout, sha256
  content-hash cache on disk (hits make zero network calls).
- Cost ledger: one JSONL row per call under `.llm-ledger/llm-calls.jsonl`
  (always), plus a service-role REST mirror to `llm_calls` when Supabase env
  vars are set. Prices live in `PRICE_TABLE` in config, from the
  [pricing page](https://dev.meta.ai/docs/pricing-rate-limits);
  `completion_tokens` already include reasoning tokens, so reasoning counts as
  output with no extra term.
- Budget guard throws `BudgetExceeded` at `LLM_MAX_USD_TOTAL`,
  `LLM_MAX_USD_PER_RUN`, `LLM_MAX_USD_DAILY_LIVE` (defaults 135 / 10 / 5 when
  unset); totals come from the ledger plus an estimated cost reserved per
  in-flight call, so parallel calls cannot overshoot. The API key and request
  headers are never logged or printed.
- `npm run smoke`: one tiny request per chat model, prints reply/token
  counts/cost; exits 2 without `MODEL_API_KEY`. Image/voice are non-chat
  endpoints and print a skip note (phase-0 client is chat-only).
- Tests (`packages/llm/tests`): transient retry, schema failure (no retry),
  length failure (higher-limit retry, then typed error; plus recovery),
  `length_retry` rows with real usage, cache hit with zero network calls,
  cost math, contributor-only routing for `listing_extraction`, plan/judge
  reasoning levels, timeout, missing key, budget stops at each of the three
  limits, and a 20-parallel-calls in-flight test.
- `.env` is found by searching upward from cwd to the repo root. A
  `SUPABASE_URL` not starting with `https://` warns once and skips mirroring.
- `worker/`: tsx placeholder with `--help`.
- `apps/web`: Next.js App Router + Tailwind v4, landing page, `GET /health`
  returning status/build info validated against `@seatpop/shared`
  (no secrets). Start after install with
  `npm run dev --workspace @seatpop/web`, then open http://localhost:3000
  (`/health` for the JSON status). The dev server was not started here (see
  verification), so treat that URL as start-then-open.
- Supabase: `supabase/migrations/0001_foundations.sql` (`vector` extension,
  `llm_calls` with RLS and no policies = service role only, `profiles` with
  owner-only policies). README covers local (`supabase init/start`) and
  hosted (`link`/`db push`) use.
- CI (`.github/workflows/ci.yml`): `npm ci`, typecheck, lint, test.
- `.env.example` lists every variable with no values; `.env` is git-ignored.

## Verification (all by hand, shell was unavailable)

`typecheck`, `lint`, `test`, `smoke`, the dev server, and the commit were NOT
run in this session: every shell invocation failed with SIGKILL (including an
escalated retry), so nothing below is verified output. Before considering
phase 0 done, run:

```sh
npm install            # then commit package-lock.json and switch CI to `npm ci`
npm run typecheck && npm run lint && npm test
npm run smoke          # needs MODEL_API_KEY in .env
git ls-files | grep -E '^\.env$' && echo LEAK || echo "no secrets tracked"
git status --short && git add -A && git commit -m "Phase 0: foundations"
```

Code was instead reviewed statically: strict TS settings (`strict`,
`isolatedModules`, `verbatimModuleSyntax`), no `any`, no non-null
assertions, no unused imports, hermetic tests (empty-env config, temp
cache/ledger dirs, mocked fetch). The `.env` file present in the workspace
holds real-looking keys and is covered by `.gitignore` (`.env`, `.env.*`);
confirm with the `git ls-files` command above.
