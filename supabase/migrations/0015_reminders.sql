-- Phase 7b: email reminders for saved events.
--
-- Guests and signed-in users alike supply an address explicitly for one
-- reminder (the web app never sees auth emails — no service role there).
-- Reads are service-role-only (no SELECT policy at all): only the slice-c
-- sender reads this table. Inserts are open (guests included) with
-- user_id bound to auth.uid() by default; deletes go through the
-- token-checked function below, so a reminder id alone deletes nothing.
create table public.reminders (
  id uuid primary key default gen_random_uuid(),
  user_id uuid references auth.users (id) on delete cascade,
  event_id uuid not null references public.events (id) on delete cascade,
  email text not null check (char_length(email) <= 254 and email like '%@%.%'),
  remind_at timestamptz not null,
  basis text not null check (basis in ('registration_window', 'event_start')),
  delete_token text not null check (char_length(delete_token) >= 32),
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  unique (event_id, email)
);

alter table public.reminders enable row level security;

alter table public.reminders alter column user_id set default auth.uid();

create policy reminders_insert on public.reminders
  for insert to anon, authenticated
  with check (user_id is null or auth.uid() = user_id);

-- One-click delete without reads: the token (returned once at creation,
-- kept on the device) proves ownership. SECURITY DEFINER with EXECUTE
-- to guests; direct DELETE stays impossible (no delete policy).
create or replace function public.delete_reminder(p_id uuid, p_token text)
returns boolean
language sql
security definer
set search_path = public
as $$
  with deleted as (
    delete from public.reminders
    where id = p_id and delete_token = p_token
    returning id
  )
  select count(*) > 0 from deleted;
$$;

grant execute on function public.delete_reminder(uuid, text)
  to anon, authenticated;
