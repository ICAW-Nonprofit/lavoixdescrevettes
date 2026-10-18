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
  try { await db.exec(strip(readFileSync(p, 'utf8'))); ok(`migration applies: ${name}`, true); }
  catch (e) { ok(`migration applies: ${name}`, false, e.message); process.exit(1); }
}
// No grants here: the default privileges above already match Supabase, so the migrations' own revokes and grants are what's tested.

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

await as('authenticated', admin, () => q(`insert into public.invitations (email, display_name, city) values ('orga@example.com', 'Orga', 'Lyon')`));
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
ok('organiser gets no attendee list', (await as('authenticated', orga, () => q(`select * from public.attendees('${e1.id}')`))).length === 0);
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
ok('sign-ups per day', (await as('authenticated', orga, () => q(`select * from public.rsvps_per_day(30)`))).reduce((a, r) => a + r.count, 0) === 16);

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

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
