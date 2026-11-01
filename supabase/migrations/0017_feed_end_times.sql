-- Phase 8c: the feed's end time must match the booked start, not the
-- listed one. When a confirmation named a different occurrence (the
-- user saved despite the mismatch warning), the listed end time would
-- be wrong on the calendar — resolve it to null here instead.
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
    case when b.starts_at is null or b.starts_at = e.starts_at
      then e.ends_at end as ends_at,
    e.timezone as timezone,
    v.name as venue_name,
    e.source_url as source_url
  from public.bookings b
  join public.events e on e.id = b.event_id
  left join public.venues v on v.id = e.venue_id
  where b.feed_token = p_token
  order by coalesce(b.starts_at, e.starts_at) asc;
$$;
