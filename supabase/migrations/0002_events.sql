-- Phase 1: data model and ingestion.
-- Every table has Row Level Security enabled and NO policies, so the tables
-- are service-role only (the service role bypasses RLS). Public read goes
-- through the public_events / public_venues views below, which run as the
-- migration owner and expose an explicit column allowlist. raw_text and
-- raw_hash are never exposed publicly.

-- Event sources (calendars, feeds, pages we ingest from).
create table public.sources (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  kind text not null check (kind in ('ics', 'jsonld', 'rss', 'html', 'user_submitted')),
  url text not null unique,
  city text not null default 'Ottawa',
  enabled boolean not null default true,
  last_run_at timestamptz,
  last_status text,
  robots_ok boolean
);

alter table public.sources enable row level security;

-- Canonical venues.
create table public.venues (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  address text,
  lat double precision,
  lng double precision,
  geocode_confidence double precision
);

alter table public.venues enable row level security;

-- Canonical events. event_pricing arrives in phase 2.
create table public.events (
  id uuid primary key default gen_random_uuid(),
  source_id uuid not null references public.sources (id) on delete restrict,
  source_url text not null,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  timezone text not null default 'America/Toronto',
  venue_id uuid references public.venues (id) on delete set null,
  raw_text text,
  raw_hash text,
  dedupe_key text,
  category text check (category in (
    'classes', 'camps', 'sports', 'arts', 'music', 'museums', 'outdoors',
    'festivals', 'markets', 'workshops', 'library', 'community'
  )),
  status text not null default 'scheduled'
    check (status in ('scheduled', 'cancelled', 'full', 'waitlist')),
  fetched_at timestamptz not null default now()
);

alter table public.events enable row level security;

-- One raw_hash per source: re-ingesting unchanged listings changes nothing.
create unique index events_source_raw_hash_uidx
  on public.events (source_id, raw_hash)
  where raw_hash is not null;

-- One canonical event per dedupe_key across sources.
create unique index events_dedupe_key_uidx
  on public.events (dedupe_key)
  where dedupe_key is not null;

create index events_starts_at_idx on public.events (starts_at);
create index events_venue_idx on public.events (venue_id);
create index events_category_idx on public.events (category);

-- Every source listing that feeds one canonical event.
create table public.event_sources (
  event_id uuid not null references public.events (id) on delete cascade,
  source_id uuid not null references public.sources (id) on delete restrict,
  source_url text not null,
  primary key (event_id, source_id)
);

alter table public.event_sources enable row level security;

-- Public read surface. Column allowlist only; no raw_text, no raw_hash.
create view public.public_events as
  select
    id,
    source_id,
    source_url,
    title,
    description,
    starts_at,
    ends_at,
    timezone,
    venue_id,
    category,
    status
  from public.events;

create view public.public_venues as
  select
    id,
    name,
    address,
    lat,
    lng
  from public.venues;

grant select on public.public_events to anon, authenticated;
grant select on public.public_venues to anon, authenticated;
