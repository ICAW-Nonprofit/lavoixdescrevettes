-- Rollback of supabase/migrations/20261021120000_blog_and_rights.sql. NEVER applied automatically (the Database
-- workflow only reads supabase/migrations/). Run it by hand in the Supabase SQL editor, only together with a revert
-- of the site's code, if the rights per account have to be undone.
--
-- It brings back the rules of before: every active organiser has Actions, Campagnes and the Tableau de bord.
-- It deletes no data: the blog tables, the new columns, the 'blog' bucket and the new functions stay (the old code
-- never reads them). Re-applying the migration later is not needed: its objects are still there.

begin;

drop policy if exists "actions right: add" on public.events;
drop policy if exists "actions right: edit" on public.events;
drop policy if exists "actions right: counters" on public.event_stats;
drop policy if exists "campaigns right" on public.campaigns;
drop policy if exists "campaigns right: counters" on public.campaign_stats;
drop policy if exists "dashboard: admins only" on public.site_stats;
drop policy if exists "dashboard notes: admins only" on public.dashboard_notes;
drop policy if exists "posters need the actions right" on storage.objects;
drop policy if exists "posters need the actions right to replace" on storage.objects;

-- functions: the bodies of before (20261019120000_dashboard.sql, 20261020120000_campaigns.sql, 20261017000000_init.sql,
-- 20261018160000_audit_log.sql)
create or replace function public.event_overview()
returns table (
  id uuid, slug text, title text, city text, kind text, status text, target text,
  starts_at timestamptz, ends_at timestamptz, created_by uuid, creator_name text, creator_status text,
  rsvps int, rsvps_with_email int, views int, shares int, newsletter int, calendar int,
  recap_participants int
)
language sql stable security definer set search_path = public as $$
  select e.id, e.slug, e.title, e.city, e.kind, e.status, e.target, e.starts_at, e.ends_at, e.created_by,
         coalesce(p.display_name, split_part(p.email, '@', 1)),
         case
           when p.id is not null then case when p.role = 'disabled' then 'disabled' else 'active' end
           when exists (select 1 from public.audit_log a where a.action = 'action.create' and a.target = e.slug and a.actor is not null) then 'deleted'
           else 'team'
         end,
         (select count(*) from public.rsvps r where r.event_id = e.id)::int,
         (select count(*) from public.rsvps r where r.event_id = e.id and r.email is not null)::int,
         coalesce((select sum(s.views) from public.event_stats s where s.event_id = e.id), 0)::int,
         coalesce((select sum(s.shares) from public.event_stats s where s.event_id = e.id), 0)::int,
         coalesce((select sum(s.newsletter) from public.event_stats s where s.event_id = e.id), 0)::int,
         coalesce((select sum(s.calendar) from public.event_stats s where s.event_id = e.id), 0)::int,
         e.recap_participants
  from public.events e
  left join public.profiles p on p.id = e.created_by
  where public.is_staff()
  order by e.starts_at desc
$$;

create or replace function public.attendees(p_event uuid)
returns table (name text, email text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  s text := (select e.slug from public.events e where e.id = p_event);
  adm boolean := public.is_admin();
begin
  if not public.is_staff() then return; end if;
  if not exists (
    select 1 from public.audit_log a
    where a.actor = auth.uid() and a.action = 'attendees.view' and a.target = s and a.at > now() - interval '1 hour'
  ) then
    perform public.audit('attendees.view', s);
  end if;
  return query select r.name, case when adm then r.email end, r.created_at from public.rsvps r where r.event_id = p_event order by r.created_at;
end $$;

create or replace function public.rsvps_per_day(p_days int default 60)
returns table (day date, count int)
language sql stable security definer set search_path = public as $$
  select (r.created_at at time zone 'Europe/Paris')::date, count(*)::int
  from public.rsvps r
  where public.is_staff() and r.created_at > now() - make_interval(days => least(greatest(p_days, 1), 366))
  group by 1 order by 1
$$;

create or replace function public.campaign_overview()
returns table (
  id uuid, name text, support text, dest_event_id uuid, dest_page text, fallback_page text,
  code_qr text, code_link text, created_at timestamptz, creator_name text, archived_at timestamptz,
  event_slug text, event_title text, event_starts_at timestamptz, event_ends_at timestamptz, event_status text,
  visits_qr int, visits_link int, rsvps int, share_clicks int, shares_done int, newsletter int
)
language sql stable security definer set search_path = public as $$
  select c.id, c.name, c.support, c.dest_event_id, c.dest_page, c.fallback_page, c.code_qr, c.code_link, c.created_at,
         coalesce(p.display_name, split_part(p.email, '@', 1)), c.archived_at,
         e.slug, e.title, e.starts_at, e.ends_at, e.status,
         coalesce(sum(s.visits) filter (where s.channel = 'qr'), 0)::int,
         coalesce(sum(s.visits) filter (where s.channel = 'link'), 0)::int,
         coalesce(sum(s.rsvps), 0)::int, coalesce(sum(s.share_clicks), 0)::int,
         coalesce(sum(s.shares_done), 0)::int, coalesce(sum(s.newsletter), 0)::int
  from public.campaigns c
  left join public.profiles p on p.id = c.created_by
  left join public.events e on e.id = c.dest_event_id
  left join public.campaign_stats s on s.campaign_id = c.id
  where public.is_staff()
  group by c.id, p.id, e.id
  order by c.created_at desc
$$;

create or replace function public.campaign_history(p_id uuid)
returns table (at timestamptz, who text, action text, fields jsonb)
language sql stable security definer set search_path = public as $$
  with c as (select * from public.campaigns where id = p_id and public.is_staff()),
  h as (
    select c.created_at as at, c.created_by as actor, 'campaign.create' as action, null::jsonb as fields from c
    union all
    select a.at, a.actor, a.action, a.detail -> 'fields' from public.audit_log a join c on a.target = c.code_link
      where a.action = 'campaign.update'
    union all
    select c.archived_at, c.archived_by, 'campaign.archive', null from c where c.archived_at is not null
  )
  select h.at, case when h.actor is null then null else coalesce(p.display_name, split_part(p.email, '@', 1), 'compte supprimé') end,
         h.action, h.fields
  from h left join public.profiles p on p.id = h.actor
  order by h.at
$$;

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare inv public.invitations;
begin
  select * into inv from public.invitations where email = lower(new.email);
  insert into public.profiles (id, email, display_name, city, role)
  values (new.id, lower(new.email), inv.display_name, inv.city, coalesce(inv.role, 'organizer'))
  on conflict (id) do nothing;
  return new;
end $$;

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

drop function public.staff_list();
create function public.staff_list()
returns table (id uuid, email text, display_name text, city text, role text, created_at timestamptz, last_sign_in_at timestamptz, actions int)
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.display_name, p.city, p.role, p.created_at, u.last_sign_in_at,
         (select count(*) from public.events e where e.created_by = p.id)::int
  from public.profiles p join auth.users u on u.id = p.id
  where public.is_admin()
  order by p.created_at
$$;
revoke execute on function public.staff_list() from public, anon;
grant execute on function public.staff_list() to authenticated;

-- nothing on the site publishes posts any more
revoke execute on function public.post_publish(uuid, timestamptz) from authenticated;

commit;
