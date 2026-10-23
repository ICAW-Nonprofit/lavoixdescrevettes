-- Rights per account (Actions, Campagnes, Blog) and the blog editor (posts, versions, preview links).
--
-- Rights
--   • profiles.rights / invitations.rights: any non-empty mix of 'actions', 'campaigns', 'blog'. Existing accounts get
--     {actions}. Admins (with the app code) have every right, plus the Tableau de bord and Paramètres.
--   • has_right(): checked in restrictive policies (added on top of the existing ones, which stay as they are) and in
--     the functions below. set_rights(): admins only, logged as account.rights.
-- Blog
--   • posts: one row per language version; the row is the working copy. Every save that changes the content adds a
--     post_versions row (kept forever). What is live is posts.published_version_id, set only by post_publish().
--   • Status (brouillon / publie / corbeille) changes only through post_publish(), post_trash() and post_restore().
--     Nothing is ever deleted. A French post going to the Corbeille takes its English version with it.
--   • post_previews: private links (random token, 7 days, revocable) read by blog_preview().
--   • blog_published(): what the build copies into src/content/posts.json (published versions only, no account IDs).
--   • Images: public bucket 'blog' (2 MB, JPEG/PNG/WebP, random names), written only with the Blog right.

-- ─────────────────────────────── rights ───────────────────────────────
alter table public.profiles
  add column rights text[] not null default '{actions}'
    check (rights <@ array['actions', 'campaigns', 'blog'] and cardinality(rights) >= 1),
  add column full_name text check (char_length(full_name) <= 120);
alter table public.invitations
  add column rights text[] not null default '{actions}'
    check (rights <@ array['actions', 'campaigns', 'blog'] and cardinality(rights) >= 1);
-- everyone edits their own name, pseudo and city; rights only through set_rights()
grant update (full_name) on public.profiles to authenticated;

create or replace function public.has_right(p text)
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select case role
      when 'organizer' then p = any(rights)
      when 'admin' then public.session_aal() = 'aal2'
      else false
    end
    from public.profiles where id = auth.uid()
  ), false)
$$;
revoke execute on function public.has_right(text) from public, anon;
grant execute on function public.has_right(text) to authenticated;

create or replace function public.set_rights(p_user uuid, p_rights text[])
returns void language plpgsql security definer set search_path = public as $$
declare
  clean text[] := (select array_agg(distinct r order by r) from unnest(p_rights) r);
begin
  if not public.is_admin() then raise exception 'forbidden' using errcode = '42501'; end if;
  if clean is null or not clean <@ array['actions', 'campaigns', 'blog'] then raise exception 'rights' using errcode = '22023'; end if;
  update public.profiles set rights = clean where id = p_user and role <> 'admin';
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
end $$;
revoke execute on function public.set_rights(uuid, text[]) from public, anon;
grant execute on function public.set_rights(uuid, text[]) to authenticated;

create or replace function public.audit_rights()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if old.rights is distinct from new.rights then
    perform public.audit('account.rights', new.email, jsonb_build_object('from', to_jsonb(old.rights), 'to', to_jsonb(new.rights)));
  end if;
  return null;
end $$;
revoke execute on function public.audit_rights() from public, anon, authenticated;
create trigger audit_rights
  after update of rights on public.profiles
  for each row execute function public.audit_rights();

-- same as in 20261017000000_init.sql, plus the invitation's rights
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
declare inv public.invitations;
begin
  select * into inv from public.invitations where email = lower(new.email);
  insert into public.profiles (id, email, display_name, city, role, rights)
  values (new.id, lower(new.email), inv.display_name, inv.city, coalesce(inv.role, 'organizer'), coalesce(inv.rights, '{actions}'))
  on conflict (id) do nothing;
  return new;
end $$;

