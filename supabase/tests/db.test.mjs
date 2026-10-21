// SQL tests for the La Voix des Crevettes migrations, on PGlite (Postgres in WebAssembly) with small
// stand-ins for Supabase's auth, storage, vault, pg_net and pg_cron. Run: npm run test:db
import { PGlite } from '@electric-sql/pglite';
import { readFileSync, readdirSync } from 'node:fs';

const here = new URL('../migrations/', import.meta.url);
const migrations = readdirSync(here).filter((n) => n.endsWith('.sql')).sort().map((n) => new URL(n, here));
const db = new PGlite();
let pass = 0, fail = 0;
const ok = (name, cond, extra = '') => { cond ? pass++ : fail++; console.log(`${cond ? 'PASS' : 'FAIL'}  ${name}${extra ? '  ' + extra : ''}`); };
async function throws(name, fn, match) {
  try { await fn(); ok(name, false, '(no error)'); } catch (e) { ok(name, !match || match.test(e.message), e.message.slice(0, 90)); }
}

// ---------- Supabase stand-ins ----------
await db.exec(`
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create schema extensions; create schema storage; create schema vault; create schema net; create schema cron;
grant usage on schema public, auth, extensions, storage to anon, authenticated;
create table auth.users (id uuid primary key default gen_random_uuid(), email text, raw_user_meta_data jsonb default '{}', last_sign_in_at timestamptz);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('test.uid', true), '')::uuid $$;
grant execute on function auth.uid() to anon, authenticated;
create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), ''), '{}')::jsonb $$;
grant execute on function auth.jwt() to anon, authenticated;
create table storage.buckets (id text primary key, name text, public boolean, file_size_limit bigint, allowed_mime_types text[]);
create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text, name text);
alter table storage.objects enable row level security;
grant select, insert, update, delete on storage.objects to anon, authenticated;
create table vault.secrets (name text primary key, decrypted_secret text);
create view vault.decrypted_secrets as select name, decrypted_secret from vault.secrets;
create table net.calls (id serial, url text, body jsonb, headers jsonb);
create function net.http_post(url text, body jsonb default '{}', params jsonb default '{}', headers jsonb default '{}', timeout_milliseconds int default 5000)
  returns bigint language sql as $$ insert into net.calls (url, body, headers) values (url, body, headers) returning id $$;
create table cron.jobs (name text, sched text, cmd text);
create function cron.schedule(n text, s text, c text) returns bigint language sql as $$ insert into cron.jobs values (n, s, c); select 1::bigint $$;
-- like Supabase: new tables and functions in public are fully granted to the API roles (RLS and revokes then restrict)
alter default privileges in schema public grant all on tables to anon, authenticated, service_role;
alter default privileges in schema public grant all on functions to anon, authenticated, service_role;
`);
const strip = (sql) => sql.replace(/^create extension.*$/gim, '-- (extension stub)').replace(/with schema pg_catalog/g, '');
for (const p of migrations) {
  const name = String(p).split('/').pop();
  // live data before the dashboard migration: newsletter sign-ups counted on an action page, to check the backfill
  if (name === '20261019120000_dashboard.sql') await db.exec(`insert into public.event_stats (event_id, day, newsletter) select id, '2026-01-15', 4 from public.events limit 1`);
  // an account that exists before rights per account: it must keep the Actions right only
  if (name === '20261021120000_blog_and_rights.sql') await db.exec(`insert into public.invitations (email) values ('ancien@example.com'); insert into auth.users (email) values ('ancien@example.com');`);
  try { await db.exec(strip(readFileSync(p, 'utf8'))); ok(`migration applies: ${name}`, true); }
  catch (e) { ok(`migration applies: ${name}`, false, e.message); process.exit(1); }
}
// No grants here: the default privileges above already match Supabase, so the migrations' own revokes and grants are what's tested.
ok('an account created before rights per account keeps the Actions right only', (await db.query(`select rights from public.profiles where email = 'ancien@example.com'`)).rows[0]?.rights.join() === 'actions');
await db.exec(`delete from auth.users where email = 'ancien@example.com'; delete from public.invitations where email = 'ancien@example.com';`);

// ---------- helpers ----------
// aal: 'aal2' = session confirmed with the authenticator-app code, 'aal1' = email link only
const as = async (role, uid, fn, headers = '{}', aal = 'aal2') => {
  const claims = JSON.stringify({ role, aal, ...(uid ? { sub: uid } : {}) });
  await db.exec(`set test.uid = '${uid || ''}'; set request.headers = '${headers}'; set request.jwt.claims = '${claims}'; set role ${role};`);
  try { return await fn(); } finally { await db.exec(`reset role; set test.uid = ''; set request.headers = '{}'; set request.jwt.claims = '';`); }
};
const q = async (sql, params) => (await db.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];

ok('seed: the 4 November action is imported', !!(await one(`select 1 as x from public.events where slug = 'action-lidl-chatenay-malabry-4-novembre-2026'`)));
await q(`delete from public.events`); // start the scenarios from an empty table

// ---------- accounts ----------
await throws('uninvited email cannot create an account', () => q(`insert into auth.users (email) values ('stranger@example.com')`), /not been invited/);
await q(`insert into public.invitations (email, role, display_name) values ('admin@example.com', 'admin', 'Admin')`);
const admin = (await one(`insert into auth.users (email) values ('Admin@Example.com') returning id`)).id;
ok('admin profile created with admin role', (await one(`select role from public.profiles where id = $1`, [admin])).role === 'admin');

await as('authenticated', admin, () => q(`insert into public.invitations (email, display_name, city, rights) values ('orga@example.com', 'Orga', 'Lyon', '{actions,campaigns}')`));
ok('admin can invite an organiser', !!(await one(`select 1 as x from public.invitations where email = 'orga@example.com'`)));
await throws('admin cannot invite another admin from the app', () => as('authenticated', admin, () => q(`insert into public.invitations (email, role) values ('x@example.com', 'admin')`)), /row-level security/);
const orga = (await one(`insert into auth.users (email) values ('orga@example.com') returning id`)).id;
const p = await one(`select role, display_name, city from public.profiles where id = $1`, [orga]);
ok('organiser profile gets name, city, organizer role from the invitation', p.role === 'organizer' && p.display_name === 'Orga' && p.city === 'Lyon');
await throws('organiser cannot invite', () => as('authenticated', orga, () => q(`insert into public.invitations (email) values ('y@example.com')`)), /row-level security/);
await throws('organiser cannot promote themselves', () => as('authenticated', orga, () => q(`update public.profiles set role = 'admin' where id = '${orga}'`)), /permission denied/);
await as('authenticated', orga, () => q(`update public.profiles set display_name = 'Orga Lyon' where id = '${orga}'`));
ok('organiser can rename themselves', (await one(`select display_name from public.profiles where id = $1`, [orga])).display_name === 'Orga Lyon');
ok('organiser cannot list organisers', (await as('authenticated', orga, () => q(`select * from public.staff_list()`))).length === 0);
ok('admin lists organisers', (await as('authenticated', admin, () => q(`select * from public.staff_list()`))).length === 2);

// ---------- two-factor login for admins ----------
const rights = (uid, aal) => as('authenticated', uid, () => one(`select public.is_admin() as admin, public.is_staff() as staff`), '{}', aal);
const a1 = await rights(admin, 'aal1');
ok('admin with the email link only has no rights (needs the app code)', a1.admin === false && a1.staff === false);
ok('admin with the app code has admin rights', (await rights(admin, 'aal2')).admin === true);
ok('admin without the code cannot list organisers', (await as('authenticated', admin, () => q(`select * from public.staff_list()`), '{}', 'aal1')).length === 0);
await throws('admin without the code cannot invite', () => as('authenticated', admin, () => q(`insert into public.invitations (email) values ('z@example.com')`), '{}', 'aal1'), /row-level security/);
const o1 = await rights(orga, 'aal1');
ok('organisers need no app code', o1.staff === true && o1.admin === false);

