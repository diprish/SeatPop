# Phase 8 (lean): guided booking and family calendar

One commit per slice, gates green throughout
(typecheck + lint + 513/513 across 70 files at slice c).

## Slice a: booking checklist (`d2ea2f4`)

- Saved events get "Book for us": a guided checklist built from
  stored facts only — official-page link, registration opening
  with City wording (or an honest "not listed"), price-appropriate
  payment step, age check only when flagged — always ending at the
  pinned boundary: SeatPop never submits forms, enters payment, or
  logs in on anyone's behalf. Progress persists per event on the
  device. Events without an official link get a note, not a button.

## Slice b: confirmation capture (`c2670eb`)

- Migration `0016`: `bookings` keyed by event+feed with
  confirmation id, parsed time, evidence quotes, feed/delete
  tokens. RLS insert-only; deletes and the feed go solely through
  token-checked `delete_booking` / `bookings_for_feed` definer
  functions (the feed prefers the parsed time, falling back to
  the listed time).
- New `booking_parse` LLM task (Meta-only standard Spark, inline
  prompt): emails, phones, addresses, and postals are redacted
  before the call, and the verifier nulls anything ungrounded or
  placeholder-bearing — a missing fact and an invented one both
  come back null. The raw paste is discarded, never stored/logged.
- `POST /api/bookings/parse` returns verified facts plus a
  calendar-mismatch flag against the event's listed time (flagged,
  not rejected — the user confirms). `POST/DELETE /api/bookings`
  persist via token (409 on re-book).
- Saved-page capture box: PII warn line, quote-bearing review
  against the listed time, mismatch alert, confirm-to-save, true
  delete (server + device).

## Slice c: Booked tab and calendar (`ddbfde9`)

- Migration `0017`: the feed's end time resolves to null when the
  confirmation named a different occurrence (`CREATE OR REPLACE`,
  grants persist) — no borrowed end times on the calendar.
- Shared ICS builder (escaping, 75-octet folding, CRLF, UTC):
  exact-byte tested, with the same start/end rule as the SQL.
- Booked tab: booking list with confirmation ids, per-booking
  `.ics` download, delete, honest empty state, and the
  token-built family feed URL with a keep-it-private note.
- `GET /api/bookings/feed?token=`: capability-token gate (no rate
  limit — the token is the gate), unknown tokens get an empty
  feed, bad rows skip without failing it, private short cache.
- No secrets in `apps/web`: no `NEXT_PUBLIC_*`, no service role.

## Operator rundown

```sh
npx supabase db push            # 0016 + 0017 (verify with migration list)
npm run build --workspace @seatpop/web
```

Manual pass: save an event → Book for us → complete on the official
site → Add confirmation → check the review → Confirm booking →
Booked tab shows it → .ics downloads → feed URL subscribes.

## Update: hardened booking creates (migration `0018`)

- `bookings` gains `CHECK (char_length(feed_token) >= 32)`, and
  direct app-role INSERT is revoked; `POST /api/bookings` calls
  `create_booking(...)`, a SECURITY DEFINER function enforcing
  long tokens, a known event, and ≤50 bookings per feed token
  (typed envelope → HTTP, 409 on duplicates). Delete and the
  feed RPCs are unchanged.
