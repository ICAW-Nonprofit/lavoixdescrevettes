-- Automation that runs inside Supabase (no extra server):
--   • posters storage bucket for custom flyers
--   • publish: any change to an action asks GitHub to rebuild the site (pg_net → GitHub API)
--   • reminders: the day before an action, attendees who left an email get a reminder (pg_cron → Brevo API)
--   • housekeeping: privacy clean-up every night
-- Secrets live in Supabase Vault (set once in the SQL editor, see SETUP.md), never in this repo:
--   github_token, brevo_api_key, mail_from, (optional) github_repo, site_url, mail_from_name

create extension if not exists pg_net with schema extensions;
create extension if not exists pg_cron with schema pg_catalog;

-- ─────────────────────────────── custom flyers ───────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('posters', 'posters', true, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy "staff upload posters" on storage.objects
  for insert to authenticated with check (bucket_id = 'posters' and public.is_staff());
create policy "staff replace posters" on storage.objects
  for update to authenticated using (bucket_id = 'posters' and public.is_staff());

-- ─────────────────────────────── secrets helper ───────────────────────────────
create or replace function public.secret(p_name text)
returns text language sql stable security definer set search_path = public, vault as $$
  select decrypted_secret from vault.decrypted_secrets where name = p_name limit 1
$$;
revoke execute on function public.secret(text) from public, anon, authenticated;

-- ─────────────────────────────── publish ───────────────────────────────
-- Asks GitHub to rebuild the site. GitHub keeps at most one queued run per workflow,
-- so a burst of edits causes at most two builds.
create or replace function public.request_publish_now()
returns void language plpgsql security definer set search_path = public, extensions as $$
declare
  tok text := public.secret('github_token');
  repo text := coalesce(public.secret('github_repo'), 'nicolas-cozzarin/lavoixdescrevettes-prototype');
begin
  if tok is null then return; end if;
  perform net.http_post(
    url := format('https://api.github.com/repos/%s/actions/workflows/deploy.yml/dispatches', repo),
    body := jsonb_build_object('ref', 'main'),
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || tok,
      'Accept', 'application/vnd.github+json',
      'X-GitHub-Api-Version', '2022-11-28',
      'User-Agent', 'lavoixdescrevettes-supabase',
      'Content-Type', 'application/json'
    )
  );
end $$;
revoke execute on function public.request_publish_now() from public, anon, authenticated;

-- every change to an action triggers a rebuild
create or replace function public.request_publish()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  perform public.request_publish_now();
  return null;
end $$;

create trigger events_publish
  after insert or update or delete on public.events
  for each statement execute function public.request_publish();

-- staff can ask for a rebuild by hand (button in the organiser space)
create or replace function public.publish_now()
returns void language plpgsql security definer set search_path = public as $$
begin
  if not public.is_staff() then raise exception 'forbidden' using errcode = '42501'; end if;
  perform public.request_publish_now();
end $$;
revoke execute on function public.publish_now() from public, anon;
grant execute on function public.publish_now() to authenticated;

