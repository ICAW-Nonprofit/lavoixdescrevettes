// Safety checks, run after `npm run build`: npm run verify
// 1. Source: the team's content rules, secrets, migrations that must never change, action data.
// 2. Built site (dist/): every page and action exists in FR and EN, internal links work, each page has
//    its language, title, stylesheet, favicon and Content-Security-Policy, noindex pages stay out of the sitemap…
// Problems fail the run (exit 1); warnings don't. Used locally before pushing and by the "Checks" workflow.
// What each rule protects is explained in AGENTS.md.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execSync } from 'node:child_process';
import { md } from '../src/lib/md.ts';
import * as calc from '../src/scripts/espace/calc.js';

const root = fileURLToPath(new URL('..', import.meta.url));
const read = (p) => readFileSync(join(root, p), 'utf8');
const problems = [];
const warnings = [];
const fail = (m) => problems.push(m);
const warn = (m) => warnings.push(m);

// site + base path, as configured for the build (works before and after the domain switch)
const astroConfig = read('astro.config.mjs');
const SITE = astroConfig.match(/^\s*site:\s*'([^']+)'/m)?.[1]?.replace(/\/$/, '') ?? '';
const BASE = (astroConfig.match(/^\s*base:\s*'([^']*)'/m)?.[1] ?? '').replace(/\/$/, '');

// ───────────────────────────── 1. source ─────────────────────────────

