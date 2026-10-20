-- Campaigns (tab « Campagnes » in /espace/): a short link and a QR code per flyer, poster or post, each pointing to
-- one of our own pages, and counts of what visitors did during that same visit.
--   • campaigns: never deleted (QR codes are printed), only archived. The codes are made here, never by the browser.
--     The destination is an action (id) or a fixed page name, never a URL: the build turns it into our own path.
--   • campaign_stats: totals per campaign, day and channel (QR code / plain link). Nothing personal: no IP, no cookie.
--   • track_campaign(): the public counter. Known bots are ignored; a daily ceiling per code stops floods.
--   • campaign_redirects(): codes and destinations only (no names), read by the build to make the /c/<code>/ pages.
--   • Security log: campaign.create, campaign.update (names of the fields changed), campaign.archive.

create table public.campaigns (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(btrim(name)) between 1 and 80),
  support text not null check (support in ('flyer', 'affiche', 'instagram', 'autre')),
  dest_event_id uuid references public.events (id) on delete set null,
  dest_page text check (dest_page ~ '^(home|agenda|report|blog/[a-z0-9]+(-[a-z0-9]+)*)$'),
  fallback_page text not null default 'agenda' check (fallback_page ~ '^(home|agenda|report|blog/[a-z0-9]+(-[a-z0-9]+)*)$'),
  code_qr text not null unique check (code_qr ~ '^[23456789abcdefghjkmnpqrstuvwxyz]{6}$'),
  code_link text not null unique check (code_link ~ '^[23456789abcdefghjkmnpqrstuvwxyz]{6}$'),
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  archived_at timestamptz,
  archived_by uuid references public.profiles (id) on delete set null,
  -- both empty only when the action was deleted later: the link then goes to the fallback page
  check (num_nonnulls(dest_event_id, dest_page) <= 1)
);
create unique index campaigns_name_key on public.campaigns (lower(btrim(name)));

-- 6 characters without 0/o/1/l/i, different from every code already given (QR or link)
create or replace function public.campaign_code()
returns text language plpgsql volatile security definer set search_path = public as $$
declare
  abc constant text := '23456789abcdefghjkmnpqrstuvwxyz';
  b bytea;
  c text;
begin
  loop
    b := uuid_send(gen_random_uuid()); -- bytes 0–5 are fully random
    c := '';
    for i in 0..5 loop c := c || substr(abc, 1 + get_byte(b, i) % 31, 1); end loop;
    exit when not exists (select 1 from public.campaigns where code_qr = c or code_link = c);
  end loop;
  return c;
end $$;
revoke execute on function public.campaign_code() from public, anon, authenticated;

create or replace function public.campaigns_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.code_qr := public.campaign_code();
    loop
      new.code_link := public.campaign_code();
      exit when new.code_link <> new.code_qr;
    end loop;
  elsif old.archived_at is not null and new.archived_at is distinct from old.archived_at then
    raise exception 'archived' using errcode = 'P0001'; -- no un-archiving
  end if;
  if new.archived_at is not null and (tg_op = 'INSERT' or old.archived_at is null) then
    new.archived_at := now();
    new.archived_by := auth.uid();
  end if;
  new.name := btrim(new.name);
  -- a destination chosen in the app: exactly one, and an action still to come (depth 1 = not the cascade of an
  -- action being deleted, which empties dest_event_id on purpose)
  if pg_trigger_depth() = 1 and (tg_op = 'INSERT' or new.dest_event_id is distinct from old.dest_event_id
                                  or new.dest_page is distinct from old.dest_page) then
    if num_nonnulls(new.dest_event_id, new.dest_page) <> 1 then
      raise exception 'destination' using errcode = 'P0001';
    end if;
    if new.dest_event_id is not null and not exists (
      select 1 from public.events e where e.id = new.dest_event_id and e.status <> 'cancelled' and e.ends_at > now()
    ) then
      raise exception 'destination closed' using errcode = 'P0001';
    end if;
  end if;
  return new;
end $$;
revoke execute on function public.campaigns_check() from public, anon, authenticated;
create trigger campaigns_check
  before insert or update on public.campaigns
  for each row execute function public.campaigns_check();

alter table public.campaigns enable row level security;
create policy "staff read campaigns" on public.campaigns
  for select to authenticated using (public.is_staff());
create policy "staff add campaigns" on public.campaigns
  for insert to authenticated with check (public.is_staff() and created_by = auth.uid());
create policy "staff edit campaigns" on public.campaigns
  for update to authenticated using (public.is_staff()) with check (public.is_staff());
-- nobody deletes; codes, author and dates are never written by the app
revoke all on public.campaigns from anon;
revoke insert, update, delete, truncate on public.campaigns from authenticated;
grant insert (name, support, dest_event_id, dest_page, fallback_page) on public.campaigns to authenticated;
grant update (name, dest_event_id, dest_page, fallback_page, archived_at) on public.campaigns to authenticated;

