-- Phase 6 slice b: the app's Why-this sheet and event detail page show
-- the verbatim evidence quotes behind enriched facts. This reverses
-- 0003/0007's "evidence stays internal" for the two quote columns only:
-- quotes are short spans from public official pages, always rendered
-- with the official-page link. Model, prompt_version, source_hash,
-- confidence, and embedding stay internal. Grants are preserved by
-- CREATE OR REPLACE VIEW, as in 0007.

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
    pr.price_basis,
    en.evidence,
    pr.evidence_quote
  from public.events e
  left join public.event_enrichment en on en.event_id = e.id
  left join public.event_pricing pr on pr.event_id = e.id;