-- same as in 20261018160000_audit_log.sql, plus the rights given
create or replace function public.audit_invitations()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    perform public.audit('invitation.create', new.email, jsonb_build_object('role', new.role, 'rights', to_jsonb(new.rights)));
  else
    perform public.audit('invitation.delete', old.email);
  end if;
  return null;
end $$;

-- admin: the accounts, now with their rights
drop function public.staff_list();
create function public.staff_list()
returns table (id uuid, email text, display_name text, city text, role text, rights text[], created_at timestamptz, last_sign_in_at timestamptz, actions int)
language sql stable security definer set search_path = public as $$
  select p.id, p.email, p.display_name, p.city, p.role, p.rights, p.created_at, u.last_sign_in_at,
         (select count(*) from public.events e where e.created_by = p.id)::int
  from public.profiles p join auth.users u on u.id = p.id
  where public.is_admin()
  order by p.created_at
$$;
revoke execute on function public.staff_list() from public, anon;
grant execute on function public.staff_list() to authenticated;

-- Restrictive policies: they apply on top of the existing ones, so a row now needs both (team member AND the right).
create policy "actions right: add" on public.events
  as restrictive for insert to authenticated with check (public.has_right('actions'));
create policy "actions right: edit" on public.events
  as restrictive for update to authenticated using (public.has_right('actions')) with check (public.has_right('actions'));
create policy "actions right: counters" on public.event_stats
  as restrictive for select to authenticated using (public.has_right('actions'));
create policy "campaigns right" on public.campaigns
  as restrictive for all to authenticated using (public.has_right('campaigns')) with check (public.has_right('campaigns'));
create policy "campaigns right: counters" on public.campaign_stats
  as restrictive for select to authenticated using (public.has_right('campaigns'));
-- Tableau de bord: admins only
create policy "dashboard: admins only" on public.site_stats
  as restrictive for select to authenticated using (public.is_admin());
create policy "dashboard notes: admins only" on public.dashboard_notes
  as restrictive for all to authenticated using (public.is_admin()) with check (public.is_admin());
-- custom flyers belong to actions (other buckets are untouched by these two)
create policy "posters need the actions right" on storage.objects
  as restrictive for insert to authenticated with check (bucket_id <> 'posters' or public.has_right('actions'));
create policy "posters need the actions right to replace" on storage.objects
  as restrictive for update to authenticated using (bucket_id <> 'posters' or public.has_right('actions'));

-- Functions with their own checks (security definer bypasses the policies): same as before, with the right.
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
  where public.has_right('actions')
  order by e.starts_at desc
$$;

create or replace function public.attendees(p_event uuid)
returns table (name text, email text, created_at timestamptz)
language plpgsql security definer set search_path = public as $$
declare
  s text := (select e.slug from public.events e where e.id = p_event);
  adm boolean := public.is_admin();
begin
  if not public.has_right('actions') then return; end if;
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
  where public.is_admin() and r.created_at > now() - make_interval(days => least(greatest(p_days, 1), 366))
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
  where public.has_right('campaigns')
  group by c.id, p.id, e.id
  order by c.created_at desc
$$;

create or replace function public.campaign_history(p_id uuid)
returns table (at timestamptz, who text, action text, fields jsonb)
language sql stable security definer set search_path = public as $$
  with c as (select * from public.campaigns where id = p_id and public.has_right('campaigns')),
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

