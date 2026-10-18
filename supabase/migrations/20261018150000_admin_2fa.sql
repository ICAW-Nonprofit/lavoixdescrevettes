-- Two-factor login for admins.
-- Admin accounts see attendees' names and emails, so the email login link is not enough on its own:
-- they also need the 6-digit code from an authenticator app (Supabase TOTP MFA). A session confirmed
-- with that code has aal = 'aal2' in its token; a session from the email link alone has 'aal1'.
-- An admin without the code gets no rights at all (not even an organiser's) until they enter it.
-- Organisers are unchanged.

-- 'aal1' or 'aal2' for the current request ('aal1' when there is no token)
create or replace function public.session_aal()
returns text language sql stable security definer set search_path = public as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1')
$$;
revoke execute on function public.session_aal() from public, anon;
grant execute on function public.session_aal() to authenticated;

create or replace function public.is_staff()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((
    select role = 'organizer' or (role = 'admin' and public.session_aal() = 'aal2')
    from public.profiles where id = auth.uid()
  ), false)
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select coalesce((select role = 'admin' from public.profiles where id = auth.uid()), false)
     and public.session_aal() = 'aal2'
$$;
