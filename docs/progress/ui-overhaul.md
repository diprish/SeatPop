# UI overhaul: warm calm look on design tokens

All web surfaces moved from raw neutral ramps and black/white
inversions onto the step-1 tokens (`--sp-*` in `globals.css`, resolved
through `@theme inline` so both themes work with no per-component
`dark:` forks for shell colors). A repo-wide sweep confirms the only
raw black left in `apps/web/src` is the intentional `bg-black/50`
modal scrim.

## Steps (one commit each, gates green each time)

- Step 1 (`713b5b8`, prior): tokens, shell wiring, amber paid badge.
- Step 2 (`838111a`): For-you cards — `rounded-card border-line
  bg-surface p-4 shadow-card` shell, muted metadata, muted
  ("Price not stated") badge on `bg-background text-muted`, `space-y-4`
  list rhythm. Pins: `tests/card-markup.test.ts`.
- Step 3 (`2542a7a`): Why sheet (`bg-surface` panel, sheet radii and
  black scrim kept) and event detail page (flat long-form, token
  recolor only). Evidence quotes in both: `border-l-2 border-line …
  italic text-muted`. Pins: `tests/detail-markup.test.ts`.
- Step 4 (`8f295c8`): household panel and Explore filters as warm
  cards; selected chips follow the Worth-it pressed pattern
  (`border-primary bg-primary/10` + semibold, never inverted pills);
  search buttons fill `bg-primary` with white text on light and
  warm-black (`dark:text-background`) on dark. Pins:
  `tests/filters-markup.test.ts`.
- Step 5 (`0edc11b`): Saved/Booked pages and reminder/booking
  controls — booked entries shelled as cards, every commit button
  (set reminder, book for us, read/confirm) on the primary pattern,
  confirmation review panel flat on `bg-surface`. Pins:
  `tests/saved-markup.test.ts`.
- Restore (`3c20805`): step 5 accidentally overwrote Phase-7b's
  Remind-me consent/label/delete pins in `saved-markup.test.ts`; this
  restores them verbatim alongside the new style pins.
- Step 6 (`1976dbb`): Trust page (eval panels as cards, amber
  ambiguity notice kept semantic), shared empty states (all three as
  cards), and the remaining shell — sticky nav, For-you chrome,
  legacy `/recommend` (whose bare `border` classes also gained
  `border-line`, and whose light-only buttons gained dark-theme
  text). Pins: `tests/trust-markup.test.ts`,
  `tests/shell-markup.test.ts`.

## Patterns (for future surfaces)

- Card: `rounded-card border border-line bg-surface p-4 shadow-card`,
  lists at `space-y-4`. Compact rows stay flat:
  `rounded border border-line bg-surface`.
- Primary commit button: `bg-primary … text-white dark:text-background`.
- Pressed/selected chip: `border-primary bg-primary/10` + semibold.
- Muted metadata/notes: `text-muted`. Inputs: `border-line bg-surface`.
- Semantic colors stay raw: green/amber reason marks and badges,
  amber validation/ambiguity notices, red error alerts.

## Contrast (computed from the pinned hex values, AA = 4.5:1)

| Pair | Light | Dark |
|---|---|---|
| Muted text on surface | 4.8:1 | 6.0:1 |
| Muted badge text on page bg | 4.7:1 | — |
| Button text on primary fill | 5.5:1 | 9.4:1 |

Known exception: the amber `(inferred)` reason mark (~4.0:1 on white)
is below AA. It predates the overhaul and is kept deliberately for its
caution semantics; flagged here so the keep is explicit.

## Verification

- `npm run typecheck && npm run lint && npm test`: 88 files / 700
  tests green at every step.
- Visual pass (light + dark, all pages incl. Why sheet, Saved
  controls, and an empty state): zero contrast failures, no
  horizontal scroll, card shadows resolve.
- Lighthouse accessibility: 100 on the For-you page (21 passed audits).
- Refreshed screenshots: `docs/screenshots/01–05` + `06-dark-for-you.png`.
