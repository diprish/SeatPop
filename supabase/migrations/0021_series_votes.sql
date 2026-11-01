-- Worth-it votes per event series (phase 9 lite): one row per
-- (series, device-hash). No names, emails, free text, or IPs — the only
-- identity is a salted device hash the API route computes.
--
-- RLS is enabled with NO policies: app roles reach rows only through
-- the definer functions below. Counts surface only at 3+ votes.
create table public.event_series_votes (
  id uuid primary key default gen_random_uuid(),
  series_key text not null check (char_length(series_key) > 0),
  event_id uuid not null references public.events (id) on delete cascade,
  voter_hash text not null check (voter_hash ~ '^[0-9a-f]{64}$'),
  vote smallint not null check (vote in (1, -1)),
  tags text[] not null default '{}',
  created_at timestamptz not null default now(),
  unique (series_key, voter_hash)
);

alter table public.event_series_votes enable row level security;

-- Fixed tag vocabulary, shared by create_vote and the UI chips.
-- (Cap counts are best-effort abuse rails, as in 0018: concurrent
-- callers can overshoot by a row, which is fine for this purpose.)
create or replace function public.create_vote(
  p_series_key text,
  p_event_id uuid,
  p_voter_hash text,
  p_vote smallint,
  p_tags text[]
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_tags text[] := (
    select coalesce(array_agg(distinct t order by t), '{}')
    from unnest(coalesce(p_tags, '{}')) as t
  );
  v_id uuid;
  v_is_new boolean;
begin
  if p_series_key is null or char_length(trim(p_series_key)) = 0 then
    return jsonb_build_object('ok', false, 'error', 'invalid_series');
  end if;
  if p_event_id is null
    or not exists (select 1 from public.events where id = p_event_id) then
    return jsonb_build_object('ok', false, 'error', 'unknown_event');
  end if;
  if p_voter_hash is null or p_voter_hash !~ '^[0-9a-f]{64}$' then
    return jsonb_build_object('ok', false, 'error', 'invalid_voter');
  end if;
  if p_vote is null or p_vote not in (1, -1) then
    return jsonb_build_object('ok', false, 'error', 'invalid_vote');
  end if;
  if not (v_tags <@ array[
    'good for toddlers',
    'good for older kids',
    'crowded',
    'well run',
    'worth the drive',
    'not as described'
  ]) then
    return jsonb_build_object('ok', false, 'error', 'invalid_tags');
  end if;
  -- Re-votes (same series + voter) always pass: only new votes count
  -- against the caps, so changing your mind never 429s.
  select not exists (
    select 1 from public.event_series_votes
    where series_key = p_series_key and voter_hash = p_voter_hash
  ) into v_is_new;
  if v_is_new then
    if (select count(*) from public.event_series_votes
        where voter_hash = p_voter_hash) >= 100 then
      return jsonb_build_object('ok', false, 'error', 'voter_cap');
    end if;
    if (select count(*) from public.event_series_votes
        where created_at > now() - interval '1 hour') >= 100 then
      return jsonb_build_object('ok', false, 'error', 'global_cap');
    end if;
  end if;
  insert into public.event_series_votes
    (series_key, event_id, voter_hash, vote, tags)
  values
    (p_series_key, p_event_id, p_voter_hash, p_vote, v_tags)
  on conflict (series_key, voter_hash)
  do update set
    event_id = excluded.event_id,
    vote = excluded.vote,
    tags = excluded.tags
  returning public.event_series_votes.id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
end;
$$;

grant execute on function public.create_vote(text, uuid, text, smallint, text[])
  to anon, authenticated;

-- Counts only, and only at 3+ votes: 1–2 votes stay hidden so small
-- samples cannot be de-anonymized ("not enough votes").
create or replace function public.series_votes_summary(p_series_key text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  with votes as (
    select vote, tags
    from public.event_series_votes
    where series_key = p_series_key
  ),
  totals as (
    select
      count(*)::int as total,
      count(*) filter (where vote = 1)::int as up,
      count(*) filter (where vote = -1)::int as down
    from votes
  ),
  tag_counts as (
    select coalesce(
      jsonb_object_agg(tag, tag_count) filter (where tag is not null),
      '{}'
    ) as tags
    from (
      select tag, count(*)::int as tag_count
      from votes, unnest(votes.tags) as tag
      group by tag
    ) as grouped
  )
  select case
    when (select total from totals) < 3 then
      jsonb_build_object('ok', true, 'enough', false)
    else
      jsonb_build_object(
        'ok', true,
        'enough', true,
        'total', (select total from totals),
        'up', (select up from totals),
        'down', (select down from totals),
        'tags', (select tags from tag_counts)
      )
  end;
$$;

grant execute on function public.series_votes_summary(text)
  to anon, authenticated;
