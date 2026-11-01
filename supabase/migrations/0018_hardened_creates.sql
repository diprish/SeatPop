-- Security hardening: no direct app-role writes on reminders/bookings.
--
-- Both tables lose their INSERT policies: guests and signed-in users
-- write only through the SECURITY DEFINER functions below, which
-- validate, rate-cap, and stamp auth.uid() server-side. Reads stay
-- service-role-only; the token-checked delete functions are unchanged.
-- (Cap counts are best-effort abuse rails: concurrent callers can
-- overshoot by a row, which is fine for this purpose.)

drop policy if exists reminders_insert on public.reminders;

create or replace function public.create_reminder(
  p_event_id uuid,
  p_email text,
  p_remind_at timestamptz,
  p_basis text,
  p_delete_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_email text := lower(trim(p_email));
  v_id uuid;
begin
  if v_email is null
    or v_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$'
    or char_length(v_email) > 254 then
    return jsonb_build_object('ok', false, 'error', 'invalid_email');
  end if;
  if p_basis is null or p_basis not in ('registration_window', 'event_start') then
    return jsonb_build_object('ok', false, 'error', 'invalid_basis');
  end if;
  if p_delete_token is null or char_length(p_delete_token) < 32 then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;
  if p_event_id is null
    or not exists (select 1 from public.events where id = p_event_id) then
    return jsonb_build_object('ok', false, 'error', 'unknown_event');
  end if;
  if p_remind_at is null or p_remind_at <= now() then
    return jsonb_build_object('ok', false, 'error', 'past_remind_at');
  end if;
  if (select count(*) from public.reminders
      where email = v_email and sent_at is null) >= 3 then
    return jsonb_build_object('ok', false, 'error', 'per_email_cap');
  end if;
  if (select count(*) from public.reminders
      where created_at > now() - interval '1 hour') >= 20 then
    return jsonb_build_object('ok', false, 'error', 'global_cap');
  end if;
  insert into public.reminders (user_id, event_id, email, remind_at, basis, delete_token)
  values (auth.uid(), p_event_id, v_email, p_remind_at, p_basis, p_delete_token)
  returning public.reminders.id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'duplicate');
end;
$$;

grant execute on function public.create_reminder(uuid, text, timestamptz, text, text)
  to anon, authenticated;

alter table public.bookings
  add constraint bookings_feed_token_length
  check (char_length(feed_token) >= 32);

drop policy if exists bookings_insert on public.bookings;

create or replace function public.create_booking(
  p_event_id uuid,
  p_confirmation_id text,
  p_starts_at timestamptz,
  p_evidence jsonb,
  p_feed_token text,
  p_delete_token text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id uuid;
begin
  if p_feed_token is null
    or char_length(p_feed_token) < 32
    or char_length(p_feed_token) > 200 then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;
  if p_delete_token is null or char_length(p_delete_token) < 32 then
    return jsonb_build_object('ok', false, 'error', 'invalid_token');
  end if;
  if p_confirmation_id is not null and char_length(p_confirmation_id) > 100 then
    return jsonb_build_object('ok', false, 'error', 'invalid_confirmation');
  end if;
  if p_event_id is null
    or not exists (select 1 from public.events where id = p_event_id) then
    return jsonb_build_object('ok', false, 'error', 'unknown_event');
  end if;
  if (select count(*) from public.bookings
      where feed_token = p_feed_token) >= 50 then
    return jsonb_build_object('ok', false, 'error', 'feed_cap');
  end if;
  insert into public.bookings
    (user_id, event_id, confirmation_id, starts_at, evidence, feed_token, delete_token)
  values
    (auth.uid(), p_event_id, p_confirmation_id, p_starts_at, p_evidence, p_feed_token, p_delete_token)
  returning public.bookings.id into v_id;
  return jsonb_build_object('ok', true, 'id', v_id);
exception when unique_violation then
  return jsonb_build_object('ok', false, 'error', 'duplicate');
end;
$$;

grant execute on function public.create_booking(uuid, text, timestamptz, jsonb, text, text)
  to anon, authenticated;
