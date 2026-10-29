# Enrichment v2 (prompt_version `enrich.v2`)

You read ONE public event listing (title, description, venue name) and
return structured facts. Every extracted field carries the exact source
span it came from. Reply with a single JSON object and nothing else.

## Rules

- Copy spans verbatim. Never invent, paraphrase, or infer facts that are
  not stated. When the text does not state a field, return
  `{"value": null, "quote": null}` for it.
- Never infer ages, price, or registration from the venue TYPE or the
  source's reputation. A library program is not free because it is at a
  library; a museum workshop has no age range because it is at a museum.
  Only stated facts.
- `setting` is one of `indoors`, `outdoors`, `online`, `hybrid`, and the
  quote must name the place type: hall, room, gym, arena, pool, studio
  (indoors); park, garden, trail, field, playground, beach (outdoors);
  online, virtual, zoom, webinar (online). `hybrid` only when the span
  covers two kinds (e.g. "in the hall and online").
- `energy` is one of `calm`, `moderate`, `high-energy`, and the quote
  must carry a matching cue: quiet, gentle, slow, peaceful (calm);
  casual, social, fun (moderate); energetic, intense, vigorous, cardio
  (high-energy).
- `crowd` is one of `small-group`, `large-group`: limited spots, seats,
  registration caps (small-group); festivals, fairs, hundreds, everyone
  (large-group). "No registration" states no cap — return null.
- `duration_min` accepts digits ("90 minutes" → 90) and number words
  ("one-hour workshop" → 60, "half an hour" → 30).
- `price_kind` is `"free"` only when the text says the EVENT costs free,
  no cost, or no charge. "Free parking", "free wifi", "free with purchase"
  and anything about a different event do NOT make the event free.
- A price is stored only if the digits AND the currency appear in the
  quote. `"$15"` gives 1500 cents; "fifteen dollars, cash only" gives
  nothing exact enough — use `price_kind` with the quote and null amounts.
- Dates: `registration_opens_at` is `YYYY-MM-DD` only. Resolve years
  against TODAY; never invent a date from vague words like "soon".
- `summary_short` (≤140 characters) and `tags` (≤8, lowercase, single
  words or short phrases) are generated, not copied: no quotes needed.
- Keep the output short: omit nothing, explain nothing.

## Output shape

```json
{
  "age_min": {"value": 3, "quote": "ages 3 to 5"},
  "age_max": {"value": 5, "quote": "ages 3 to 5"},
  "needs_adult": {"value": true, "quote": "children must be with a caregiver"},
  "setting": {"value": "indoors", "quote": "in the main hall"},
  "energy": {"value": "calm", "quote": "a quiet morning session"},
  "crowd": {"value": "small-group", "quote": "limited to 12 spots"},
  "duration_min": {"value": 60, "quote": "one-hour workshop"},
  "language": {"value": "English", "quote": "in English"},
  "accessibility": {"value": ["wheelchair accessible"], "quote": "wheelchair accessible entrance"},
  "registration_hint": {"value": "drop-in", "quote": "drop-in program"},
  "registration_opens_at": {"value": "2026-11-01", "quote": "registration opens November 1"},
  "price_kind": {"value": "paid", "quote": "$15 per person"},
  "amount_min_cents": {"value": 1500, "quote": "$15 per person"},
  "amount_max_cents": {"value": 1500, "quote": "$15 per person"},
  "currency": {"value": "CAD", "quote": "$15 CAD per person"},
  "price_text": {"value": "$15", "quote": "$15 per person"},
  "fee_notes": {"value": "supplies included", "quote": "supplies included"},
  "summary_short": {"value": "One-hour kids craft hour at the library."},
  "tags": {"value": ["crafts", "kids", "library"]}
}
```

`price_kind` is one of: `free`, `paid`, `pay_what_you_can`, `donation`,
`member_only`, `unknown`. Use `unknown` (with a null quote) when the text
says nothing about cost.
