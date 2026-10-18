-- Security log: who did what in the organiser space. Admins read it in /espace/admin/ ("Journal de sécurité").
-- Recorded: actions created, edited (names of the fields changed, never their content) and deleted; accounts created
-- and (de)activated; invitations sent and cancelled; logins; an admin opening an attendee list.
-- Nothing about attendees except which action's list was opened. Entries are deleted after a year (housekeeping).

create table public.audit_log (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid,          -- the signed-in account; null = Supabase itself (SQL editor, migrations, scheduled jobs)
  action text not null,
  target text,         -- the action's slug, or the email of the account or invitation concerned
  detail jsonb
);
create index audit_log_at_idx on public.audit_log (at desc);
alter table public.audit_log enable row level security;
-- written only by the functions below, read only through audit_recent()
revoke all on public.audit_log from anon, authenticated;

create or replace function public.audit(p_action text, p_target text, p_detail jsonb default null)
returns void language sql security definer set search_path = public as $$
  insert into public.audit_log (actor, action, target, detail) values (auth.uid(), p_action, p_target, p_detail)
$$;
revoke execute on function public.audit(text, text, jsonb) from public, anon, authenticated;

-- actions
create or replace function public.audit_events()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  changed jsonb;
begin
  if tg_op = 'INSERT' then
    perform public.audit('action.create', new.slug);
  elsif tg_op = 'DELETE' then
    perform public.audit('action.delete', old.slug, jsonb_build_object('title', old.title));
  else
    select jsonb_agg(n.key order by n.key) into changed
    from jsonb_each(to_jsonb(new)) n
    where n.key not in ('updated_at', 'updated_by') and to_jsonb(old) -> n.key is distinct from n.value;
    if changed is not null then perform public.audit('action.update', new.slug, jsonb_build_object('fields', changed)); end if;
  end if;
  return null;
end $$;
revoke execute on function public.audit_events() from public, anon, authenticated;
create trigger audit_events
  after insert or update or delete on public.events
  for each row execute function public.audit_events();

-- accounts: created, activated, deactivated
create or replace function public.audit_profiles()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit('account.create', new.email, jsonb_build_object('role', new.role));
  elsif old.role is distinct from new.role then
    perform public.audit('account.role', new.email, jsonb_build_object('from', old.role, 'to', new.role));
  end if;
  return null;
end $$;
revoke execute on function public.audit_profiles() from public, anon, authenticated;
create trigger audit_profiles
  after insert or update of role on public.profiles
  for each row execute function public.audit_profiles();

-- invitations
create or replace function public.audit_invitations()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit('invitation.create', new.email, jsonb_build_object('role', new.role));
  else
    perform public.audit('invitation.delete', old.email);
  end if;
  return null;
end $$;
revoke execute on function public.audit_invitations() from public, anon, authenticated;
create trigger audit_invitations
  after insert or delete on public.invitations
  for each row execute function public.audit_invitations();

-- logins (Supabase sets last_sign_in_at at each sign-in)
create or replace function public.audit_login()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if new.last_sign_in_at is distinct from old.last_sign_in_at then
    insert into public.audit_log (actor, action, target) values (new.id, 'login', lower(new.email));
  end if;
  return null;
exception when others then
  return null; -- a log entry must never block a login
end $$;
revoke execute on function public.audit_login() from public, anon, authenticated;
create trigger audit_login
  after update of last_sign_in_at on auth.users
  for each row execute function public.audit_login();

-- attendee list: same result as before, and an admin opening it is logged (once per admin, action and hour)
create or replace function public.attendees(p_event uuid)
returns table (name text, email text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  s text := (select e.slug from public.events e where e.id = p_event);
begin
  if not public.is_admin() then return; end if;
  if not exists (
    select 1 from public.audit_log a
    where a.actor = auth.uid() and a.action = 'attendees.view' and a.target = s and a.at > now() - interval '1 hour'
  ) then
    perform public.audit('attendees.view', s);
  end if;
  return query select r.name, r.email, r.created_at from public.rsvps r where r.event_id = p_event order by r.created_at;
end $$;
revoke execute on function public.attendees(uuid) from public, anon;
grant execute on function public.attendees(uuid) to authenticated;

-- admins: the latest entries, with the name of who did it
create or replace function public.audit_recent(p_limit int default 200)
returns table (at timestamptz, who text, action text, target text, detail jsonb)
language sql stable security definer set search_path = public as $$
  select a.at,
         case when a.actor is null then null else coalesce(p.display_name, split_part(p.email, '@', 1), 'compte supprimé') end,
         a.action, a.target, a.detail
  from public.audit_log a
  left join public.profiles p on p.id = a.actor
  where public.is_admin()
  order by a.at desc, a.id desc
  limit least(greatest(p_limit, 1), 1000)
$$;
revoke execute on function public.audit_recent(int) from public, anon;
grant execute on function public.audit_recent(int) to authenticated;

-- housekeeping (daily): same as before, plus log entries older than a year
create or replace function public.housekeeping()
returns void language sql security definer set search_path = public as $$
  update public.rsvps r set ip_hash = null
    from public.events e where e.id = r.event_id and e.ends_at < now() and r.ip_hash is not null;
  update public.rsvps r set email = null
    from public.events e where e.id = r.event_id and e.ends_at < now() - interval '30 days' and r.email is not null;
  delete from public.audit_log where at < now() - interval '1 year';
$$;
revoke execute on function public.housekeeping() from public, anon, authenticated;