-- ─────────────────────────────── blog ───────────────────────────────
create table public.posts (
  id uuid primary key default gen_random_uuid(),
  lang text not null default 'fr' check (lang in ('fr', 'en')),
  translation_of uuid unique references public.posts (id) on delete restrict,
  slug text check (slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$' and char_length(slug) <= 90),
  status text not null default 'brouillon' check (status in ('brouillon', 'publie', 'corbeille')),
  title text not null default '' check (char_length(title) <= 120),
  summary text not null default '' check (char_length(summary) <= 400),
  category text check (category in ('science', 'campagne')),
  publish_date date,
  cover_path text check (cover_path ~ '^[0-9a-f-]{36}\.(jpg|png|webp)$'),
  cover_alt text not null default '' check (char_length(cover_alt) <= 300),
  cover_credit text not null default '' check (char_length(cover_credit) <= 120),
  author_id uuid references public.profiles (id) on delete set null,
  author_display text not null default 'collectif' check (author_display in ('collectif', 'prenom', 'nom')),
  blocks jsonb not null default '[]' check (jsonb_typeof(blocks) = 'array' and pg_column_size(blocks) <= 500000),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null,
  first_published_at timestamptz,
  published_at timestamptz,
  published_version_id bigint,
  unique (lang, slug),
  check ((lang = 'en') = (translation_of is not null))
);

create table public.post_versions (
  id bigint generated always as identity primary key,
  post_id uuid not null references public.posts (id) on delete restrict,
  saved_at timestamptz not null default now(),
  saved_by uuid references public.profiles (id) on delete set null,
  restored_from bigint references public.post_versions (id),
  title text, slug text, summary text, category text, publish_date date,
  cover_path text, cover_alt text, cover_credit text, author_display text, blocks jsonb
);
create index post_versions_post_idx on public.post_versions (post_id, id desc);
alter table public.posts add constraint posts_published_version_fk foreign key (published_version_id) references public.post_versions (id);

create table public.post_previews (
  token text primary key check (token ~ '^[0-9a-f]{64}$'),
  post_id uuid not null references public.posts (id) on delete restrict,
  created_by uuid default auth.uid() references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '7 days',
  revoked_at timestamptz
);
create index post_previews_post_idx on public.post_previews (post_id);

alter table public.posts enable row level security;
alter table public.post_versions enable row level security;
alter table public.post_previews enable row level security;
create policy "blog right: read posts" on public.posts for select to authenticated using (public.has_right('blog'));
create policy "blog right: add posts" on public.posts for insert to authenticated with check (public.has_right('blog'));
create policy "blog right: edit posts" on public.posts for update to authenticated using (public.has_right('blog')) with check (public.has_right('blog'));
create policy "blog right: read versions" on public.post_versions for select to authenticated using (public.has_right('blog'));
create policy "blog right: read preview links" on public.post_previews for select to authenticated using (public.has_right('blog'));
-- the browser writes the content columns of posts; status, versions and links only through the functions below
revoke all on public.posts, public.post_versions, public.post_previews from anon;
revoke insert, update, delete, truncate on public.posts, public.post_versions, public.post_previews from authenticated;
grant insert (lang, translation_of, slug, title, summary, category, publish_date, cover_path, cover_alt, cover_credit, author_display, blocks)
  on public.posts to authenticated;
grant update (slug, title, summary, category, publish_date, cover_path, cover_alt, cover_credit, author_display, blocks)
  on public.posts to authenticated;

-- true when two rows of posts have the same content (what a version holds)
create or replace function public.post_same_content(a public.posts, b public.posts)
returns boolean language sql immutable as $$
  select (a.slug, a.title, a.summary, a.category, a.publish_date, a.cover_path, a.cover_alt, a.cover_credit, a.author_display, a.blocks)
         is not distinct from
         (b.slug, b.title, b.summary, b.category, b.publish_date, b.cover_path, b.cover_alt, b.cover_credit, b.author_display, b.blocks)
$$;
revoke execute on function public.post_same_content(public.posts, public.posts) from public, anon, authenticated;

create or replace function public.posts_check()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    new.author_id := auth.uid();
    new.updated_by := auth.uid();
    new.status := 'brouillon';
    new.published_version_id := null;
    new.first_published_at := null;
    new.published_at := null;
    if new.translation_of is not null and not exists (select 1 from public.posts f where f.id = new.translation_of and f.lang = 'fr') then
      raise exception 'translation' using errcode = '22023';
    end if;
  else
    new.id := old.id;
    new.lang := old.lang;
    new.translation_of := old.translation_of;
    new.author_id := old.author_id;
    new.created_at := old.created_at;
    -- a published post keeps its address: links already shared must keep working
    if old.first_published_at is not null then new.slug := old.slug; end if;
    -- updated_at changes only with the content (it is what concurrent saves are checked against)
    if public.post_same_content(new, old) then
      new.updated_at := old.updated_at;
      new.updated_by := old.updated_by;
    else
      new.updated_at := now();
      new.updated_by := auth.uid();
    end if;
  end if;
  -- only the author can sign a post with their own name
  if new.author_display <> 'collectif' and auth.uid() is not null and auth.uid() is distinct from new.author_id
     and (tg_op = 'INSERT' or new.author_display is distinct from old.author_display) then
    raise exception 'author' using errcode = '42501';
  end if;
  return new;
end $$;
revoke execute on function public.posts_check() from public, anon, authenticated;
create trigger posts_check
  before insert or update on public.posts
  for each row execute function public.posts_check();

-- every save that changes the content is a version (who and when)
create or replace function public.posts_version()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'UPDATE' and public.post_same_content(new, old) then return null; end if;
  insert into public.post_versions (post_id, saved_by, title, slug, summary, category, publish_date, cover_path, cover_alt, cover_credit, author_display, blocks)
  values (new.id, auth.uid(), new.title, new.slug, new.summary, new.category, new.publish_date, new.cover_path, new.cover_alt, new.cover_credit, new.author_display, new.blocks);
  return null;
end $$;
revoke execute on function public.posts_version() from public, anon, authenticated;
create trigger posts_version
  after insert or update on public.posts
  for each row execute function public.posts_version();

-- the site changes only when a post goes live, leaves, or publishes new changes (saving a draft never rebuilds)
create trigger posts_publish
  after update of status, published_version_id on public.posts
  for each row
  when ((old.status = 'publie' or new.status = 'publie')
        and (old.status is distinct from new.status or old.published_version_id is distinct from new.published_version_id))
  execute function public.request_publish();

-- the name shown on a post: the author's own choice, else the collective
create or replace function public.post_author(p_author uuid, p_display text)
returns text language sql stable security definer set search_path = public as $$
  select coalesce((
    select case p_display when 'nom' then nullif(btrim(full_name), '') when 'prenom' then nullif(btrim(display_name), '') end
    from public.profiles where id = p_author
  ), 'La Voix des Crevettes')
$$;
revoke execute on function public.post_author(uuid, text) from public, anon, authenticated;

create or replace function public.post_target(p public.posts)
returns text language sql immutable as $$
  select p.lang || '/' || coalesce(p.slug, left(p.id::text, 8))
$$;
revoke execute on function public.post_target(public.posts) from public, anon, authenticated;

-- Publish the latest saved version (« Publier » and « Publier les modifications »). Raises 'incomplete' with the list
-- of what is missing in DETAIL, one item per line.
create or replace function public.post_publish(p_id uuid, p_expected timestamptz default null)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.posts;
  missing text[] := '{}';
  img record;
  txt text;
  found_name text;
begin
  if not public.has_right('blog') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into p from public.posts where id = p_id for update;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  if p_expected is not null and p.updated_at is distinct from p_expected then raise exception 'conflict' using errcode = '40001'; end if;
  if p.status = 'corbeille' then raise exception 'trashed' using errcode = 'P0001'; end if;

  if char_length(btrim(p.title)) not between 3 and 80 then missing := missing || text 'Titre : entre 3 et 80 caractères'; end if;
  if p.slug is null then missing := missing || text 'Lien de l’article'; end if;
  if char_length(btrim(p.summary)) not between 50 and 170 then missing := missing || text 'Résumé : entre 50 et 170 caractères'; end if;
  if p.category is null then missing := missing || text 'Catégorie'; end if;
  if p.publish_date > (now() at time zone 'Europe/Paris')::date then missing := missing || text 'Date de publication : pas dans le futur'; end if;
  if p.cover_path is null then missing := missing || text 'Image de couverture'; end if;
  if char_length(btrim(p.cover_alt)) < 5 then missing := missing || text 'Couverture : texte alternatif'; end if;
  if btrim(p.cover_credit) = '' then missing := missing || text 'Couverture : crédit photo'; end if;
  for img in
    select b, n from jsonb_path_query(p.blocks, 'strict $.**?(@.type == "image")') with ordinality as t(b, n)
  loop
    if coalesce(img.b -> 'props' ->> 'path', '') !~ '^[0-9a-f-]{36}\.(jpg|png|webp)$' then missing := missing || format('Image %s : fichier manquant', img.n); end if;
    if char_length(btrim(coalesce(img.b -> 'props' ->> 'alt', ''))) < 5 then missing := missing || format('Image %s : texte alternatif', img.n); end if;
    if btrim(coalesce(img.b -> 'props' ->> 'credit', '')) = '' then missing := missing || format('Image %s : crédit photo', img.n); end if;
  end loop;

  -- the team's content rules (the site's own checks never see the database)
  txt := lower(concat_ws(' ', p.title, p.summary, p.cover_alt, p.cover_credit, p.blocks::text));
  if strpos(txt, U&'\+01F990') > 0 then missing := missing || text 'Pas d’emoji crevette (elle a l’air cuite)'; end if;
  found_name := (regexp_match(txt, '(^|[^a-z])(lidl|carrefour|leclerc|auchan|intermarch[ée]|mousquetaires|monoprix|franprix|aldi|casino|biocoop|grand frais|picard|syst[èe]me u|coop[ée]rative u)($|[^a-zà-ÿ])'))[2];
  if found_name is not null then missing := missing || format('Pas de nom d’enseigne dans le blog (« %s »)', found_name); end if;

  if p.author_display <> 'collectif' and public.post_author(p.author_id, p.author_display) = 'La Voix des Crevettes' then
    missing := missing || text 'Signature : le nom choisi n’est pas rempli dans le profil';
  end if;
  if p.lang = 'en' and not exists (select 1 from public.posts f where f.id = p.translation_of and f.status = 'publie') then
    missing := missing || text 'Publie d’abord la version française';
  end if;

  if cardinality(missing) > 0 then
    raise exception 'incomplete' using errcode = 'P0001', detail = array_to_string(missing, E'\n');
  end if;

  perform public.audit('post.publish', public.post_target(p), jsonb_build_object('first', p.first_published_at is null));
  update public.posts set
    status = 'publie',
    published_version_id = (select max(v.id) from public.post_versions v where v.post_id = p.id),
    first_published_at = coalesce(first_published_at, now()),
    published_at = now()
  where id = p.id;