// ---------- actions ----------
await q(`insert into vault.secrets values ('github_token', 'ghp_test')`);
const ev = {
  slug: 'action-test-paris', title: 'Action devant le siège de Testmart', target: 'Testmart', city: 'Paris', street: '1 rue de Rivoli', postal_code: '75001',
  summary: 'On exige que Testmart arrête de les asphyxier.', description: 'Texte.',
};
const insertEv = (uid, e, startsIn = '2 days') => as('authenticated', uid, () => q(
  `insert into public.events (slug, title, target, city, street, postal_code, summary, description, starts_at, ends_at, lat, lng)
   values ($1,$2,$3,$4,$5,$6,$7,$8, now() + interval '${startsIn}', now() + interval '${startsIn}' + interval '90 minutes', 48.86, 2.33) returning id, created_by`,
  [e.slug, e.title, e.target, e.city, e.street, e.postal_code, e.summary, e.description]));
const callsBefore = (await one(`select count(*)::int as n from net.calls`)).n;
const [e1] = await insertEv(orga, ev);
ok('organiser creates an action (created_by = them)', e1.created_by === orga);
ok('creating an action asks GitHub to rebuild once', (await one(`select count(*)::int as n from net.calls where url like '%/actions/workflows/deploy.yml/dispatches'`)).n === callsBefore + 1);
await as('authenticated', admin, () => q(`update public.events set title = 'Nouveau titre', slug = 'hacked' where id = '${e1.id}'`));
const e1b = await one(`select title, slug, updated_by from public.events where id = $1`, [e1.id]);
ok('anyone on the team edits any action, slug stays fixed', e1b.title === 'Nouveau titre' && e1b.slug === 'action-test-paris' && e1b.updated_by === admin);
const delOrga = await as('authenticated', orga, () => q(`delete from public.events where id = '${e1.id}' returning id`));
ok('organiser cannot delete an action', delOrga.length === 0);
await throws('end must be after start', () => as('authenticated', orga, () => q(`insert into public.events (slug, title, city, summary, starts_at, ends_at) values ('x-y', 'Titre ok', 'Paris', 'Résumé assez long', now(), now() - interval '1 hour')`)), /check/);
await throws('bad slug rejected', () => as('authenticated', orga, () => q(`insert into public.events (slug, title, city, summary, starts_at, ends_at) values ('Bad Slug', 'Titre ok', 'Paris', 'Résumé assez long', now(), now() + interval '1 hour')`)), /check/);

// public reads
await throws('public cannot read who created an action', () => as('anon', null, () => q(`select created_by from public.events`)), /permission denied/);
ok('public reads action fields', (await as('anon', null, () => q(`select slug, title from public.events`))).length === 1);
await throws('public cannot create actions', () => as('anon', null, () => q(`insert into public.events (slug, title, city, summary, starts_at, ends_at) values ('a-b', 'Titre ok', 'Paris', 'Résumé assez long', now(), now() + interval '1 hour')`)), /permission denied|row-level/);

// rebuilds: only the team can trigger them
const dispatches = async () => (await one(`select count(*)::int as n from net.calls where url like '%/deploy.yml/dispatches'`)).n;
let d0 = await dispatches();
await throws('public cannot update actions', () => as('anon', null, () => q(`update public.events set title = 'Piraté' where id = '${e1.id}'`)), /permission denied/);
await throws('public cannot delete actions', () => as('anon', null, () => q(`delete from public.events where false`)), /permission denied/);
await throws('public cannot truncate tables', () => as('anon', null, () => q(`truncate public.events cascade`)), /permission denied/);
ok('public cannot trigger a rebuild', (await dispatches()) === d0);

// disabled organiser
await as('authenticated', admin, () => q(`select public.set_organizer_active('${orga}', false)`));
await throws('disabled organiser cannot create actions', () => insertEv(orga, { ...ev, slug: 'action-2' }), /row-level security/);
d0 = await dispatches();
await as('authenticated', orga, () => q(`update public.events set title = 'Rien' where id = '${e1.id}'`));
ok('disabled organiser cannot trigger a rebuild (empty update)', (await dispatches()) === d0);
await as('authenticated', admin, () => q(`update public.events set title = 'Titre admin' where id = '${e1.id}'`));
ok('a team edit still triggers a rebuild', (await dispatches()) === d0 + 1);
await throws('organiser cannot disable others', () => as('authenticated', orga, () => q(`select public.set_organizer_active('${admin}', false)`)), /forbidden/);
await as('authenticated', admin, () => q(`select public.set_organizer_active('${orga}', true)`));
ok('admin re-enables organiser', (await one(`select role from public.profiles where id = $1`, [orga])).role === 'organizer');

// ---------- J'y vais ----------
const r1 = await as('anon', null, () => one(`select public.rsvp('action-test-paris', 'Camille', 'Camille@Example.com') as r`));
ok('public can say "J\'y vais", count hidden under 10', r1.r.ok === true && r1.r.count === null);
await as('anon', null, () => q(`select public.rsvp('action-test-paris', 'Camille B', 'camille@example.com')`));
ok('same email twice counts once (name updated)', (await one(`select count(*)::int as n, max(name) as name from public.rsvps`)).n === 1 && (await one(`select name from public.rsvps`)).name === 'Camille B');
for (let i = 0; i < 8; i++) await as('anon', null, () => q(`select public.rsvp('action-test-paris', 'Anon ${i}')`));
const r10 = await as('anon', null, () => one(`select public.rsvp('action-test-paris', 'Dix') as r`));
ok('count shown from 10 people', r10.r.count === 10);
ok('public count function', (await as('anon', null, () => one(`select public.rsvp_public_count('action-test-paris') as c`))).c === 10);
await throws('empty name rejected', () => as('anon', null, () => q(`select public.rsvp('action-test-paris', '   ')`)), /name/);
await throws('bad email rejected', () => as('anon', null, () => q(`select public.rsvp('action-test-paris', 'X', 'not-an-email')`)), /email/);
await throws('public cannot write rsvps directly', () => as('anon', null, () => q(`insert into public.rsvps (event_id, name) values ('${e1.id}', 'x')`)), /permission denied|row-level/);
ok('public cannot read attendees', (await as('anon', null, () => q(`select * from public.rsvps`).catch(() => []))).length === 0);
ok('organiser cannot read attendees', (await as('authenticated', orga, () => q(`select * from public.rsvps`))).length === 0);
const orgaList = await as('authenticated', orga, () => q(`select * from public.attendees('${e1.id}')`));
ok('organiser gets the first names, never the emails', orgaList.length === 10 && orgaList.every((r) => r.email === null) && orgaList.some((r) => r.name === 'Camille B'));
ok('admin reads attendees with emails', (await as('authenticated', admin, () => q(`select * from public.attendees('${e1.id}')`))).filter((r) => r.email).length === 1);
ok('admin without the app code gets no attendee list', (await as('authenticated', admin, () => q(`select * from public.attendees('${e1.id}')`), '{}', 'aal1')).length === 0);
ok('admin without the app code cannot edit actions', (await as('authenticated', admin, () => q(`update public.events set title = 'Sans code' where id = '${e1.id}' returning id`), '{}', 'aal1')).length === 0);

// rate limit per connection
const hdr = JSON.stringify({ 'x-forwarded-for': '203.0.113.7, 10.0.0.1' });
for (let i = 0; i < 5; i++) await as('anon', null, () => q(`select public.rsvp('action-test-paris', 'IP ${i}')`), hdr);
await throws('6th sign-up from one connection within an hour is refused', () => as('anon', null, () => q(`select public.rsvp('action-test-paris', 'IP 6')`), hdr), /too many/);
ok('another connection still works', !!(await as('anon', null, () => one(`select public.rsvp('action-test-paris', 'Other IP') as r`), JSON.stringify({ 'x-forwarded-for': '198.51.100.2' }))).r.ok);

// past action closed
const [past] = await insertEv(orga, { ...ev, slug: 'action-passee' }, '-3 days');
await throws('cannot sign up for a past action', () => as('anon', null, () => q(`select public.rsvp('action-passee', 'Late')`)), /closed/);

