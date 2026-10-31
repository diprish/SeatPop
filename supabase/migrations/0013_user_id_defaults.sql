-- Phase 6 slice b: owner-id defaults. The households and feedback
-- routes never accept user_id from the client (spoofable); the WITH CHECK
-- policies already bind every row to auth.uid(), so default the columns
-- to it. Without this, inserts fail on the NOT NULL constraint.
alter table public.households alter column user_id set default auth.uid();
alter table public.feedback alter column user_id set default auth.uid();
