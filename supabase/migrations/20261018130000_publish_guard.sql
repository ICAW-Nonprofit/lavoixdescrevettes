-- Only the team can trigger a rebuild of the site.
--
-- Supabase gives anon and authenticated every right on public tables by default; the database rules (RLS)
-- then block the rows. But the events_publish trigger runs once per statement, even when RLS blocked every
-- row, so an empty update from a visitor (or a disabled account) still asked GitHub to rebuild.

-- Visitors write only through rsvp() and track(), never directly on a table.
revoke insert, update, delete, truncate on public.events, public.rsvps, public.event_stats, public.profiles, public.invitations from anon;
-- RLS doesn't apply to truncate: nobody signed in needs it.
revoke truncate on public.events, public.rsvps, public.event_stats, public.profiles, public.invitations from authenticated;

-- Same function as in 20261017000100_automation.sql, plus: no rebuild for a visitor or a signed-in account
-- that isn't on the team. Changes made in the SQL editor or by migrations (no signed-in user) still publish.
create or replace function public.request_publish()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if coalesce(nullif(current_setting('request.jwt.claims', true), '')::json ->> 'role', '') = 'anon' then return null; end if;
  if auth.uid() is not null and not public.is_staff() then return null; end if;
  perform public.request_publish_now();
  return null;
end $$;
revoke execute on function public.request_publish() from public, anon, authenticated;
