-- La Voix des Crevettes — organiser platform: accounts, actions, "J'y vais", anonymous counters.
--
-- Security model (Row Level Security everywhere):
--   • public (anon key): read published action fields, sign up via rsvp(), bump counters via track()
--   • organisers: create and edit any action, see counts (never attendees' names or emails)
--   • admins: everything above + attendees, organisers, invitations, delete
-- Only invited emails can create an account (see guard_new_user). The first admin is invited by hand
-- in the Supabase SQL editor (see SETUP.md), so no personal email is stored in this repository.

-- ─────────────────────────────── invitations & profiles ───────────────────────────────
create table public.invitations (
  email text primary key check (email = lower(btrim(email)) and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  display_name text check (char_length(display_name) <= 80),
  city text check (char_length(city) <= 80),
  role text not null default 'organizer' check (role in ('admin', 'organizer')),
  invited_by uuid,
  created_at timestamptz not null default now()
);
alter table public.invitations enable row level security;

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null unique,
  display_name text check (char_length(display_name) <= 80),
  city text check (char_length(city) <= 80),
  role text not null default 'organizer' check (role in ('admin', 'organizer', 'disabled')),
  created_at timestamptz not null default now()
);
alter table public.profiles enable row level security;

-- helpers (security definer: read profiles without going through RLS, so policies don't recurse)
create or replace function public.my_role()
returns text language sql stable security definer set search_path = public as $$
  select role from public.profiles where id = auth.uid()
$$;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role in ('admin', 'organizer') from public.profiles where id = auth.uid()), false)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
$$;

create policy "admins manage invitations" on public.invitations
  for all to authenticated
  using (public.is_admin())
  with check (public.is_admin() and role = 'organizer'); -- new admins are added by hand in SQL

create policy "read own profile, admins read all" on public.profiles
  for select to authenticated using (id = auth.uid() or public.is_admin());
create policy "edit own profile" on public.profiles
  for update to authenticated using (id = auth.uid()) with check (id = auth.uid());
revoke update on public.profiles from authenticated;
grant update (display_name, city) on public.profiles to authenticated;

-- only invited emails may create an account (login links create the account on first use)
create or replace function public.guard_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from public.invitations where email = lower(new.email)) then
    raise exception 'This email has not been invited' using errcode = '42501';
  end if;
  return new;
end $$;

