# Enrichment eval report

Generated 2026-11-01T05:13:37.082Z · prompt enrich.v4 · golden worker/eval/golden/events.jsonl (60 events).

Accuracy is exact-match per field against human labels (label only
what the text says; blank means the text does not say). Cost is
live spend only — cached passes cost $0 but keep their stored token
counts. Events with no usable model pass are excluded from every
denominator and counted as failed.

## Muse Spark 1.3 contributor (Meta API)

Model `muse-spark-1.3-contributor` · scored 60 · failed 0.

| field | accuracy | null rate |
| --- | --- | --- |
| age_min | 100.0% (60/60) | 86.7% |
| age_max | 95.0% (57/60) | 90.0% |
| price_kind | 98.3% (59/60) | 58.3% |
| amount | 98.3% (59/60) | 98.3% |
| setting | 95.0% (57/60) | 30.0% |
| language | 100.0% (60/60) | 73.3% |
| registration_hint | 86.7% (52/60) | 56.7% |
| accessibility | 98.3% (59/60) | 96.7% |

- false-"free": 1
- wrong-price: 1
- hallucinated fields: 7
- tokens: in 188887, out 83050, reasoning 43223 (live passes 73, cached 54)
- cost: $0.0132 total, $0.22 per 1,000 events

## Muse Spark 1.3 (Meta API)

Model `muse-spark-1.3` · scored 60 · failed 0.

| field | accuracy | null rate |
| --- | --- | --- |
| age_min | 100.0% (60/60) | 86.7% |
| age_max | 95.0% (57/60) | 90.0% |
| price_kind | 98.3% (59/60) | 58.3% |
| amount | 98.3% (59/60) | 98.3% |
| setting | 95.0% (57/60) | 30.0% |
| language | 100.0% (60/60) | 73.3% |
| registration_hint | 86.7% (52/60) | 55.0% |
| accessibility | 98.3% (59/60) | 96.7% |

- false-"free": 1
- wrong-price: 1
- hallucinated fields: 7
- tokens: in 196435, out 88543, reasoning 47091 (live passes 75, cached 57)
- cost: $0.3058 total, $5.10 per 1,000 events

## Muse Spark Open (Baseten)

Model `meta-models/muse-spark-open-1026` · scored 60 · failed 0.

| field | accuracy | null rate |
| --- | --- | --- |
| age_min | 100.0% (60/60) | 86.7% |
| age_max | 95.0% (57/60) | 90.0% |
| price_kind | 98.3% (59/60) | 58.3% |
| amount | 98.3% (59/60) | 98.3% |
| setting | 95.0% (57/60) | 30.0% |
| language | 100.0% (60/60) | 73.3% |
| registration_hint | 86.7% (52/60) | 56.7% |
| accessibility | 96.7% (58/60) | 96.7% |

- false-"free": 1
- wrong-price: 1
- hallucinated fields: 7
- tokens: in 218539, out 127803, reasoning 75288 (live passes 78, cached 57)
- cost: $0.3647 total, $6.08 per 1,000 events
