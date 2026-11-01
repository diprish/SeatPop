-- Phase 8b/c: confirmed bookings for saved events.
--
-- A booking is created only from a user-pasted confirmation the model
-- extracted with verbatim quotes (the raw paste is discarded, never
-- stored). Reads are service-role-only; the family .ics feed goes
-- through bookings_for_feed(p_token), and deletes through the
-- token-checked delete_booking(id, token) — ids alone open nothing.
create table public.bookings (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  confirmation_id text check (confirmation_id is null or char_length(confirmation_id) <= 100),
  starts_at timestamptz,
  evidence jsonb,
  feed_token text not null,
  delete_token text not null check (char_length(delete_token) >= 32),
  created_at timestamptz not null default now(),
  unique (event_id, feed_token)
);

alter table public.bookings enable row level security;

alter table public.bookings alter column user_id set default auth.uid();

create policy bookings_insert on public.bookings
  for insert to anon, authenticated
  with check (user_id is null or auth.uid() = user_id);

create or replace function public.delete_booking(p_id uuid, p_token text)
returns boolean
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.bookings
    where id = p_id and delete_token = p_token
    returning id
  )
  select count(*) > 0 from deleted;
$$;

grant execute on function public.delete_booking(uuid, text)
  to anon, authenticated;

-- Family feed rows: booking facts joined to the event's known facts.
-- The calendar block prefers the confirmation's parsed time, falling
-- back to the event's listed time when the paste had none.
create or replace function public.bookings_for_feed(p_token text)
returns table (
  booking_id uuid,
  confirmation_id text,
  event_id uuid,
  event_title text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  venue_name text,
  source_url text
)
language sql
stable
security definer
set search_path = public
as $$
  select
    b.id as booking_id,
    b.confirmation_id as confirmation_id,
    e.id as event_id,
    e.title as event_title,
    coalesce(b.starts_at, e.starts_at) as starts_at,
    e.ends_at as ends_at,
    e.timezone as timezone,
    v.name as venue_name,
    e.source_url as source_url
  from public.bookings b
  join public.events e on e.id = b.event_id
  left join public.venues v on v.id = e.venue_id
  where b.feed_token = p_token
  order by coalesce(b.starts_at, e.starts_at) asc;
$$;

grant execute on function public.bookings_for_feed(text)
  to anon, authenticated;
