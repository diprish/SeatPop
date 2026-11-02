-- Detail-page enrichment: where an event's description came from.
-- 'feed' (default, backfilled) is listing text; 'detail_page' is text
-- fetched from the event's own official page by the detail-enrich step
-- (YES/accepted-DECIDE sources only, robots honored, 403s never
-- bypassed). One attempt per event: sourced rows are never re-fetched.
alter table public.events
  add column description_source text not null default 'feed'
  check (description_source in ('feed', 'detail_page'));