// ---------- counters & dashboard ----------
for (const k of ['view', 'view', 'share', 'newsletter', 'calendar', 'bogus']) await as('anon', null, () => q(`select public.track('action-test-paris', '${k}')`));
const st = await one(`select views, shares, newsletter, calendar from public.event_stats`);
ok('counters add up (unknown kinds ignored)', st.views === 2 && st.shares === 1 && st.newsletter === 1 && st.calendar === 1);
ok('public cannot read counters', (await as('anon', null, () => q(`select * from public.event_stats`).catch(() => []))).length === 0);
const ov = await as('authenticated', orga, () => q(`select * from public.event_overview()`));
const row = ov.find((r) => r.slug === 'action-test-paris');
ok('organiser dashboard: counts per action', ov.length === 2 && row.rsvps === 16 && row.views === 2 && row.creator_name === 'Orga Lyon');
ok('public gets no dashboard', (await as('anon', null, () => q(`select * from public.event_overview()`).catch(() => []))).length === 0);
ok('sign-ups per day (Tableau de bord: admins)', (await as('authenticated', admin, () => q(`select * from public.rsvps_per_day(30)`))).reduce((a, r) => a + r.count, 0) === 16);
ok('organiser gets no sign-ups per day (Tableau de bord is admin-only)', (await as('authenticated', orga, () => q(`select * from public.rsvps_per_day(30)`))).length === 0);

// site-wide newsletter counter: every sign-up on the site, with or without an action page
ok('backfill: sign-ups already counted on action pages are in the site counter', (await one(`select newsletter from public.site_stats where day = '2026-01-15'`))?.newsletter === 4);
await as('anon', null, () => q(`select public.track(null, 'newsletter')`));
await as('anon', null, () => q(`select public.track('no-such-action', 'newsletter')`));
await as('anon', null, () => q(`select public.track(null, null)`));
ok('organiser reads no site counter (Tableau de bord is admin-only)', (await as('authenticated', orga, () => q(`select * from public.site_stats`))).length === 0);
const today = await as('authenticated', admin, () => one(`select newsletter from public.site_stats where day = (now() at time zone 'Europe/Paris')::date`));
ok('newsletter sign-ups count site-wide (action page, no page, unknown page)', today.newsletter === 3);
ok('a sign-up without an action page is not counted for an action', (await one(`select sum(newsletter)::int as n from public.event_stats`)).n === 1);
await throws('public cannot read the site counter', () => as('anon', null, () => q(`select * from public.site_stats`)), /permission denied/);
await throws('public cannot write the site counter', () => as('anon', null, () => q(`insert into public.site_stats (day, newsletter) values ('2026-02-01', 99)`)), /permission denied/);
await throws('organiser cannot write the site counter', () => as('authenticated', orga, () => q(`update public.site_stats set newsletter = 999`)), /permission denied/);
ok('admin without the app code cannot read the site counter', (await as('authenticated', admin, () => q(`select * from public.site_stats`), '{}', 'aal1')).length === 0);
ok('admin reads the site counter', (await as('authenticated', admin, () => q(`select * from public.site_stats`))).length === 2);

// notes on the dashboard chart (Tableau de bord: admins only)
const [note1] = await as('authenticated', admin, () => q(`insert into public.dashboard_notes (day, label) values ('2026-10-16', 'Passage radio') returning id, created_by`));
ok('admin adds a note (signed with their account)', note1.created_by === admin);
await throws('admin cannot add a note in someone else\'s name', () => as('authenticated', admin, () => q(`insert into public.dashboard_notes (day, label, created_by) values ('2026-10-16', 'x', '${orga}')`)), /row-level security/);
await throws('empty note rejected', () => as('authenticated', admin, () => q(`insert into public.dashboard_notes (day, label) values ('2026-10-16', '   ')`)), /check/);
await throws('organiser cannot add a note', () => as('authenticated', orga, () => q(`insert into public.dashboard_notes (day, label) values ('2026-10-16', 'x')`)), /row-level security/);
const [note2] = await as('authenticated', admin, () => q(`insert into public.dashboard_notes (day, label) values ('2026-10-17', 'Note admin') returning id`));
await q(`insert into public.dashboard_notes (day, label, created_by) values ('2026-10-15', 'Note d’avant', '${orga}')`); // written before notes became admin-only
ok('admins read every note', (await as('authenticated', admin, () => q(`select * from public.dashboard_notes`))).length === 3);
ok('organiser reads no note', (await as('authenticated', orga, () => q(`select * from public.dashboard_notes`))).length === 0);
ok('organiser cannot delete a note, even their own', (await as('authenticated', orga, () => q(`delete from public.dashboard_notes returning id`))).length === 0);
ok('admin deletes an organiser\'s older note', (await as('authenticated', admin, () => q(`delete from public.dashboard_notes where created_by = '${orga}' returning id`))).length === 1);
await throws('nobody edits a note (delete and add again)', () => as('authenticated', admin, () => q(`update public.dashboard_notes set label = 'Modifiée' where id = ${note1.id}`)), /permission denied/);
await throws('public cannot read notes', () => as('anon', null, () => q(`select * from public.dashboard_notes`)), /permission denied/);
await throws('public cannot add notes', () => as('anon', null, () => q(`insert into public.dashboard_notes (day, label) values ('2026-10-16', 'x')`)), /permission denied/);
ok('admin without the app code reads no notes', (await as('authenticated', admin, () => q(`select * from public.dashboard_notes`), '{}', 'aal1')).length === 0);
ok('admin deletes any note', (await as('authenticated', admin, () => q(`delete from public.dashboard_notes where id = ${note1.id} returning id`))).length === 1);
ok('author deletes their own note', (await as('authenticated', admin, () => q(`delete from public.dashboard_notes where id = ${note2.id} returning id`))).length === 1);

// who created each action: active, disabled, deleted account, created in SQL
await as('authenticated', admin, () => q(`insert into public.invitations (email, display_name) values ('temp@example.com', 'Temp')`));
const temp = (await one(`insert into auth.users (email) values ('temp@example.com') returning id`)).id;
await insertEv(temp, { ...ev, slug: 'action-compte-supprime' });
await q(`delete from auth.users where id = '${temp}'`);
await q(`insert into public.events (slug, title, city, summary, starts_at, ends_at) values ('action-import-sql', 'Action importée', 'Lyon', 'Créée dans l’éditeur SQL.', now() + interval '5 days', now() + interval '5 days 90 minutes')`);
await as('authenticated', admin, () => q(`select public.set_organizer_active('${orga}', false)`));
const creators = Object.fromEntries((await as('authenticated', admin, () => q(`select slug, creator_name, creator_status from public.event_overview()`))).map((r) => [r.slug, r]));
ok('dashboard: creator of a deactivated account', creators['action-test-paris'].creator_status === 'disabled' && creators['action-test-paris'].creator_name === 'Orga Lyon');
ok('dashboard: creator account deleted, action kept', creators['action-compte-supprime']?.creator_status === 'deleted' && creators['action-compte-supprime'].creator_name === null);
ok('dashboard: action created in SQL', creators['action-import-sql']?.creator_status === 'team');
ok('disabled organiser gets no dashboard', (await as('authenticated', orga, () => q(`select * from public.event_overview()`))).length === 0);
ok('disabled organiser gets no attendee list', (await as('authenticated', orga, () => q(`select * from public.attendees('${e1.id}')`))).length === 0);
ok('disabled organiser reads no site counter and no notes', (await as('authenticated', orga, () => q(`select * from public.site_stats`))).length === 0 && (await as('authenticated', orga, () => q(`select * from public.dashboard_notes`))).length === 0);
ok('admin without the app code gets no dashboard', (await as('authenticated', admin, () => q(`select * from public.event_overview()`), '{}', 'aal1')).length === 0);
await as('authenticated', admin, () => q(`select public.set_organizer_active('${orga}', true)`));
await q(`delete from public.events where slug in ('action-compte-supprime', 'action-import-sql')`);

