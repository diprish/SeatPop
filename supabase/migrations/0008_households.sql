-- Phase 4: households, hard-constraint recommendations.
--
-- User data is keyed to auth.uid() with owner-only RLS policies. Members
-- are age bands ONLY (never names, birth dates, full postal codes, or
-- street addresses — no column exists for them). Home areas reference the
-- home_area table: FSA prefix + centroid, seeded from GeoNames postal
-- data (CC BY 4.0, see README) for Ottawa-area K prefixes only.
--
-- recommend_candidates() enforces every hard constraint in SQL (CONTEXT
-- rule 3): age fit, distance, time windows, budget, accessibility,
-- language, status, and future start. Models only reorder/explain rows
-- it returns. It is SECURITY DEFINER with EXECUTE granted to anon and
-- authenticated so guests can search without storing anything; prefs
-- arrive as untrusted JSONB and every accessor is type-guarded.

-- Reference areas first: households.home_fsa references this table.
create table public.home_area (
  fsa text primary key check (fsa ~ '^[A-Z][0-9][A-Z]$'),
  lat double precision not null,
  lng double precision not null,
  name text
);

alter table public.home_area enable row level security;

-- Reference data (no user content): readable by everyone, writable by
-- the service role only (no insert/update/delete policies).
create policy home_area_public_read on public.home_area
  for select to anon, authenticated using (true);

grant select on public.home_area to anon, authenticated;

