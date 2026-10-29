-- Display rule support: the app must render policy-derived prices as
-- attributed ("free (per OPL)"), never as plain facts, so it needs to
-- read price_basis. This reverses 0004's "basis stays internal" for the
-- basis flag only: the policy quote, URL, scope, and per-field evidence
-- stay internal (audit data, not app data). Grants are preserved by
-- CREATE OR REPLACE VIEW (as in 0003); no new grants needed.

create or replace view public.public_events as
  select
    e.id,
    e.source_id,
    e.source_url,
    e.title,
    e.description,
    e.starts_at,
    e.ends_at,
    e.timezone,
    e.venue_id,
    e.category,
    e.status,
    en.age_min,
    en.age_max,
    en.needs_adult,
    en.setting,
    en.energy,
    en.crowd,
    en.duration_min,
    en.language,
    en.accessibility,
    en.registration_hint,
    en.registration_opens_at,
    en.summary_short,
    en.tags,
    pr.price_kind,
    pr.amount_min_cents,
    pr.amount_max_cents,
    pr.currency,
    pr.price_text,
    pr.fee_notes,
    pr.price_basis
  from public.events e
  left join public.event_enrichment en on en.event_id = e.id
  left join public.event_pricing pr on pr.event_id = e.id;