// ---------- reminders ----------
await q(`insert into vault.secrets values ('brevo_api_key', 'xkeysib-test'), ('mail_from', 'contact@example.com')`);
const [tom] = await insertEv(orga, { ...ev, slug: 'action-demain', title: 'Action <demain> & co' }, '1 day');
await q(`update public.events set starts_at = date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris' + interval '1 day 11 hours', ends_at = date_trunc('day', now() at time zone 'Europe/Paris') at time zone 'Europe/Paris' + interval '1 day 12 hours 30 minutes' where id = '${tom.id}'`);
await as('anon', null, () => q(`select public.rsvp('action-demain', 'Léa <b>', 'lea@example.com')`));
await as('anon', null, () => q(`select public.rsvp('action-demain', 'Sans email')`));
const n1 = (await one(`select public.send_reminders() as n`)).n;
const mail = await one(`select body from net.calls where url = 'https://api.brevo.com/v3/smtp/email' order by id desc limit 1`);
ok('reminder sent only to attendees with an email', n1 === 1);
ok('reminder escapes titles in HTML', mail.body.htmlContent.includes('Action &lt;demain&gt; &amp; co'));
ok('reminder never contains the name typed in the public form', !JSON.stringify(mail.body).includes('Léa'));
ok('reminder has the French date', / à 11 h/.test(mail.body.htmlContent));
ok('reminder not sent twice', (await one(`select public.send_reminders() as n`)).n === 0);
const [rep] = await insertEv(orga, { ...ev, slug: 'action-reportee' }, '1 day');
await q(`update public.events set status = 'postponed', starts_at = t.starts_at, ends_at = t.ends_at from public.events t where t.id = '${tom.id}' and public.events.id = '${rep.id}'`);
await as('anon', null, () => q(`select public.rsvp('action-reportee', 'Noé', 'noe@example.com')`));
ok('no reminder for a postponed action (its date is not known yet)', (await one(`select public.send_reminders() as n`)).n === 0);
await throws('public cannot trigger reminders', () => as('anon', null, () => q(`select public.send_reminders()`)), /permission denied/);
await throws('public cannot read secrets', () => as('anon', null, () => q(`select public.secret('github_token')`)), /permission denied/);

// ---------- housekeeping ----------
await as('anon', null, () => q(`select public.rsvp('action-test-paris', 'Old', 'old@example.com')`), JSON.stringify({ 'x-forwarded-for': '192.0.2.9' }));
await q(`update public.events set starts_at = now() - interval '40 days', ends_at = now() - interval '40 days' + interval '90 minutes' where slug = 'action-test-paris'`);
await q(`select public.housekeeping()`);
const hk = await one(`select count(*) filter (where email is not null)::int as emails, count(*) filter (where ip_hash is not null)::int as ips from public.rsvps r join public.events e on e.id = r.event_id where e.slug = 'action-test-paris'`);
ok('housekeeping forgets emails and connection hashes after the action', hk.emails === 0 && hk.ips === 0);
ok('cron jobs scheduled', (await one(`select count(*)::int as n from cron.jobs`)).n === 2);

// ---------- admin delete ----------
await as('authenticated', admin, () => q(`delete from public.events where id = '${past.id}'`));
ok('admin deletes an action', !(await one(`select 1 as x from public.events where id = $1`, [past.id])));

