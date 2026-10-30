-- Phase 4-5: repair fee-signal noise blocking the OPL free policy (data).
-- enrich.v2's example taught the model that supplies sentences belong in
-- fee_notes; the Crafternoon instances carry "we have all the supplies
-- you need to satisfy your creativity!" there. That is not a fee, but any
-- non-null fee_notes blocks the source policy and hides the events from
-- free_only searches. Clear the exact string (idempotent, no schema
-- change); enrich.v3 constrains the field to cost spans so no new noise
-- lands. TS mirrors are untouched: the rule was right, the data was wrong.
update public.event_pricing
set fee_notes = null
where fee_notes = 'we have all the supplies you need to satisfy your creativity!';
