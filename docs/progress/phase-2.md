# Phase 2: Enrichment, pricing, embeddings

Model enrichment for all 261 events (17 verified fields + pricing +
summary/tags), adaptive majority voting, bge-small embeddings for the
30-day window, provider flag for the phase-3 comparison. $0.09 per 1,000
events. Review list empty; price unknown on 84% (honest thin-text
output, see null analysis).

## What was built

- Migration `0003_enrichment.sql`: `event_enrichment` (all spec columns,
  `embedding vector(384)`, sanity CHECKs on ages/duration/amounts/ranges)
  and `event_pricing` (`price_kind` enum, `unknown` default), both RLS on
  with no policies (service-role only). Indexes for the review list and
  phase-3 hard-constraint filters. `public_events` recreated with 19
  display/filter columns; evidence, model, prompt_version, source_hash,
  confidence, and embedding stay internal. Applied with
  `npx supabase db push`.
- Prompt `packages/llm/prompts/enrich.v1.md` + zod schema
  (`packages/llm/src/enrichment.ts`): per-field `{value, quote}` pairs,
  per-field parsing (one mistyped field nulls itself, not the pass),
  free-only-on-explicit-signal, amounts-only-with-digits-and-currency,
  no inference from venue type or source reputation. Venue NAME only —
  the street address has no parameter (CONTEXT rule 4).
- Verifier `packages/shared/verify.ts`: whitespace/case/quote
  normalisation, quote must ground in the event's OWN text (a price from
  another event on the page cannot leak in), digits-in-quote for
  ages/durations/amounts, free-signal + parking/wifi/coat-check
  exclusions, month-or-digit rule for registration dates. 14 adversarial
  tests (invented price, free parking, cross-event price, invented ages,
  paraphrase). `PriceKind` lives in shared; the llm package depends on it.
- `worker/enrich`: new/changed-only by source_hash (title+description+
  venue+prompt), soonest first, per-event commits (resumable/idempotent).
  Adaptive voting — 2 passes at temperature 0.3, 3rd only on
  disagreement, field majority else null; confidence = first-two
  agreement rate, <0.7 joins the printed review list. Pass markers keep
  cache keys distinct so votes are independent samples. `$5/run` cap
  with loud stop + partial report. `--provider contributor|spark`
  (flag > `ENRICH_PROVIDER` > contributor); the API-reported model id is
  stored per row for the phase-3 comparison. `--limit`, `--dry-run`,
  `--skip-embeddings` supported.
- Embeddings (`worker/enrich/embed.ts`): bge-small-en-v1.5 (384 dims)
  via transformers.js, lazy-loaded, CPU-only, on summary+tags for events
  starting within 30 days. Batch sweep after enrichment; batch failures
  warn and continue (embedding stays null). Verified working on the
  user's Intel Mac (112 embedded, 0 failed).

## Full-run report (2026-10-28, contributor, enrich.v1)

- Events: 261 candidates, 261 processed (11 in trials + 250), 0 failed.
- Passes: 149 live + 384 cached — 72% cache reuse, because recurring
  series share identical text (same text ⇒ same enrichment, so sharing
  is correct) — 180 events fully cached.
- Spend: $0.0228 total, **$0.09 per 1,000 events** (tokens include cached
  replays; cost is live-only). Tokens in 519k / out 341k / reasoning 177k.
- Null rates: setting/energy/crowd/duration/accessibility/reg_opens/
  amounts/currency 1.00; age_min 0.92, age_max 0.94, needs_adult 0.94,
  price_kind 0.84 (unknown), language 0.72, reg_hint 0.58, fee_notes 0.96,
  price_text 0.99, summary 0.00, tags 0.01.
- Review list: 0 rows below 0.7 (strict verification makes passes agree;
  nulls agree too).
- Embeddings: 112 embedded, 149 skipped (outside the 30-day window),
  0 failed.
