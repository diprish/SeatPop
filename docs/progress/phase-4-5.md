# Phases 4-5 (lite): households + recommendations + eval

Guest-first recommendations over hard SQL constraints, staged scoring,
model rerank with deterministic fallback, profile-parse chips, and a
20-household live eval. Correctness proven (zero violations, verified
distances, fallback proven); coverage is thin on the current snapshot
(see "Coverage honesty" — a corpus fact, not a code bug).

## What was built

- Migration 0008 (task said 0007; 0007 was already taken): households
  (owner + home_fsa), members (age bands only, include_adjacent default
  true), preferences (budget, distance, availability JSONB, language,
  accessibility, interests, avoid), home_area (FSA + centroid, public
  read), feedback (saved/dismissed/not_for_us + reason, one row per
  user-event). RLS on all five tables; user data owner-only via
  auth.uid(); no columns exist for names, birth dates, full postals, or
  addresses (pinned by a static test).
- `recommend_candidates(p_prefs, p_limit→200)`: SECURITY DEFINER,
  EXECUTE to anon/authenticated, all 8 hard constraints in SQL (age fit
  per member with adjacent expansion, haversine distance, locale-proof
  weekday/part windows, budget with source-policy merge, accessibility,
  language, status, future start). Unenriched ages fall back to
  permissive category defaults (camps 5–17, else all-ages), always
  flagged "check the age group"; unknown price passes unless free_only
  ("price not stated"); policy free renders "free (per OPL)".
- Home-area seeds: 41 Ottawa K FSAs from the GeoNames free postal dump
  (CC BY 4.0, FSA rows used directly; method + operator steps in
  `supabase/seeds/ottawa_fsa_from_geonames.py`, attribution in README).
  34 admin2-selected (Ottawa/Gloucester/Kanata/Nepean) + 7 reviewed
  Ottawa communities (Orleans K1E/K4A, Stittsville K2S, Cumberland
  K4B/K4C, Manotick K4M, Greely K4P); 43 non-Ottawa K areas excluded
  with reasons in the migration comment.
- Shared prefs schema (`PreferencesSchema`, bands, ranges, day parts,
  category fallbacks) validating guest JSON, saved prefs, parse output,
  and eval fixtures alike; PII redactors (email, phone, full postal;
  FSAs kept) applied before any household-text model call.
- New LLM tasks, both standard Spark via Meta only (never contributor,
  never Baseten — PUBLIC_TEXT exclusion + provider gate + tests):
  `profile_parse` (typed household text → prefs; prompt inline so the
  web route needs no fs reads) and `rerank`.
- `worker/recommend`: TS mirror of every SQL predicate (unit-tested per
  constraint), stage-2 scorer (weights in config: time, proximity,
  interests, embedding, novelty, avoid penalty; missing data scores
  neutral), reranker (strict JSON, unknown ids discarded, reasons must
  mark stated vs inferred else templated, dropped candidates rejoin in
  stage-2 order), TTL cache, per-IP daily rate limiter, chips
  derivation, and `runRecommend` orchestration (guest prefs stored
  nowhere; household path forwards the user JWT so RLS enforces
  ownership). Any rerank failure (timeout, invalid JSON, budget stop)
  returns stage-2 order with templated reasons.
- Web: `POST /api/recommend` (guest cache 5 min; household path fresh),
  `POST /api/profile/parse` (raw text discarded; failures degrade to an
  editable template with 502/503), `GET/POST /api/households` (JWT,
  user_id never accepted from the body), and a `/recommend` page
  (textarea + no-names warning → chips with × → results with flags and
  AI/match-marked reasons → save). Serverless-safe tmpdir LLM
  cache/ledger; client page imports only the dependency-free chips
  entrypoint.
- `eval:recommend` over 20 synthetic households
  (`worker/recommend/golden-households.json`): violations in the top 10
  (exit 1 unless 0), independent haversine re-verification against home
  centroids, NDCG@10 vs date-order and stage-2-no-rerank baselines with
  Wonder "model-graded" relevance, embedding similarities from stored
  vectors + local query vectors. No-key mode isolates a cold cache and
  asserts order-kept + all-templated (the fallback proof).

## Bugs found and fixed (all live-data catches)

- 0008 shipped without the closing `$$` (db push failed, rolled back
  cleanly). Static test added.
- SRF alias shadowing (migration 0009): bare `as part` does not name
  the output column, so `where part = p.part` compared the outer column
  to itself — time filtering passed on weekday alone (14 eval
  violations: weekday right, part wrong, every time). Same latent shape
  in 4 more sites, fixed with explicit column aliases + a pinning test.
  The TS mirror was correct all along.
- Token floors: rerank 512→4096 and judge 2048→4096 (30-item lists
  truncated to length failures and silent fallbacks).
- No-key proof defeated by warm cache (cache correctly serves without a
  key); no-key mode now isolates a cold cache dir.

## Verification (user terminal; agent shell SIGKILLed throughout)