const git = (args) => execSync(`git ${args}`, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
let files = [];
try {
  // tracked files + new files not ignored (what would end up in a commit)
  files = git('ls-files --cached --others --exclude-standard -z').split('\0').filter((f) => f && existsSync(join(root, f)));
} catch {
  warn('git is not available: source checks skipped.');
}
const TEXT = /\.(astro|ts|js|mjs|cjs|md|ya?ml|json|css|html|svg|webmanifest|txt|sql|xml|ics)$/i;
const textFiles = files.filter((f) => TEXT.test(f) && f !== 'package-lock.json' && statSync(join(root, f)).size < 3e6);

const SHRIMP_EMOJI = /\u{1F990}/u; // looks cooked: never on the site
const ASSISTANT = /(?<![a-z])c[l]aude(?![a-z])/i; // the AI assistant's name: team rule, never in the repo (written so this line doesn't match)
const RETAILERS =
  /(?<![a-z])(lidl|carrefour|leclerc|auchan|intermarch[ée]|mousquetaires|monoprix|franprix|aldi|casino|biocoop|grand frais|picard|syst[èe]me u|coop[ée]rative u)(?![a-zà-ÿ])/iu;
// Where retailer names may appear (campaign rule): action data and pages, the report, the organiser space.
const RETAILERS_ALLOWED = [
  /^src\/content\/events\.json$/,
  /^src\/views\/(EventPage|Report)\.astro$/,
  /^src\/lib\/report\.ts$/,
  /^src\/styles\/report\.css$/,
  /^src\/pages\/(agenda|en\/events|flyers)\//,
  /^src\/pages\/(rapport-souffrance-en-rayon|en\/report)\.astro$/,
  /^src\/scripts\/espace\//,
];
const SECRETS = [
  [/sb_secret_[A-Za-z0-9_-]{10,}/, 'a Supabase secret key'],
  [/xkeysib-[a-f0-9]{20,}/i, 'a Brevo API key'],
  [/xsmtpsib-[a-f0-9]{20,}/i, 'a Brevo SMTP key'],
  [/(?<![A-Za-z0-9])gh[pousr]_[A-Za-z0-9]{30,}/, 'a GitHub token'],
  [/github_pat_[A-Za-z0-9_]{30,}/, 'a GitHub token'],
  [/postgres(?:ql)?:\/\/[^\s:@'"`]+:[^\s@'"`[\]<>{}$]{6,}@/, 'a database address with its password'],
  [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, 'a private key'],
];
const JWT = /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;

const lineOf = (text, re) => {
  const i = text.search(re);
  return i < 0 ? 0 : text.slice(0, i).split('\n').length;
};

for (const f of files) {
  if (/(^|\/)\.env(\.|$)/.test(f)) fail(`${f}: environment files must never be committed.`);
}
for (const f of textFiles) {
  const text = read(f);
  if (SHRIMP_EMOJI.test(text)) fail(`${f}:${lineOf(text, SHRIMP_EMOJI)}: shrimp emoji (it looks cooked: team rule).`);
  if (ASSISTANT.test(text)) fail(`${f}:${lineOf(text, ASSISTANT)}: names the AI assistant (team rule: no assistant names in the repo).`);
  if (f.startsWith('src/') && RETAILERS.test(text) && !RETAILERS_ALLOWED.some((re) => re.test(f))) {
    fail(`${f}:${lineOf(text, RETAILERS)}: names a retailer ("${text.match(RETAILERS)[0]}"). Retailers only appear on action pages and the report page.`);
  }
  for (const [re, what] of SECRETS) if (re.test(text)) fail(`${f}:${lineOf(text, re)}: looks like ${what}. Secrets never go in the repo.`);
  if (JWT.test(text) && f !== 'src/supabase.json') fail(`${f}:${lineOf(text, JWT)}: contains a JWT. Only the public anon key in src/supabase.json is allowed.`);
}

// Applied migrations never change, and the flyer design is approved: compare with where this branch left main.
let mergeBase = '';
try {
  mergeBase = git('merge-base origin/main HEAD').trim();
} catch {
  warn('origin/main not found (run `git fetch origin`): migration and flyer checks skipped.');
}
if (mergeBase) {
  const diff = (paths) =>
    git(`diff --name-status ${mergeBase} -- ${paths}`)
      .split('\n')
      .filter(Boolean)
      .map((l) => l.split('\t'));
  for (const [status, ...paths] of diff('supabase/migrations')) {
    if (!status.startsWith('A')) {
      fail(`${paths.join(' → ')}: this migration is already on main (so applied to the live database) and was ${status.startsWith('D') ? 'deleted' : status.startsWith('R') ? 'renamed' : 'modified'}. Add a new migration file instead.`);
    }
  }
  const flyer = diff('src/lib/flyer.js public/flyer public/fonts/flyer');
  if (flyer.length) warn(`Flyer design files changed (${flyer.map((d) => d.at(-1)).join(', ')}). The design is approved: only OK if the team asked for it, or if the output stays identical.`);
}

// Action data (the backup copy of the database, or the source while Supabase isn't configured)
let events = [];
try {
  events = JSON.parse(read('src/content/events.json'));
  if (!Array.isArray(events)) throw new Error('not a list');
} catch (e) {
  fail(`src/content/events.json: unreadable (${e.message}).`);
  events = [];
}
for (const e of events) {
  if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(e.slug || '')) fail(`events.json: invalid slug "${e.slug}".`);
  const start = Date.parse(e.starts_at);
  const end = Date.parse(e.ends_at);
  if (!(start < end)) fail(`events.json: ${e.slug} ends before it starts.`);
  else if (end - start !== 90 * 60e3) warn(`${e.slug} lasts ${Math.round((end - start) / 60e3)} min (actions last 1 h 30 unless the team said otherwise).`);
}

// Organiser text goes through md(): it must keep escaping HTML and dropping unsafe links
const mdOut = md('<script>x</script> [a](javascript:alert(1)) [b](https://x.org/"onclick=y)');
if (/<script|href="javascript:|"onclick/i.test(mdOut)) fail(`src/lib/md.ts: organiser text is no longer made safe (got: ${mdOut}).`);

// Numbers of the organiser dashboard (src/scripts/espace/calc.js)
{
  const now = Date.parse('2026-11-10T12:00:00Z');
  const a = (id, ends, status, extra) => ({ id, starts_at: ends, ends_at: ends, status, ...extra });
  const rows = [
    a('a', '2026-10-01T10:00:00Z', 'published', { views: 400 }),
    a('b', '2026-10-05T10:00:00Z', 'published', { views: 1000 }),
    a('c', '2026-10-09T10:00:00Z', 'published', { views: 1540 }),
    a('cancelled', '2026-10-10T10:00:00Z', 'cancelled', { views: 5000 }),
    a('postponed', '2026-10-11T10:00:00Z', 'postponed', { views: 5000 }),
    a('upcoming', '2026-12-01T10:00:00Z', 'published', { views: 5000 }),
    a('self', '2026-10-12T10:00:00Z', 'published', { views: 5000 }),
  ];
  const month = [
    a('oct-late', '2026-10-31T22:30:00Z', 'published', { recap_participants: 30 }), // 23:30 in Paris: still October
    a('nov-early', '2026-10-31T23:30:00Z', 'published', { recap_participants: 99 }), // 00:30 on 1 Nov in Paris
    a('oct-no-recap', '2026-10-20T10:00:00Z', 'published', {}),
    a('oct-cancelled', '2026-10-21T10:00:00Z', 'cancelled', { recap_participants: 50 }),
  ];
  const checks = [
    ['avgPast leaves out cancelled, postponed, upcoming and the action itself', calc.avgPast(rows, 'views', 'self', now) === 980],
    ['avgPast is null with no past action', calc.avgPast(rows.slice(5), 'views', 'self', now) === null],
    ['pctDiff(412, 980) = -58', calc.pctDiff(412, 980) === -58],
    ['pctDiff(0, 980) = -100', calc.pctDiff(0, 980) === -100],
    ['pctDiff with no base is null', calc.pctDiff(5, 0) === null && calc.pctDiff(5, null) === null],
    ['fmtPct', calc.fmtPct(-58) === '−58 %' && calc.fmtPct(12) === '+12 %' && calc.fmtPct(null) === '—'],
    ['presentInMonth uses the Paris month and leaves out cancelled actions', JSON.stringify(calc.presentInMonth(month, '2026-10', now)) === '{"people":30,"recaps":1,"actions":2}'],
    ['monthsBack', calc.monthsBack(3, now).join() === '2026-09,2026-10,2026-11'],
    ['daysLeft: same Paris day is 0', calc.daysLeft('2026-10-24T20:00:00Z', Date.parse('2026-10-24T06:00:00Z')) === 0],
    ['daysLeft across the DST change', calc.daysLeft('2026-10-26T10:00:00Z', Date.parse('2026-10-24T10:00:00Z')) === 2],
    ['nextAction skips cancelled and postponed', calc.nextAction([a('p', '2026-11-20T10:00:00Z', 'postponed'), a('c', '2026-11-21T10:00:00Z', 'cancelled'), a('n', '2026-11-22T10:00:00Z', 'published')], now)?.id === 'n'],
    ['nextAction is null when none', calc.nextAction(rows.slice(0, 3), now) === null],
    ['cumulative fills missing days and keeps earlier totals', JSON.stringify(calc.cumulative([{ day: '2026-10-01', n: 2 }, { day: '2026-10-03', n: 1 }], '2026-10-02', '2026-10-04').map((d) => d.total)) === '[2,3,3]'],
    ['creatorLabel', calc.creatorLabel({ creator_status: 'deleted', creator_name: null }) === 'Compte supprimé' && calc.creatorLabel({ creator_status: 'team' }) === 'Équipe' && calc.creatorLabel({ creator_status: 'disabled', creator_name: 'Sam' }) === 'Sam'],
    ['fallbackReason: gone, cancelled, over, postponed, other page', calc.fallbackReason(null, now) === 'deleted'
      && calc.fallbackReason({ status: 'cancelled', ends_at: '2026-12-01T10:00:00Z' }, now) === 'cancelled'
      && calc.fallbackReason({ status: 'published', ends_at: '2026-11-10T11:59:00Z' }, now) === 'ended'
      && calc.fallbackReason({ status: 'postponed', ends_at: '2026-12-01T10:00:00Z' }, now) === null && calc.fallbackReason({}, now) === null],
    ['pctOf', calc.pctOf(1, 3) === 33 && calc.pctOf(2, 3) === 67 && calc.pctOf(null, 4) === 0 && calc.pctOf(5, 0) === null],
    ['csvCell escapes formulas and quotes', ['=SUM(A1)', '+33 6', '-1', '@x', '\tx', 'a"b'].map(calc.csvCell).join() === `"'=SUM(A1)","'+33 6","'-1","'@x","'\tx","a""b"`],
  ];
  for (const [name, pass] of checks) if (!pass) fail(`src/scripts/espace/calc.js: ${name} is wrong.`);
}

// ───────────────────────────── 2. built site ─────────────────────────────

const dist = join(root, 'dist');
const built = new Set();
if (!existsSync(join(dist, 'index.html'))) {
  fail('dist/ is missing or empty: run `npm run build` first.');
  report();
}

(function walk(dir, rel) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const r = rel ? `${rel}/${name}` : name;
    if (statSync(p).isDirectory()) walk(p, r);
    else built.add(r);
  }
})(dist, '');

