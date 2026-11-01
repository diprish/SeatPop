# Phase 9 (lite): "Worth it?" series votes

Parents vote a series up or down with optional fixed-vocabulary tags.
One row per (series, device-hash); counts show at 3+ votes. No names,
no emails, no free-text comments, no IPs stored — the only identity is
a salted device hash. Past and cancelled events accept votes: the
question is retrospective.

## Step 1: migration `0021`

- `event_series_votes(series_key, event_id, voter_hash, vote, tags,
  created_at)`: `vote` CHECK (1, -1), `voter_hash` pinned to 64-char
  hex, `UNIQUE (series_key, voter_hash)` dedupes re-votes into
  updates. RLS enabled, zero policies: no direct access.
- `create_vote(...)` (definer, anon/authenticated EXECUTE): validates
  series/event/hex-voter/vote, enforces the six-tag vocabulary with
  SQL-side dedupe, then upserts (re-votes refresh direction, tags, and
  latest occurrence; `created_at` keeps the first vote). Caps: ≤100
  votes per voter total, ≤100 created globally per hour — checked only
  for genuinely new votes, so changing your mind never 429s. Typed
  `{ok, id|error}` envelope.
- `series_votes_summary(...)` (definer, STABLE): counts only
  (`total/up/down` + per-tag counts), and only at 3+ votes — smaller
  samples return `{enough: false}` with no counts.

## Step 2: voter hash and API

- `voteSeriesKey` (`worker/src/recommend/series.ts`, via
  `@seatpop/worker/recommend`): normalized title + normalized venue
  branch — rooms of one branch vote as one series. Reuses the
  twins-collapse normalization exactly.
- `voterHashFor = sha256(device_id:salt)` (`lib/voter-hash.ts`,
  server-only). The device id is a random UUID in localStorage
  (`lib/votes.ts`, in-memory fallback for private mode); the raw id is
  never logged or stored. Salt is the `VOTE_SALT` env var (root `.env`
  + host; `.env.example` and `docs/deploy.md` name it). Missing salt
  500s vote casts while counts still read.
- `GET /api/votes?event_id=…` derives the series server-side and
  returns the summary envelope; `POST /api/votes` validates (uuid,
  vote ±1, fixed-vocabulary tags, device id) and maps every envelope
  code to HTTP via `voteCreateError` (400s, 404, 429s, fail-closed
  500).

## Step 3: UI

- `<WorthIt>` (`components/worth-it.tsx`), shared by event cards
  (after the reason line) and the detail page (under the price badge):
  thumbs up/down (`aria-pressed`, 44px targets), a collapsible Tags
  disclosure with the six fixed chips (staged before the first vote,
  re-saved on every toggle after), and count lines fed only by the API
  — "{up} parents say it's worth it" (pluralized) at 3+ votes,
  otherwise "Be the first to say if it was worth it". Loading,
  retryable load failure, and server-message vote errors are all
  explicit states; the voter's own direction stays highlighted
  per-device. Counts never render from placeholders.

## Step 4: abuse rails and tests

- POST shares the daily per-IP cap (`votes:` bucket); GET stays
  unlimited — every card reads its summary on view, and reads are
  cheap aggregates.
- Tests: `voteSeriesKey` behavior (branch sharing, splits,
  normalization, venue-less); migration pins (checks, unique dedupe,
  RLS with no policies, grants, six-tag vocabulary, both caps,
  upsert-without-created_at-touch, 3-vote threshold with counts-only
  output); `VOTE_TAGS` exact list + SQL sync; `voterHashFor`
  stability/salt-dependence; `voteCreateError` table; worth-it markup
  pins (thumbs, strings, chips, no free-text inputs, both hosts).

```sh
npx supabase db push            # 0021 (verify with migration list)
npm run typecheck && npm run lint && npm test
```
