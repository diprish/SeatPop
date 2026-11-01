# Ranking exact age fit + months-as-years repair

Two live-data bugs from https://seat-pop.vercel.app, fixed in order: the
repair first (the ranking fix assumes truthful stored ages), then the
ranking. One commit per bug, no push.

## Bug 1: sample-household results did not fit the household

Cause: `include_adjacent` widens each member's band at the SQL layer, and
stage-2 scoring ignored age fit entirely — so Babytime sessions for ages
0-1 topped a household of one adult, one kid (6-12), and one preschooler
(3-5), with reasons claiming "fits preschool".

Fix (`rank: exact age fit before adjacent`):

- New shared helper `packages/shared/src/age-fit.ts`: per-candidate,
  per-member fit level `exact` (stated range overlaps the band as
  stated), `adjacent` (only via expansion), `unknown` (both ages
  missing), `none` (no overlap even expanded — reachable per member
  whenever another member carries the SQL age constraint).
- Stage-2 `ageFit` component, weight 40 in the existing config block:
  exact scores 0.9–1.0 (rising with the share of members fit exactly),
  unknown 0.5, adjacent-only 0. The weight strictly separates the
  tiers — an adjacent-only candidate cannot outscore an exact fit
  however attractive otherwise — and a test pins the invariant
  against future retunes. SQL constraints and their TS mirror are
  untouched: ranking only.
- Reasons: adjacent-only matches say "close to your preschooler's age
  (inferred)", never "fits X". The rerank prompt carries per-band fit
  levels with a fits-only-if-exact rule; the verifier rejects model
  reasons claiming "fits \<band\>" for non-exact bands (per-item
  fallback to the template). The Why sheet's Age row matches.
- Diversity: at most 2 consecutive results from one title family, in
  stage 2 and post-rerank (stable, idempotent, so the eval fallback
  proof still holds). The family key is the first word of the
  suffix-stripped title — the first probe showed suffix-stripping
  alone misses live shapes like "Babytime followed by a Play and
  Stay", so the rule was widened to the lead word.

Sample-household top 5 (K2S, 20 km), before → after:

Before (all exact-tier only because 0-18 overlaps preschool 3-5):

1. Babytime - Fall Session 2 (10:15 am) | 0-18 | fits preschool (stated)
2. Babytime followed by a Play and Stay | 0-None | fits preschool (stated)
3. Babytime + Stay & Play (Thursdays)… | 0-18 | fits preschool (stated)
4. Bilingual Babytime + Stay & Play (Fridays)… | 0-18 | fits preschool (stated)
5. Storytime and Stay & Play | 0-5 | fits preschool (stated)

After (all exact-tier on repaired ages; Babytime gone from the top 5):

1. Toddlertime | 1-3 | close to your kids age (inferred)
2. Storytime and Stay & Play | 0-5 | close to your kids age (inferred)
3. Toddlertime - Fall Session 2 | 1-3 | close to your kids age (inferred)
4. Storytime with Stay & Play | 0-5 | close to your kids age (inferred)
5. Toddlertime | 1-3 | close to your kids age (inferred)

The after reasons are model-written within the new rules (close-to
phrasing, `(inferred)` mark, no fit claim). Families alternate, so no
run exceeds 1.

`eval:recommend` after: **PASS — 0 violations, 0 distance mismatches,
policy probe ok** (246 candidates, 6 free_per_opl). NDCG@10 means,
before → after: reranked 0.990 → 0.843, date 0.766 → 0.709, stage2
0.895 → 0.756. These means are not directly comparable across the two
runs, and the note would mislead without the confounders:

- Graded sets differ (14/20 before, 11/20 after): four perfect-1.000
  single-candidate households (h03, h05, h09, h18) expired to zero
  candidates between Oct 30 and Nov 1; h07 graded new at 1.000.
- Pools shifted by expiry (h07 63→48, h16 68→62 candidates) and the
  repaired ages change the judge's inputs (0-18 → 0-2).
- The judge re-grades shared lists differently run to run: h11 and
  h14 fell identically on reranked and stage2 (grade-side movement),
  and h01's date baseline fell 0.138 → 0.000 on a shifted pool.