-- ─────────────────────────────── reminder emails ───────────────────────────────
create or replace function public.esc(t text)
returns text language sql immutable as $$
  select replace(replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;'), '"', '&quot;')
$$;

-- "mercredi 4 novembre à 11 h"
create or replace function public.fr_when(ts timestamptz)
returns text language sql immutable as $$
  select (array['dimanche','lundi','mardi','mercredi','jeudi','vendredi','samedi'])[extract(dow from l)::int + 1]
      || ' ' || case when extract(day from l) = 1 then '1er' else extract(day from l)::int::text end
      || ' ' || (array['janvier','février','mars','avril','mai','juin','juillet','août','septembre','octobre','novembre','décembre'])[extract(month from l)::int]
      || ' à ' || extract(hour from l)::int || ' h'
      || case when extract(minute from l) = 0 then '' else ' ' || lpad(extract(minute from l)::int::text, 2, '0') end
  from (select ts at time zone 'Europe/Paris' as l) t
$$;

create or replace function public.send_reminders()
returns int language plpgsql security definer set search_path = public, extensions as $$
declare
  key text := public.secret('brevo_api_key');
  sender text := public.secret('mail_from');
  sender_name text := coalesce(public.secret('mail_from_name'), 'La Voix des Crevettes');
  site text := coalesce(public.secret('site_url'), 'https://nicolas-cozzarin.github.io/lavoixdescrevettes-prototype');
  r record;
  url text;
  place text;
  sent int := 0;
begin
  if key is null or sender is null then return 0; end if;
  for r in
    select x.id as rsvp_id, x.name, x.email, e.*
    from public.rsvps x join public.events e on e.id = x.event_id
    where x.email is not null and x.reminder_sent_at is null and e.status <> 'cancelled'
      and (e.starts_at at time zone 'Europe/Paris')::date = (now() at time zone 'Europe/Paris')::date + 1
  loop
    url := site || '/agenda/' || r.slug || '/';
    place := concat_ws(', ', nullif(r.street, ''), nullif(concat_ws(' ', nullif(r.postal_code, ''), r.city), ''));
    perform net.http_post(
      url := 'https://api.brevo.com/v3/smtp/email',
      body := jsonb_build_object(
        'sender', jsonb_build_object('email', sender, 'name', sender_name),
        'to', jsonb_build_array(jsonb_build_object('email', r.email, 'name', r.name)),
        'subject', 'C''est demain : ' || r.title,
        'htmlContent',
          '<div style="font-family:Arial,sans-serif;font-size:16px;line-height:1.5;color:#00192e;max-width:560px">'
          || '<p>Salut ' || public.esc(r.name) || ',</p>'
          || '<p>Petit rappel : <strong>' || public.esc(r.title) || '</strong>, c''est demain !</p>'
          || '<p>🗓️ ' || public.esc(public.fr_when(r.starts_at)) || '<br>📍 ' || public.esc(place)
          || case when coalesce(r.access, '') <> '' then '<br>🚇 ' || public.esc(r.access) else '' end
          || case when coalesce(r.meeting_point, '') <> '' then '<br>👉 ' || public.esc(r.meeting_point) else '' end || '</p>'
          || '<p><a href="' || public.esc(url) || '" style="color:#00192e">Toutes les infos de l''action</a></p>'
          || case when coalesce(r.whatsapp_url, '') <> '' then '<p><a href="' || public.esc(r.whatsapp_url) || '" style="color:#00192e">Rejoindre le groupe WhatsApp</a></p>' else '' end
          || '<p>Merci d''être la voix des crevettes. À demain !</p>'
          || '<p style="font-size:13px;color:#555">Tu reçois cet email parce que tu as dit « J''y vais » sur notre site. '
          || 'Ton adresse sert uniquement aux infos de cette action et sera effacée 30 jours après.</p></div>',
        'textContent',
          'Salut ' || r.name || E',\n\nPetit rappel : ' || r.title || E', c''est demain !\n\n'
          || public.fr_when(r.starts_at) || E'\n' || place
          || case when coalesce(r.access, '') <> '' then E'\n' || r.access else '' end
          || case when coalesce(r.meeting_point, '') <> '' then E'\n' || r.meeting_point else '' end
          || E'\n\nToutes les infos : ' || url
          || case when coalesce(r.whatsapp_url, '') <> '' then E'\nGroupe WhatsApp : ' || r.whatsapp_url else '' end
          || E'\n\nMerci d''être la voix des crevettes. À demain !'
      ),
      headers := jsonb_build_object('api-key', key, 'Content-Type', 'application/json', 'accept', 'application/json')
    );
    update public.rsvps set reminder_sent_at = now() where id = r.rsvp_id;
    sent := sent + 1;
  end loop;
  return sent;
end $$;
revoke execute on function public.send_reminders() from public, anon, authenticated;

-- ─────────────────────────────── schedules (UTC) ───────────────────────────────
select cron.schedule('lvdc-reminders', '0 16 * * *', $$select public.send_reminders()$$);   -- ~17–18 h in Paris
select cron.schedule('lvdc-housekeeping', '30 3 * * *', $$select public.housekeeping()$$);
