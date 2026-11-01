# SeatPop eval report

## Recommend eval (worker/recommend/eval-report.json)

20 synthetic households. Every returned row is re-checked against the
TypeScript mirror of the SQL hard constraints, distances re-verified,
and relevance graded by Muse Wonder (labeled model-graded throughout).
Baselines: date order and stage-2 without rerank. A key-removed run
proves the fallback (stage-2 order kept, templated reasons).

| Metric | Result |
|---|---|
| Constraint violations in top 10 | 0 (all 20 households) |
| Distance mismatches | 0 |
| Mean NDCG@10, reranked | 0.990 (14/20 households graded) |
| Mean NDCG@10, date order | 0.766 |
| Mean NDCG@10, stage 2 only | 0.895 |
| Policy probe (free per OPL) | ok (6 in 305 candidates) |
| Fallback, key removed | order kept, all reasons templated |

The Trust page (`/trust`, live at
https://seat-pop.vercel.app/trust) renders these reports from the
snapshots copied at build time.

## Enrichment eval (pending)

Not yet run: no `worker/eval/report.json` exists, so the Trust page
shows "enrichment eval pending" and never fake numbers. When run
(`npm run eval:import` then `npm run eval` in `@seatpop/worker`), it
reports per-field accuracy, false-"free" count, wrong-price count,
hallucinated-field count, null rate, tokens, and cost per 1,000 events
for Muse Spark 1.3 contributor, Muse Spark 1.3 standard, and Muse Spark
Open on Baseten. CI fails the run on false-free > 0 or wrong-price > 0.

## Ranking and email scaffolds

Metric code exists (NDCG@10, top-10 constraint violations, junk-email
false creations) with empty golden files; the recommend eval above is
the reporting instance.
