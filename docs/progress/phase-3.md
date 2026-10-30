# Phase 3: Enrichment eval + ranking/email scaffolds

Eval pipeline for voted enrichment (export → label → import → eval →
report + CI gate), three-model comparison harness, and empty-golden
ranking/email scaffolds with real metric code. Code complete and green
(261/261); the golden labels and the live eval run are open items below.

## What was built

- `worker/src/eval/` + `npm run eval:export|eval:import|eval|eval:check`
  (`worker/package.json`, `EVAL_DIR` in `.env.example`, default
  `worker/eval/`).
- Export: 60 events sampled across sources and categories from Supabase
  (listing text + metadata only — enrichment rows are never selected, so
  no model answer can leak into the labels). Force-includes every
  price/`free`-text event, holds a 20 non-library floor, fills the rest
  by stratified round-robin over source×category buckets. Deterministic
  by id. Refuses to overwrite `labeling.csv` without `--force`. The CSV
  prints the rule in `#` comments: label only what the text says; blank
  means the text does not say.
- Sampling conflict (found on the real pool of 857): 122 events mention
  a price or "free", so "60 rows + ≥20 non-library + every price event"
  is jointly unsatisfiable. Resolution: the two numeric constraints are
  hard, price inclusion is maximized within them (non-library price
  first, then library price yields one-for-one to non-library fill).
  First export filled all 60 slots with price events and missed the
  floor (10); after the fix: 60 rows, 20 non-library, 50 price rows,
  5 categories, loud warning naming the 72 dropped price events.
- Import: validates every row (whole-year ages 0–130 with min≤max, kind
  in enum, parseable amount, `labeled` must be `x`), lists ALL invalid
  rows with spreadsheet line numbers (comment- and wrap-aware), writes
  nothing until clean, then writes `golden/events.jsonl`. Amount cells:
  blank, `$25`, `$25.00`, `$1,200`, ranges `10-20`/`$10–$20`/`10 to 20`.
- `eval`: production-identical voted enrichment over the golden set on
  contributor, standard Spark, and Baseten Spark Open (Baseten runs
  `fallback: "none"` so outages score as failures, never silent
  contributor output), then scores 8 fields per model: per-field
  accuracy + null rate, false-"free" count, wrong-price count
  (disjoint buckets), hallucinated-field count, tokens, live-only cost
  per 1,000 events. Failed events are excluded from denominators and
  reported. Writes `worker/eval/report.json` (source of truth),
  `docs/eval-report.md` (one table per model), and
  `apps/web/public/eval-report.json` (the web-renderable copy).
- Model side is the voted extraction only — no source-policy merge, no
  facet ages — because labels cover listing text alone.
- Ranking scaffold: `golden/ranking.jsonl` (empty) + `ranking.ts`
  (NDCG@10, top-10 constraint violations; out-of-set ids discarded per
  CONTEXT rule 3). Email scaffold: `golden/emails.jsonl` (empty, ids
  and verdicts only, never bodies per CONTEXT rule 4) + `email.ts`
  (junk-email false creations). Schemas documented in
  `worker/eval/golden/README.md`.
- CI: `eval:check` step after `test` fails on any recorded run with
  false-free > 0 or wrong-price > 0. Reads the committed report only
  (no network/keys); passes with a note until a report exists.
- Tests: 7 new `worker/tests/eval-*.test.ts` (CSV, sampling, import,
  scoring, ranking, email, report gate + Markdown).

## Bugs found and fixed

- Sampler missed the non-library floor under price overflow (above):
  eviction + `floorMet` stat + 2 regression tests.
- Two test-code bugs (sources were correct): a golden-JSONL fixture
  that failed schema on line 1 while asserting a line-2 error, and a
  `.toContain` asserted on a boolean instead of the event text.

## Verification (user terminal; agent shell was SIGKILLed throughout)

- `npm run typecheck && npm run lint && npm test`: green, **261/261**
  across 30 files (33 new eval tests).
- `eval:check`: passes, "no eval runs recorded".
- `eval:export --force`: 60 rows, 20 non-library, 50 price rows,
  library=40 arts=8 museums=7 music=4 markets=1, warning on the 72
  dropped price events.

## Open items

1. Label the 60 rows in `worker/eval/labeling.csv` (human work; the
   file is committed so labeling can span sessions).
2. `npm run eval:import --workspace @seatpop/worker` → fix rows until
   `golden/events.jsonl` writes.
3. `npm run eval --workspace @seatpop/worker` (needs `MODEL_API_KEY`
   + `BASETEN_API_KEY`; ~$2 worst case cold, $5/run cap) → review
   `docs/eval-report.md`, commit the report + web JSON with a results
   addendum to this file.
4. Commit: the secrets check + `git add -A` below (agent shell cannot
   run git).
