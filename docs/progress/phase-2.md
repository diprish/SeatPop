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