// ---------- campaigns ----------
const UA = JSON.stringify({ 'user-agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148' });
const BOT = JSON.stringify({ 'user-agent': 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)' });
const CODE = /^[23456789abcdefghjkmnpqrstuvwxyz]{6}$/;
const camp = (uid, c, aal) => as('authenticated', uid, () => q(
  `insert into public.campaigns (name, support, dest_event_id, dest_page, fallback_page) values ($1, $2, $3, $4, coalesce($5, 'agenda')) returning *`,
  [c.name, c.support || 'flyer', c.event || null, c.page || null, c.fallback || null]), '{}', aal);
const track = (code, kind, headers = UA, slug = null) => as('anon', null, () => q(`select public.track_campaign($1, $2, $3)`, [code, kind, slug]), headers);
const counts = async (id) => Object.fromEntries((await q(`select * from public.campaign_stats where campaign_id = $1`, [id])).map((r) => [r.channel, r]));

d0 = await dispatches();
const [c1] = await camp(orga, { name: 'Flyers marché Croix-Rousse', event: tom.id });
ok('organiser creates a campaign: two different random codes, signed with their account', CODE.test(c1.code_qr) && CODE.test(c1.code_link) && c1.code_qr !== c1.code_link && c1.created_by === orga);
ok('a new campaign asks GitHub to rebuild (its /c/ pages)', (await dispatches()) === d0 + 1);
const [c2] = await camp(admin, { name: 'Affiches fac', support: 'affiche', page: 'blog/pourquoi-les-crevettes', fallback: 'home' });
await throws('the browser cannot choose the codes', () => as('authenticated', orga, () => q(`insert into public.campaigns (name, support, dest_page, code_qr) values ('Codes', 'flyer', 'home', 'aaaaaa')`)), /permission denied/);
await throws('same name refused (case and spaces ignored)', () => camp(admin, { name: '  FLYERS marché croix-rousse ', page: 'home' }), /duplicate|unique/);
await throws('a campaign needs a destination', () => camp(orga, { name: 'Sans destination' }), /destination/);
await throws('only one destination', () => camp(orga, { name: 'Deux destinations', event: tom.id, page: 'home' }), /destination/);
await throws('a web address is never a destination', () => camp(orga, { name: 'Ailleurs', page: 'https://example.com' }), /check/);
await throws('a web address is never a fallback page', () => camp(orga, { name: 'Ailleurs 2', page: 'home', fallback: '//example.com' }), /check/);
await throws('a past action is not offered as a destination', () => camp(orga, { name: 'Trop tard', event: e1.id }), /destination closed/);
const [cancelled] = await insertEv(orga, { ...ev, slug: 'action-annulee' }, '3 days');
await q(`update public.events set status = 'cancelled' where id = '${cancelled.id}'`);
await throws('a cancelled action is not offered as a destination', () => camp(orga, { name: 'Annulée', event: cancelled.id }), /destination closed/);

// who sees what
await throws('public cannot read campaigns', () => as('anon', null, () => q(`select * from public.campaigns`)), /permission denied/);
await throws('public cannot create campaigns', () => as('anon', null, () => q(`insert into public.campaigns (name, support, dest_page) values ('x', 'flyer', 'home')`)), /permission denied/);
await throws('public cannot read campaign counts', () => as('anon', null, () => q(`select * from public.campaign_stats`)), /permission denied/);
await throws('organiser cannot write campaign counts', () => as('authenticated', orga, () => q(`update public.campaign_stats set visits = 999`)), /permission denied/);
const redirects = await as('anon', null, () => q(`select * from public.campaign_redirects()`));
ok('the build reads codes and destinations, never names', redirects.length === 2 && redirects[0].code_qr === c1.code_qr && !JSON.stringify(redirects).includes('Flyers'));
ok('admin without the app code sees no campaign', (await as('authenticated', admin, () => q(`select * from public.campaign_overview()`), '{}', 'aal1')).length === 0);
await as('authenticated', admin, () => q(`select public.set_organizer_active('${orga}', false)`));
ok('disabled organiser sees no campaign', (await as('authenticated', orga, () => q(`select * from public.campaign_overview()`))).length === 0);
await throws('disabled organiser creates no campaign', () => camp(orga, { name: 'Désactivé', page: 'home' }), /row-level security/);
await as('authenticated', admin, () => q(`select public.set_organizer_active('${orga}', true)`));

// counting (same visit): the code says QR or link
for (const [code, kind, slug] of [[c1.code_qr, 'visit'], [c1.code_qr, 'visit'], [c1.code_link, 'visit'], [c1.code_qr, 'rsvp', 'action-demain'],
  [c1.code_qr, 'rsvp', 'action-test-paris'], [c1.code_link, 'share_click'], [c1.code_link, 'share_done'], [c1.code_qr, 'newsletter'],
  [c1.code_qr, 'bogus'], ['nope42', 'visit'], [null, 'visit'], [c2.code_qr, 'rsvp', 'action-demain']]) await track(code, kind, UA, slug);
await track(c1.code_qr, 'visit', BOT);
await track(c1.code_qr, 'visit', '{}');
const k1 = await counts(c1.id);
ok('scans and clicks are counted apart (bots, no user agent, unknown codes and kinds ignored)', k1.qr.visits === 2 && k1.link.visits === 1);
ok("J'y vais counts only for the destination action", k1.qr.rsvps === 1 && !(await counts(c2.id)).qr);
ok('shares and newsletter count on the channel the visitor came by', k1.link.share_clicks === 1 && k1.link.shares_done === 1 && k1.qr.newsletter === 1 && k1.qr.share_clicks === 0);
await as('anon', null, () => q(`select public.track_campaign($1, 'share_click') from generate_series(1, 501)`, [c2.code_link]), UA);
ok('daily ceiling per code (visitors never blocked)', (await counts(c2.id)).link.share_clicks === 500);

// archive, edit, never delete
await as('authenticated', orga, () => q(`update public.campaigns set archived_at = '2000-01-01' where id = '${c2.id}'`));
const arch = await one(`select archived_at, archived_by from public.campaigns where id = $1`, [c2.id]);
ok('archiving records who and when (not a date sent by the browser)', arch.archived_by === orga && new Date(arch.archived_at).getFullYear() > 2000);
await throws('an archived campaign is never un-archived', () => as('authenticated', admin, () => q(`update public.campaigns set archived_at = null where id = '${c2.id}'`)), /archived/);
await throws('nobody deletes a campaign', () => as('authenticated', admin, () => q(`delete from public.campaigns where id = '${c2.id}'`)), /permission denied/);
await track(c2.code_qr, 'visit');
ok('an archived campaign still counts and still redirects', (await counts(c2.id)).qr.visits === 1 && (await as('anon', null, () => q(`select * from public.campaign_redirects()`))).some((r) => r.code_qr === c2.code_qr));
d0 = await dispatches();
await as('authenticated', orga, () => q(`update public.campaigns set name = 'Flyers Croix-Rousse' where id = '${c1.id}'`));
ok('a rename does not rebuild the site', (await dispatches()) === d0);
await as('authenticated', admin, () => q(`update public.campaigns set fallback_page = 'home' where id = '${c1.id}'`));
ok('a new fallback page rebuilds the site', (await dispatches()) === d0 + 1);
await throws('codes never change (they are printed)', () => as('authenticated', admin, () => q(`update public.campaigns set code_qr = 'zzzzzz' where id = '${c1.id}'`)), /permission denied/);
const [gone] = await insertEv(orga, { ...ev, slug: 'action-supprimee' }, '4 days');
const [c3] = await camp(orga, { name: 'Post Instagram', support: 'instagram', event: gone.id });
await as('authenticated', admin, () => q(`delete from public.events where id = '${gone.id}'`));
ok('deleting an action keeps its campaigns (their links go to the fallback page)', (await one(`select dest_event_id from public.campaigns where id = $1`, [c3.id])).dest_event_id === null);

const co = await as('authenticated', orga, () => q(`select * from public.campaign_overview()`));
const co1 = co.find((r) => r.id === c1.id);
ok('campaign list: newest first, totals per channel, destination action', co.length === 3 && co[0].id === c3.id && co1.visits_qr === 2 && co1.visits_link === 1 && co1.rsvps === 1 && co1.event_slug === 'action-demain' && co1.creator_name === 'Orga Lyon');
const hist = await as('authenticated', orga, () => q(`select * from public.campaign_history('${c1.id}')`));
ok('history: created, then each edit with who and which fields', hist[0].action === 'campaign.create' && hist[0].who === 'Orga Lyon' && hist.some((h) => h.action === 'campaign.update' && h.who === 'Admin' && h.fields.includes('fallback_page')));
ok('history: archived, with who', (await as('authenticated', admin, () => q(`select * from public.campaign_history('${c2.id}')`))).at(-1).action === 'campaign.archive');
ok('public gets no campaign list or history', (await as('anon', null, () => q(`select * from public.campaign_overview()`).catch(() => []))).length === 0 && (await as('anon', null, () => q(`select * from public.campaign_history('${c1.id}')`).catch(() => []))).length === 0);

// ---------- rights per account: every combination ----------
const RIGHTS = ['actions', 'campaigns', 'blog'];
const IMG = () => `${crypto.randomUUID()}.jpg`;
const tried = async (fn) => { try { const r = await fn(); return Array.isArray(r) ? r.length > 0 : true; } catch { return false; } };
const people = [];
for (let m = 1; m < 8; m++) {
  const r = RIGHTS.filter((_, i) => m & (1 << i));
  const email = `droits${m}@example.com`;
  await as('authenticated', admin, () => q(`insert into public.invitations (email, display_name, rights) values ($1, $2, $3)`, [email, `Droits ${m}`, r]));
  people.push({ id: (await one(`insert into auth.users (email) values ($1) returning id`, [email])).id, r, label: r.join('+') });
}
ok('a new account gets the rights ticked on its invitation', (await one(`select rights from public.profiles where id = $1`, [people[6].id])).rights.join() === 'actions,campaigns,blog');
await throws('an invitation needs at least one right', () => as('authenticated', admin, () => q(`insert into public.invitations (email, rights) values ('vide@example.com', '{}')`)), /check/);
await throws('an invitation only gives known rights', () => as('authenticated', admin, () => q(`insert into public.invitations (email, rights) values ('x2@example.com', '{admin}')`)), /check/);
const [fr0] = await as('authenticated', admin, () => q(`insert into public.posts (title) values ('Brouillon témoin') returning id`));
// what each kind of account can do: [label, uid, aal, expected rights]
const accounts = [...people.map((p) => [p.label, p.id, 'aal2', p.r]), ['admin', admin, 'aal2', RIGHTS], ['admin sans code', admin, 'aal1', []]];
const probes = {
  actions: [
    (u, a, i) => as('authenticated', u, () => q(`insert into public.events (slug, title, city, summary, starts_at, ends_at) values ('droits-${i}', 'Titre ok', 'Paris', 'Résumé assez long', now() + interval '9 days', now() + interval '9 days 90 minutes') returning id`), '{}', a),
    (u, a) => as('authenticated', u, () => q(`update public.events set access = 'Métro' where id = '${tom.id}' returning id`), '{}', a),
    (u, a) => as('authenticated', u, () => q(`select * from public.event_overview()`), '{}', a),
    (u, a) => as('authenticated', u, () => q(`select * from public.attendees('${tom.id}')`), '{}', a),
    (u, a) => as('authenticated', u, () => q(`select * from public.event_stats`), '{}', a),
    (u, a) => as('authenticated', u, () => q(`insert into storage.objects (bucket_id, name) values ('posters', 'droits.jpg')`), '{}', a).then(() => [1]),
  ],
  campaigns: [
    (u, a, i) => as('authenticated', u, () => q(`insert into public.campaigns (name, support, dest_page) values ('Droits ${i}', 'flyer', 'home') returning id`), '{}', a),
    (u, a) => as('authenticated', u, () => q(`select * from public.campaigns`), '{}', a),
    (u, a) => as('authenticated', u, () => q(`update public.campaigns set fallback_page = 'agenda' where id = '${c1.id}' returning id`), '{}', a),
    (u, a) => as('authenticated', u, () => q(`select * from public.campaign_overview()`), '{}', a),
    (u, a) => as('authenticated', u, () => q(`select * from public.campaign_history('${c1.id}')`), '{}', a),
    (u, a) => as('authenticated', u, () => q(`select * from public.campaign_stats`), '{}', a),
  ],
  blog: [
    (u, a, i) => as('authenticated', u, () => q(`insert into public.posts (title) values ('Droits ${i}') returning id`), '{}', a),
    (u, a) => as('authenticated', u, () => q(`select * from public.posts`), '{}', a),
    (u, a) => as('authenticated', u, () => q(`update public.posts set summary = 'x' where id = '${fr0.id}' returning id`), '{}', a),
    (u, a) => as('authenticated', u, () => q(`select * from public.post_list()`), '{}', a),
    (u, a) => as('authenticated', u, () => q(`select * from public.post_versions`), '{}', a),
    (u, a) => as('authenticated', u, () => q(`select public.post_preview_create('${fr0.id}')`), '{}', a),
    (u, a) => as('authenticated', u, () => q(`insert into storage.objects (bucket_id, name) values ('blog', '${IMG()}')`), '{}', a).then(() => [1]),
  ],
};
const adminOnly = [
  (u, a) => as('authenticated', u, () => q(`select * from public.site_stats`), '{}', a),
  (u, a) => as('authenticated', u, () => q(`select * from public.dashboard_notes`), '{}', a),
  (u, a) => as('authenticated', u, () => q(`select * from public.rsvps_per_day(366)`), '{}', a),
  (u, a) => as('authenticated', u, () => q(`select * from public.staff_list()`), '{}', a),
  (u, a) => as('authenticated', u, () => q(`select * from public.audit_recent()`), '{}', a),
  (u, a) => as('authenticated', u, () => q(`select public.set_rights('${people[0].id}', '{actions}')`), '{}', a),
];
await as('authenticated', admin, () => q(`insert into public.dashboard_notes (day, label) values ('2026-10-18', 'Témoin')`));
let probe = 0;
for (const [label, uid, aal, has] of accounts) {
  for (const right of RIGHTS) {
    const results = [];
    for (const p of probes[right]) results.push(await tried(() => p(uid, aal, ++probe)));
    const want = has.includes(right);
    ok(`rights [${label}]: ${right} ${want ? 'allowed' : 'refused'} on every table, function and bucket`, results.every((x) => x === want), JSON.stringify(results));
  }
  const dash = [];
  for (const p of adminOnly) dash.push(await tried(() => p(uid, aal)));
  const wantDash = label === 'admin';
  ok(`rights [${label}]: Tableau de bord and Paramètres ${wantDash ? 'allowed' : 'refused'}`, dash.every((x) => x === wantDash), JSON.stringify(dash));
}
await as('authenticated', admin, () => q(`select public.set_organizer_active('${people[6].id}', false)`));
const off = [];
for (const right of RIGHTS) for (const p of probes[right]) off.push(await tried(() => p(people[6].id, 'aal2', ++probe)));
ok('rights [disabled account with every right]: nothing allowed', off.every((x) => !x), JSON.stringify(off));
await as('authenticated', admin, () => q(`select public.set_organizer_active('${people[6].id}', true)`));
const anonTries = [
  await tried(() => as('anon', null, () => q(`select * from public.posts`))),
  await tried(() => as('anon', null, () => q(`insert into public.posts (title) values ('x') returning id`))),
  await tried(() => as('anon', null, () => q(`select * from public.post_versions`))),
  await tried(() => as('anon', null, () => q(`select * from public.post_previews`))),
  await tried(() => as('anon', null, () => q(`select * from public.post_list()`))),
  await tried(() => as('anon', null, () => q(`select public.post_publish('${fr0.id}')`))),
  await tried(() => as('anon', null, () => q(`insert into storage.objects (bucket_id, name) values ('blog', '${IMG()}')`)).then(() => [1])),
  await tried(() => as('anon', null, () => q(`select public.set_rights('${people[0].id}', '{blog}')`))),
];
ok('rights [public]: no blog table, function or upload', anonTries.every((x) => !x), JSON.stringify(anonTries));

// changing rights (admins only, logged)
await as('authenticated', admin, () => q(`select public.set_rights('${people[0].id}', '{blog,actions,blog}')`));
ok('admin changes an account\'s rights (duplicates removed, sorted)', (await one(`select rights from public.profiles where id = $1`, [people[0].id])).rights.join() === 'actions,blog');
await throws('rights cannot be empty (use Désactiver)', () => as('authenticated', admin, () => q(`select public.set_rights('${people[0].id}', '{}')`)), /rights/);
await throws('unknown rights refused', () => as('authenticated', admin, () => q(`select public.set_rights('${people[0].id}', '{actions,admin}')`)), /rights/);
await throws('an admin\'s rights are not changed from the app', () => as('authenticated', admin, () => q(`select public.set_rights('${admin}', '{blog}')`)), /not found/);
await throws('nobody writes rights directly', () => as('authenticated', people[0].id, () => q(`update public.profiles set rights = '{actions,campaigns,blog}' where id = '${people[0].id}'`)), /permission denied/);
await as('authenticated', people[0].id, () => q(`update public.profiles set full_name = 'Droits Un' where id = '${people[0].id}'`));
ok('everyone edits their own full name', (await one(`select full_name from public.profiles where id = $1`, [people[0].id])).full_name === 'Droits Un');
ok('staff list shows the rights', (await as('authenticated', admin, () => q(`select rights from public.staff_list() where id = '${people[1].id}'`)))[0].rights.join() === 'campaigns');

// ---------- blog ----------
await as('authenticated', admin, () => q(`insert into public.invitations (email, display_name, rights) values ('plume@example.com', 'Plume', '{blog}'), ('relecture@example.com', 'Relecture', '{blog}')`));
const writer = (await one(`insert into auth.users (email) values ('plume@example.com') returning id`)).id;
const editor2 = (await one(`insert into auth.users (email) values ('relecture@example.com') returning id`)).id;
await as('authenticated', writer, () => q(`update public.profiles set full_name = 'Plume Martin' where id = '${writer}'`));
const W = (sql, params) => as('authenticated', writer, () => q(sql, params));
const R = (sql, params) => as('authenticated', editor2, () => q(sql, params));
const publishErr = async (fn) => { try { await fn(); return null; } catch (e) { return `${e.message}\n${e.detail || ''}`; } };
const cover = IMG();
const imgA = IMG();
const goodBlocks = JSON.stringify([
  { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Sources', styles: {} }] },
  { type: 'paragraph', content: [{ type: 'text', text: 'Les crevettes ressentent la douleur.', styles: { bold: true } }] },
  { type: 'image', props: { path: imgA, alt: 'Une crevette vivante', credit: '' } },
]);

d0 = await dispatches();
const [p1] = await W(`insert into public.posts (title, slug) values ('Pourquoi un blog ?', 'pourquoi-un-blog') returning *`);
ok('writer creates a draft (signed with their account, Brouillon)', p1.author_id === writer && p1.status === 'brouillon' && p1.lang === 'fr');
ok('creating a draft makes version 1 (who and when)', (await q(`select saved_by from public.post_versions where post_id = $1`, [p1.id]))[0]?.saved_by === writer);
await throws('the browser cannot set a status', () => W(`insert into public.posts (title, status) values ('x', 'publie')`), /permission denied/);
await throws('the browser cannot publish by editing the status', () => W(`update public.posts set status = 'publie' where id = '${p1.id}'`), /permission denied/);
await throws('the browser cannot choose the live version', () => W(`update public.posts set published_version_id = 1 where id = '${p1.id}'`), /permission denied/);
await throws('nobody deletes a post', () => as('authenticated', admin, () => q(`delete from public.posts where id = '${p1.id}'`)), /permission denied/);
await throws('nobody writes versions directly', () => W(`insert into public.post_versions (post_id) values ('${p1.id}')`), /permission denied/);
await throws('bad slug refused', () => W(`update public.posts set slug = 'Pas Bon' where id = '${p1.id}'`), /check/);
await throws('a cover is one of our uploads, never a web address', () => W(`update public.posts set cover_path = 'https://example.com/x.jpg' where id = '${p1.id}'`), /check/);
const [{ updated_at: u1 }] = await W(`update public.posts set summary = 'Un résumé assez long pour passer la règle des cinquante caractères.', category = 'science', blocks = $1 where id = '${p1.id}' returning updated_at`, [goodBlocks]);
const [{ updated_at: u2 }] = await W(`update public.posts set summary = summary where id = '${p1.id}' returning updated_at`);
ok('a save without changes adds no version and keeps the date', u2.getTime() === u1.getTime() && (await q(`select count(*)::int as n from public.post_versions where post_id = $1`, [p1.id]))[0].n === 2);
ok('saving drafts never rebuilds the site', (await dispatches()) === d0);

let err = await publishErr(() => W(`select public.post_publish('${p1.id}')`));
ok('publishing an incomplete post is refused with the list of what is missing',
  /incomplete/.test(err) && /Image de couverture/.test(err) && /Image 1 : crédit photo/.test(err) && !/Image 1 : texte alternatif/.test(err) && !/Catégorie/.test(err), err);
await W(`update public.posts set cover_path = $1, cover_alt = 'Une crevette dans l’eau claire', cover_credit = 'Photo : Test', blocks = $2 where id = '${p1.id}'`,
  [cover, goodBlocks.replace('"credit":""', '"credit":"Photo : Test"')]);
await W(`update public.posts set title = 'Le blog de Lidl ?' where id = '${p1.id}'`);
err = await publishErr(() => W(`select public.post_publish('${p1.id}')`));
ok('a retailer name is refused in the blog (content rule)', /enseigne/.test(err) && /lidl/.test(err), err);
await W(`update public.posts set title = 'Pourquoi un blog ? \u{1F990}' where id = '${p1.id}'`);
ok('the shrimp emoji is refused (content rule)', /emoji crevette/.test(await publishErr(() => W(`select public.post_publish('${p1.id}')`))));
const [{ updated_at: before }] = await W(`update public.posts set title = 'Pourquoi un blog ?' where id = '${p1.id}' returning updated_at`);
await R(`update public.posts set summary = 'Un autre résumé, lui aussi assez long pour passer la règle des cinquante.' where id = '${p1.id}'`);
ok('publishing with a stale copy is refused (someone saved in between)', /conflict/.test(await publishErr(() => W(`select public.post_publish('${p1.id}', $1)`, [before]))));
ok('the stale save itself matches no row (the editor then offers « Enregistrer quand même »)', (await W(`update public.posts set title = 'Vieux' where id = '${p1.id}' and updated_at = $1 returning id`, [before])).length === 0);
await W(`select public.post_publish('${p1.id}')`);
const pub1 = await one(`select status, first_published_at, published_version_id, (select max(id) from public.post_versions where post_id = $1) as latest from public.posts where id = $1`, [p1.id]);
ok('« Publier » puts the latest version live', pub1.status === 'publie' && pub1.first_published_at && pub1.published_version_id === pub1.latest);
ok('publishing rebuilds the site once', (await dispatches()) === d0 + 1);
const live = await as('anon', null, () => q(`select * from public.blog_published()`));
ok('the build reads the live post: content, author label, translation key, no account ID',
  live.length === 1 && live[0].slug === 'pourquoi-un-blog' && live[0].title === 'Pourquoi un blog ?' && live[0].author === 'La Voix des Crevettes'
  && live[0].translation_key === p1.id && !JSON.stringify(live).includes(writer) && live[0].publish_date);

// live post: slug locked, changes wait for « Publier les modifications »
await W(`update public.posts set slug = 'nouveau-lien', title = 'Pourquoi un blog ? (v2)' where id = '${p1.id}'`);
ok('a published post keeps its address', (await one(`select slug from public.posts where id = $1`, [p1.id])).slug === 'pourquoi-un-blog');
ok('saved changes stay off the site until they are published', (await as('anon', null, () => q(`select title from public.blog_published()`)))[0].title === 'Pourquoi un blog ?');
ok('the Blog tab flags unpublished changes', (await W(`select has_changes from public.post_list() where id = '${p1.id}'`))[0].has_changes === true);
d0 = await dispatches();
await W(`select public.post_publish('${p1.id}')`);
ok('« Publier les modifications » puts them live and rebuilds', (await as('anon', null, () => q(`select title from public.blog_published()`)))[0].title === 'Pourquoi un blog ? (v2)' && (await dispatches()) === d0 + 1);

// author shown
await throws('only the author can sign with their own name', () => R(`update public.posts set author_display = 'nom' where id = '${p1.id}'`), /author/);
await W(`update public.posts set author_display = 'nom' where id = '${p1.id}'`);
await W(`select public.post_publish('${p1.id}')`);
ok('the author signs with their full name', (await as('anon', null, () => q(`select author from public.blog_published()`)))[0].author === 'Plume Martin');
await R(`update public.posts set title = 'Relu par une autre personne' where id = '${p1.id}'`);
ok('someone else can edit a signed post without changing the signature', (await one(`select author_display from public.posts where id = $1`, [p1.id])).author_display === 'nom');
await R(`update public.posts set author_display = 'collectif' where id = '${p1.id}'`);
ok('anyone can switch back to « La Voix des Crevettes »', (await one(`select author_display from public.posts where id = $1`, [p1.id])).author_display === 'collectif');

// slugs, English version
await throws('a slug is unique per language', () => R(`insert into public.posts (title, slug) values ('Autre', 'pourquoi-un-blog')`), /duplicate|unique/);
const [en1] = await R(`insert into public.posts (lang, translation_of, title, slug) values ('en', '${p1.id}', 'Why a blog?', 'pourquoi-un-blog') returning *`);
ok('the English version may reuse the slug and links to its French post', en1.lang === 'en' && en1.translation_of === p1.id);
await throws('one English version per French post', () => R(`insert into public.posts (lang, translation_of, title) values ('en', '${p1.id}', 'Again')`), /duplicate|unique/);
await throws('an English post needs its French post', () => R(`insert into public.posts (lang, title) values ('en', 'Alone')`), /check/);
await throws('an English post translates a French post only', () => R(`insert into public.posts (lang, translation_of, title) values ('en', '${en1.id}', 'Of English')`), /translation/);
await R(`update public.posts set summary = 'A summary that is long enough to pass the fifty character rule.', category = 'science', cover_path = $1, cover_alt = 'A shrimp in clear water', cover_credit = 'Photo: Test' where id = '${en1.id}'`, [cover]);
const [p2] = await W(`insert into public.posts (title, slug, summary, category, cover_path, cover_alt, cover_credit) values ('Brouillon FR', 'brouillon-fr', 'Un résumé assez long pour passer la règle des cinquante caractères.', 'campagne', $1, 'Une crevette', 'Photo : Test') returning id`, [cover]);
const [en2] = await W(`insert into public.posts (lang, translation_of, title, slug, summary, category, cover_path, cover_alt, cover_credit) values ('en', '${p2.id}', 'English draft', 'english-draft', 'A summary that is long enough to pass the fifty character rule.', 'campagne', $1, 'A shrimp', 'Photo: Test') returning id`, [cover]);
ok('an English post cannot go live before its French post', /version française/.test(await publishErr(() => W(`select public.post_publish('${en2.id}')`))));
await R(`select public.post_publish('${en1.id}')`);
ok('both languages go live, linked by the French post', (await as('anon', null, () => q(`select lang, translation_key from public.blog_published()`))).filter((r) => r.translation_key === p1.id).length === 2);

// unpublish, restore
d0 = await dispatches();
await R(`select public.post_trash('${p1.id}')`);
const trashed = await q(`select lang, status from public.posts where id in ($1, $2)`, [p1.id, en1.id]);
ok('« Dépublier » moves the French post and its English version to the Corbeille', trashed.every((r) => r.status === 'corbeille'));
ok('unpublished posts leave the site (rebuild, gone from the build data)', (await dispatches()) > d0 && (await as('anon', null, () => q(`select * from public.blog_published()`))).length === 0);
ok('nothing is deleted: the Corbeille keeps everything', (await q(`select count(*)::int as n from public.post_versions where post_id = $1`, [p1.id]))[0].n > 3);
await R(`select public.post_restore('${p1.id}')`);
ok('anyone with Blog rights restores: back to Brouillon, English version left in the Corbeille', (await one(`select status from public.posts where id = $1`, [p1.id])).status === 'brouillon' && (await one(`select status from public.posts where id = $1`, [en1.id])).status === 'corbeille');
await R(`select public.post_trash('${p1.id}')`);
await R(`select public.post_restore('${p1.id}', true)`);
ok('restoring with its translation brings both back as drafts', (await q(`select status from public.posts where id in ($1, $2)`, [p1.id, en1.id])).every((r) => r.status === 'brouillon'));
await R(`select public.post_trash('${p2.id}')`);
await throws('a post in the Corbeille cannot be published', () => R(`select public.post_publish('${p2.id}')`), /trashed/);
await R(`select public.post_restore('${p2.id}')`);

// versions
const hist1 = await W(`select * from public.post_history('${p1.id}')`);
ok('history: every version, newest first, with who saved it', hist1.length > 4 && hist1[0].id > hist1[1].id && hist1.some((h) => h.who === 'Plume') && hist1.some((h) => h.who === 'Relecture'));
const firstV = hist1.at(-1);
const [{ post_restore_version: u3 }] = await W(`select public.post_restore_version(${firstV.id})`);
const after = await W(`select * from public.post_history('${p1.id}')`);
ok('restoring a version makes a new version (nothing lost)', after.length === hist1.length + 1 && after[0].restored_from === firstV.id && after[0].restored_from_at && u3);
ok('the restored content is back, the address stays', (await one(`select title, slug from public.posts where id = $1`, [p1.id])).title === 'Pourquoi un blog ?' && (await one(`select slug from public.posts where id = $1`, [p1.id])).slug === 'pourquoi-un-blog');
ok('restoring with a stale copy is refused', /conflict/.test(await publishErr(() => W(`select public.post_restore_version(${firstV.id}, '2000-01-01')`))));

// preview links
const [{ post_preview_create: tok }] = await W(`select public.post_preview_create('${p2.id}')`);
ok('a preview token is 64 random hex characters', /^[0-9a-f]{64}$/.test(tok));
const pv = await as('anon', null, () => q(`select * from public.blog_preview($1)`, [tok]));
ok('the preview link shows that draft to someone logged out', pv.length === 1 && pv[0].title === 'Brouillon FR' && pv[0].author === 'La Voix des Crevettes' && pv[0].expires_at);
ok('a wrong token shows nothing', (await as('anon', null, () => q(`select * from public.blog_preview($1)`, ['0'.repeat(64)]))).length === 0);
ok('the preview link gives that one post only', !(await as('anon', null, () => q(`select * from public.blog_preview($1)`, [tok]))).some((r) => r.title === 'English draft'));
const [{ post_preview_create: tok2 }] = await W(`select public.post_preview_create('${p2.id}')`);
ok('a new link revokes the old one', (await as('anon', null, () => q(`select * from public.blog_preview($1)`, [tok]))).length === 0 && (await as('anon', null, () => q(`select * from public.blog_preview($1)`, [tok2]))).length === 1);
await q(`update public.post_previews set expires_at = now() - interval '1 minute' where token = $1`, [tok2]);
ok('an expired link shows nothing (7 days)', (await as('anon', null, () => q(`select * from public.blog_preview($1)`, [tok2]))).length === 0);
const [{ post_preview_create: tok3 }] = await W(`select public.post_preview_create('${p2.id}')`);
ok('a link lasts 7 days', (await one(`select expires_at - created_at = interval '7 days' as ok from public.post_previews where token = $1`, [tok3])).ok === true);
await W(`select public.post_preview_revoke('${p2.id}')`);
ok('a revoked link shows nothing', (await as('anon', null, () => q(`select * from public.blog_preview($1)`, [tok3]))).length === 0);
const [{ post_preview_create: tok4 }] = await W(`select public.post_preview_create('${p2.id}')`);
await W(`select public.post_trash('${p2.id}')`);
ok('a post in the Corbeille is not previewable', (await as('anon', null, () => q(`select * from public.blog_preview($1)`, [tok4]))).length === 0);
await throws('the public cannot read the preview links', () => as('anon', null, () => q(`select token from public.post_previews`)), /permission denied/);

// images
ok('Blog rights upload an image with a random name', await tried(() => W(`insert into storage.objects (bucket_id, name) values ('blog', '${IMG()}')`).then(() => [1])));
ok('an upload name that is not ours is refused (no folders, no other types)', !(await tried(() => W(`insert into storage.objects (bucket_id, name) values ('blog', '../x.svg')`).then(() => [1]))));
ok('the image bucket: public, 2 MB, JPEG/PNG/WebP only (no SVG)', (await one(`select public, file_size_limit, allowed_mime_types from storage.buckets where id = 'blog'`)).allowed_mime_types.join() === 'image/jpeg,image/png,image/webp');

// security log for the blog and rights
const blogLog = await as('authenticated', admin, () => q(`select * from public.audit_recent(1000)`));
const logged = (action, target) => blogLog.some((r) => r.action === action && (!target || r.target === target));
ok('log: publish, unpublish, trash, restore, version restore, preview links', ['post.publish', 'post.unpublish', 'post.trash', 'post.restore', 'post.version_restore', 'post.preview', 'post.preview_revoke'].every((a) => logged(a)) && logged('post.unpublish', 'en/pourquoi-un-blog'));
ok('log: rights changed, from → to', blogLog.some((r) => r.action === 'account.rights' && r.target === 'droits1@example.com' && r.detail.from.join() === 'actions' && r.detail.to.join() === 'actions,blog'));
ok('log: invitation with its rights', blogLog.some((r) => r.action === 'invitation.create' && r.target === 'plume@example.com' && r.detail.rights.join() === 'blog'));

// ---------- security log ----------
await as('authenticated', admin, () => q(`select * from public.attendees('${e1.id}')`)); // second look within the hour
await q(`update auth.users set last_sign_in_at = now() where id = '${orga}'`);
const log = await as('authenticated', admin, () => q(`select * from public.audit_recent(1000)`));
const has = (action, target, f = () => true) => log.some((r) => r.action === action && r.target === target && f(r));
ok('log: action created, with who did it', has('action.create', 'action-test-paris', (r) => r.who === 'Orga Lyon'));
ok('log: edited fields are named, their content is not', has('action.update', 'action-test-paris', (r) => r.detail.fields.includes('title') && !JSON.stringify(r.detail).includes('Nouveau titre')));
ok('log: action deleted', has('action.delete', 'action-passee'));
ok('log: organiser deactivated', has('account.role', 'orga@example.com', (r) => r.detail.to === 'disabled'));
ok('log: invitation sent', has('invitation.create', 'orga@example.com'));
ok('log: login', has('login', 'orga@example.com'));
ok('log: admin opened an attendee list (once per hour)', log.filter((r) => r.action === 'attendees.view' && r.target === 'action-test-paris' && r.who === 'Admin').length === 1);
ok('log: organiser opened an attendee list', has('attendees.view', 'action-test-paris', (r) => r.who === 'Orga Lyon'));
ok('log: campaign created, edited (field names only, never the text) and archived',
  has('campaign.create', c1.code_link, (r) => r.who === 'Orga Lyon') && has('campaign.archive', c2.code_link, (r) => r.who === 'Orga Lyon')
  && has('campaign.update', c1.code_link, (r) => r.detail.fields.includes('name') && !JSON.stringify(r.detail).includes('Croix')));
ok('organiser cannot read the log',(await as('authenticated', orga, () => q(`select * from public.audit_recent()`))).length === 0);
ok('admin without the app code cannot read the log', (await as('authenticated', admin, () => q(`select * from public.audit_recent()`), '{}', 'aal1')).length === 0);
await throws('nobody reads the log table directly', () => as('authenticated', admin, () => q(`select * from public.audit_log`)), /permission denied/);
await throws('nobody writes the log directly', () => as('authenticated', admin, () => q(`insert into public.audit_log (action) values ('fake')`)), /permission denied/);
await throws('public cannot write the log', () => as('anon', null, () => q(`select public.audit('fake', 'x')`)), /permission denied/);
await q(`insert into public.audit_log (at, action) values (now() - interval '400 days', 'old')`);
await q(`select public.housekeeping()`);
ok('housekeeping deletes log entries older than a year', !(await one(`select 1 as x from public.audit_log where action = 'old'`)));

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