end $$;
revoke execute on function public.post_publish(uuid, timestamptz) from public, anon;
grant execute on function public.post_publish(uuid, timestamptz) to authenticated;

-- « Dépublier » / « Mettre à la corbeille ». A French post takes its English version with it.
create or replace function public.post_trash(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.posts;
begin
  if not public.has_right('blog') then raise exception 'forbidden' using errcode = '42501'; end if;
  -- only French posts have translations pointing to them
  for p in
    select * from public.posts where (id = p_id or translation_of = p_id) and status <> 'corbeille' for update
  loop
    perform public.audit(case when p.status = 'publie' then 'post.unpublish' else 'post.trash' end, public.post_target(p));
    update public.posts set status = 'corbeille' where id = p.id;
  end loop;
end $$;
revoke execute on function public.post_trash(uuid) from public, anon;
grant execute on function public.post_trash(uuid) to authenticated;

-- Corbeille → Brouillon (publishing again is a separate step). p_with_translation: also restore the English version.
create or replace function public.post_restore(p_id uuid, p_with_translation boolean default false)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.posts;
begin
  if not public.has_right('blog') then raise exception 'forbidden' using errcode = '42501'; end if;
  for p in
    select * from public.posts
    where status = 'corbeille' and (id = p_id or (p_with_translation and translation_of = p_id))
    for update
  loop
    perform public.audit('post.restore', public.post_target(p));
    update public.posts set status = 'brouillon' where id = p.id;
  end loop;
end $$;
revoke execute on function public.post_restore(uuid, boolean) from public, anon;
grant execute on function public.post_restore(uuid, boolean) to authenticated;

-- Copies an old version into the working copy: that makes a new version, nothing is lost. The live page changes only
-- on « Publier les modifications ». Returns the new updated_at.
create or replace function public.post_restore_version(p_version bigint, p_expected timestamptz default null)
returns timestamptz language plpgsql security definer set search_path = public as $$
declare
  v public.post_versions;
  p public.posts;
  before bigint;
  res timestamptz;
begin
  if not public.has_right('blog') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v from public.post_versions where id = p_version;
  if not found then raise exception 'not found' using errcode = 'P0002'; end if;
  select * into p from public.posts where id = v.post_id for update;
  if p_expected is not null and p.updated_at is distinct from p_expected then raise exception 'conflict' using errcode = '40001'; end if;
  select max(id) into before from public.post_versions where post_id = p.id;
  update public.posts set
    title = v.title, slug = v.slug, summary = v.summary, category = v.category, publish_date = v.publish_date,
    cover_path = v.cover_path, cover_alt = v.cover_alt, cover_credit = v.cover_credit, blocks = v.blocks,
    -- someone else's name is never put back by another person
    author_display = case when auth.uid() is not distinct from p.author_id or v.author_display = 'collectif' then v.author_display else p.author_display end
  where id = p.id
  returning updated_at into res;
  update public.post_versions set restored_from = p_version where post_id = p.id and id > before;
  perform public.audit('post.version_restore', public.post_target(p), jsonb_build_object('saved_at', v.saved_at));
  return res;
end $$;
revoke execute on function public.post_restore_version(bigint, timestamptz) from public, anon;
grant execute on function public.post_restore_version(bigint, timestamptz) to authenticated;

-- Private preview link: one active link per post (a new one revokes the old one). Returns the token.
create or replace function public.post_preview_create(p_id uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  p public.posts;
  tok text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if not public.has_right('blog') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into p from public.posts where id = p_id;
  if not found or p.status = 'corbeille' then raise exception 'not found' using errcode = 'P0002'; end if;
  update public.post_previews set revoked_at = now() where post_id = p_id and revoked_at is null;
  insert into public.post_previews (token, post_id) values (tok, p_id);
  perform public.audit('post.preview', public.post_target(p));
  return tok;
end $$;
revoke execute on function public.post_preview_create(uuid) from public, anon;
grant execute on function public.post_preview_create(uuid) to authenticated;

create or replace function public.post_preview_revoke(p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
declare
  p public.posts;
begin
  if not public.has_right('blog') then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into p from public.posts where id = p_id;
  update public.post_previews set revoked_at = now() where post_id = p_id and revoked_at is null;
  if found then perform public.audit('post.preview_revoke', public.post_target(p)); end if;
end $$;
revoke execute on function public.post_preview_revoke(uuid) from public, anon;
grant execute on function public.post_preview_revoke(uuid) to authenticated;

-- Blog tab: every post with who saved last, whether it has unpublished changes, and its English version.
create or replace function public.post_list()
returns table (
  id uuid, lang text, translation_of uuid, slug text, title text, status text, updated_at timestamptz, updated_by_name text,
  author_id uuid, author_name text, has_changes boolean, first_published_at timestamptz, published_at timestamptz,
  en_id uuid, en_status text
)
language sql stable security definer set search_path = public as $$
  select p.id, p.lang, p.translation_of, p.slug, p.title, p.status, p.updated_at,
         coalesce(u.display_name, split_part(u.email, '@', 1)),
         p.author_id, coalesce(a.display_name, split_part(a.email, '@', 1)),
         p.status = 'publie' and p.published_version_id is distinct from (select max(v.id) from public.post_versions v where v.post_id = p.id),
         p.first_published_at, p.published_at, en.id, en.status
  from public.posts p
  left join public.profiles u on u.id = p.updated_by
  left join public.profiles a on a.id = p.author_id
  left join public.posts en on en.translation_of = p.id
  where public.has_right('blog')
  order by p.updated_at desc
$$;
revoke execute on function public.post_list() from public, anon;
grant execute on function public.post_list() to authenticated;

-- History: every version, newest first, with who saved it and which one is live
create or replace function public.post_history(p_id uuid)
returns table (id bigint, saved_at timestamptz, who text, restored_from bigint, restored_from_at timestamptz, live boolean)
language sql stable security definer set search_path = public as $$
  select v.id, v.saved_at,
         case when v.saved_by is null then null else coalesce(pr.display_name, split_part(pr.email, '@', 1), 'compte supprimé') end,
         v.restored_from, o.saved_at, v.id = p.published_version_id and p.status = 'publie'
  from public.post_versions v
  join public.posts p on p.id = v.post_id
  left join public.profiles pr on pr.id = v.saved_by
  left join public.post_versions o on o.id = v.restored_from
  where v.post_id = p_id and public.has_right('blog')
  order by v.id desc
$$;
revoke execute on function public.post_history(uuid) from public, anon;
grant execute on function public.post_history(uuid) to authenticated;

-- Public: one draft through its private link (valid, not expired, not revoked, not in the Corbeille)
create or replace function public.blog_preview(p_token text)
returns table (
  lang text, title text, summary text, category text, publish_date date, cover_path text, cover_alt text, cover_credit text,
  author text, blocks jsonb, expires_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select p.lang, p.title, p.summary, p.category, coalesce(p.publish_date, (now() at time zone 'Europe/Paris')::date),
         p.cover_path, p.cover_alt, p.cover_credit, public.post_author(p.author_id, p.author_display), p.blocks, l.expires_at
  from public.post_previews l join public.posts p on p.id = l.post_id
  where l.token = p_token and l.revoked_at is null and l.expires_at > now() and p.status <> 'corbeille'
$$;
revoke execute on function public.blog_preview(text) from public;
grant execute on function public.blog_preview(text) to anon, authenticated;

-- Build: the published version of each live post (an English post only while its French post is live). No account IDs.
create or replace function public.blog_published()
returns table (
  lang text, translation_key uuid, slug text, title text, summary text, category text, publish_date date,
  cover_path text, cover_alt text, cover_credit text, author text, blocks jsonb, published_at timestamptz
)
language sql stable security definer set search_path = public as $$
  select p.lang, coalesce(p.translation_of, p.id), p.slug, v.title, v.summary, v.category,
         coalesce(v.publish_date, (p.first_published_at at time zone 'Europe/Paris')::date),
         v.cover_path, v.cover_alt, v.cover_credit, public.post_author(p.author_id, v.author_display), v.blocks, p.published_at
  from public.posts p join public.post_versions v on v.id = p.published_version_id
  where p.status = 'publie'
    and (p.lang = 'fr' or exists (select 1 from public.posts f where f.id = p.translation_of and f.status = 'publie'))
  order by p.lang, p.slug
$$;
revoke execute on function public.blog_published() from public;
grant execute on function public.blog_published() to anon, authenticated;

-- ─────────────────────────────── blog images ───────────────────────────────
-- Public (the editor and logged-out previews show them); names are random, so a draft's images can't be guessed.
-- No update or delete: old versions keep their images.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('blog', 'blog', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;
create policy "blog writers upload images" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'blog' and public.has_right('blog') and name ~ '^[0-9a-f-]{36}\.(jpg|png|webp)$');
