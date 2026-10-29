-- Phase 2: model enrichment and pricing for canonical events.
-- Both tables are service-role only (RLS enabled, NO policies). The public
-- surface stays the public_events view (recreated below with an explicit
-- allowlist): display/filter fields are exposed, while evidence quotes,
-- model metadata, confidence, and the embedding stay internal.

create table public.event_enrichment (
  event_id uuid primary key references public.events (id) on delete cascade,
  age_min smallint check (age_min is null or (age_min >= 0 and age_min <= 130)),
  age_max smallint check (age_max is null or (age_max >= 0 and age_max <= 130)),
  needs_adult boolean,
  setting text,
  energy text,
  crowd text,
  duration_min integer check (duration_min is null or duration_min > 0),
  language text,
  accessibility text[] not null default '{}',
  registration_hint text,
  registration_opens_at timestamptz,
  summary_short text,
  tags text[] not null default '{}',
  embedding vector(384),
  evidence jsonb,
  model text,
  prompt_version text,
  source_hash text,
  confidence double precision
    check (confidence is null or (confidence >= 0 and confidence <= 1)),
  enriched_at timestamptz not null default now(),
  check (age_min is null or age_max is null or age_min <= age_max)
);

alter table public.event_enrichment enable row level security;

create table public.event_pricing (
  event_id uuid primary key references public.events (id) on delete cascade,
  price_kind text not null default 'unknown'
    check (price_kind in (
      'free', 'paid', 'pay_what_you_can', 'donation', 'member_only', 'unknown'
    )),
  amount_min_cents integer
    check (amount_min_cents is null or amount_min_cents >= 0),
  amount_max_cents integer
    check (amount_max_cents is null or amount_max_cents >= 0),
  currency text,
  price_text text,
  evidence_quote text,
  fee_notes text,
  check (
    amount_min_cents is null or amount_max_cents is null
    or amount_min_cents <= amount_max_cents
  )
);

alter table public.event_pricing enable row level security;

-- Review list (low confidence first) and phase-3 hard-constraint filters.
create index event_enrichment_confidence_idx
  on public.event_enrichment (confidence);
create index event_enrichment_ages_idx
  on public.event_enrichment (age_min, age_max);
create index event_pricing_kind_idx on public.event_pricing (price_kind);

-- No vector index yet: at pilot scale (~10^2 rows) sequential scan wins.
-- Add ivfflat/hnsw when events approach 10^4.

-- Public read surface: the same events allowlist plus the display/filter
-- fields the app needs. Never exposed: raw_text, raw_hash, evidence
-- quotes, model, prompt_version, source_hash, confidence, embedding.
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
    pr.fee_notes
  from public.events e
  left join public.event_enrichment en on en.event_id = e.id
  left join public.event_pricing pr on pr.event_id = e.id;