-- ─────────────────────────────── counts ───────────────────────────────
create table public.campaign_stats (
  campaign_id uuid not null references public.campaigns (id) on delete restrict,
  day date not null,
  channel text not null check (channel in ('qr', 'link')),
  visits int not null default 0 check (visits >= 0),
  rsvps int not null default 0 check (rsvps >= 0),
  share_clicks int not null default 0 check (share_clicks >= 0),
  shares_done int not null default 0 check (shares_done >= 0),
  newsletter int not null default 0 check (newsletter >= 0),
  primary key (campaign_id, day, channel)
);
alter table public.campaign_stats enable row level security;
create policy "staff read campaign counters" on public.campaign_stats
  for select to authenticated using (public.is_staff());
-- written only by track_campaign()
revoke all on public.campaign_stats from anon;
revoke insert, update, delete, truncate on public.campaign_stats from authenticated;

-- p_slug: the action of a « J'y vais », counted only when it is the campaign's destination
create or replace function public.track_campaign(p_code text, p_kind text, p_slug text default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  c public.campaigns;
  k text := coalesce(p_kind, '');
  ua text := coalesce(coalesce(nullif(current_setting('request.headers', true), ''), '{}')::json ->> 'user-agent', '');
  d date := (now() at time zone 'Europe/Paris')::date;
begin
  if k not in ('visit', 'rsvp', 'share_click', 'share_done', 'newsletter') then return; end if;
  -- crawlers, headless browsers, link-preview fetchers and scripts (previews don't run scripts anyway)
  if ua = '' or ua ~* '[a-z]bot[/-]|spider|crawl|headless|lighthouse|pagespeed|prerender|facebookexternalhit|whatsapp/|python|curl/|wget/' then
    return;
  end if;
  select * into c from public.campaigns where code_qr = p_code or code_link = p_code;
  if c.id is null then return; end if;
  if k = 'rsvp' and not exists (select 1 from public.events e where e.id = c.dest_event_id and e.slug = p_slug) then return; end if;
  -- daily ceiling per code: a flood stops counting, visitors are never blocked
  insert into public.campaign_stats as s (campaign_id, day, channel, visits, rsvps, share_clicks, shares_done, newsletter)
  values (c.id, d, case when p_code = c.code_qr then 'qr' else 'link' end,
          (k = 'visit')::int, (k = 'rsvp')::int, (k = 'share_click')::int, (k = 'share_done')::int, (k = 'newsletter')::int)
  on conflict (campaign_id, day, channel) do update set
    visits = least(s.visits + excluded.visits, 2000),
    rsvps = least(s.rsvps + excluded.rsvps, 500),
    share_clicks = least(s.share_clicks + excluded.share_clicks, 500),
    shares_done = least(s.shares_done + excluded.shares_done, 500),
    newsletter = least(s.newsletter + excluded.newsletter, 500);
end $$;
revoke execute on function public.track_campaign(text, text, text) from public;
grant execute on function public.track_campaign(text, text, text) to anon, authenticated;

-- ─────────────────────────────── build: the /c/<code>/ pages ───────────────────────────────
-- archived campaigns included: their links keep working
create or replace function public.campaign_redirects()
returns table (code_qr text, code_link text, dest_event_id uuid, dest_page text, fallback_page text)
language sql stable security definer set search_path = public as $$
  select c.code_qr, c.code_link, c.dest_event_id, c.dest_page, c.fallback_page from public.campaigns c order by c.created_at
$$;
revoke execute on function public.campaign_redirects() from public;
grant execute on function public.campaign_redirects() to anon, authenticated;

-- ─────────────────────────────── organiser space ───────────────────────────────
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
revoke execute on function public.campaign_overview() from public, anon;
grant execute on function public.campaign_overview() to authenticated;

-- created and archived come from the campaign itself (kept forever); edits from the security log (kept a year)
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
revoke execute on function public.campaign_history(uuid) from public, anon;
grant execute on function public.campaign_history(uuid) to authenticated;

-- ─────────────────────────────── security log and rebuilds ───────────────────────────────
create or replace function public.audit_campaigns()
returns trigger language plpgsql security definer set search_path = public as $$
declare
  changed jsonb;
begin
  if tg_op = 'INSERT' then
    perform public.audit('campaign.create', new.code_link);
    return null;
  end if;
  if old.archived_at is null and new.archived_at is not null then
    perform public.audit('campaign.archive', new.code_link);
  end if;
  select jsonb_agg(n.key order by n.key) into changed
  from jsonb_each(to_jsonb(new)) n
  where n.key not in ('archived_at', 'archived_by') and to_jsonb(old) -> n.key is distinct from n.value;
  if changed is not null then perform public.audit('campaign.update', new.code_link, jsonb_build_object('fields', changed)); end if;
  return null;
end $$;
revoke execute on function public.audit_campaigns() from public, anon, authenticated;
create trigger audit_campaigns
  after insert or update on public.campaigns
  for each row execute function public.audit_campaigns();

-- a new link, or a new destination: rebuild the /c/ pages (a rename or an archive changes nothing public)
create trigger campaigns_publish
  after insert or update of dest_event_id, dest_page, fallback_page on public.campaigns
  for each statement execute function public.request_publish();
