-- Organiser space dashboard (tabs « Tableau de bord · Actions · Paramètres », action details, charts).
--   • site_stats: newsletter sign-ups per day across the whole site, not only on action pages. Nothing personal.
--   • track(): a newsletter sign-up always counts site-wide, and also for the action page it came from (if any).
--   • dashboard_notes: notes the team adds on the newsletter chart.
--   • event_overview(): also says whether the creator's account is active, disabled, deleted, or none (created in SQL).
--   • attendees(): organisers now see first names too; emails stay admin-only.

-- ─────────────────────────────── site-wide newsletter counter ───────────────────────────────
create table public.site_stats (
  day date primary key,
  newsletter int not null default 0 check (newsletter >= 0)
);
alter table public.site_stats enable row level security;
create policy "staff read site counters" on public.site_stats
  for select to authenticated using (public.is_staff());
-- written only by track()
revoke all on public.site_stats from anon;
revoke insert, update, delete, truncate on public.site_stats from authenticated;

-- history so far: the sign-ups made on action pages
insert into public.site_stats (day, newsletter)
select day, sum(newsletter)::int from public.event_stats group by day having sum(newsletter) > 0;

create or replace function public.track(p_slug text, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare
  eid uuid;
  d date := (now() at time zone 'Europe/Paris')::date;
begin
  if coalesce(p_kind, '') not in ('view', 'share', 'newsletter', 'calendar') then return; end if;
  if p_kind = 'newsletter' then
    insert into public.site_stats as s (day, newsletter) values (d, 1)
    on conflict (day) do update set newsletter = s.newsletter + 1;
  end if;
  select id into eid from public.events where slug = p_slug;
  if eid is null then return; end if;
  insert into public.event_stats as s (event_id, day, views, shares, newsletter, calendar)
  values (eid, d, (p_kind = 'view')::int, (p_kind = 'share')::int, (p_kind = 'newsletter')::int, (p_kind = 'calendar')::int)
  on conflict (event_id, day) do update set
    views = s.views + excluded.views,
    shares = s.shares + excluded.shares,
    newsletter = s.newsletter + excluded.newsletter,
    calendar = s.calendar + excluded.calendar;
end $$;
revoke execute on function public.track(text, text) from public;
grant execute on function public.track(text, text) to anon, authenticated;

-- ─────────────────────────────── notes on the dashboard chart ───────────────────────────────
create table public.dashboard_notes (
  id bigint generated always as identity primary key,
  day date not null,
  label text not null check (char_length(btrim(label)) between 1 and 80),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);
alter table public.dashboard_notes enable row level security;
create policy "staff read notes" on public.dashboard_notes
  for select to authenticated using (public.is_staff());
create policy "staff add their own notes" on public.dashboard_notes
  for insert to authenticated with check (public.is_staff() and created_by = auth.uid());
create policy "authors and admins delete notes" on public.dashboard_notes
  for delete to authenticated using (public.is_staff() and (created_by = auth.uid() or public.is_admin()));
revoke all on public.dashboard_notes from anon;
revoke update, truncate on public.dashboard_notes from authenticated;

-- ─────────────────────────────── dashboard: who created each action ───────────────────────────────
-- creator_status: 'active' | 'disabled' | 'deleted' (the account is gone, the log shows it created the action)
--                 | 'team' (created outside the app, e.g. the SQL seed)
drop function public.event_overview();
create function public.event_overview()
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
revoke execute on function public.event_overview() from public, anon;
grant execute on function public.event_overview() to authenticated;

-- ─────────────────────────────── attendee list: first names for the whole team ───────────────────────────────
-- Organisers see first names / pseudos (check-in list, CSV); only admins see emails. Every opening is logged
-- (once per person, action and hour).
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
revoke execute on function public.attendees(uuid) from public, anon;
grant execute on function public.attendees(uuid) to authenticated;