- Attributable signal: h16 (kids + preschooler, closest to the
  reported bug) improved on both reranked (0.859 → 0.917) and stage2
  (0.603 → 0.902). h01's stage2 baseline cratered (0.948 → 0.000)
  while its final stayed perfect (1.000) — the likely mechanism is
  tiering demoting unknown-age high-interest events out of the
  stage-2 top 10, with the reranker recovering them from the top 30.
- Product/judge tension, stated plainly: the Wonder judge never saw
  the "Babytime-topping-a-preschool-household is wrong" requirement,
  so where it rewards adjacent events, NDCG punishes this fix. The
  user-verified probe above is the ground truth for the reported
  bug. A possible follow-up (not done): an age-aware judge prompt.

## Bug 2: months stored as years

Cause: old enrichment stored month-stated ages unconverted
("19-35 months" → 19-35), and the model re-enrichment never repaired
the live rows. Listings showed "Ages 19-35" and "Ages 0-18".

Fix (`enrich: repair months-as-years`):

- `repair:months` rewritten as a deterministic correction (no model
  calls, no spend): single months/mois ranges in the listing text
  (`19-35 months`, `0-18 months`, `6 to 24 months`, `0 à 18 mois`;
  bilingual repeats must agree, distinct ranges are left alone)
  convert to years (min down, max up: 19–35 → 1–3, 0–18 → 0–2).
  Per side: months magnitudes (≥ 5) convert, nulls fill, years-scale
  values stay (v4-correct rows are never churned). Dry run by
  default, `--apply` writes ages + verbatim evidence quotes +
  `repair-months` model stamp + current source hash (so enrich
  treats the row as done). The "check the age group" flag clears on
  its own — corrected rows carry real ages, and no stored flag
  exists. Owner rows never qualify; detection stays on title +
  description (page-level raw text could match another event's
  span). A glued `monthsPlease` tag strip in the live Tuesday
  Babytime text defeated the first pattern's `\b`, so the trailing
  guard is now case-sensitive "no lowercase letter next" (still
  rejects `monthly`).
- Render safety net in `ageLine`: magnitude in [5, 36) plus a
  month/mois word renders "Ages 19–35 months". The ≥ 5 floor is the
  `verifyAge` ceiling — without it, correctly repaired rows would
  mislabel. Months magnitudes under 5 are indistinguishable from
  years here (the repair owns those); frequency words beside
  years-scale ages ("every month") can misfire, rarely.
- Eval regression: the 3 Babytime golden rows asserted labeled as
  years, and months-magnitude predictions asserted to score wrong.

Repair ledger (user-ran, production):

- Dry run: `events=857 enriched=857 month_text=109 planned=83` —
  all Babytime/Toddlertime/EarlyON, conversions spot-checked.
- Apply 1: `repaired=83 failed=0`.
- Gap query found 6 Tuesday Morning Babytime rows still at 0–18
  (the glued-`monthsPlease` miss above); pattern fixed, dry run 2:
  `month_text=115 planned=6` (detection parity with SQL).
- Apply 2: `repaired=6 failed=0`. Total 89 rows.
- Idempotency: re-run prints `planned=0`.
- SQL confirm: fixed_class 109, broken_leftovers 0, month_text_rows
  115 at first check; the 6-row gap was exactly the Tuesday rows,
  repaired in apply 2 (the apply and idempotency outputs already
  close the loop; the query stays valid for any future re-check):

  ```sql
  select
    count(*) filter (where en.age_max <= 3) as fixed_class,
    count(*) filter (where en.age_min >= 12) as broken_leftovers,
    count(*) as month_text_rows
  from public.events e
  join public.event_enrichment en on en.event_id = e.id
  where coalesce(e.title, '') || ' ' || coalesce(e.description, '')
      || ' ' || coalesce(e.raw_text, '')
    ~* '\d+\s*(-|–|—|to|à)\s*\d+\s*(months?|mois)';
  ```
- No redeploy needed for the data fix (the API reads enrichment
  live); the ranking + render-net code ships with the next push,
  when Vercel auto-deploys `main`.

Gates: typecheck, lint, and 668/668 tests green (83 files),
including the new age-fit, sample-household, reason-wording,
diversity, repair, render-net, and eval-months coverage.