- `typecheck && lint && test`: green, **325/325** across 41 files.
- `db push`: 0008 + 0009 applied cleanly.
- Full eval: **PASS — 0 violations, 0 distance mismatches** across 20
  households; 4/20 graded, mean NDCG@10 (model-graded): reranked 0.998,
  date 0.935, stage-2 1.000 (n=4 — the harness discriminates, but no
  ranking conclusion is drawable; report in
  `worker/recommend/eval-report.json`).
- No-key eval (`--limit 5`): **PASS** — fallback proof
  (order_kept=true, all_templated=true), grades unavailable as designed.

## Coverage honesty (the thin half)

16/20 eval households return zero candidates. Proven corpus facts, not
bugs: only **10 of 797** live events have venue coordinates (any
distance-capped household matches among ~10), and the snapshot is
weekday-daytime heavy (Tue 209, Wed 245, Thu 126, Mon 97, Sat 58, Fri
46, Sun 16 — library storytimes), so evening/weekend windows match
little. Follow-ups, in order: (1) geocoding backfill (10/797 blocks
all distance search); (2) continuous re-crawl so the corpus isn't a
single-week snapshot. Until then, "Find activities" is correct but
often empty — the UI states counts honestly via the warnings array.

## Open items

- Sign-in UI (save API works with a JWT; page reads `seatpop_jwt`).
- Web embedding vectors (eval-only today; route passes no query vector).
- Phase-3 labeling + live eval still pending (independent track).
- Feedback/re-cache APIs (table exists; no endpoints yet).

## Follow-up: facet pattern, policy probe, fee-noise repair (0010/0011)

- 0010 re-installed `recommend_candidates` with the single-backslash facet
  pattern `\(([^)]+)\)$`; a static test pins it and rejects the
  double-backslash variant (which silently disabled all scoped policies).
- `eval:recommend` gained a policy probe: bare `free_only` + kids must
  surface ≥1 `free (per OPL)` row, over a full-width net (`stage1Limit:
  500`, new dep on `recommendStages`) so late-dated rows count.
- The probe first failed at 0/301: 295 in-scope OPL kids events were
  already enriched `free` (policy correctly masked), and the other 6 —
  one recurring Crafternoon — carried enrichment noise in `fee_notes`
  ("we have all the supplies..."), which blocked the policy and hid them
  from `free_only` families. enrich.v2's own example taught that noise.
- Fix: enrich.v3 constrains `price_text`/`fee_notes` to cost spans and
  corrects the example; 0011 clears the exact bogus sentence
  (idempotent data repair, no schema change). TS mirrors untouched —
  the rule was right, the data was wrong.
- Rerun 2026-10-30 (user terminal): **329/329 across 42 files**; push
  applied only 0011; eval **PASS** — 0 violations, 0 mismatches, probe
  `candidates=307 free_per_opl=6` as predicted. Household lines
  unchanged (same 4 non-empty): the 6 Crafternoon rows miss every
  `free_only` household's time/distance windows, so emptiness is still
  the 10/797 coords gap, not the policy path.

## Update: venue coordinates

- `data/seed/venue-coordinates.json` holds 41 entries: 33 OPL branches
  (City of Ottawa "Library Locations 2024" open data), Diefenbunker,
  Ottawa Art Gallery, Nature, War Museum, Little Theatre, Westboro
  market, Great Canadian Theatre Company, Dominion-Chalmers. One entry
  per physical place; matching is normalized substring with longest
  match winning (`worker/src/seed-venues/seed.ts`).
- `npm run seed:venues` backfills rows where lat/lng are both null and
  never overwrites; re-running changes nothing. Ingest venue creation
  consults the seed first, geocoder second, so re-crawls keep coverage.
- Coverage: **10/797 → 775/779** live events with coordinates (the pool
  shrank as events expired; 61 venue rows updated). Recommend eval:
  **4/20 → 15/20** households return candidates, **0 violations** (exit
  rule intact), mean NDCG@10 over 14 graded: reranked **0.990**, date
  0.766, stage-2 0.895 — the harness now clearly discriminates.
  h07 (63 candidates) went ungraded: the judge hit the 4096 length cap.
- Unverified entries (map-check queue, pinned by test): OAG (45.4253,
  -75.6898, rounded from its geocoded row), GCTC (45.4001, -75.7318,
  Wikipedia coords may predate the Wellington move), Westboro market
  (45.3905, -75.7435, approximate Byron Park spot).
- Still without coordinates (4 one-event rows, out of scope): Canadian
  Museum of History Theatre, Lansdowne Indoor Market, National Gallery
  of Canada, "Telephone, Canada" (extraction junk). Seed entries with
  no venue yet (kept for ingest): Nature, Little Theatre, Fitzroy
  Harbour, Vernon.
- Verify: `npm run typecheck && npm run lint && npm test`;
  `npm run seed:venues --workspace @seatpop/worker -- --dry-run`;
  `npm run seed:venues --workspace @seatpop/worker`;
  `npm run eval:recommend --workspace @seatpop/worker`.
