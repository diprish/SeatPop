# Phase 7 (lean): registration windows and email reminders

One commit per slice, gates green throughout
(typecheck + lint + 483/483 across 65 files at slice c).

## Slice a: registration windows (`7602b3f` + `f61de81`)

- Migration `0014`: `registration_windows` (scope, kind, opens_at,
  opens_date_only, verbatim quote, https source URL, natural-key
  unique) with RLS public-read/service-write, plus a
  `public_event_sources` view so anon matching never exposes
  `event_sources`.
- `seed:registration-windows`: strict validation (https URLs, zoned
  datetimes, real calendar dates, every error listed), bare dates
  become Toronto-midnight instants flagged date-only (DST-aware, so
  no time is ever invented), upsert-idempotent, never deletes.
- Matching: window scope names an event source (case-insensitive);
  soonest upcoming opening wins; past/invalid windows never show.
- `/api/recommend` + `/api/events/[id]` attach the window (cached
  10 min, degrading to null — never a 500). Cards show
  "Registration opens …" + City link + truncated quote; detail
  shows kind + full verbatim quote + link, all in America/Toronto.
- Open owner step: `windows[]` in
  `data/seed/city-registration-dates.json` is still empty — the
  feature needs ≥1 hand-transcribed window (quote + page URL) and a
  re-run of the seed before anything visible appears. Nothing here
  invents City dates.

## Slice b: Remind me (`6c41928`)

- Migration `0015`: `reminders` keyed by event+email with
  `remind_at`/`basis`/delete-token/`sent_at`. RLS insert-only for
  app roles — no read/update/delete policies, so reads are
  service-role-only. Deletes go solely through the token-checked
  `delete_reminder(id, token)` SECURITY DEFINER function.
- `POST /api/reminders` validates the address, 404s unknown events,
  computes remind_at (window opening − 1h, else start − 1d),
  returns the delete token once, 409s duplicates, and is
  rate-limited. The address is never logged and never sent to a
  model. `DELETE` calls the token RPC (404 on mismatch).
- Saved page: per-snapshot Remind-me form (labelled email input,
  explicit one-email consent line, busy/error states), then
  "Reminder set · <date>" with its basis note and one-click
  delete. The token lives only on the device.

## Slice c: sender (`8c25f0b`)

- `send:reminders`: unsent due rows oldest-first (limit 100,
  `--limit` override), text-only mail from stored facts (window
  basis: opening + City quote + both links; start basis: honest
  fallback note + official link; footer states the one-email
  promise), `sent_at` marked per success. At-least-once by design;
  one bad row never blocks the rest; any failure exits 1 with the
  failed ids. `--dry-run` prints masked recipients + subjects.
- `reminders.yml` crons it every 15 minutes + manual dispatch.
  Secrets (names only): `RESEND_API_KEY`, `RESEND_FROM`,
  `SUPABASE_*` — see `docs/deploy.md`.
- No secrets in `apps/web`: no `NEXT_PUBLIC_*`, no service role;
  `process.env` only in API routes and the two server-only libs.

## Operator rundown

```sh
npx supabase db push                                            # 0014 + 0015
npm run seed:registration-windows --workspace @seatpop/worker  # after transcribing windows
npm run send:reminders --workspace @seatpop/worker -- --dry-run
```
