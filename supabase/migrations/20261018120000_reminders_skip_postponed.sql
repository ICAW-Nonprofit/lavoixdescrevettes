-- "Reportée" means the date isn't known yet: no "C'est demain" reminder for a postponed action.
-- Same function as in 20261017000100_automation.sql, with e.status = 'published' instead of <> 'cancelled'.

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
    where x.email is not null and x.reminder_sent_at is null and e.status = 'published'
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