- Categories: library 211, arts 20, museums 16, music 12, markets 2.
- price_kind unknown: 220/261 (41 known: explicit free/paid text,
  mostly Chamberfest/GCTC).

## Null-rate analysis (read before phase 3)

The nulls are honest, but two rules interact badly:

1. The prompt EXAMPLES teach normalization the verifier rejects:
   setting `"indoors"` from quote "in the main hall" (value not inside
   quote → dropped), energy `"calm"` from "a quiet morning session",
   crowd `"small group"` from "limited to 12 spots", duration `60` from
   "one-hour workshop" (no digits → dropped). This is likely the whole
   story behind the 1.00 rates for setting/energy/crowd/duration.
2. Thin ICS text genuinely lacks the rest: OPL descriptions never say
   "free" (unknown is correct — never infer from reputation) and rarely
   state ages/language/access.

Proposed `enrich.v2` (not built): fixed vocabularies for
setting/energy/crowd with deterministic keyword checks in the verifier
(value accepted only when the grounded quote contains its keywords),
plus a number-word map for durations. Cost of a v2 re-run: ~$0.20 and
~30 min (prompt bump = full cache miss). Decision deferred to phase 3,
when filters show which fields matter.

## Bugs found and fixed

- Prompt path went up one directory too many (`packages/prompts/...`) —
  fixed to `packages/llm/prompts/...`, caught by the new tests.
- Worker scripts executed `main()` on import, so the enrich test suite
  ran the CLI and `process.exit` killed it (third occurrence of this
  class after probe-opl). Root fix: `worker/src/script-entry.ts`
  `isDirectExecution()` guard applied to all six scripts
  (ingest/run/probe/probe-opl/seed, enrich/run, index); enrich config
  helpers moved to side-effect-free `worker/src/enrich/config.ts`.
- Two unused imports in enrich/run.ts (lint).

## Verification (user terminal; agent shell was SIGKILLed throughout)

- `npm install` (74 packages: transformers/onnx runtime), `db push`
  (0003 applied), `typecheck && lint && test` green, **132/132**
  (37 new: 14 verifier, 13 voting, 5 embed, 2 migration-0003, 3 prompt).
- `--dry-run` (261 pending, soonest first), `--limit 3` (all-null on
  thin exhibitions — investigated, not a bug), `--limit 8` (grounded
  fields flow: ages, needs_adult, 2 drop-in hints; temp 0.3 accepted),
  full run (report above).
- Commit: below.

## Open items

- `enrich.v2` decision (prompt/verifier vocabulary tension, above).
- `--provider spark` comparison run happens in phase 3 (flag ready).
- Prompt says "events ending before TODAY" nowhere: ongoing exhibitions
  (start in past, end in future) enrich normally — intended.

## Phase 2b

### enrich.v2: vocabularies + number words

- Fixed vocabularies for setting/energy/crowd with deterministic
  keyword checks in the verifier: a value is accepted only when its
  grounded quote contains the value's cue words (whole-word, negation
  aware, so "mushroom" never means "room"). Number-word map for
  durations ("one-hour" → 60). Prompt bumped to `enrich.v2`, which
  forces a justified full re-enrich (~$0.20 on contributor).
- Null rates before → after, contributor (v1 on 261 events → v2 on
  857; populations differ, see below): setting 1.00 → 0.28, energy
  1.00 → 0.92, crowd 1.00 → 0.96, duration 1.00 → 0.96. The setting
  win is the verifier keyword check; energy/crowd/duration stay thin
  because OPL text rarely carries the cues. Full v2 report below.

### Source pricing policies (migration 0004 schema + 0006 data)

- Numbered 0006 because remote already holds a 0005 row from earlier
  work, which shadows any local 0005 file. The UPDATE is idempotent.