/** Site path ("/agenda/x/", without the base) → is there a file for it in dist/? */
function exists(path) {
  let p = decodeURIComponent(path.split(/[?#]/)[0]).replace(/^\/+/, '');
  if (p === '' || p.endsWith('/')) p += 'index.html';
  return built.has(p) || built.has(`${p}/index.html`);
}

// Every route in src/i18n.ts, both languages, plus the fixed files
const routes = [...read('src/i18n.ts').matchAll(/^\s*\w+: \{ fr: '([^']+)', en: '([^']+)' \}/gm)].flatMap((m) => [m[1], m[2]]);
if (routes.length < 20) fail('src/i18n.ts: could not read the routes (format changed?). Update scripts/verify.mjs.');
const REQUIRED = [
  ...routes,
  '/404.html', '/en/404/', '/espace/', '/espace/action/', '/espace/admin/', '/espace/details/', '/espace/parametres/',
  '/espace/campagnes/', '/espace/campagnes/details/',
  '/rss.xml', '/en/rss.xml', '/agenda.ics', '/en/events.ics', '/robots.txt', '/sitemap-index.xml', '/site.webmanifest',
  '/favicon.ico', '/favicon.svg', '/apple-touch-icon.png', '/icon-192.png', '/icon-512.png', '/logo.png',
  '/logo.svg', '/logo-navy.svg', '/logo-bleu.svg',
];
for (const p of REQUIRED) if (!exists(p)) fail(`Missing in the build: ${p}`);

// Blog posts: one page per published post, in its language
for (const lang of ['fr', 'en']) {
  const dir = `src/content/blog/${lang}`;
  if (!existsSync(join(root, dir))) continue;
  for (const name of readdirSync(join(root, dir)).filter((n) => n.endsWith('.md'))) {
    if (/^draft:\s*true/m.test(read(`${dir}/${name}`))) continue;
    const page = `${lang === 'fr' ? '' : '/en'}/blog/${name.replace(/\.md$/, '')}/`;
    if (!exists(page)) fail(`Missing blog page: ${page}`);
  }
}

// Actions: FR + EN pages, calendar files and a real flyer for each
let sharp = null;
try {
  sharp = (await import('sharp')).default;
} catch {
  warn('sharp is not installed: flyer sizes not checked.');
}
const plainBackground = existsSync(join(root, 'public/flyer/background.jpg')) ? readFileSync(join(root, 'public/flyer/background.jpg')) : null;
for (const e of events) {
  for (const p of [`/agenda/${e.slug}/`, `/en/events/${e.slug}/`, `/agenda/${e.slug}.ics`, `/en/events/${e.slug}.ics`]) {
    if (!exists(p)) fail(`Missing page for the action ${e.slug}: ${p}`);
  }
  const flyerPath = join(dist, 'flyers', `${e.slug}.jpg`);
  if (!existsSync(flyerPath)) {
    fail(`Missing flyer: /flyers/${e.slug}.jpg`);
    continue;
  }
  const jpg = readFileSync(flyerPath);
  if (plainBackground && jpg.equals(plainBackground)) warn(`/flyers/${e.slug}.jpg is the plain background: the flyer failed to render (see "[flyer]" in the build log).`);
  if (sharp) {
    const meta = await sharp(jpg).metadata().catch(() => ({}));
    if (meta.format !== 'jpeg' || meta.width !== 1080) fail(`/flyers/${e.slug}.jpg is not a 1080 px wide JPEG (${meta.format} ${meta.width}px).`);
  }
}

// Home page "next action" = the soonest action that isn't over or cancelled
const now = Date.now();
// Campaign links (the backup copy of the database): codes printed on flyers, so every one keeps its page
let campaigns = [];
try {
  campaigns = JSON.parse(read('src/content/campaigns.json'));
  if (!Array.isArray(campaigns)) throw new Error('not a list');
} catch (e) {
  fail(`src/content/campaigns.json: unreadable (${e.message}).`);
  campaigns = [];
}
const CODE = /^[23456789abcdefghjkmnpqrstuvwxyz]{6}$/;
for (const c of campaigns) if (!CODE.test(c.code_qr || '') || !CODE.test(c.code_link || '')) fail(`campaigns.json: invalid code "${c.code_qr}" / "${c.code_link}".`);

const next = events
  .filter((e) => Date.parse(e.ends_at) >= now && e.status !== 'cancelled')
  .sort((a, b) => Date.parse(a.starts_at) - Date.parse(b.starts_at))[0];
if (next) {
  for (const [page, link] of [['index.html', `${BASE}/agenda/${next.slug}/`], ['en/index.html', `${BASE}/en/events/${next.slug}/`]]) {
    if (built.has(page) && !readFileSync(join(dist, page), 'utf8').includes(`href="${link}"`)) {
      fail(`${page}: the "next action" doesn't link to the soonest action (${next.slug}).`);
    }
  }
}

// Every HTML page
const ATTR = /\s(href|src|srcset|action|poster|data-[a-z-]+)="([^"]*)"/g;
const ABSOLUTE = new RegExp(`${(SITE + BASE).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(/[^"'\\s<>)\\\\]*)`, 'g');
const noindexPages = new Set();
const broken = new Map(); // link → first page using it
for (const file of [...built].filter((f) => f.endsWith('.html'))) {
  const html = readFileSync(join(dist, file), 'utf8');
  const where = `dist/${file}`;
  if (!/<html[^>]*\slang="(fr|en)"/.test(html)) fail(`${where}: no lang="fr|en" on <html>.`);
  if (!/<title>[^<]+<\/title>/.test(html)) fail(`${where}: no <title>.`);
  if (!/<link[^>]+rel="stylesheet"|<style[\s>]/.test(html)) fail(`${where}: no stylesheet (on Windows: build from the folder's real path, see AGENTS.md).`);
  if (!/<link[^>]+rel="icon"/.test(html)) fail(`${where}: no favicon link.`);
  const csp = html.match(/<meta http-equiv="content-security-policy" content="([^"]*)"/i)?.[1];
  if (!csp) fail(`${where}: no Content-Security-Policy meta.`);
  else {
    const scriptSrc = csp.split(';').find((d) => d.trim().startsWith('script-src')) || '';
    if (/'unsafe-inline'|'unsafe-eval'/.test(scriptSrc)) fail(`${where}: the CSP allows unsafe inline scripts or eval.`);
  }
  const noindex = /<meta name="robots" content="[^"]*noindex/.test(html);
  if (noindex) noindexPages.add(file);
  if (file.startsWith('espace/') && !noindex) fail(`${where}: organiser pages must be noindex.`);
  if (SHRIMP_EMOJI.test(html)) fail(`${where}: shrimp emoji.`);
  if (ASSISTANT.test(html)) fail(`${where}: names the AI assistant.`);

  const check = (link) => {
    if (!exists(link) && !broken.has(link)) broken.set(link, where);
  };
  for (const [, attr, raw] of html.matchAll(ATTR)) {
    const values = attr === 'srcset' ? raw.split(',').map((s) => s.trim().split(/\s+/)[0]) : [raw];
    for (const v of values.map((x) => x.replace(/&amp;/g, '&'))) {
      if (!v.startsWith('/') || v.startsWith('//')) continue;
      if (BASE && !(v === BASE || v.startsWith(`${BASE}/`))) {
        if (!attr.startsWith('data-')) fail(`${where}: link "${v}" skips the base path ${BASE} (use url() from src/i18n.ts).`);
        continue;
      }
      check(v.slice(BASE.length) || '/');
    }
  }
  for (const [, path] of html.matchAll(ABSOLUTE)) check(path.replace(/&amp;/g, '&'));
}
for (const [link, page] of broken) fail(`${page}: broken link ${BASE}${link}`);