-- Home-area seeds: 41 Ottawa-area K FSA rows used directly from the
-- GeoNames free postal dump (CC BY 4.0; FSA-level lat/lng, accuracy 6 =
-- centroid of addresses or shape). 34 admin2-selected (Ottawa, Gloucester,
-- Kanata, Nepean) + 7 reviewed unclassified Ottawa communities (Orleans
-- K1E/K4A, Stittsville K2S, Cumberland K4B/K4C, Manotick K4M, Greely K4P).
-- Non-Ottawa K areas stay out (Belleville, Cornwall, Kingston, Pembroke,
-- Peterborough, Frontenac/Renfrew counties, Almonte, Prescott-Russell,
-- Glengarry, Grenville, Quinte, Kawarthas, Rockland, Russell, Hawkesbury,
-- Brockville, Smiths Falls, Perth, Arnprior, Renfrew, Petawawa, Trenton,
-- Cobourg, Lindsay). Method: supabase/seeds/ottawa_fsa_from_geonames.py.
insert into public.home_area (fsa, lat, lng, name) values ('K1A', 45.42070, -75.70230, 'Government of Canada Ottawa and Gatineau offices'); -- Ottawa
insert into public.home_area (fsa, lat, lng, name) values ('K1B', 45.42840, -75.58750, 'Blackburn Hamlet / Pine View'); -- Gloucester
insert into public.home_area (fsa, lat, lng, name) values ('K1C', 45.46770, -75.53990, 'West Orleans'); -- Gloucester
insert into public.home_area (fsa, lat, lng, name) values ('K1E', 45.47710, -75.50460, 'Queenswood'); -- reviewed Ottawa (unclassified)
insert into public.home_area (fsa, lat, lng, name) values ('K1G', 45.35480, -75.57730, 'Riverview / Hawthorne'); -- Ottawa
insert into public.home_area (fsa, lat, lng, name) values ('K1H', 45.38760, -75.65930, 'Alta Vista'); -- Ottawa
insert into public.home_area (fsa, lat, lng, name) values ('K1J', 45.45190, -75.60360, 'Beacon Hill / Cyrville'); -- Gloucester
insert into public.home_area (fsa, lat, lng, name) values ('K1K', 45.44480, -75.64310, 'Overbrook'); -- Ottawa
insert into public.home_area (fsa, lat, lng, name) values ('K1L', 45.44000, -75.66300, 'Vanier'); -- Ottawa
insert into public.home_area (fsa, lat, lng, name) values ('K1M', 45.44910, -75.68180, 'Rockcliffe Park / New Edinburgh'); -- Ottawa
insert into public.home_area (fsa, lat, lng, name) values ('K1N', 45.42890, -75.68440, 'Lower Town / Sandy Hill / University of Ottawa'); -- Ottawa
insert into public.home_area (fsa, lat, lng, name) values ('K1P', 45.42250, -75.70260, 'Parliament Hill'); -- Ottawa
insert into public.home_area (fsa, lat, lng, name) values ('K1R', 45.41230, -75.71080, 'West Downtown area'); -- Ottawa
insert into public.home_area (fsa, lat, lng, name) values ('K1S', 45.39900, -75.68710, 'The Glebe / Ottawa South / Ottawa East'); -- Ottawa
insert into public.home_area (fsa, lat, lng, name) values ('K1T', 45.32950, -75.61560, 'Blossom Park / Hunt Club East / Leitrim'); -- Gloucester
insert into public.home_area (fsa, lat, lng, name) values ('K1V', 45.32810, -75.67190, 'Riverside Park / Hunt Club West / Riverside South / YOW'); -- Ottawa
insert into public.home_area (fsa, lat, lng, name) values ('K1W', 45.43650, -75.51580, 'South Orleans'); -- Gloucester
insert into public.home_area (fsa, lat, lng, name) values ('K1X', 45.27560, -75.62830, 'Gloucester South'); -- Gloucester
insert into public.home_area (fsa, lat, lng, name) values ('K1Y', 45.40230, -75.73290, 'Ottawa West'); -- Ottawa
insert into public.home_area (fsa, lat, lng, name) values ('K1Z', 45.38670, -75.74050, 'Westboro'); -- Ottawa
insert into public.home_area (fsa, lat, lng, name) values ('K2A', 45.38050, -75.76360, 'Highland Park / Carlingwood'); -- Ottawa
insert into public.home_area (fsa, lat, lng, name) values ('K2B', 45.36450, -75.79340, 'Britannia / Pinecrest'); -- Ottawa
insert into public.home_area (fsa, lat, lng, name) values ('K2C', 45.36790, -75.73810, 'Queensway / Copeland / Carlington / Carleton Heights'); -- Ottawa
insert into public.home_area (fsa, lat, lng, name) values ('K2E', 45.34380, -75.71570, 'Nepean East'); -- Nepean
insert into public.home_area (fsa, lat, lng, name) values ('K2G', 45.32110, -75.73910, 'Davidson Heights'); -- Nepean
insert into public.home_area (fsa, lat, lng, name) values ('K2H', 45.34330, -75.82650, 'Bells Corners'); -- Nepean
insert into public.home_area (fsa, lat, lng, name) values ('K2J', 45.26910, -75.75180, 'Barrhaven'); -- Nepean
insert into public.home_area (fsa, lat, lng, name) values ('K2K', 45.37040, -75.91980, 'Beaverbrook / South March'); -- Kanata
insert into public.home_area (fsa, lat, lng, name) values ('K2L', 45.30010, -75.92440, 'Katimavik-Hazeldean / Glen Cairn'); -- Kanata
insert into public.home_area (fsa, lat, lng, name) values ('K2M', 45.28610, -75.85620, 'Bridlewood'); -- Kanata
insert into public.home_area (fsa, lat, lng, name) values ('K2P', 45.41660, -75.69040, 'Centre Town'); -- Ottawa
insert into public.home_area (fsa, lat, lng, name) values ('K2R', 45.28990, -75.81260, 'Fallowfield Village / Cedarhill Estates / Orchard Estates'); -- Nepean
insert into public.home_area (fsa, lat, lng, name) values ('K2S', 45.25010, -75.91610, 'Stittsville'); -- reviewed Ottawa (unclassified)
insert into public.home_area (fsa, lat, lng, name) values ('K2T', 45.31700, -75.93670, 'Marchwood'); -- Kanata
insert into public.home_area (fsa, lat, lng, name) values ('K2V', 45.28540, -75.89280, 'Terry Fox / Palladium'); -- Kanata
insert into public.home_area (fsa, lat, lng, name) values ('K2W', 45.36990, -75.98870, 'North March'); -- Kanata
insert into public.home_area (fsa, lat, lng, name) values ('K4A', 45.46970, -75.47150, 'Fallingbrook'); -- reviewed Ottawa (unclassified)
insert into public.home_area (fsa, lat, lng, name) values ('K4B', 45.41010, -75.36380, 'Cumberland Township'); -- reviewed Ottawa (unclassified)
insert into public.home_area (fsa, lat, lng, name) values ('K4C', 45.49800, -75.39160, 'Cumberland'); -- reviewed Ottawa (unclassified)
insert into public.home_area (fsa, lat, lng, name) values ('K4M', 45.21540, -75.65280, 'Manotick'); -- reviewed Ottawa (unclassified)
insert into public.home_area (fsa, lat, lng, name) values ('K4P', 45.24340, -75.56740, 'Greely'); -- reviewed Ottawa (unclassified)