create trigger before_auth_user_created
  before insert on auth.users
  for each row execute function public.guard_new_user();

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

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- admin: enable / disable an organiser (admins can't be changed from the app)
create or replace function public.set_organizer_active(p_user uuid, p_active boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  update public.profiles
     set role = case when p_active then 'organizer' else 'disabled' end
   where id = p_user and role <> 'admin';
end $$;
revoke execute on function public.set_organizer_active(uuid, boolean) from public, anon;
grant execute on function public.set_organizer_active(uuid, boolean) to authenticated;

-- ─────────────────────────────── actions ───────────────────────────────
create table public.events (
  id uuid primary key default gen_random_uuid(),
  slug text not null unique check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 100),
  status text not null default 'published' check (status in ('published', 'cancelled', 'postponed')),
  kind text not null default 'rassemblement' check (kind in ('rassemblement', 'tractage', 'en-ligne', 'autre')),
  title text not null check (char_length(btrim(title)) between 3 and 120),
  title_en text check (char_length(title_en) <= 120),
  target text check (char_length(target) <= 60),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  street text check (char_length(street) <= 160),
  postal_code text check (char_length(postal_code) <= 10),
  city text not null check (char_length(btrim(city)) between 1 and 80),
  lat double precision check (lat between -90 and 90),
  lng double precision check (lng between -180 and 180),
  meeting_point text check (char_length(meeting_point) <= 300),
  access text check (char_length(access) <= 200),
  access_en text check (char_length(access_en) <= 200),
  summary text not null check (char_length(btrim(summary)) between 10 and 400),
  summary_en text check (char_length(summary_en) <= 400),
  description text not null default '' check (char_length(description) <= 6000),
  description_en text check (char_length(description_en) <= 6000),
  share_text text check (char_length(share_text) <= 1500),
  share_text_en text check (char_length(share_text_en) <= 1500),
  whatsapp_url text check (whatsapp_url is null or whatsapp_url ~ '^https://'),
  flyer_tagline text check (char_length(flyer_tagline) <= 200),
  flyer_place text check (char_length(flyer_place) <= 80),
  custom_poster text check (custom_poster is null or custom_poster ~ '^(https://|/)'),
  poster_alt text check (char_length(poster_alt) <= 300),
  recap_participants int check (recap_participants between 0 and 100000),
  recap_text text check (char_length(recap_text) <= 6000),
  recap_links text check (char_length(recap_links) <= 2000),
  created_by uuid references public.profiles (id) on delete set null default auth.uid(),
  updated_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (ends_at > starts_at),
  check (lat is null = (lng is null))
);
create index events_starts_at_idx on public.events (starts_at);
alter table public.events enable row level security;

create policy "everyone reads actions" on public.events
  for select to anon, authenticated using (true);
create policy "staff create actions" on public.events
  for insert to authenticated with check (public.is_staff());
create policy "staff edit actions" on public.events
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
create policy "admins delete actions" on public.events
  for delete to authenticated using (public.is_admin());

-- the public doesn't need to know which account created or edited an action
revoke select on public.events from anon;
grant select (
  id, slug, status, kind, title, title_en, target, starts_at, ends_at, street, postal_code, city, lat, lng,
  meeting_point, access, access_en, summary, summary_en, description, description_en, share_text, share_text_en,
  whatsapp_url, flyer_tagline, flyer_place, custom_poster, poster_alt, recap_participants, recap_text, recap_links,
  created_at, updated_at
) on public.events to anon;

create or replace function public.events_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  if tg_op = 'UPDATE' then
    new.slug := old.slug;            -- links already shared must keep working
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end $$;

create trigger events_touch
  before insert or update on public.events
  for each row execute function public.events_touch();

-- admin: list of organisers with their last login
create or replace function public.staff_list()
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

-- ─────────────────────────────── "J'y vais" ───────────────────────────────
create table public.rsvps (
  id uuid primary key default gen_random_uuid(),
  event_id uuid not null references public.events (id) on delete cascade,
  name text not null check (char_length(btrim(name)) between 1 and 60),
  email text check (email is null or (char_length(email) <= 200 and email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$')),
  ip_hash text,                      -- rate limiting only; wiped once the action is over
  reminder_sent_at timestamptz,
  created_at timestamptz not null default now()
);
create index rsvps_event_idx on public.rsvps (event_id);
alter table public.rsvps enable row level security;

-- only admins see attendees; nobody writes directly (see rsvp())
create policy "admins read attendees" on public.rsvps
  for select to authenticated using (public.is_admin());
create policy "admins remove attendees" on public.rsvps
  for delete to authenticated using (public.is_admin());

-- public sign-up: validates, rate-limits, returns the public count (shown from 10 people up)
create or replace function public.rsvp(p_slug text, p_name text, p_email text default null)
returns json language plpgsql security definer set search_path = public as $$
declare
  ev public.events;
  hdr json := coalesce(nullif(current_setting('request.headers', true), '')::json, '{}'::json);
  ip text;
  h text;
  n int;
  clean_name text := btrim(coalesce(p_name, ''));
  clean_email text := nullif(lower(btrim(coalesce(p_email, ''))), '');
begin
  select * into ev from public.events where slug = p_slug;
  if not found then raise exception 'unknown action' using errcode = 'P0002'; end if;
  if ev.status = 'cancelled' or ev.ends_at < now() then raise exception 'closed' using errcode = 'P0001'; end if;
  if char_length(clean_name) not between 1 and 60 then raise exception 'name' using errcode = '22023'; end if;
  if clean_email is not null and clean_email !~* '^[^@\s]+@[^@\s]+\.[^@\s]+$' then raise exception 'email' using errcode = '22023'; end if;

  -- anti-flood: 5 sign-ups per hour per connection for one action, 120 per hour per action overall
  ip := coalesce(hdr ->> 'cf-connecting-ip', hdr ->> 'x-real-ip', split_part(coalesce(hdr ->> 'x-forwarded-for', ''), ',', 1));
  if coalesce(ip, '') <> '' then
    h := md5(ip || ':' || ev.id::text || ':lvdc');
    if (select count(*) from public.rsvps where ip_hash = h and created_at > now() - interval '1 hour') >= 5 then
      raise exception 'too many' using errcode = 'P0001';
    end if;
  end if;
  if (select count(*) from public.rsvps where event_id = ev.id and created_at > now() - interval '1 hour') >= 120 then
    raise exception 'too many' using errcode = 'P0001';
  end if;

  -- same email twice for one action: update the name instead of counting twice
  if clean_email is not null and exists (select 1 from public.rsvps where event_id = ev.id and email = clean_email) then
    update public.rsvps set name = clean_name where event_id = ev.id and email = clean_email;
  else
    insert into public.rsvps (event_id, name, email, ip_hash) values (ev.id, clean_name, clean_email, h);
  end if;

  select count(*) into n from public.rsvps where event_id = ev.id;
  return json_build_object('ok', true, 'count', case when n >= 10 then n else null end);
end $$;
revoke execute on function public.rsvp(text, text, text) from public;
grant execute on function public.rsvp(text, text, text) to anon, authenticated;

create or replace function public.rsvp_public_count(p_slug text)
returns int language sql stable security definer set search_path = public as $$
  select case when c >= 10 then c else null end
  from (select count(*)::int as c from public.rsvps r join public.events e on e.id = r.event_id where e.slug = p_slug) t
$$;
revoke execute on function public.rsvp_public_count(text) from public;
grant execute on function public.rsvp_public_count(text) to anon, authenticated;

-- admin: attendees of one action
create or replace function public.attendees(p_event uuid)
returns table (name text, email text, created_at timestamptz)
language sql stable security definer set search_path = public as $$
  select r.name, r.email, r.created_at from public.rsvps r
  where r.event_id = p_event and public.is_admin()
  order by r.created_at
$$;
revoke execute on function public.attendees(uuid) from public, anon;
grant execute on function public.attendees(uuid) to authenticated;

-- ─────────────────────────────── anonymous counters ───────────────────────────────
-- Daily counters per action: page views, share-button uses, newsletter sign-ups, calendar adds.
-- No cookies, no IP, nothing personal.
create table public.event_stats (
  event_id uuid not null references public.events (id) on delete cascade,
  day date not null,
  views int not null default 0,
  shares int not null default 0,
  newsletter int not null default 0,
  calendar int not null default 0,
  primary key (event_id, day)
);
alter table public.event_stats enable row level security;
create policy "staff read counters" on public.event_stats
  for select to authenticated using (public.is_staff());

create or replace function public.track(p_slug text, p_kind text)
returns void language plpgsql security definer set search_path = public as $$
declare
  eid uuid;
  d date := (now() at time zone 'Europe/Paris')::date;
begin
  if p_kind not in ('view', 'share', 'newsletter', 'calendar') then return; end if;
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

-- ─────────────────────────────── dashboard ───────────────────────────────
create or replace function public.event_overview()
returns table (
  id uuid, slug text, title text, city text, kind text, status text, target text,
  starts_at timestamptz, ends_at timestamptz, created_by uuid, creator_name text,
  rsvps int, rsvps_with_email int, views int, shares int, newsletter int, calendar int,
  recap_participants int
)
language sql stable security definer set search_path = public as $$
  select e.id, e.slug, e.title, e.city, e.kind, e.status, e.target, e.starts_at, e.ends_at, e.created_by,
         coalesce(p.display_name, split_part(p.email, '@', 1)),
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

create or replace function public.rsvps_per_day(p_days int default 60)
returns table (day date, count int)
language sql stable security definer set search_path = public as $$
  select (r.created_at at time zone 'Europe/Paris')::date, count(*)::int
  from public.rsvps r
  where public.is_staff() and r.created_at > now() - make_interval(days => least(greatest(p_days, 1), 366))
  group by 1 order by 1
$$;
revoke execute on function public.rsvps_per_day(int) from public, anon;
grant execute on function public.rsvps_per_day(int) to authenticated;

-- ─────────────────────────────── privacy housekeeping ───────────────────────────────
-- Daily: forget connection hashes once an action is over, and attendees' emails 30 days after it.
create or replace function public.housekeeping()
returns void language sql security definer set search_path = public as $$
  update public.rsvps r set ip_hash = null
    from public.events e where e.id = r.event_id and e.ends_at < now() and r.ip_hash is not null;
  update public.rsvps r set email = null
    from public.events e where e.id = r.event_id and e.ends_at < now() - interval '30 days' and r.email is not null;
$$;
revoke execute on function public.housekeeping() from public, anon, authenticated;
