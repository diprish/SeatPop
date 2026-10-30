-- Phase 4 fix: explicit column aliases for every set-returning function
-- in recommend_candidates().
--
-- Bug: `from jsonb_array_elements_text(...) as part` does NOT name the
-- output column `part` (it keeps the function name), so the unqualified
-- `part` in `where part = p.part` resolved to the OUTER query's p.part
-- column — the predicate was `p.part = p.part`, always true. The time
-- filter passed every event whose weekday had any listed window,
-- ignoring the part of day (the live eval caught 14 such rows: weekday
-- right, part wrong, every time). The `as req/want/x` sites had the
-- same shape and would have errored once evaluated (whole-row record
-- into lower()); the `as m` site worked only because no outer column
-- shadowed it. Every SRF now carries an explicit column alias, which is
-- unambiguous under all name-resolution rules; a static test pins them.
--
-- Verified against the TS mirror (worker/recommend/constraints.ts),
-- which was correct all along: re-running eval:recommend must show
-- zero violations.

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
      case member ->> 'age_band'
        when 'baby' then 0
        when 'preschool' then case when coalesce((member ->> 'include_adjacent')::boolean, true) then 0 else 3 end
        when 'kids' then case when coalesce((member ->> 'include_adjacent')::boolean, true) then 3 else 6 end
        when 'teens' then case when coalesce((member ->> 'include_adjacent')::boolean, true) then 6 else 13 end
        when 'adults' then case when coalesce((member ->> 'include_adjacent')::boolean, true) then 13 else 18 end
        when 'seniors' then case when coalesce((member ->> 'include_adjacent')::boolean, true) then 18 else 65 end
      end as blo,
      case member ->> 'age_band'
        when 'baby' then case when coalesce((member ->> 'include_adjacent')::boolean, true) then 5 else 2 end
        when 'preschool' then case when coalesce((member ->> 'include_adjacent')::boolean, true) then 12 else 5 end
        when 'kids' then case when coalesce((member ->> 'include_adjacent')::boolean, true) then 17 else 12 end
        when 'teens' then case when coalesce((member ->> 'include_adjacent')::boolean, true) then 64 else 17 end
        when 'adults' then case when coalesce((member ->> 'include_adjacent')::boolean, true) then 130 else 64 end
        when 'seniors' then 130
      end as bhi
    from jsonb_array_elements(
      case when jsonb_typeof(p_prefs -> 'members') = 'array'
        then p_prefs -> 'members' else '[]' end
    ) as m(member)
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
        ) as part(listed)
        where listed = p.part
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
        ) as req(needed)
        where not (lower(needed) = any (
          select lower(stated) from unnest(p.accessibility) as x(stated)
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
        ) as want(wanted)
        where lower(wanted) = lower(p.language)
      )
    )
  order by p.starts_at asc
  limit greatest(1, least(coalesce(p_limit, 200), 500));
$$;

-- Idempotent re-grant (create or replace preserves grants, but explicit
-- beats sorry for the guest path).
grant execute on function public.recommend_candidates(jsonb, int)
  to anon, authenticated;
