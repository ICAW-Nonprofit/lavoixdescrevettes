# Setting up the organiser space (about 20 minutes)

The organiser space (`/espace/`), "J'y vais", reminder emails and automatic publishing need three free accounts:
**Supabase** (database and logins), **Brevo** (emails) and a **GitHub token** (so a saved action republishes the site).
Until this is done, `/espace/` runs in demo mode and the site works as before.

> **Never paste a password, secret key or token into a chat or a file in this repo.**
> They only go into the Supabase and GitHub settings pages, as described below.
> The only values you can share freely are the Supabase **Project URL** and **publishable (anon) key**: they are public by design.

## 1. Create the Supabase project

1. Go to [supabase.com](https://supabase.com) → **Start your project** (signing in with GitHub is fine).
2. **New project**: name `lavoixdescrevettes`, region **West EU (Paris)**, and a strong database password (keep it in a password manager).
3. When the project is ready, open **Project Settings → API Keys** (or the **Connect** button) and copy:
   - the **Project URL** (`https://xxxx.supabase.co`)
   - the **publishable key** (`sb_publishable_…`), or the legacy **anon public** key (`eyJ…`)

   → These two values go into `src/supabase.json`.

## 2. Let GitHub update the database

1. In Supabase, click **Connect** (top of the project page) → **ORMs** tab (or **Session pooler**). Copy the line labelled **DIRECT_URL** / "session-mode pooler, used for migrations": the one with **port 5432**, not 6543.
   It looks like `postgresql://postgres.xxxx:[YOUR-PASSWORD]@aws-0-eu-west-1.pooler.supabase.com:5432/postgres`.
   Copy only what's between the quotes, and replace `[YOUR-PASSWORD]` (brackets included) with your database password.
   - If the password contains symbols like `@ : / ? # & %`, the address breaks. Simplest fix: **Project Settings → Database → Reset database password**, click **Generate a password** until it has only letters and digits, save it in your password manager, and use that one.
2. On GitHub: the repo → **Settings → Secrets and variables → Actions → New repository secret**
   (direct link: `https://github.com/<owner>/<repo>/settings/secrets/actions/new`).
   Name: `SUPABASE_DB_URL`. Value: the address from step 1. **Add secret**.

→ Then run the **Database (Supabase)** workflow (GitHub → Actions → Database (Supabase) → Run workflow): it creates the database tables.

## 3. Brevo (emails)

1. Create a free account on [brevo.com](https://www.brevo.com) (300 emails a day).
2. **Senders, domains & IPs → Senders → Add a sender**: the address emails will come from, then click the confirmation link Brevo sends you.
   Until the real domain exists, your own email address is fine for testing. With the domain, use e.g. `contact@lavoixdescrevettes.org` and authenticate the domain (DKIM) so emails don't land in spam.
3. **SMTP & API**:
   - **SMTP** tab: note the **login** (`xxxx@smtp-brevo.com`) and click **Generate a new SMTP key**. Keep it for step 4.
   - **API Keys** tab: **Generate a new API key**, named `supabase-reminders`. Keep it for step 6.

## 4. Supabase login settings

In Supabase → **Authentication**:

1. **URL Configuration**
   - Site URL: `https://icaw-nonprofit.github.io/lavoixdescrevettes/espace/`
   - Redirect URLs, add: `https://icaw-nonprofit.github.io/lavoixdescrevettes/espace/` and `http://localhost:4321/lavoixdescrevettes/espace/`
2. **Sign In / Providers → Email**: enabled. Leave **Allow new users to sign up** ON: only emails invited from the admin page can actually create an account (the database refuses the others).
3. **Emails → SMTP Settings** → enable custom SMTP:
   - Sender email: the address verified in Brevo · Sender name: `La Voix des Crevettes`
   - Host: `smtp-relay.brevo.com` · Port: `587`
   - Username: the Brevo SMTP login · Password: the Brevo SMTP key
4. **Emails → Templates** (in the left menu: Authentication → **Emails**, then the **Templates** tab). Open **Confirm signup**, replace the subject and the message body with the text below and **Save**; then do the same for **Magic Link**. ("Confirm signup" is what a new organiser receives the very first time; "Magic Link" is every login after that.)
   - Subject: `Ton lien de connexion · La Voix des Crevettes`
   - Body:
     ```html
     <p>Salut !</p>
     <p>Voici ton lien pour entrer dans l'espace organisation de La Voix des Crevettes :</p>
     <p><a href="{{ .ConfirmationURL }}">Me connecter</a></p>
     <p>Il est valable une heure. Si tu n'as rien demandé, ignore simplement cet email.</p>
     ```

## 5. GitHub token for automatic publishing

1. GitHub → your avatar → **Settings → Developer settings → Personal access tokens → Fine-grained tokens → Generate new token**.
2. Name `lvdc-publish`, expiration **1 year** (put a reminder in your calendar to renew it).
3. **Repository access → Only select repositories** → `lavoixdescrevettes`.
4. **Permissions → Repository permissions → Actions: Read and write**. Nothing else.
5. **Generate token** and copy it (it's shown only once). Keep it for step 6.

## 6. Store the secrets in Supabase (once the tables exist)

Only once the **Database (Supabase)** workflow has run successfully (otherwise you get "relation public.invitations does not exist").
Supabase → **SQL Editor → New query**. Paste this, replace the five `<…>` values, and click **Run**. It's safe to run again if something went wrong.

```sql
delete from vault.secrets where name in ('github_token', 'brevo_api_key', 'mail_from');
select vault.create_secret('<GITHUB TOKEN FROM STEP 5>', 'github_token');
select vault.create_secret('<BREVO API KEY FROM STEP 3, starts with xkeysib->', 'brevo_api_key');
select vault.create_secret('<SENDER EMAIL VERIFIED IN BREVO>', 'mail_from');
insert into public.invitations (email, role, display_name) values ('<YOUR EMAIL>', 'admin', '<YOUR NAME>')
on conflict (email) do update set role = 'admin';
```

The secrets are stored encrypted in Supabase Vault; the query history may keep the text, so you can delete the query afterwards.

## 7. First login

Open `https://icaw-nonprofit.github.io/lavoixdescrevettes/espace/`, enter your email, and click the link you receive.
You're the admin. The first time, the space asks you to set up **two-factor login** (see below); then invite organisers from **Tableau de bord**.

## 8. Two-factor login for admins

Admins see attendees' names and emails, so their login needs two things: the email link, then a 6-digit code from an authenticator app (Google Authenticator, Microsoft Authenticator, 2FAS, Aegis…). The database refuses admin rights to a session without the code. Organisers only use the email link.

- **Supabase setting**: Authentication → **Multi-Factor** → **TOTP (App Authenticator)** must be **Enabled** (it is by default).
- **Set-up**: at the first login after this change, the space shows a QR code to scan, then asks for the code. After that it asks for the code at each new login.
- **Why not a code by email?** The login link already arrives by email. A second code in the same inbox would not protect anything if that inbox were hacked; a phone app does.
- **Lost or changed phone**: in Supabase → **SQL Editor**, run the line below (with the admin's email). At the next login, the space shows a new QR code.

  ```sql
  delete from auth.mfa_factors where user_id = (select id from auth.users where email = '<ADMIN EMAIL>');
  ```

---

## Good to know

- **Publishing**: every save asks GitHub to rebuild the site, which goes live in 2 to 3 minutes. The **Actions** tab on GitHub shows the builds.
- **Backups**: every build copies the actions into `src/content/events.json` in the repo. If Supabase is ever down, the site still builds from that copy.
- **Sleeping**: free Supabase projects pause after a week without activity. The daily rebuild (every morning) keeps it awake.
- **Reminders**: sent every day around 17–18 h (Paris) to attendees of the next day's actions who left an email.
- **Privacy**: attendees' emails are deleted 30 days after the action; organisers see attendees' first names (list and CSV), never their emails; only admins see emails.
- **The token expires** after a year: generate a new one (step 5) and run `select vault.update_secret((select id from vault.secrets where name = 'github_token'), '<NEW TOKEN>');`.

### Where to see the logs

| What | Where | Kept |
|---|---|---|
| Who did what in the organiser space: logins, actions created / edited / deleted, accounts (de)activated, invitations, attendee lists opened | `/espace/admin/` → **Journal de sécurité** (admins only). Full table: Supabase → **Table Editor** → `audit_log` | 1 year |
| Every login attempt, failed ones and rate-limit blocks included | Supabase → **Logs & Analytics** → **Auth** | 1 day (free plan) |
| Every request to the database API, blocked ones included | Supabase → **Logs & Analytics** → **API Gateway** / **Postgres** | 1 day (free plan) |
| Reminder and login emails sent | Brevo → **Transactional → Logs** | Brevo's plan |
| Site builds, migrations, daily database check | GitHub → **Actions**. The daily **Database check** fails, and GitHub emails you, when a reminder email or publish request failed. It also prints how many log entries of each kind the last 7 days had. | 90 days |

### When the real domain arrives

1. `astro.config.mjs`: set `site` to `https://lavoixdescrevettes.org` and remove `base`.
2. Supabase → URL Configuration: replace the GitHub Pages URLs with `https://lavoixdescrevettes.org/espace/`.
3. Supabase SQL: `select vault.create_secret('https://lavoixdescrevettes.org', 'site_url');` (links in reminder emails).
4. Brevo: authenticate the domain (DKIM, DMARC) and switch the sender (Supabase SMTP settings and `mail_from`).

### Something doesn't work?

- **No login email**: check spam, then Brevo → **Transactional → Logs**. "Adresse non invitée" means the email isn't in the invitations.
- **A save doesn't show on the site**: GitHub → **Actions** tab. If no build started, the token may have expired (see above).
- **Database changes**: new files in `supabase/migrations/` are tested and applied by the **Database (Supabase)** workflow on push.
