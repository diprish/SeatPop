# Phase 6: public web app

Mobile-first guest app on top of the `/recommend` APIs: a judge opens
`/` and sees results in seconds with no sign-up.

## Built

- **Shell**: nav (For you, Explore, Saved, Trust), light/dark theme with
  stored preference, PWA manifest + icon, favicon.
- **For you (`/`)**: opens into the sample household (Ottawa K2S, one
  adult, one kid, one preschooler) and searches on load. Visible
  household panel (age-band chips, FSA, budget, distance, free-only,
  availability grid) that collapses after searching; typed describe-your
  family shortcut via `/api/profile/parse`. No names, no addresses.
- **Cards**: title (detail link), event-local time range
  ("Sat Oct 31 · 10:00 AM–11:00 AM", ends_at aware, never UTC — including
  UTC instants embedded in model reasons), venue, distance, price badge
  (`Free`, `free (per OPL)`, `$12.00`, `Price not stated`), ages with the
  amber "check the age group" flag, reason with green (stated) / amber
  (inferred) marks and an AI-vs-match tag, official-page link. Actions:
  Save, Not for us (reason chips), Why this?, Official page.
- **Why sheet**: per-card dialog with matched fields (age, price +
  policy-vs-listing basis, distance, time, language, accessibility,
  interests), verbatim evidence quotes, official link; Escape/backdrop
  close, focus trapped; degrades to fields-only when quotes fail.
- **Empty state**: names the blocking filter with measured candidate
  counts (`diagnose: true` on the API runs cheap SQL-only relaxations)
  and one-tap widening that applies exactly what was measured.
- **Event detail (`/events/[id]`)**: verified facts with quotes, price
  basis, amounts/fee notes, registration (opens/opened), description,
  official link; loading/error/not-found states.
- **Trust (`/trust`)**: enrichment eval per-model tables (accuracy,
  false-free, wrong-price, hallucinated, tokens, cost/1k, gate PASS/FAIL)
  or "enrichment eval pending"; recommend summary (violations, NDCG@10
  by method labelled model-graded, policy probe); no-key fallback proof
  (order kept, all templated). Missing snapshots always render pending —
  numbers are never faked. Snapshots refresh on `predev`/`prebuild` from
  `worker/recommend/eval-report*.json` (git-ignored copies).
- **Explore**: same recommend path narrowed by one band, free-only, and
  distance on the stored household context.
- **Saved**: guest snapshots on-device; signed-in verdicts mirror to the
  new feedback API (`POST/GET/DELETE /api/feedback`); API-only ids link
  to detail.
- **APIs**: `diagnose` flag on `/api/recommend`; `GET /api/events/[id]`
  (public views, anon key); feedback CRUD (JWT-forwarded, RLS-owned).
- **Data (migrations 0012–0013)**: public view gains the two evidence
  columns (documented reversal; model/confidence/embedding stay
  internal); `user_id` defaults to `auth.uid()` on households + feedback
  (this also fixed household save, which would have failed NOT NULL).
- **Eval change**: no-key runs persist `eval-report-fallback.json`
  instead of overwriting the full report.
- **States**: loading indicators, error banner with retry (never a blank
  page), honest empty states everywhere.

## How to run

```sh
npm run dev --workspace @seatpop/web   # open the printed Local URL
npm run build --workspace @seatpop/web # production build (green)
npm start --workspace @seatpop/web     # serve the build
```

Secrets live in the repo-root `.env` (see `docs/deploy.md` for the host
variable list). Without `MODEL_API_KEY` the app runs in match-order
fallback. Apply migrations with `npx supabase db push` (through 0013).

## Verification

- `typecheck && lint && test`: green, **386/386** across 51 files.
- `next build`: green (13 routes; APIs + detail dynamic, rest static).
- **Lighthouse accessibility: 100** on `/` (Chrome). The run showed an
  environmental "clearing the browser cache timed out" warning plus one
  best-practice note about identical link text — the Official-page links
  now carry per-event `aria-label`s, and the `/icon.svg` 500 behind the
  console errors is fixed (static file + explicit metadata icon).
- Secret audit: no `SUPABASE_SERVICE_ROLE_KEY` and no `NEXT_PUBLIC_*` in
  `apps/web`; `process.env` appears only in API routes, the server-only
  `recommend-server.ts` (imported exclusively by routes), and build
  config.

## Screenshots

In `docs/screenshots/`: `01-for-you.png`, `02-why-sheet.png`,
`03-detail.png`, `04-trust.png`, `05-explore.png`.

## Cut, and why

- **Explore beyond free/age/distance** (date range, category, map): the
  task's own time-short list; the three shipped filters all run
  server-side through the same SQL path, so no misleading client
  post-filtering.
- **Sign-in UI**: JWT is read from `localStorage` manually; the save and
  feedback APIs are ready for it. Guest mode is the demo path.
- **Enrichment Trust data**: correctly pending until human labelling
  finishes; the page renders the pending state instead of numbers.
- **Service worker / offline**: manifest only; the app is honest about
  needing the network.
- **`/recommend` legacy page**: kept working, untouched; the new home is
  the primary flow.