// Sitemap: only pages that exist and are meant to be indexed
for (const f of [...built].filter((f) => /^sitemap-\d+\.xml$/.test(f))) {
  for (const [, loc] of readFileSync(join(dist, f), 'utf8').matchAll(/<loc>([^<]+)<\/loc>/g)) {
    const path = loc.startsWith(SITE + BASE) ? loc.slice((SITE + BASE).length) || '/' : null;
    if (path === null) fail(`${f}: ${loc} is not on ${SITE}${BASE}.`);
    else if (!exists(path)) fail(`${f}: ${loc} doesn't exist.`);
    else {
      const p = path.replace(/^\//, '') + (path.endsWith('/') ? 'index.html' : '');
      if (noindexPages.has(p)) fail(`${f}: ${loc} is noindex and shouldn't be in the sitemap (filter in astro.config.mjs).`);
    }
  }
}

// Campaign links: a page for each code (QR and plain link), noindex (so out of the sitemap, checked above).
// Their redirects are data-* links, already checked like every other link.
for (const c of campaigns) {
  for (const code of [c.code_qr, c.code_link]) {
    if (!exists(`/c/${code}/`)) fail(`Missing campaign link page: /c/${code}/`);
    else if (!noindexPages.has(`c/${code}/index.html`)) fail(`dist/c/${code}/index.html: campaign links must be noindex.`);
  }
}

// robots.txt and web manifest follow the configured address
if (built.has('robots.txt') && !readFileSync(join(dist, 'robots.txt'), 'utf8').includes(`Sitemap: ${SITE}${BASE}/sitemap-index.xml`)) {
  fail('robots.txt: the Sitemap line doesn\'t match the site address.');
}
if (built.has('site.webmanifest')) {
  try {
    const m = JSON.parse(readFileSync(join(dist, 'site.webmanifest'), 'utf8'));
    if (m.start_url !== `${BASE}/` || m.scope !== `${BASE}/`) fail(`public/site.webmanifest: start_url and scope must be "${BASE}/" (they follow the base path).`);
    for (const icon of m.icons || []) {
      if (!icon.src?.startsWith(`${BASE}/`) || !exists(icon.src.slice(BASE.length))) fail(`public/site.webmanifest: icon ${icon.src} doesn't exist.`);
    }
  } catch (e) {
    fail(`public/site.webmanifest: invalid JSON (${e.message}).`);
  }
}

// Other text outputs (feeds, calendars, scripts, styles)
for (const file of [...built].filter((f) => /\.(xml|ics|js|css|json|webmanifest|txt)$/.test(f))) {
  const text = readFileSync(join(dist, file), 'utf8');
  if (SHRIMP_EMOJI.test(text)) fail(`dist/${file}: shrimp emoji.`);
  if (ASSISTANT.test(text)) fail(`dist/${file}: names the AI assistant.`);
}

report();

function report() {
  for (const w of warnings) console.log(`warning  ${w}`);
  for (const p of problems) console.log(`PROBLEM  ${p}`);
  const pages = [...built].filter((f) => f.endsWith('.html')).length;
  console.log(
    problems.length
      ? `\n${problems.length} problem(s). Fix them before pushing (see AGENTS.md).`
      : `\nAll checks passed: ${pages} pages, ${events.length} action(s), ${textFiles.length} source files.${warnings.length ? ` ${warnings.length} warning(s) above.` : ''}`,
  );
  process.exit(problems.length ? 1 : 0);
}