- OPL children's programs, verbatim (Children's Programs section,
  [parenting page](https://collections.biblioottawalibrary.ca/en/parenting)):
  "These programs are free and offered at branches throughout the
  city." Stored on every `Ottawa Public Library%` source row with
  scope `[Baby, Child, Family, Preschool, Toddler]`. Teen excluded:
  OPL treats Teen as a separate audience and the statement never
  names it — no inference.
- Every other source stays `unknown`: OAG's official "Admission is
  always FREE" is gallery admission while its feed carries paid
  programs (camps) no scope can separate; no verbatim fee statement
  found for the market, museums, or theatres.
- Merge rule (runner): event fee text always wins; a scoped policy
  needs an overlapping facet label; basis recorded per row
  (`event_text` | `source_policy`).

### OPL age-group facets

- `probe:opl --age-groups` (fixed 2026-10-29: the matcher was bare
  `/age/i`, which caught the *language* select; now `/age_group/i`
  with a regression test). Robots allow; all 9 slices differ from
  the baseline (of-counts: Adult 327, 50-plus 165, Baby 36, Child
  121, Family 116, Newcomers 40, Preschool 32, Teen 75, Toddler 25).
- 8 new slice sources configured (Adult = existing Adults slice);
  each carries its facet label as structured evidence. Only
  "Adults 50-plus" states digits, so only it can set ages — and
  only when every digit-bearing facet agrees; text-verified ages
  always win.
- Ingest hardening from the slice counts (2026-10-29): the runner
  used to collapse drafts by raw_hash before cross-source dedupe,
  which drops links whenever one raw text fans out to several
  occurrences. Fix: per-occurrence raw text (`X-SEATPOP-OCCURRENCE`
  stamp, also required by the `(source_id, raw_hash)` unique index)
  + a pure per-draft write planner (`planDraftActions`, tested)
  that links every occurrence and skips already-linked canonicals.
  Post-fix run: the feared ~400 missing links did not exist — most
  collapsed drafts were same-key duplicates (identical series files
  served from several event pages), already covered by run-1 links;
  the fix's real yield was small fan-out catch-up plus clean
  idempotent re-runs (stable slices report all-unchanged, zero link
  re-attempts). Known pre-existing gap, unchanged: a listing whose
  text changes re-links but never updates the canonical row.
- Counts per source/category + price/age null rates: see the full
  v2 run report below.

### Full v2 re-enrich report (2026-10-29, contributor, enrich.v2)

- Events: 857 candidates (+596 over the 261: +30 in the two pasted
  ingest runs, the rest from intermediate runs — the new slices'
  page-1s hold largely distinct programs, and the per-occurrence fix
  recovered RRULE fan-out the old collapse had dropped), 851
  processed, 0 failed, 6 up_to_date.
- Passes: 396 live + 1437 cached — cached v1 raw replies re-verified
  under v2 rules, which is legitimate (verification runs at vote
  time) and is why the run cost $0.07 instead of ~$0.20.
- Spend: $0.0732 total, **$0.09 per 1,000 events** (same unit rate
  as v1). Tokens in 2.2M / out 1.2M / reasoning 0.7M.
- Null rates: setting 0.28, energy 0.92, crowd 0.96, duration 0.96,
  age_min 0.67 (was 0.92 — facet + text ages), age_max 0.84 (was
  0.94), needs_adult 0.76, language 0.77, reg_hint 0.56,
  accessibility 1.00, reg_opens 1.00, price_kind 0.58 (was 0.84),
  amounts/currency/price_text 1.00, fee_notes 0.97, summary 0.00,
  tags 0.00.
- Review list: 1 event at 0.50 (Morning Social — one pass returned
  unusable JSON; correctly flagged, everything else ≥ 0.7).
- Embeddings: 358 embedded (30-day window), 387 skipped out of
  window, 0 failed (remainder already embedded).
- Categories: library 792 (was 211 — kids slices), arts 26,
  museums 23, music 14, markets 2.
- price_kind unknown: 500/857 (was 220/261); this run put 300 on
  `free` via the OPL kids source policy.
- Final ingest per source (fetched): History 7, Nature 5, War 6,
  Diefenbunker 0 (304), GCTC 5, OAG 14, Chamberfest 23, OFM 2,
  OLT 1, OPL base 82, 50-plus 92, Adults 89, Baby 113, Child 62,
  English 58, Family 73, Newcomers 106, Preschool 100, Teen 75,
  Toddler 95 — 20 sources, 1008 fetched / 1001 upcoming.

## Baseten provider (second provider, public-text tasks only)

- `packages/llm`: base `https://inference.baseten.co/v1`, model exactly
  `meta-models/muse-spark-open-1026`, key `BASETEN_API_KEY` from env
  only. Ledger provider is `"meta" | "baseten"`.
- Price table (real, from the model library page, USD per 1M tokens):
  input 1.25, cached input 0.15, output 4.25. No estimates.
- The model always reasons: `reasoning_content` is parsed separately,
  stripped from the answer, and its tokens counted as output
  (`reasoning_effort: minimal` still sent; runs at low, the lightest
  available).
- Only tasks flagged public-text may use it (enrichment, listing
  extraction). Non-public tasks (household/email) refuse Baseten in
  code (`refused`, never falls back).
- Routing: Baseten is the default for `listing_extraction` and
  enrichment; an explicit provider flag/env wins. Any Baseten error or
  cap hit falls back to the contributor model automatically (warn
  logged); both attempts are ledger-logged. The API-reported model id
  is stored per enrichment row.
- Budgets: global limits (total, per_run, daily_live) count Meta spend
  ONLY; Baseten spend is capped only by `BASETEN_MAX_USD_TOTAL`
  (default 90).
- `npm run smoke` covers Baseten (live leg confirmed: reply ok, 46
  reasoning tokens).

### Baseten vs contributor, 20 events each (`--force`, enrich.v2)

- Baseten: $0.1792, **$8.96/1k events**; contributor: $0.0085,
  **$0.43/1k events** (~21x gap).
- Null rates tied within noise (age_min 0.90 both; setting 0.55 both;
  price_kind 1.00 both; language 1.00 vs 0.95 — one event differed).
- Quality tied, cost not: Baseten is the default with automatic
  contributor fallback (outages never block a run); pass
  `--provider contributor` for cheap production runs until the cost
  gap is revisited.

### Baseten data-retention and training policy (verbatim, read 2026-10-29)

Training — Terms and Conditions, Sec 6.3 "No Training on Customer
Content" ([terms](https://www.baseten.co/terms-and-conditions/), last
updated September 15, 2026):

