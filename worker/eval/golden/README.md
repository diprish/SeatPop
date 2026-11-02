# Eval golden sets (phase 3)

One JSON object per line. Empty files are scaffolds: the metric code is
real and tested, the labels arrive with the feature.

## events.jsonl (enrichment)

Written by `npm run eval:import` from the labeled CSV. Do not hand-edit;
re-label and re-import instead.

```json
{"event_id": "…", "title": "…", "description": "…" | null,
 "venue_name": "…" | null, "source": "…", "category": "…" | null,
 "labels": {"age_min": 10 | null, "age_max": 12 | null,
  "price_kind": "free|paid|pay_what_you_can|donation|member_only|unknown",
  "amount_min_cents": 1500 | null, "amount_max_cents": 1500 | null,
  "setting": "…" | null, "language": "…" | null,
  "registration_hint": "…" | null, "accessibility": ["…"]}}
```

Labeling rule: label only what the text says; blank means the text does
not say. A blank price_kind imports as `unknown`.

Data note: excerpts of public listing text kept for evaluation, source
URLs retained; labels are ours. Descriptions are trimmed to their first
300 characters (short texts kept whole) and staff contact details are
removed. Source names and event ids link each row back to the full
listing in our database. Trimming can cut labeled evidence that sits
late in a listing (e.g. prices near the end), so eval numbers from
before the trim are not directly comparable with later runs.

## ranking.jsonl (EMPTY — ranking scaffold)

One row per request. Fill when the ranker exists.

```json
{"query_id": "…", "candidates": [
 {"event_id": "…", "relevance": 0 | 1 | 2 | 3,
  "violates_constraint": true | false}]}
```

Metrics (`worker/src/eval/ranking.ts`, tested): NDCG@10 and
constraint-violations-in-top-10. Out-of-set ids are discarded before
scoring (CONTEXT rule 3); unjudged survivors gain 0.

## emails.jsonl (EMPTY — email scaffold)

Ids and verdicts ONLY — never bodies, senders, or addresses
(CONTEXT rule 4). Fill when the email path exists.

```json
{"email_id": "…", "is_junk": true | false, "note": "optional, no PII"}
```

Metric (`worker/src/eval/email.ts`, tested): junk-email false
creations — junk the system turned into events. Must stay 0.
