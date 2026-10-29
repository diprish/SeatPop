-- Phase 2b: source-level pricing policies and pricing basis.
-- A policy is a verbatim official fee statement (quote + URL), applied to a
-- source's events only when the event text carries no fee signal of its own.
-- pricing_policy_scope (facet labels, e.g. OPL kids slices) restricts a
-- policy; null scope means every event from the source. No public-view
-- change: policies and basis stay internal (audit data, not app data).

alter table public.sources
  add column pricing_policy_kind text
    check (
      pricing_policy_kind is null or pricing_policy_kind in (
        'free', 'paid', 'pay_what_you_can', 'donation', 'member_only', 'unknown'
      )
    ),
  add column pricing_policy_quote text,
  add column pricing_policy_url text,
  add column pricing_policy_scope text[];

alter table public.sources
  add constraint sources_policy_quote_kind_match
  check (
    (pricing_policy_quote is null) = (pricing_policy_kind is null)
  );

alter table public.event_pricing
  add column price_basis text not null default 'event_text'
    check (price_basis in ('event_text', 'source_policy'));