> "Baseten will not use Customer Content, including Customer Models,
> Model Outputs, or inference logs, to train, fine-tune, or otherwise
> develop machine learning or artificial intelligence models."

"Customer Content" (Sec 1) means submitted content AND all Model
Outputs, so the no-training promise covers both prompts and outputs.
Sec 6.2 limits Baseten's use of Customer Content to (a) providing /
maintaining the Services, (b) service problems and support, (c) legal
compulsion or written permission. Sec 6.4: operational telemetry
(latency, throughput, error rates, utilization) may be used for
analytics/benchmarking only in aggregated or de-identified form.

Retention — [security docs](https://docs.baseten.co/observability/security)
(Data privacy):

> "Baseten does not store model inputs, outputs, or weights by
> default. This zero data retention (ZDR) policy applies to
> synchronous inference."

Async-inference inputs are stored in queue up to 72 hours; "Baseten
doesn't store outputs." Our client uses synchronous inference, so ZDR
applies. The [security page](https://www.baseten.co/security/) states
"zero retention of inference inputs and outputs, plus encryption in
transit and at rest."

Unclear: the pages read state no exception or retention window for
abuse/safety monitoring copies — not stated either way. Deletion:
Sec 7.4 — export during the term + 30 days; on written request Baseten
securely deletes all Customer Content "in accordance with the Security
Practices, unless legally prohibited."
