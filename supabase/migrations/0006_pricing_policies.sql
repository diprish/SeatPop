-- Phase 2b: source-level pricing policies (data).
-- Numbered 0006: version 0005 is marked reverted in the remote
-- migration history, and db push matches versions, not content.
-- This UPDATE is idempotent: it converges the policy columns to
-- the values below whether or not a previous migration set them.
-- OPL children's programs are officially free (verbatim, Children's
-- Programs section):
--   "These programs are free and offered at branches throughout the city."
--   https://collections.biblioottawalibrary.ca/en/parenting
-- Scope is the kids facet labels ONLY: the statement covers newborns to
-- older children plus family programs. Teen is deliberately excluded
-- (OPL treats Teen as a separate audience; not named in the statement),
-- as are Adult/Adults 50-plus/Newcomers. Events apply the policy only
-- when their own text carries no fee signal; event text always wins.
-- All other sources stay unknown: OAG's "Admission is always FREE" is
-- gallery admission while its feed includes paid programs (camps); no
-- verbatim fee statement was found for the market, museums, or theatres.
-- Run seed-sources BEFORE pushing so the new OPL slice rows exist.

update public.sources
set pricing_policy_kind = 'free',
    pricing_policy_quote = 'These programs are free and offered at branches throughout the city.',
    pricing_policy_url = 'https://collections.biblioottawalibrary.ca/en/parenting',
    pricing_policy_scope = array['Baby', 'Child', 'Family', 'Preschool', 'Toddler']
where name like 'Ottawa Public Library%';
