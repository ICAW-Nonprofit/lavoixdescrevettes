# La Voix des Crevettes: guide for anyone changing the code

This is the full description of the site and the rules for changing it without breaking it.
It is written for people and for AI coding agents. **Read all of it before your first change.**
When you change how something works, update this file in the same commit.

---

## 0. The short version

1. **The site is live.** Every push to `main` deploys to GitHub Pages within about 3 minutes, and organisers use `/espace/` every day.
   Work on a branch (`feature/<name>`), push it, let the **Checks** workflow pass, then merge.
2. **Before you push, run:** `npm run test:db`, `npm run build`, `npm run verify`. All three must pass.
3. **Never edit a migration that is already applied** (any file in `supabase/migrations/` that exists on `main`). Add a new file.
4. **Don't change the flyer design** (`src/lib/flyer.js`, `public/flyer/`, `public/fonts/flyer/`) unless the team asks for it.
5. **Content rules** (section 3): shrimp only alive, no shrimp emoji, retailer names only on action pages and the report page, no names of the report's authors, tutoiement.
6. **No secrets in the repo.** It is public: GitHub Actions logs included.
7. **No AI-assistant names** anywhere (files, site, tests, test data, commit messages) and **no co-author lines** in commits.
8. **Every page exists in French and English.** French is the default, at the root. English is under `/en/`. The organiser space is French only.
9. If you're unsure whether a change is safe, stop and ask. Don't guess.
10. **When you finish, list very briefly what to test by hand, with a clickable URL for every changed page** (section 13, "Report back").

---

## 1. What the site is

**La Voix des Crevettes** ("the voice of shrimp") is a grassroots group that organises street actions in France against the cruellest shrimp-farming practices:

- eyestalk ablation of breeding females;
- slaughter in ice slurry.

It runs with the **International Council for Animal Welfare (ICAW)**, which publishes the report *Souffrance en rayon* (October 2026) on French supermarkets.

What the site has to do:

- explain why shrimp matter;
- get people to the next action (map, details, "J'y vais", add to calendar, share with flyer);
- collect newsletter sign-ups (ICAW's Mailchimp);
- give organisers a private space to publish actions.

| | |
|---|---|
| Live prototype | https://nicolas-cozzarin.github.io/lavoixdescrevettes-prototype/ |
| Repo | https://github.com/nicolas-cozzarin/lavoixdescrevettes-prototype (public) |
| Future domain | `lavoixdescrevettes.org` (not connected yet: see section 13) |
| Instagram | https://www.instagram.com/lavoixdescrevettes/ |
| Look | Canva poster style: blue `#9CB3F7`, navy `#00192E`, yellow `#FFC907`, Bricolage Grotesque, riso grain, hard shadows, tape |

---

## 2. Architecture at a glance

```
                ┌──────────── Supabase (Postgres + Auth + Storage, EU) ────────────┐
organisers ───▶ │ events · rsvps · event_stats · profiles · invitations           │
 /espace/       │ RLS + security-definer functions · pg_cron · pg_net · Vault      │
                └───────┬───────────────────────────────┬──────────────────────────┘
                        │ trigger on events → GitHub API │ cron 16:00 UTC → Brevo API
                        ▼ (workflow_dispatch deploy.yml) ▼ (reminder emails)
GitHub Actions ── npm run build ── scripts/snapshot-events.mjs (Supabase → src/content/events.json)
                        │          └─ astro build (static HTML, flyers, .ics, RSS, sitemap)
                        ▼
                 GitHub Pages (static) ◀── visitors: rsvp() and track() via the public REST API
```

- **Astro 7** static site, with no server.
  - Everything is pre-rendered at build time.
  - The only runtime calls go from the browser to Supabase (RSVP, counters, organiser space), Mailchimp (newsletter JSONP), Formspree (contact, once configured), OpenFreeMap (map tiles) and data.geopf.fr (address search in `/espace/`).
- **"Upcoming" is decided at build time.** The deploy workflow therefore also runs **every morning (04:00 UTC)**, so the "next action" rolls over without anyone editing anything.
- **Supabase is optional at build time.**
  - If it can't be reached, the build uses the last committed copy of `src/content/events.json`.
  - If `src/supabase.json` is empty, `/espace/` runs in demo mode and "J'y vais" is hidden.

---

## 3. Content rules (from the team: non-negotiable)

- **Shrimp are only ever shown alive.** No dead shrimp, no dishes, no packaging photos, no jokes about eating them, no shrimp emoji (U+1F990: it looks cooked). Eating shrimp is never presented as fine.
- **Retailers are named only on action pages and on the report page.**
  - "Retailers" means Lidl and the others in `src/lib/report.ts`.
  - "Action pages" means `/agenda/<slug>/` and `/en/events/<slug>/`, including their share text and flyer. The report page is `/rapport-souffrance-en-rayon/` and `/en/report/`.
  - Home, FAQ, blog, resources, about and everything else stay general ("the cruellest practices", "supermarkets").
  - On the home page, actions use the neutral `teaser` title ("Action pour les crevettes à <ville>"), never the action's own title.
  - Press clipping titles (`src/content/press.yaml`) show on the home page, so they must not name retailers either.
- **No names of the report's authors** until the team says otherwise.
- **Brand names stay untranslated** (for example "Google Calendar" on French pages).
- **Every factual claim is sourced** (blog posts have a Sources section; figures cite ICAW or studies).
- **Tone:** tutoiement, short sentences, angry at systems, never at people. Inclusive writing with the middle dot (`prévenu·e`).
- **The flyer design is approved** (17 Oct 2026). Layout, sizes, fonts, colours and background stay as they are, even when the designer's Canva files arrive, unless the team explicitly asks. Technical fixes must leave the output pixel-identical.
- **Logo** (the team's file, Oct 2026):
  - `public/logo.svg` is the full square logo.
  - `public/logo-navy.svg` is used on blue backgrounds (header), and `public/logo-bleu.svg` on navy backgrounds (footer, menu, organiser space).
  - `public/favicon.svg` is the shrimp alone (no lettering), cropped so it fills the navy square and stays readable at 16 px.
    `favicon.ico`, `favicon-32.png`, `apple-touch-icon.png`, `icon-192.png` and `icon-512.png` are rendered from `favicon.svg` (resvg).
    `logo.png` (structured data) stays the full logo.
- **Photo credit:** most action photos are by @come_closer_project (`site.photographer` in `src/config.ts`).
  - Every photo of people shows a small white `@come_closer_project` (`components/PhotoCredit.astro`, inside an element with class `credited`): home hero, About team photo, blog photo covers (post page and cards; drawings get none).
  - The legal notice credits the photographer in FR and EN. A new photo of people gets the overlay too, unless someone else took it.

`npm run verify` checks the shrimp emoji, retailer names in general content files, AI-assistant names and obvious secrets. It can't judge tone or sourcing: you have to.

---

## 4. Directory map

```
astro.config.mjs        site + base path, sitemap filter, Content-Security-Policy (CSP)
src/config.ts           public IDs: Mailchimp, Instagram, photographer, WhatsApp group, Formspree endpoint, GA4 ID (empty = off)
src/supabase.json       public Supabase URL + publishable key (empty = demo mode, no "J'y vais")
src/i18n.ts             routes FR/EN, url() base-path helper, date formatting (Europe/Paris), UI strings
src/content.config.ts   content collections: events (from events.json), blog, faq, resources, press
src/content/            events.json (backup of the DB), blog/{fr,en}/*.md, faq.yaml, resources.yaml, press.yaml
src/lib/                content.ts (getEvents: next/upcoming/past), calendar.ts (Google/Outlook/ICS), endpoints.ts
                        (ics + rss), md.ts (safe mini-markdown), report.ts (report data), flyer.js (+ flyer-render.js)
src/pages/              thin route files (FR at root, EN under en/); each renders a view with lang="fr"|"en"
src/views/              the real page templates, shared by FR and EN
src/components/         Header, Footer, Seo, StickyCta, CookieBanner, EventMap, EventRow, Rsvp, ShareEvent,
                        AddToCalendar, Newsletter, PressClippings, ReportTeaser, ShrimpScene, PhotoCredit, Breadcrumbs, …
src/layouts/            Base.astro (public pages) · Espace.astro (organiser space: noindex, no menu)
src/scripts/            browser JS: site.js (menu, sticky CTA), shrimp.js (live shrimp), map*.js, rsvp.js,
                        share-event.js, newsletter.js, contact.js, consent.js, directions.js, not-found.js
src/scripts/espace/     organiser space SPA: api.js (Supabase or demo), ui.js (DOM helpers), home.js, editor.js,
                        admin.js, address.js, flyer-preview.js
src/styles/             global.css (design system + all public pages), report.css, espace.css
src/assets/             fonts, processed photos (EXIF stripped, logos blurred), brand images (optimised by Astro)
public/                 copied as is: logos/icons, site.webmanifest, flyer/background.jpg, fonts/flyer/*.ttf, posters/
scripts/                snapshot-events.mjs (DB → events.json before build), verify.mjs (safety checks after build)
supabase/migrations/    SQL, applied in filename order by the "Database (Supabase)" workflow
supabase/tests/         db.test.mjs: SQL tests on PGlite with Supabase stand-ins (npm run test:db)
.github/workflows/      deploy.yml, database.yml, db-check.yml, checks.yml
```

There are also local-only files, never in git:

- `PLAN.md`: internal strategy.
- `/assets/`: original photos and the raw brand files.
- Local tool settings folders and the local notes file (listed in `.git/info/exclude`).

A fresh clone doesn't have them, and doesn't need them to build.

---

## 5. Pages and routes

All internal links must go through `url()` (adds the base path) and `route(key, lang)` / `eventPath()` / `postPath()` from `src/i18n.ts`.
**Never hard-code `/lavoixdescrevettes-prototype`** or write a bare `/path` in a link: it breaks when the domain changes, and `npm run verify` flags it.

| Page | French | English | Template |
|---|---|---|---|
| Home | `/` | `/en/` | `views/Home.astro` |
| Agenda (map + list) | `/agenda/` | `/en/events/` | `views/Agenda.astro` |
| Action page | `/agenda/<slug>/` | `/en/events/<slug>/` | `views/EventPage.astro` |
| Action calendar file | `/agenda/<slug>.ics` | `/en/events/<slug>.ics` | `lib/endpoints.ts` |
| All actions calendar | `/agenda.ics` | `/en/events.ics` | `lib/endpoints.ts` |
| Blog | `/blog/`, `/blog/<slug>/` | `/en/blog/`, `/en/blog/<slug>/` | `views/BlogIndex.astro`, `views/Post.astro` |
| Report *Souffrance en rayon* | `/rapport-souffrance-en-rayon/` | `/en/report/` | `views/Report.astro` + `lib/report.ts` + `styles/report.css` |
| Resources + FAQ (`#faq`) | `/ressources/` | `/en/resources/` | `views/Resources.astro` |
| About | `/a-propos/` | `/en/about/` | `views/About.astro` |
| Contact | `/contact/` | `/en/contact/` | `views/Contact.astro` |
| Thank-you (contact / newsletter) | `/merci/`, `/merci-newsletter/` | `/en/thanks/`, `/en/thanks-newsletter/` | `views/Scene.astro` |
| Legal notice / privacy | `/mentions-legales/`, `/confidentialite/` | `/en/legal-notice/`, `/en/privacy/` | `views/Legal.astro` |
| 404 | `/404.html` (GitHub Pages) | `/en/404/` | `views/Scene.astro` + `scripts/not-found.js` |
| RSS | `/rss.xml` | `/en/rss.xml` | `lib/endpoints.ts` |
| Flyer per action | `/flyers/<slug>.jpg` | same | `pages/flyers/[slug].jpg.ts` |
| Organiser space | `/espace/`, `/espace/action/?id=…`, `/espace/admin/` | French only | `layouts/Espace.astro` + `scripts/espace/*` |
| Also | `robots.txt`, `sitemap-index.xml`, `site.webmanifest` | | |

The sitemap leaves out the thank-you pages, the 404 pages and `/espace/` (all marked noindex).
The language switch in the header uses each page's `alternates`. Pages also emit `hreflang` links (see `components/Seo.astro`).

---

## 6. Actions (events): the data flow

1. **Organisers create and edit actions in `/espace/action/`.** Every row change fires the `events_publish` trigger.
2. The trigger calls `request_publish_now()`, which uses pg_net to call the GitHub API and dispatch `deploy.yml` on `main`.
3. **`npm run build` first runs `scripts/snapshot-events.mjs`.** It reads `events` through the public REST API (anon key, public columns only) and overwrites `src/content/events.json`.
4. On non-push runs (cron or dispatch), the deploy workflow commits that file back as **"Backup copy of the actions from Supabase"**. That is why `main` gets bot commits: always `git pull --rebase` before pushing.
5. `src/content.config.ts` maps each DB row (snake_case, FR plus optional `_en`) to the shape the pages use:
   - `{ title: {fr,en}, summary, description, start, end, venue, lat/lng, status: prevu|annule|reporte, … }`
   - English falls back to French when an organiser didn't translate.
6. `getEvents()` in `src/lib/content.ts` returns `upcoming` (not ended, not cancelled), `past` and `next`. The **home page "next action" and the sticky CTA** use `next`.

Rules:

- **Don't hand-edit `src/content/events.json` while Supabase is configured.** The next build overwrites it. Edit in `/espace/` or in the database. (It is the source only if `src/supabase.json` is emptied.)
- A local `npm run build` also rewrites `events.json` with live data. Before committing, restore it (`git checkout -- src/content/events.json`) unless the change is intended. Otherwise you'll fight the bot's backup commits.
- **Actions last 1 h 30** unless told otherwise (`ends_at = starts_at + 1:30`).
- **`share_text` / `share_text_en` must describe that action** (target, demand, date, place, context).
  - It is the body of the "Partager l'action" message. Date, place and links are appended automatically; if it's empty, the text is generated from the summary.
  - Whenever an action's target, demand, date, place or context changes, rewrite both.
- **Organiser text is untrusted.**
  - Render descriptions only through `md()` from `src/lib/md.ts`: it escapes everything and allows only http(s), mailto and relative links.
  - JSON-LD escapes `<`.
  - In `/espace/`, always build DOM with `el()` and `fill()` from `scripts/espace/ui.js`, never `innerHTML`.

### Adding a field to actions (the full chain: miss one and something silently breaks)

1. **New migration** `supabase/migrations/<YYYYMMDDHHMMSS>_<name>.sql`.
   - `alter table public.events add column … check (…)`.
   - Then **`grant select (<new column>) on public.events to anon;`** if it's public. Anon has column-level grants only.
2. `supabase/tests/db.test.mjs`: the test setup repeats the anon column grant list, so add the column there too. Add tests for any new rule.
3. `scripts/snapshot-events.mjs`: add it to `COLUMNS`.
4. `src/content.config.ts`: map it in the loader and add it to the zod schema (optional unless every row has it).
5. `src/scripts/espace/editor.js` (form field) and `api.js` (demo data, if the demo should show it).
6. Use it in the views, in both languages.
7. If it changes what the action says, check `share_text` (rule above).

---

## 7. Organiser space (`/espace/`)

- It's a small single-page app in plain JS (`src/scripts/espace/`), mounted into `#app` by `layouts/Espace.astro`.
- It is French only, `noindex`, and has no site menu.
- **Login:** Supabase magic link (implicit flow), only for invited emails.
  - The `before_auth_user_created` trigger refuses non-invited addresses.
  - Emails go out through Brevo SMTP.
- **Roles** (`profiles.role`):
  - `admin`: everything, plus attendees' names and emails, organiser management and deleting actions.
  - `organizer`: create and edit **any** action, see counts only.
  - `disabled`: no access.
  - The public reads actions and can only call `rsvp()` and `track()`.
- **Pages:**
  - `/espace/` (`home.js`): login, profile, list of actions with counters ("J'y vais", views, shares, newsletter, calendar).
  - `/espace/action/?id=` (`editor.js`): create or edit, address search (`address.js`, Géoplateforme), live flyer preview (`flyer-preview.js`, same template as the build), custom flyer upload to the `posters` bucket.
  - `/espace/admin/` (`admin.js`): dashboard, sign-ups per day chart, invitations, activate or deactivate organisers.
- **Demo mode** (`/espace/?demo`, or automatically when `src/supabase.json` is empty): in-memory data in `sessionStorage`, nothing sent anywhere. Use it to test UI changes without touching real data. `?nodemo` leaves it.
- A new action's public page exists only after the rebuild (2–3 min). `pageLink()` shows "Publication en cours…" and polls until the page answers.
- All backend calls go through `api` in `api.js`, which has both a real and a demo implementation. **Add every new call to both.**

---

## 8. Database (Supabase)

Project URL `https://ifhsohgisjbnuxljsesj.supabase.co`. The publishable key is in `src/supabase.json`: public by design, since the database rules are what protect the data.

**Tables:**

| Table | What it holds | Who can access |
|---|---|---|
| `invitations` | who may create an account | admins only |
| `profiles` | one per user: `role`, `display_name`, `city` | users read their own, admins read all; users edit only `display_name` and `city` |
| `events` | the actions | everyone reads the public columns; staff insert and update; admins delete |
| `rsvps` | name, optional email, ip_hash, reminder_sent_at | admins only; the public writes through `rsvp()` |
| `event_stats` | daily counters: views, shares, newsletter, calendar | staff read; the public writes through `track()` |

**Functions:** `my_role`, `is_staff`, `is_admin`, `rsvp`, `rsvp_public_count`, `attendees`, `track`, `event_overview`, `rsvps_per_day`, `staff_list`, `set_organizer_active`, `publish_now`, `send_reminders`, `housekeeping`, `secret`, `request_publish_now`.

- They are `security definer` with `set search_path = public`.
- `execute` is revoked from `public` and granted only to the roles that need it. **Do the same for every new function.**

**`rsvp()` rules:**

- Rate-limited: 5 sign-ups per hour per connection hash per action, 120 per hour per action.
- The same email updates the existing sign-up instead of counting twice.
- The public count is shown from 10 people up.

**Cron jobs (pg_cron):**

- `lvdc-reminders` at 16:00 UTC (about 17–18 h in Paris): Brevo emails to the next day's attendees who left an email.
- `lvdc-housekeeping` at 03:30 UTC: forgets connection hashes after an action, and attendees' emails 30 days after it.

**Vault secrets** (never in the repo): `github_token`, `brevo_api_key`, `mail_from`. Optional: `mail_from_name`, `site_url`, `github_repo`.

**Storage:** public bucket `posters` (5 MB, jpeg/png/webp). Staff upload; the build fetches only from that bucket.

**Migrations:**

- One new file per change, named so it sorts last.
- Never edit or rename an applied one.
- The **Database (Supabase)** workflow runs the SQL tests on every push to `main` that touches `supabase/**`, then applies files not yet listed in `public._lvdc_migrations`.
- Write migrations that are safe to apply on the live data, and think about existing rows (defaults, nullable columns).
- **Tests:** `npm run test:db` runs every migration on PGlite with stand-ins for auth, storage, vault, pg_net and pg_cron, then checks the access rules. Keep it passing, and add tests for every new rule.
- **db-check.yml** (run by hand) prints counts and settings only, **never names, emails or IDs**: the logs of a public repo are public.

---

## 9. Front-end features (where each one lives)

- **Live shrimp** (`scripts/shrimp.js` + `components/ShrimpScene.astro`):
  - A hand-drawn-looking shrimp on a 2D canvas, no dependencies. Eye and antennae follow the cursor (and wander on touch or when idle); legs and swimmerets move.
  - Used in the home hero and on the 404 and thank-you pages.
  - Respects `prefers-reduced-motion`. It's the team's favourite part: don't degrade it.
- **Map** (`components/EventMap.astro`, `scripts/map.js` → `map-impl.js`):
  - MapLibre 6 with OpenFreeMap tiles, recoloured in the brand palette, yellow pins, popups with "add to calendar" and directions.
  - Loaded lazily near the viewport.
  - The worker is bundled via `?url` + `setWorkerUrl` (needed for the CSP).
  - Opens on the Paris area (`PARIS_AREA`); the event page mini-map uses zoom 12.
- **Directions** (`scripts/directions.js`): Android → app chooser, iPhone → Apple Plans, computer → Google Maps.
- **"J'y vais"** (`components/Rsvp.astro`, `scripts/rsvp.js`):
  - Plain `fetch` to the Supabase REST API.
  - The publishable key goes in the `apikey` header, and as a Bearer token only if it starts with `eyJ`.
  - Also sends the anonymous counters through `track()`: a view once per session, share, calendar and newsletter.
  - Hidden when Supabase isn't configured.
- **Share the action** (`components/ShareEvent.astro`, `scripts/share-event.js`):
  - Native share sheet with the flyer file and text on phones.
  - A panel on computers: WhatsApp, Signal, Telegram, email, copy, download.
  - The flyer is prefetched on idle.
- **Add to calendar** (`components/AddToCalendar.astro`, `lib/calendar.ts`): Google Calendar, Outlook.com and an `.ics` file (works for Apple and Outlook). There's also a `webcal:` subscription to the whole agenda.
- **Newsletter** (`components/Newsletter.astro`, `scripts/newsletter.js`):
  - Posts to ICAW's Mailchimp audience with JSONP, then goes to `/merci-newsletter/`.
  - Field values must match Mailchimp exactly (`site.newsletter.choices`).
  - Without JS, the form posts directly to Mailchimp.
- **Contact** (`views/Contact.astro`, `scripts/contact.js`): Formspree-compatible. While `site.contactEndpoint` is empty, it simulates sending and goes to `/merci/` (preview mode).
- **Cookies and analytics** (`components/CookieBanner.astro`, `scripts/consent.js`):
  - GA4 loads only after an explicit yes (CNIL); refusing is as easy as accepting.
  - With `site.gaId` empty there's no banner and no cookies, just an honest note from the footer link.
- **Sticky mobile CTA and expired "next action"** (`scripts/site.js`): once the next action has ended (between daily rebuilds), the ticket hides itself on the client.
- **SEO** (`components/Seo.astro`):
  - Title, description, canonical, hreflang, Open Graph and Twitter tags. Action pages use their flyer as the share image.
  - JSON-LD: NGO (with logo) on the home page, `Event` on action pages, `BlogPosting` on posts, `BreadcrumbList` everywhere (from `crumbs`).
  - Also a sitemap and RSS.

---

## 10. Security and privacy (must stay true)

- **CSP** in `astro.config.mjs`. Astro adds SHA-256 hashes for its own inline scripts and styles.
  - **No `'unsafe-inline'`** for scripts.
  - `'wasm-unsafe-eval'` exists only for the flyer preview (satori WebAssembly) in `/espace/`.
  - A new external service (script, image, API, font, form target) needs its domain added to the right directive. Add only that domain, and say why in a comment.
  - After any change, open the pages in a browser and check the console for CSP errors.
- **Inline `<script>` in `.astro`** files is bundled by Astro (fine). Avoid `is:inline` scripts: they need their own hash handling.
- **No secrets in the repo or in logs.**
  - Only public IDs go in `src/config.ts` and `src/supabase.json`.
  - Secrets live in GitHub Actions secrets (`SUPABASE_DB_URL`) and Supabase Vault.
  - Never print personal data or IDs in a workflow.
- **Photos:** originals stay in `/assets/` (ignored). Only processed copies are published: EXIF/GPS stripped, Lidl logos lightly blurred.
- **Personal data** is minimal and deleted automatically (section 8). Organisers never see attendees' names or emails; only admins do.
- **Test data:** use neutral names ("Test", "Camille"), never real people. Don't leave test actions or sign-ups in the live database.

---

## 11. Design system

- **Tokens** are at the top of `src/styles/global.css`:
  - colours: `--bleu`, `--bleu-pale`, `--marine`, `--jaune`, `--blanc`;
  - `--border`, `--shadow`, `--grain`, `--gutter`, `--max`, `--header-h`.
  - Reuse them; don't add new colours.
- **Fonts:** Bricolage Grotesque, a self-hosted variable font (`src/assets/fonts/`). Headlines are condensed and uppercase. The flyer uses static condensed cuts in `public/fonts/flyer/`.
- **Layout:** check every change at 375 px (phone), 768 px and desktop. No horizontal scroll, and tap targets of at least 44 px.
- **Accessibility:**
  - There's a skip link.
  - Keep visible focus, sufficient contrast (navy on blue / yellow, or blue on navy) and `alt` text (FR and EN).
  - The canvas shrimp is `aria-hidden`.
  - `[hidden]` is forced to `display:none!important`. Use it to hide things.
- **Styles:** `global.css` holds all public pages, `report.css` the report page, and `espace.css` the organiser space.

---

## 12. Workflows (GitHub Actions)

| Workflow | When | What it does |
|---|---|---|
| `deploy.yml` (Deploy to GitHub Pages) | push to `main`, daily 04:00 UTC, dispatch from Supabase | Builds with Node 24 (`withastro/action`) and deploys. On non-push runs it commits `events.json` as a backup. A burst of saves queues at most one extra build. |
| `database.yml` (Database (Supabase)) | push to `main` touching `supabase/**`, or manual | `npm run test:db`, then applies new migrations with `psql` (needs the `SUPABASE_DB_URL` secret) |
| `db-check.yml` (Database check) | manual | Counts and access-rule sanity checks on the live DB (no personal data) |
| `checks.yml` (Checks) | push to any branch, pull requests, manual | `npm run test:db`, `npm run build`, `npm run verify`. Deploys nothing and uses no secret. |

Supabase dispatches `deploy.yml` on **`main`**: organiser saves always publish what is on `main`. A broken `main` means organisers can't publish, which is why changes go through a branch and the Checks workflow first.

---

## 13. Working safely: the procedure

### Set up

```bash
git clone https://github.com/nicolas-cozzarin/lavoixdescrevettes-prototype.git
cd lavoixdescrevettes-prototype
npm ci
git switch -c feature/<short-name>
```

- You need Node.js 22+ (CI uses 24).
- On the team's Windows machine, Node may be installed per user in `%LOCALAPPDATA%\Programs\node-lts\`, not on `PATH`. Call it as `"$LOCALAPPDATA/Programs/node-lts/node.exe" node_modules/astro/bin/astro.mjs build`.
- **Windows quirk:** if the folder is reached through a virtualised path (an app's sandbox under `AppData\Roaming`), Vite resolves the real path and the built pages come out **without CSS**. Build from the folder's real location instead. `npm run verify` catches this (pages without a stylesheet). CI isn't affected.

### Before you change anything

- Read the files you'll touch, and the views and components that use them (grep for imports).
- Check whether the change affects both languages, the organiser space, the database or the flyer.

### Verify (all must pass before pushing)

```bash
npm run test:db     # SQL tests (only matters if supabase/ changed, but it's quick)
npm run build       # also refreshes src/content/events.json from Supabase
npm run verify      # safety checks on the source and on dist/
git checkout -- src/content/events.json   # unless you meant to change it
```

`npm run verify` fails on:

- a missing page, in FR or EN;
- a missing action page, flyer or `.ics` for any action;
- broken internal links (`href`/`src`), or links that skip the base path;
- pages without `lang`, `<title>`, stylesheet, favicon or CSP meta;
- `'unsafe-inline'` scripts;
- organiser pages that aren't `noindex`, or noindex pages listed in the sitemap;
- a web manifest that doesn't match the base path;
- the shrimp emoji, AI-assistant names, retailer names in general content files, secret-looking strings;
- edits to migrations that already exist on `origin/main`.

It **warns** when flyer design files differ from `origin/main`, and when an action doesn't last 1 h 30.

### Look at it

For any visible change, run `npm run preview` (or `npm run dev`) and check in a browser:

- FR and EN;
- 375 px and desktop;
- keyboard navigation;
- no console errors, in particular CSP violations;
- the live shrimp still follows the cursor;
- the map loads;
- `/espace/?demo` still works if you touched shared CSS or `src/scripts/espace/`.

### Ship

- Commit with a plain, descriptive message: no co-author lines, no AI-assistant names.
- `git push -u origin feature/<short-name>` and wait for the **Checks** workflow to pass.
- Open a pull request (or merge if the team agreed).
- After merging, watch the **Deploy to GitHub Pages** run.
- If `supabase/**` changed, also watch the **Database (Supabase)** run. Then check the live page.
- `main` receives bot commits (backups), so always `git pull --rebase` before pushing.
- Never force-push `main`.

### Report back

Every time you finish a change, end your report with a short **"To test by hand"** list:

- One line per thing to check: what to do and what should happen. Keep it to the essentials.
- Give the full clickable URL of every page the change touched, in FR and EN (e.g. `https://nicolas-cozzarin.github.io/lavoixdescrevettes-prototype/en/report/`).
  - Use the live URL once it's merged and deployed. Before that, give the local preview URL (`http://localhost:4321/lavoixdescrevettes-prototype/…`).
- Say which width to check (phone, desktop or both).

---

## 14. Recipes

**Add a public page**

1. Add the route key to `routes` in `src/i18n.ts` (FR and EN paths).
2. Create `src/views/<Name>.astro`, taking `lang`.
3. Add two thin files in `src/pages/` (FR at the root, EN under `en/`) that render the view.
4. Pass `alternates={alternatesFor('<key>')}` and `crumbs` to `Base`.
5. Add it to the header nav (`ui.*.nav` + `Header.astro`) and/or the footer if needed.
6. If it shouldn't be indexed: pass `noindex` (this also drops the canonical link) and exclude it in the sitemap `filter` in `astro.config.mjs`.
7. `npm run verify` picks up every route in `src/i18n.ts` automatically. Pages outside `routes` go in `REQUIRED` in `scripts/verify.mjs`.

**Add a blog post**

- Add `src/content/blog/fr/<slug>.md` and `src/content/blog/en/<slug>.md` with the same `translationKey`.
- Front matter: `title` (≤ 80 chars), `description` (50–170), `lang`, `date`, `category`, `cover` (an image in `src/assets/`, processed), `coverAlt`, optional `coverStyle: drawing`, `draft`.
- End with a Sources section.
- No retailer names.

**Add a FAQ entry, resource or press clipping:** edit `src/content/faq.yaml`, `resources.yaml` or `press.yaml`. The schemas are in `src/content.config.ts`. Both languages are needed where the schema asks for `{fr, en}`.

**Change the report figures:** `src/lib/report.ts`. That data is the only place, along with the report view, where retailer names live.

**Turn on WhatsApp, contact form or analytics:** fill `whatsappGroup`, `contactEndpoint` or `gaId` in `src/config.ts`. All are public IDs. Formspree and GA domains are already in the CSP.

**Add an external service:** add its domain to the CSP (section 10) and to the privacy page (`views/Legal.astro`, FR and EN) if it receives visitors' data.

**Database change:** follow section 8 (new migration, grants, tests). For an action field, follow the chain in section 6.

**When the real domain arrives:**

1. `astro.config.mjs`: set `site` to `https://lavoixdescrevettes.org` and remove `base`.
2. `public/site.webmanifest`: set `start_url` and `scope` to `/`.
3. Supabase → Authentication → URL Configuration: replace the GitHub Pages URLs with `https://lavoixdescrevettes.org/espace/`.
4. Supabase SQL: `select vault.create_secret('https://lavoixdescrevettes.org', 'site_url');` (links in reminder emails).
5. Brevo: authenticate the domain (DKIM, DMARC) and switch the sender (`mail_from` and the Supabase SMTP settings).
6. GitHub Pages: custom domain + HTTPS.
7. Update the URLs in `README.md`, `SETUP.md` and this file.
8. `npm run verify` checks the base path and the manifest.

---

## 15. Known gotchas

- **The base path** (`/lavoixdescrevettes-prototype`) is everywhere at runtime. Use `url()` in Astro, and `BASE` / `link()` in `/espace/` scripts.
- **trailingSlash: 'always'**: page links end with `/`, file links don't (`.ics`, `.jpg`, `.xml`).
- **`[hidden]` vs `display` rules:** it's already forced globally; don't fight it.
- **`replaceChildren` with `cond && el()`** prints "false". Use `fill()` in `/espace/`.
- **IntersectionObserver on a `display: contents` element** never fires. Observe a real box.
- **Flyer paths in the build** use `process.cwd()` (bundling moves files into `dist/.prerender/`). One broken flyer falls back to the plain background, so a publish never fails because of it.
- **MapLibre:** use `import * as maplibregl`, and set the worker URL.
- **Migration order:** a function that reads a table must be created after the table. PGlite catches this.
- **The build warns about Shiki and the CSP.** That's harmless today. It means fenced code blocks in Markdown would be highlighted with inline styles the CSP blocks, so don't put code blocks in blog posts.
- **Expected build warning:** the chunk-size warning (MapLibre and the flyer renderer are big, and both are lazy-loaded).
- **GitHub Pages serves one 404 page (French).** `not-found.js` sends `/en/…` misses to the English 404.
- **Supabase free tier** pauses after a week without activity. The daily build keeps it awake.
- **The GitHub token** used for publishing expires after a year. See SETUP.md to renew it.

---

## 16. Not done yet / placeholders

- `src/config.ts`: `whatsappGroup`, `contactEndpoint` (Formspree) and `gaId` are empty, and their features show fallbacks.
- `views/Legal.astro`: items marked `[à compléter]` need the team's legal details.
- The domain isn't connected yet (section 14).
- Idea not built: the live shrimp as a standalone, reusable component (a web component). Only do it if asked.