create table public.households (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  home_fsa text references public.home_area (fsa) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.households enable row level security;

create policy households_owner_select on public.households
  for select to authenticated using (auth.uid() = user_id);
create policy households_owner_insert on public.households
  for insert to authenticated with check (auth.uid() = user_id);
create policy households_owner_update on public.households
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy households_owner_delete on public.households
  for delete to authenticated using (auth.uid() = user_id);

create table public.members (
  id uuid primary key default gen_random_uuid(),
  household_id uuid not null references public.households (id) on delete cascade,
  age_band text not null check (age_band in (
    'baby', 'preschool', 'kids', 'teens', 'adults', 'seniors'
  )),
  include_adjacent boolean not null default true,
  created_at timestamptz not null default now()
);

alter table public.members enable row level security;

-- Owned through the household: one policy covers all commands.
create policy members_owner_all on public.members
  for all to authenticated
  using (
    exists (
      select 1 from public.households h
      where h.id = household_id and h.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.households h
      where h.id = household_id and h.user_id = auth.uid()
    )
  );

create table public.preferences (
  household_id uuid primary key references public.households (id) on delete cascade,
  max_price_cents integer check (max_price_cents is null or max_price_cents >= 0),
  free_only boolean not null default false,
  max_distance_km double precision check (max_distance_km is null or max_distance_km > 0),
  availability jsonb not null default '{}',
  language text[] not null default '{}',
  accessibility text[] not null default '{}',
  interests text[] not null default '{}',
  avoid text[] not null default '{}',
  updated_at timestamptz not null default now()
);

alter table public.preferences enable row level security;

create policy preferences_owner_all on public.preferences
  for all to authenticated
  using (
    exists (
      select 1 from public.households h
      where h.id = household_id and h.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.households h
      where h.id = household_id and h.user_id = auth.uid()
    )
  );

-- Recommendation feedback: exactly three verdicts plus a free reason.
create table public.feedback (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  value text not null check (value in ('saved', 'dismissed', 'not_for_us')),
  reason text,
  created_at timestamptz not null default now(),
  unique (user_id, event_id)
);

alter table public.feedback enable row level security;

create policy feedback_owner_select on public.feedback
  for select to authenticated using (auth.uid() = user_id);
create policy feedback_owner_insert on public.feedback
  for insert to authenticated with check (auth.uid() = user_id);
create policy feedback_owner_update on public.feedback
  for update to authenticated
  using (auth.uid() = user_id) with check (auth.uid() = user_id);
create policy feedback_owner_delete on public.feedback
  for delete to authenticated using (auth.uid() = user_id);

-- Hard-constraint candidate search (CONTEXT rule 3). Guests pass prefs
-- JSON directly; signed-in users pass their saved household prefs. The
-- TypeScript mirror of every predicate lives in
-- worker/recommend/constraints.ts (unit-tested); the live recommend eval
-- re-checks returned rows against it, so SQL/TS drift fails loudly.
--
-- p_prefs shape (see PreferencesSchema in packages/shared):
-- {members: [{age_band, include_adjacent}], max_price_cents?, free_only?,
--  max_distance_km?, fsa?, availability?: {mon?: [parts]}, language?[],
--  accessibility?[], interests?[], avoid?[]} — interests/avoid/embedding
-- score in stage 2 (TypeScript), never filter here.
create or replace function public.recommend_candidates(
  p_prefs jsonb,
  p_limit int default 200
)
returns table (
  event_id uuid,
  title text,
  description text,
  starts_at timestamptz,
  ends_at timestamptz,
  timezone text,
  venue_name text,
  venue_lat double precision,
  venue_lng double precision,
  distance_km double precision,
  category text,
  status text,
  source_url text,
  age_min smallint,
  age_max smallint,
  age_fallback boolean,
  age_flag text,
  price_kind text,
  price_label text,
  amount_min_cents integer,
  amount_max_cents integer,
  currency text,
  accessibility text[],
  language text,
  tags text[],
  summary_short text,
  fetched_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  with home as (
    select h.lat as lat, h.lng as lng
    from public.home_area h
    where h.fsa = upper(p_prefs ->> 'fsa')
  ),
  listing_facets as (
    -- Facet label per listing source, e.g. 'Child' from
    -- 'Ottawa Public Library (Child)'; the base source has none.
    select distinct es.event_id as event_id,
      substring(s.name from '\\(([^)]+)\\)$') as facet
    from public.event_sources es
    join public.sources s on s.id = es.source_id
  ),
  member_ranges as (
    -- Effective [blo, bhi] per member (mirror: effectiveBandRange).
    -- Unknown bands yield null bounds and match nothing.
    select
      case m ->> 'age_band'
        when 'baby' then 0
        when 'preschool' then case when coalesce((m ->> 'include_adjacent')::boolean, true) then 0 else 3 end
        when 'kids' then case when coalesce((m ->> 'include_adjacent')::boolean, true) then 3 else 6 end
        when 'teens' then case when coalesce((m ->> 'include_adjacent')::boolean, true) then 6 else 13 end
        when 'adults' then case when coalesce((m ->> 'include_adjacent')::boolean, true) then 13 else 18 end
        when 'seniors' then case when coalesce((m ->> 'include_adjacent')::boolean, true) then 18 else 65 end
      end as blo,
      case m ->> 'age_band'
        when 'baby' then case when coalesce((m ->> 'include_adjacent')::boolean, true) then 5 else 2 end
        when 'preschool' then case when coalesce((m ->> 'include_adjacent')::boolean, true) then 12 else 5 end
        when 'kids' then case when coalesce((m ->> 'include_adjacent')::boolean, true) then 17 else 12 end
        when 'teens' then case when coalesce((m ->> 'include_adjacent')::boolean, true) then 64 else 17 end
        when 'adults' then case when coalesce((m ->> 'include_adjacent')::boolean, true) then 130 else 64 end
        when 'seniors' then 130
      end as bhi
    from jsonb_array_elements(
      case when jsonb_typeof(p_prefs -> 'members') = 'array'
        then p_prefs -> 'members' else '[]' end
    ) as m
  ),
  priced as (
    select
      e.id as id,
      e.title as title,
      e.description as description,
      e.starts_at as starts_at,
      e.ends_at as ends_at,
      e.timezone as timezone,
      v.name as venue_name,
      v.lat as venue_lat,
      v.lng as venue_lng,
      e.category as category,
      e.status as status,
      e.source_url as source_url,
      e.fetched_at as fetched_at,
      en.age_min as age_min,
      en.age_max as age_max,
      (en.age_min is null and en.age_max is null) as age_fallback,
      -- Effective ages: enriched, else the permissive category fallback
      -- (mirror: categoryAgeFallback). Fallback rows are always flagged.
      coalesce(en.age_min, case e.category when 'camps' then 5 else 0 end) as eff_min,
      coalesce(en.age_max, case e.category when 'camps' then 17 else 130 end) as eff_max,
      coalesce(en.accessibility, '{}') as accessibility,
      en.language as language,
      coalesce(en.tags, '{}') as tags,
      en.summary_short as summary_short,
      pr.amount_min_cents as amount_min_cents,
      pr.amount_max_cents as amount_max_cents,
      pr.currency as currency,
      coalesce(pr.price_kind, 'unknown') as kind_raw,
      -- The event's own fee signal always wins (mirror:
      -- applyPricingPolicy): any stated kind, amount, currency, or fee
      -- text blocks the source policy.
      (
        coalesce(pr.price_kind, 'unknown') <> 'unknown'
        or pr.amount_min_cents is not null
        or pr.amount_max_cents is not null
        or pr.currency is not null
        or pr.price_text is not null
        or pr.fee_notes is not null
      ) as has_fee_signal,
      -- Applicable source policy (null when none): a scoped policy needs
      -- an overlapping listing facet (e.g. OPL kids slices).
      case
        when src.pricing_policy_kind is null then null
        when src.pricing_policy_scope is null
          or cardinality(src.pricing_policy_scope) = 0
          then src.pricing_policy_kind
        when exists (
          select 1 from listing_facets lf
          where lf.event_id = e.id
            and lf.facet = any (src.pricing_policy_scope)
        ) then src.pricing_policy_kind
        else null
      end as policy_kind,
      -- Haversine kilometres; null when either endpoint is unknown.
      case
        when v.lat is null or v.lng is null
          or home.lat is null or home.lng is null then null
        else 2 * 6371 * asin(sqrt(
          power(sin(radians((v.lat - home.lat) / 2)), 2) +
          cos(radians(home.lat)) * cos(radians(v.lat)) *
          power(sin(radians((v.lng - home.lng) / 2)), 2)))
      end as dist_km,
      -- Locale-proof weekday + part of day in event-local time.
      (array['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun'])[
        extract(isodow from e.starts_at at time zone e.timezone)::int
      ] as dow,
      case
        when extract(hour from e.starts_at at time zone e.timezone) >= 5
          and extract(hour from e.starts_at at time zone e.timezone) < 12 then 'morning'
        when extract(hour from e.starts_at at time zone e.timezone) >= 12
          and extract(hour from e.starts_at at time zone e.timezone) < 17 then 'afternoon'
        when extract(hour from e.starts_at at time zone e.timezone) >= 17
          and extract(hour from e.starts_at at time zone e.timezone) < 22 then 'evening'
        else 'night'
      end as part
    from public.events e
    left join public.venues v on v.id = e.venue_id
    left join public.event_enrichment en on en.event_id = e.id
    left join public.event_pricing pr on pr.event_id = e.id
    left join public.sources src on src.id = e.source_id
    left join home on true
    where e.status not in ('cancelled', 'full')
      and e.starts_at > now()
  )
  select
    p.id as event_id,
    p.title as title,
    p.description as description,
    p.starts_at as starts_at,
    p.ends_at as ends_at,
    p.timezone as timezone,
    p.venue_name as venue_name,
    p.venue_lat as venue_lat,
    p.venue_lng as venue_lng,
    p.dist_km as distance_km,
    p.category as category,
    p.status as status,
    p.source_url as source_url,
    p.age_min as age_min,
    p.age_max as age_max,
    p.age_fallback as age_fallback,
    case when p.age_fallback then 'check the age group' else null end as age_flag,
    case
      when p.kind_raw <> 'unknown' then p.kind_raw
      when p.has_fee_signal then 'unknown'
      when p.policy_kind is not null then p.policy_kind
      else 'unknown'
    end as price_kind,
    case
      when p.policy_kind is not null and not p.has_fee_signal and p.kind_raw = 'unknown'
        then p.policy_kind || ' (per OPL)'
      when p.kind_raw = 'free' then 'Free'
      when p.kind_raw = 'unknown' and not p.has_fee_signal then 'price not stated'
      when p.kind_raw = 'unknown' then 'price not stated'
      when p.amount_min_cents is not null and p.amount_max_cents is not null
        and p.amount_min_cents <> p.amount_max_cents
        then '$' || (p.amount_min_cents / 100.0)::numeric(10, 2)
          || '–' || (p.amount_max_cents / 100.0)::numeric(10, 2)
      when p.amount_min_cents is not null
        then '$' || (p.amount_min_cents / 100.0)::numeric(10, 2)
      else p.kind_raw
    end as price_label,
    p.amount_min_cents as amount_min_cents,
    p.amount_max_cents as amount_max_cents,
    p.currency as currency,
    p.accessibility as accessibility,
    p.language as language,
    p.tags as tags,
    p.summary_short as summary_short,
    p.fetched_at as fetched_at
  from priced p
  where
    -- Age fit: overlaps at least one member's effective band.
    (
      not exists (select 1 from member_ranges)
      or exists (
        select 1 from member_ranges r
        where p.eff_min <= r.bhi and p.eff_max >= r.blo
      )
    )
    -- Distance: null (unknown venue or area) passes only when unconstrained.
    and (
      p_prefs ->> 'max_distance_km' is null
      or (
        p.dist_km is not null
        and p.dist_km <= (p_prefs ->> 'max_distance_km')::double precision
      )
    )
    -- Time windows: the event's local (weekday, part) must be listed.
    and (
      p_prefs -> 'availability' is null
      or (p_prefs -> 'availability') = '{}'
      or exists (
        select 1
        from jsonb_array_elements_text(
          case when jsonb_typeof((p_prefs -> 'availability') -> p.dow) = 'array'
            then (p_prefs -> 'availability') -> p.dow else '[]' end
        ) as part
        where part = p.part
      )
    )
    -- Budget: free_only admits free only; otherwise free/unknown pass
    -- and priced events need amount_min within budget (null amounts with
    -- a set budget cannot prove fit, so they fail).
    and (
      (
        coalesce((p_prefs ->> 'free_only')::boolean, false)
        and p.kind_raw = 'free'
        or p.policy_kind is not null and not p.has_fee_signal and p.kind_raw = 'unknown' and p.policy_kind = 'free'
      )
      or (
        not coalesce((p_prefs ->> 'free_only')::boolean, false)
        and (
          p.kind_raw = 'free'
          or p.kind_raw = 'unknown'
          or p_prefs ->> 'max_price_cents' is null
          or (
            p.amount_min_cents is not null
            and p.amount_min_cents <= (p_prefs ->> 'max_price_cents')::int
          )
        )
      )
    )
    -- Accessibility: every required item must be stated, unless the
    -- event states nothing (unstated never excludes).
    and (
      (case when jsonb_typeof(p_prefs -> 'accessibility') = 'array'
        then jsonb_array_length(p_prefs -> 'accessibility') else 0 end) = 0
      or cardinality(p.accessibility) = 0
      or not exists (
        select 1
        from jsonb_array_elements_text(
          case when jsonb_typeof(p_prefs -> 'accessibility') = 'array'
            then p_prefs -> 'accessibility' else '[]' end
        ) as req
        where not (lower(req) = any (
          select lower(x) from unnest(p.accessibility) as x
        ))
      )
    )
    -- Language: unstated event language never excludes.
    and (
      (case when jsonb_typeof(p_prefs -> 'language') = 'array'
        then jsonb_array_length(p_prefs -> 'language') else 0 end) = 0
      or p.language is null
      or exists (
        select 1
        from jsonb_array_elements_text(
          case when jsonb_typeof(p_prefs -> 'language') = 'array'
            then p_prefs -> 'language' else '[]' end
        ) as want
        where lower(want) = lower(p.language)
      )
    )
  order by p.starts_at asc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

grant execute on function public.recommend_candidates(jsonb, int)
  to anon, authenticated;
