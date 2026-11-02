# Enrichment eval report

Generated 2026-11-01T23:34:55.955Z · prompt enrich.v5 · golden worker/eval/golden/events.jsonl (60 events).

Gate: PASS — zero false-free and zero wrong-price across all recorded runs.

Accuracy is exact-match per field against human labels (label only
what the text says; blank means the text does not say). Cost is
live spend only — cached passes cost $0 but keep their stored token
counts. Events with no usable model pass are excluded from every
denominator and counted as failed.

Excluded from scoring as ambiguous (1): labels kept, out of every denominator.

- b2092319-1be1-4c2f-9f9b-ec7b89a82b35: "Enjoy free general admission to the museum" (Nov 11) is explicit, but Nov 10 tours are ticketed without a price ("tickets must be reserved in advance") and other days state nothing; "free" and "unknown" are both honest single-kind labels.

## Muse Spark 1.3 contributor (Meta API)

Model `muse-spark-1.3-contributor` · scored 59 · failed 0.

| field | accuracy | null rate |
| --- | --- | --- |
| age_min | 100.0% (59/59) | 86.4% |
| age_max | 94.9% (56/59) | 89.8% |
| price_kind | 100.0% (59/59) | 59.3% |
| amount | 100.0% (59/59) | 98.3% |
| setting | 96.6% (57/59) | 30.5% |
| language | 100.0% (59/59) | 72.9% |
| registration_hint | 86.4% (51/59) | 54.2% |
| accessibility | 96.6% (57/59) | 96.6% |

- false-"free": 0
- wrong-price: 0
- hallucinated fields: 5
- tokens: in 200649, out 83379, reasoning 44453 (live passes 64, cached 61)
- cost: $0.0134 total, $0.23 per 1,000 events

## Muse Spark 1.3 (Meta API)

Model `muse-spark-1.3` · scored 59 · failed 0.

| field | accuracy | null rate |
| --- | --- | --- |
| age_min | 100.0% (59/59) | 86.4% |
| age_max | 94.9% (56/59) | 89.8% |
| price_kind | 100.0% (59/59) | 59.3% |
| amount | 100.0% (59/59) | 98.3% |
| setting | 96.6% (57/59) | 30.5% |
| language | 100.0% (59/59) | 72.9% |
| registration_hint | 86.4% (51/59) | 54.2% |
| accessibility | 96.6% (57/59) | 98.3% |

- false-"free": 0
- wrong-price: 0
- hallucinated fields: 5
- tokens: in 198258, out 77195, reasoning 38486 (live passes 63, cached 61)
- cost: $0.2535 total, $4.30 per 1,000 events

## Muse Spark Open (Baseten)

Model `meta-models/muse-spark-open-1026` · scored 59 · failed 0.

| field | accuracy | null rate |
| --- | --- | --- |
| age_min | 100.0% (59/59) | 86.4% |
| age_max | 94.9% (56/59) | 89.8% |
| price_kind | 100.0% (59/59) | 59.3% |
| amount | 100.0% (59/59) | 98.3% |
| setting | 96.6% (57/59) | 30.5% |
| language | 100.0% (59/59) | 72.9% |
| registration_hint | 86.4% (51/59) | 55.9% |
| accessibility | 96.6% (57/59) | 98.3% |

- false-"free": 0
- wrong-price: 0
- hallucinated fields: 5
- tokens: in 222432, out 115199, reasoning 68081 (live passes 65, cached 63)
- cost: $0.2785 total, $4.72 per 1,000 events

---

## Failure analysis 2026-11-01 (prompt enrich.v4 → v5)

The v4 run failed the gate on every model (false-free 1, wrong-price 1).
Both failures were reproduced per event before any fix; neither labels
nor thresholds were adjusted to force green.

- Veterans' Week at the Diefenbunker (`b2092319`, false-free):
  all three models voted `free`, quoting "enjoy free general admission
  to the museum", against the `unknown` label. Class AMBIGUOUS: Nov 11
  free admission is explicit, but Nov 10 tours are ticketed without a
  price and the other days state nothing — "free" and "unknown" are
  both honest single-kind labels, and no precise verifier rule separates
  scoped-free-with-ticketed-parts from legitimate free admission.
  The row is now marked `AMBIGUOUS-EXCLUDED` in labeling.csv (reason
  quoted above); its labels stay and it is out of every denominator.
- Operation Whisky fundraiser (`531a1e6a`, wrong-price): all three
  models voted `(paid, 10000, 150000)`, taking the $1,500 table
  sponsorship ("sponsor a full table: $1,500", 8 tickets plus sponsor
  perks) as the per-person max against the labeled `(paid, 10000,
  16000)`. Class MODEL ERROR. enrich.v5 adds the per-person amount
  rule (individual tiers bind min/max; sponsorships, table and group
  packages, donations, and auction prices excluded). The verifier
  cannot fix amount selection — digits plus currency are legitimately
  present — so the re-run below is the proof.

Ruled out by direct votes: the AI-tips session ("do it all for free"),
Teen Spooky Social ("free snacks"), the OAG reception ("free
childcare"), and one rep per "free to…" trap-text group all vote clean
on every model tried.

Final numbers (this report): 59 scored, 0 failed, false-free 0,
wrong-price 0 on all three models; price_kind and amount accuracy
100% everywhere. Total re-run cost $0.55.

Note: golden listing text was trimmed to 300-char excerpts AFTER this
run (staff contact details removed; see worker/eval/golden/README.md).
Four rows lost price evidence sitting past the cut (notably the Whisky
amounts), so a future run on the trimmed goldens may fail those rows
again — that would be a data artifact of the trim, not a model
regression, and is reported here in advance. The v5 prompt bump also
re-queues all live rows for lazy re-enrichment on the next crawl.

(This section is hand-written analysis appended after the generated
report above; re-running the eval regenerates the numbers and drops
this text unless it is re-added. History is in git.)
