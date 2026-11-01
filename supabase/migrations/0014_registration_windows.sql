-- Phase 7a: owner-transcribed City registration windows.
--
-- data/seed/city-registration-dates.json holds windows the owner transcribes
-- BY HAND from the City's registration page (never crawled, never derived):
-- each row carries the verbatim quote and the https page URL, and the app
-- always renders both. opens_at is the exact instant; opens_date_only marks
-- rows transcribed as a bare calendar date (Toronto midnight — the loader
-- computes the EST/EDT offset), so the app never invents a time.
-- Reference data like home_area: public read, service-role writes only.
create table public.registration_windows (
  id uuid primary key default gen_random_uuid(),
  scope text not null check (char_length(scope) > 0),
  kind text not null default '',
  opens_at timestamptz not null,
  opens_date_only boolean not null,
  quote text not null check (char_length(quote) > 0),
  source_url text not null check (source_url like 'https://%'),
  created_at timestamptz not null default now(),
  unique (scope, kind, opens_at, opens_date_only)
);

alter table public.registration_windows enable row level security;

create policy registration_windows_public_read on public.registration_windows
  for select to anon, authenticated using (true);

grant select on public.registration_windows to anon, authenticated;

-- Public event-to-source-name map for window matching. event_sources
-- itself stays service-role-only; (event id, listing source name) pairs
-- are public listing facts.
create view public.public_event_sources as
  select es.event_id as event_id, s.name as source_name
  from public.event_sources es
  join public.sources s on s.id = es.source_id;

grant select on public.public_event_sources to anon, authenticated;
