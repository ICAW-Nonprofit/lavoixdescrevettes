// Organiser space: everything that talks to the backend goes through `api`.
// Real mode = Supabase (login links, database rules). Demo mode (?demo) = in-memory data in this tab,
// so the space can be tried before Supabase is set up. Nothing in demo mode is ever sent anywhere.
import { createClient } from '@supabase/supabase-js';
import cfg from '../../supabase.json';
import seed from '../../content/events.json';
import { parisDay } from './calc.js';
import { postProblems } from './blog-rules.js';

export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export const SITE = `${location.origin}${BASE}`;

const params = new URLSearchParams(location.search);
if (params.has('demo')) sessionStorage.setItem('lvdc-demo', '1');
if (params.has('nodemo')) sessionStorage.removeItem('lvdc-demo');
// demo only: ?droits=blog,campaigns makes the demo account an organiser with those rights (?droits=admin: back to admin)
if (params.has('droits')) sessionStorage.setItem('lvdc-demo-rights', params.get('droits'));
export const DEMO = sessionStorage.getItem('lvdc-demo') === '1' || !cfg.url;
export const CONFIGURED = Boolean(cfg.url && cfg.anonKey);

export class ApiError extends Error {
  constructor(code, message) {
    super(message || code);
    this.code = code;
  }
}

// ───────────────────────────── real backend ─────────────────────────────
function realApi() {
  const sb = createClient(cfg.url, cfg.anonKey, {
    auth: { flowType: 'implicit', persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
  });
  const check = ({ data, error }) => {
    if (error) {
      const msg = error.message || '';
      if (error.code === '23505') throw new ApiError('duplicate', msg);
      if (error.code === '40001' || msg === 'conflict') throw new ApiError('conflict', msg);
      // post_publish(): what is missing, one item per line
      if (msg === 'incomplete') throw Object.assign(new ApiError('incomplete', msg), { details: (error.details || '').split('\n').filter(Boolean) });
      if (msg === 'author') throw new ApiError('author', msg);
      if (error.code === '42501' || /row-level security|permission denied|forbidden/i.test(msg)) throw new ApiError('forbidden', msg);
      throw new ApiError('error', msg);
    }
    return data;
  };
  let profileCache = null;

  return {
    demo: false,
    async session() {
      const { data } = await sb.auth.getSession();
      const user = data.session?.user;
      if (!user) return null;
      if (!profileCache || profileCache.id !== user.id) {
        profileCache = check(await sb.from('profiles').select('id, email, display_name, full_name, city, role, rights').eq('id', user.id).maybeSingle());
      }
      return profileCache ? { user, profile: profileCache } : { user, profile: null };
    },
    onAuthChange(cb) {
      sb.auth.onAuthStateChange((event) => {
        profileCache = null;
        cb(event);
      });
    },
    async sendLoginLink(email) {
      const { error } = await sb.auth.signInWithOtp({
        email: email.trim().toLowerCase(),
        options: { shouldCreateUser: true, emailRedirectTo: `${SITE}/espace/` },
      });
      if (error) {
        if (/database error|not been invited|signups not allowed/i.test(error.message)) throw new ApiError('not_invited');
        if (error.status === 429 || /rate|seconds/i.test(error.message)) throw new ApiError('rate');
        if (/sending .*email|smtp/i.test(error.message)) throw new ApiError('email_send', error.message);
        throw new ApiError('error', error.message);
      }
    },
    async signOut() {
      profileCache = null;
      await sb.auth.signOut();
    },
    async updateProfile(fields) {
      const s = await this.session();
      check(await sb.from('profiles').update(fields).eq('id', s.user.id));
      profileCache = null;
    },
    overview: async () => check(await sb.rpc('event_overview')) || [],
    getEvent: async (id) => check(await sb.from('events').select('*').eq('id', id).maybeSingle()),
    async saveEvent(row) {
      const { id, ...fields } = row;
      if (id) return check(await sb.from('events').update(fields).eq('id', id).select().single());
      return check(await sb.from('events').insert(fields).select().single());
    },
    deleteEvent: async (id) => check(await sb.from('events').delete().eq('id', id)),
    async uploadPoster(file, slug) {
      const ext = { 'image/png': 'png', 'image/webp': 'webp' }[file.type] || 'jpg';
      const path = `${slug}-${Date.now()}.${ext}`;
      check(await sb.storage.from('posters').upload(path, file, { contentType: file.type, upsert: false }));
      return sb.storage.from('posters').getPublicUrl(path).data.publicUrl;
    },
    attendees: async (eventId) => check(await sb.rpc('attendees', { p_event: eventId })) || [],
    rsvpsPerDay: async (days = 60) => check(await sb.rpc('rsvps_per_day', { p_days: days })) || [],
    // shortcut: PostgREST returns at most 1000 rows (≈ 3 years of days with a sign-up); switch to a summing function before then
    newsletterPerDay: async () => (check(await sb.from('site_stats').select('day, newsletter').order('day')) || []).map((r) => ({ day: r.day, n: r.newsletter })),
    notes: async () => check(await sb.from('dashboard_notes').select('id, day, label, created_by').order('day')) || [],
    addNote: async (day, label) => check(await sb.from('dashboard_notes').insert({ day, label })),
    deleteNote: async (id) => check(await sb.from('dashboard_notes').delete().eq('id', id)),
    staff: async () => check(await sb.rpc('staff_list')) || [],
    invitations: async () => check(await sb.from('invitations').select('*').order('created_at', { ascending: false })) || [],
    async invite({ email, display_name, city, rights }) {
      const clean = email.trim().toLowerCase();
      const res = await sb.from('invitations').insert({ email: clean, display_name: display_name || null, city: city || null, ...(rights?.length ? { rights } : {}) });
      if (res.error && res.error.code !== '23505') check(res);
      await this.sendLoginLink(clean);
    },
    cancelInvitation: async (email) => check(await sb.from('invitations').delete().eq('email', email)),
    setActive: async (id, active) => check(await sb.rpc('set_organizer_active', { p_user: id, p_active: active })),
    setRights: async (id, rights) => check(await sb.rpc('set_rights', { p_user: id, p_rights: rights })),
    // the public columns of the actions (Campagnes needs them without the Actions right)
    actionsBrief: async () => check(await sb.from('events').select('id, slug, title, city, status, starts_at, ends_at').order('starts_at', { ascending: false })) || [],

    // blog (status, versions and preview links are set by the database functions)
    posts: async () => check(await sb.rpc('post_list')) || [],
    getPost: async (id) => check(await sb.from('posts').select('*').eq('id', id).maybeSingle()),
    createPost: async (fields) => check(await sb.from('posts').insert(fields).select().single()),
    /** Saves the content. With `expected` (the updated_at loaded), refuses when someone saved in between. */
    async savePost(id, fields, expected) {
      let req = sb.from('posts').update(fields).eq('id', id);
      if (expected) req = req.eq('updated_at', expected);
      const rows = check(await req.select());
      if (rows?.length) return rows[0];
      const now = (await this.posts()).find((p) => p.id === id);
      throw Object.assign(new ApiError(now ? 'conflict' : 'forbidden'), { who: now?.updated_by_name, at: now?.updated_at });
    },
    publishPost: async (id, expected) => check(await sb.rpc('post_publish', { p_id: id, p_expected: expected || null })),
    trashPost: async (id) => check(await sb.rpc('post_trash', { p_id: id })),
    restorePost: async (id, withTranslation = false) => check(await sb.rpc('post_restore', { p_id: id, p_with_translation: withTranslation })),
    postHistory: async (id) => check(await sb.rpc('post_history', { p_id: id })) || [],
    postVersion: async (versionId) => check(await sb.from('post_versions').select('*').eq('id', versionId).single()),
    restoreVersion: async (versionId, expected) => check(await sb.rpc('post_restore_version', { p_version: versionId, p_expected: expected || null })),
    postPreview: async (id) =>
      (check(await sb.from('post_previews').select('token, expires_at').eq('post_id', id).is('revoked_at', null).gt('expires_at', new Date().toISOString()).limit(1)) || [])[0] || null,
    createPreview: async (id) => check(await sb.rpc('post_preview_create', { p_id: id })),
    revokePreview: async (id) => check(await sb.rpc('post_preview_revoke', { p_id: id })),
    /** An image already checked and re-encoded by blog-images.js; returns its path in the bucket. */
    async uploadBlogImage(blob) {
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[blob.type];
      if (!ext) throw new ApiError('image_type');
      const path = `${crypto.randomUUID()}.${ext}`;
      check(await sb.storage.from('blog').upload(path, blob, { contentType: blob.type, upsert: false }));
      return path;
    },
    blogImageUrl: (path) => (path ? `${cfg.url}/storage/v1/object/public/blog/${path}` : null),
    publishNow: async () => check(await sb.rpc('publish_now')),
    auditLog: async (limit = 200) => check(await sb.rpc('audit_recent', { p_limit: limit })) || [],

    // campaigns (codes, author and dates are set by the database)
    campaigns: async () => check(await sb.rpc('campaign_overview')) || [],
    // shortcut: PostgREST returns at most 1000 rows (≈ 500 days of visits by QR and by link); sum in a function before then
    campaignStats: async (id) => check(await sb.from('campaign_stats').select('day, channel, visits, rsvps, share_clicks, shares_done, newsletter').eq('campaign_id', id).order('day')) || [],
    campaignHistory: async (id) => check(await sb.rpc('campaign_history', { p_id: id })) || [],
    createCampaign: async (fields) => check(await sb.from('campaigns').insert(fields).select('id').single()),
    updateCampaign: async (id, fields) => check(await sb.from('campaigns').update(fields).eq('id', id)),
    archiveCampaign: async (id) => check(await sb.from('campaigns').update({ archived_at: new Date().toISOString() }).eq('id', id)),

    // two-factor login (required for admins): a 6-digit code from an authenticator app, on top of the email link
    async mfaStatus() {
      const { data, error } = await sb.auth.mfa.getAuthenticatorAssuranceLevel();
      if (error) throw new ApiError('error', error.message);
      return { level: data.currentLevel, hasFactor: data.nextLevel === 'aal2' };
    },
    async mfaEnroll() {
      // a set-up started earlier and never finished leaves an unverified factor behind: remove it first
      const { data: list } = await sb.auth.mfa.listFactors();
      for (const f of list?.all || []) if (f.factor_type === 'totp' && f.status !== 'verified') await sb.auth.mfa.unenroll({ factorId: f.id });
      const { data, error } = await sb.auth.mfa.enroll({ factorType: 'totp', issuer: 'La Voix des Crevettes', friendlyName: `Espace orga ${Date.now()}` });
      if (error) throw new ApiError('error', error.message);
      return { factorId: data.id, qr: data.totp.qr_code, secret: data.totp.secret };
    },
    async mfaVerify(code, factorId) {
      if (!factorId) {
        const { data } = await sb.auth.mfa.listFactors();
        factorId = data?.totp?.[0]?.id;
      }
      const { error } = await sb.auth.mfa.challengeAndVerify({ factorId, code });
      if (error) throw new ApiError(error.code === 'mfa_verification_failed' || /invalid|expired/i.test(error.message) ? 'mfa_code' : 'error', error.message);
      profileCache = null;
    },
  };
}

// ───────────────────────────── demo backend ─────────────────────────────
// what a blog version holds (same columns as public.post_versions)
const CONTENT = ['title', 'slug', 'summary', 'category', 'publish_date', 'cover_path', 'cover_alt', 'cover_credit', 'author_display', 'blocks'];
const pick = (p) => Object.fromEntries(CONTENT.map((k) => [k, structuredClone(p[k] ?? null)]));
const DEMO_IMAGE = '00000000-0000-4000-8000-000000000000.png'; // the demo shows it as the site's yellow shrimp drawing

function demoApi() {
  const KEY = 'lvdc-demo-db';
  const now = Date.now();
  const day = 86400000;
  const iso = (t) => new Date(t).toISOString();
  const fresh = () => {
    const first = { ...seed[0], created_by: 'demo-admin', created_at: iso(now - 10 * day) };
    const past = {
      ...seed[0],
      id: 'demo-past',
      slug: 'action-lidl-chatenay-malabry-demo-passee',
      title: 'Première action devant le siège de Lidl',
      starts_at: iso(now - 21 * day),
      ends_at: iso(now - 21 * day + 5400000),
      custom_poster: null,
      recap_participants: 38,
      recap_text: 'Une super première ! Merci à toutes et tous.',
      recap_links: '',
      created_by: 'demo-orga',
      created_at: iso(now - 30 * day),
    };
    const older = { ...past, id: 'demo-older', slug: 'action-crevettes-lyon-demo', title: 'Tractage pour les crevettes', city: 'Lyon', kind: 'tractage', starts_at: iso(now - 45 * day), ends_at: iso(now - 45 * day + 5400000), recap_participants: 22, recap_text: null, created_by: 'demo-gone', created_at: iso(now - 52 * day) };
    const cancelled = { ...past, id: 'demo-cancelled', slug: 'action-crevettes-marseille-demo', title: 'Rassemblement à Marseille', city: 'Marseille', status: 'cancelled', starts_at: iso(now - 8 * day), ends_at: iso(now - 8 * day + 5400000), recap_participants: null, recap_text: null, created_at: iso(now - 14 * day) };
    const soon = { ...seed[0], id: 'demo-soon', slug: 'action-crevettes-nantes-demo', title: 'Action pour les crevettes à Nantes', city: 'Nantes', custom_poster: null, starts_at: iso(now + 30 * day), ends_at: iso(now + 30 * day + 5400000), created_by: null, created_at: iso(now - 2 * day) };
    // newsletter sign-ups via the site: a few a day, more after actions and media coverage
    const spikes = { 3: 18, 8: 4, 21: 14, 45: 9 };
    const signups = Array.from({ length: 120 }, (_, i) => ({ day: parisDay(now - i * day), n: (spikes[i] || 0) + ((i * 7) % 5 === 0 ? 2 : i % 3 === 0 ? 1 : 0) }))
      .filter((r) => r.n)
      .reverse();
    // campaigns: a flyer for the next action, posters for an article, an archived post whose action is over
    const camp = (id, name, support, dest, ago, code_qr, code_link, extra) => ({
      id, name, support, dest_event_id: dest.event || null, dest_page: dest.page || null, fallback_page: 'agenda',
      code_qr, code_link, created_by: 'demo-orga', created_at: iso(now - ago * day), archived_at: null, archived_by: null, ...extra,
    });
    const campaigns = [
      camp('demo-camp-flyers', 'Flyers marché Croix-Rousse', 'flyer', { event: soon.id }, 12, 'k7p2qa', 'x3m9tb'),
      camp('demo-camp-affiches', 'Affiches fac Lyon 2', 'affiche', { page: 'blog/pourquoi-les-crevettes' }, 26, 'h4vn8r', 'p2wq7c', { created_by: 'demo-admin', fallback_page: 'home' }),
      camp('demo-camp-insta', 'Post Instagram première action', 'instagram', { event: past.id }, 30, 'm6t3ks', 'd9fy4e', { archived_at: iso(now - 5 * day), archived_by: 'demo-admin' }),
    ];
    // visits per day and channel since each campaign started, with what visitors did next
    const visitsFor = (c, seed, rsvps) =>
      Array.from({ length: Math.round((now - Date.parse(c.created_at)) / day) + 1 }, (_, ago) => ago).flatMap((ago) =>
        ['qr', 'link'].map((channel) => {
          const visits = channel === 'qr' ? (ago * seed) % 7 : (ago * seed + 1) % 4;
          return { day: parisDay(now - ago * day), channel, visits, rsvps: rsvps && visits > 4 ? 1 : 0, share_clicks: visits > 3 ? 1 : 0, shares_done: visits > 5 ? 1 : 0, newsletter: visits === 6 ? 1 : 0 };
        })).filter((r) => r.visits).reverse();
    const campaignStats = { [campaigns[0].id]: visitsFor(campaigns[0], 5, true), [campaigns[1].id]: visitsFor(campaigns[1], 3, false), [campaigns[2].id]: visitsFor(campaigns[2], 2, true) };
    // blog: a live post (with an English draft), a draft, and a post in the Corbeille. Versions follow each save.
    const para = (text, styles = {}) => ({ type: 'paragraph', content: [{ type: 'text', text, styles }] });
    const blocks = [
      para('Dans la plupart des élevages, les crevettes vivent serrées dans des bassins sans abri.'),
      { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Ce que montrent les études', styles: {} }] },
      para('Elles apprennent à éviter ce qui leur fait mal : c’est un signe de douleur, pas un simple réflexe.', { bold: true }),
      { type: 'heading', props: { level: 2 }, content: [{ type: 'text', text: 'Sources', styles: {} }] },
      { type: 'bulletListItem', content: [{ type: 'text', text: 'ICAW, Souffrance en rayon, 2026.', styles: {} }] },
    ];
    const post = (id, extra) => ({
      id, lang: 'fr', translation_of: null, slug: null, status: 'brouillon', title: '', summary: '', category: null, publish_date: null,
      cover_path: null, cover_alt: '', cover_credit: '', author_id: 'demo-orga', author_display: 'collectif', blocks: [],
      created_at: iso(now - 9 * day), updated_at: iso(now - 9 * day), updated_by: 'demo-orga', first_published_at: null, published_at: null, published_version_id: null, ...extra,
    });
    const posts = [
      post('demo-post-live', {
        slug: 'la-vie-dans-un-bassin', status: 'publie', title: 'La vie dans un bassin d’élevage', category: 'science', publish_date: parisDay(now - 6 * day),
        summary: 'Serrées, sans abri, privées de nuit : à quoi ressemble la vie d’une crevette dans un élevage intensif, étude par étude.',
        cover_path: DEMO_IMAGE, cover_alt: 'Dessin d’une crevette vivante, jaune', cover_credit: 'Dessin : La Voix des Crevettes', blocks,
        updated_at: iso(now - 2 * day), first_published_at: iso(now - 6 * day), published_at: iso(now - 6 * day),
      }),
      post('demo-post-live-en', { lang: 'en', translation_of: 'demo-post-live', slug: 'life-in-a-farm-pond', title: 'Life in a farm pond', updated_by: 'demo-admin', author_id: 'demo-admin', updated_at: iso(now - day) }),
      post('demo-post-draft', { slug: 'retour-sur-nantes', title: 'Retour sur l’action de Nantes', category: 'campagne', author_id: 'demo-admin', updated_by: 'demo-admin', updated_at: iso(now - 3 * 3600000), blocks: [para('On était 40 devant le magasin.')] }),
      post('demo-post-trash', { slug: 'ancien-brouillon', status: 'corbeille', title: 'Ancien brouillon', updated_at: iso(now - 20 * day) }),
    ];
    const versions = [];
    const snapshot = (p, at, by) => versions.push({ id: versions.length + 1, post_id: p.id, saved_at: at, saved_by: by, restored_from: null, ...pick(p) });
    snapshot({ ...posts[0], title: 'La vie en bassin', blocks: blocks.slice(0, 2) }, iso(now - 9 * day), 'demo-orga');
    snapshot(posts[0], iso(now - 6 * day), 'demo-admin');
    posts[0].published_version_id = versions.length;
    snapshot({ ...posts[0], summary: `${posts[0].summary}` }, iso(now - 2 * day), 'demo-orga');
    for (const p of posts.slice(1)) snapshot(p, p.updated_at, p.updated_by);
    return {
      version: 5,
      campaigns,
      campaignStats,
      posts,
      versions,
      previews: [],
      profile: { id: 'demo-admin', email: 'demo@example.org', display_name: 'Démo', full_name: 'Démo Admin', city: 'Paris', role: 'admin', rights: ['actions'] },
      events: [first, past, older, cancelled, soon],
      rsvps: {
        [first.id]: Array.from({ length: 12 }, (_, i) => ({ name: ['Camille', 'Sam', 'Léa', 'Noé', 'Inès', 'Yanis'][i % 6], email: i % 3 ? null : `demo${i}@example.org`, created_at: iso(now - (i % 9) * day) })),
        [past.id]: Array.from({ length: 30 }, (_, i) => ({ name: 'Militant·e ' + (i + 1), email: null, created_at: iso(now - (22 + (i % 6)) * day) })),
        [older.id]: Array.from({ length: 20 }, (_, i) => ({ name: 'Militant·e ' + (i + 31), email: null, created_at: iso(now - (46 + (i % 5)) * day) })),
        [cancelled.id]: Array.from({ length: 6 }, (_, i) => ({ name: 'Militant·e ' + (i + 51), email: null, created_at: iso(now - (10 + (i % 3)) * day) })),
      },
      stats: {
        [first.id]: { views: 412, shares: 57, newsletter: 9, calendar: 23 },
        [past.id]: { views: 980, shares: 121, newsletter: 31, calendar: 40 },
        [older.id]: { views: 640, shares: 80, newsletter: 14, calendar: 25 },
        [cancelled.id]: { views: 120, shares: 9, newsletter: 2, calendar: 4 },
      },
      signups,
      notes: [
        { id: 1, day: parisDay(now - 60 * day), label: 'Lancement de la newsletter', created_by: 'demo-orga' },
        { id: 2, day: parisDay(now - 12 * day), label: 'Post Instagram partagé par une asso', created_by: 'demo-admin' },
      ],
      staff: [
        { id: 'demo-admin', email: 'demo@example.org', display_name: 'Démo', full_name: 'Démo Admin', city: 'Paris', role: 'admin', rights: ['actions'], created_at: iso(now - 40 * day), last_sign_in_at: iso(now), actions: 1 },
        { id: 'demo-orga', email: 'orga.lyon@example.org', display_name: 'Orga Lyon', city: 'Lyon', role: 'organizer', rights: ['actions', 'campaigns'], created_at: iso(now - 30 * day), last_sign_in_at: iso(now - 3 * day), actions: 1 },
        { id: 'demo-plume', email: 'plume@example.org', display_name: 'Camille', full_name: 'Camille Martin', city: 'Nantes', role: 'organizer', rights: ['blog'], created_at: iso(now - 12 * day), last_sign_in_at: iso(now - day), actions: 0 },
      ],
      invitations: [{ email: 'nouvelle@example.org', display_name: 'Nouvelle orga', city: 'Marseille', role: 'organizer', rights: ['actions'], created_at: iso(now - day) }],
      audit: [
        { at: iso(now - day), who: 'Démo', action: 'invitation.create', target: 'nouvelle@example.org', detail: { role: 'organizer' } },
        { at: iso(now - 21 * day - 3600000), who: 'Orga Lyon', action: 'action.update', target: past.slug, detail: { fields: ['recap_participants', 'recap_text'] } },
        { at: iso(now - 30 * day), who: 'Orga Lyon', action: 'login', target: 'orga.lyon@example.org' },
      ],
      signedIn: false,
    };
  };
  const load = () => {
    try {
      const saved = JSON.parse(sessionStorage.getItem(KEY));
      return saved?.version === 5 ? saved : fresh(); // older demo data lacks the dashboard's numbers, the campaigns, the rights or the blog
    } catch {
      return fresh();
    }
  };
  let db = load();
  const save = () => sessionStorage.setItem(KEY, JSON.stringify(db));
  const wait = (v) => new Promise((r) => setTimeout(() => r(v), 250));
  // demo security log (the real one is written by the database)
  const log = (action, target, detail) => {
    db.audit = [{ at: new Date().toISOString(), who: db.profile.display_name || 'Démo', action, target, detail }, ...(db.audit || [])].slice(0, 200);
  };
  const listeners = [];
  // ?droits=…: the demo account as an organiser with those rights (see the top of this file)
  const me = () => {
    const r = sessionStorage.getItem('lvdc-demo-rights');
    if (!r || r === 'admin') return db.profile;
    return { ...db.profile, role: 'organizer', rights: r.split(',').filter((x) => ['actions', 'campaigns', 'blog'].includes(x)) };
  };
  const nameOf = (uid) => (uid === db.profile.id ? db.profile.display_name : db.staff.find((p) => p.id === uid)?.display_name) ?? null;
  const personOf = (uid) => (uid === db.profile.id ? db.profile : db.staff.find((p) => p.id === uid));
  // blog images uploaded in the demo stay in this tab's memory (not in sessionStorage: too big)
  const images = new Map();
  const latest = (postId) => Math.max(0, ...db.versions.filter((v) => v.post_id === postId).map((v) => v.id));
  const authorLabel = (p, display = p.author_display) => {
    const a = personOf(p.author_id);
    return (display === 'nom' ? a?.full_name : display === 'prenom' ? a?.display_name : null)?.trim() || null;
  };
  const postTarget = (p) => `${p.lang}/${p.slug || p.id.slice(0, 8)}`;
  const saveVersion = (p, restoredFrom = null) => db.versions.push({ id: (db.versions.at(-1)?.id || 0) + 1, post_id: p.id, saved_at: p.updated_at, saved_by: me().id, restored_from: restoredFrom, ...pick(p) });

  return {
    demo: true,
    session: async () => (db.signedIn ? { user: { id: db.profile.id, email: db.profile.email }, profile: me() } : null),
    onAuthChange: (cb) => listeners.push(cb),
    async sendLoginLink() {
      db.signedIn = true; // demo: no email, you're simply signed in
      db.aal = 'aal1';
      log('login', db.profile.email);
      save();
      await wait();
      listeners.forEach((cb) => cb('SIGNED_IN'));
    },
    async signOut() {
      db.signedIn = false;
      db.aal = 'aal1';
      save();
    },
    async updateProfile(fields) {
      Object.assign(db.profile, fields);
      save();
    },
    async overview() {
      return wait(
        db.events
          .map((e) => {
            const r = db.rsvps[e.id] || [];
            const s = db.stats[e.id] || { views: 0, shares: 0, newsletter: 0, calendar: 0 };
            const creator = db.staff.find((p) => p.id === e.created_by);
            const creator_status = creator ? (creator.role === 'disabled' ? 'disabled' : 'active') : e.created_by ? 'deleted' : 'team';
            return { ...e, creator_name: creator?.display_name ?? null, creator_status, rsvps: r.length, rsvps_with_email: r.filter((x) => x.email).length, ...s };
          })
          .sort((a, b) => b.starts_at.localeCompare(a.starts_at)),
      );
    },
    getEvent: async (id) => wait(structuredClone(db.events.find((e) => e.id === id) || null)),
    async saveEvent(row) {
      if (row.id) {
        const i = db.events.findIndex((e) => e.id === row.id);
        const fields = Object.keys(row).filter((k) => k !== 'slug' && JSON.stringify(row[k] ?? null) !== JSON.stringify(db.events[i][k] ?? null)).sort();
        db.events[i] = { ...db.events[i], ...row, slug: db.events[i].slug, updated_at: new Date().toISOString() };
        if (fields.length) log('action.update', db.events[i].slug, { fields });
        save();
        return wait(structuredClone(db.events[i]));
      }
      if (db.events.some((e) => e.slug === row.slug)) throw new ApiError('duplicate');
      const ev = { ...row, id: crypto.randomUUID(), created_by: db.profile.id, created_at: new Date().toISOString(), updated_at: new Date().toISOString() };
      db.events.push(ev);
      log('action.create', ev.slug);
      save();
      return wait(structuredClone(ev));
    },
    async deleteEvent(id) {
      const ev = db.events.find((e) => e.id === id);
      db.events = db.events.filter((e) => e.id !== id);
      if (ev) log('action.delete', ev.slug, { title: ev.title });
      save();
    },
    async uploadPoster(file) {
      return new Promise((resolve) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result); // demo: kept in this tab only
        fr.readAsDataURL(file);
      });
    },
    async attendees(id) {
      const slug = db.events.find((e) => e.id === id)?.slug;
      const recent = (db.audit || []).some((a) => a.action === 'attendees.view' && a.target === slug && Date.now() - Date.parse(a.at) < 3600000);
      if (!recent) {
        log('attendees.view', slug);
        save();
      }
      // like the database: emails only for admins
      return wait((db.rsvps[id] || []).map((r) => (me().role === 'admin' ? r : { ...r, email: null })));
    },
    async rsvpsPerDay(days = 60) {
      const counts = {};
      for (const list of Object.values(db.rsvps))
        for (const r of list) {
          if (Date.now() - Date.parse(r.created_at) > days * day) continue;
          const d = r.created_at.slice(0, 10);
          counts[d] = (counts[d] || 0) + 1;
        }
      return Object.entries(counts).sort().map(([d, c]) => ({ day: d, count: c }));
    },
    newsletterPerDay: async () => wait(db.signups),
    notes: async () => wait(db.notes),
    async addNote(day, label) {
      db.notes.push({ id: Date.now(), day, label, created_by: db.profile.id });
      save();
    },
    async deleteNote(id) {
      db.notes = db.notes.filter((n) => n.id !== id || (n.created_by !== db.profile.id && db.profile.role !== 'admin'));
      save();
    },
    staff: async () => wait(db.staff),
    invitations: async () => wait(db.invitations.filter((i) => !db.staff.some((s) => s.email === i.email))),
    async invite({ email, display_name, city, rights = ['actions'] }) {
      const clean = email.trim().toLowerCase();
      if (!db.invitations.some((i) => i.email === clean)) {
        db.invitations.unshift({ email: clean, display_name, city, role: 'organizer', rights, created_at: new Date().toISOString() });
        log('invitation.create', clean, { role: 'organizer', rights });
      }
      save();
      await wait();
    },
    async setRights(id, rights) {
      const p = db.staff.find((s) => s.id === id);
      const clean = ['actions', 'blog', 'campaigns'].filter((r) => rights.includes(r));
      if (!clean.length) throw new ApiError('error', 'rights');
      if (p && p.role !== 'admin' && p.rights.join() !== clean.join()) {
        log('account.rights', p.email, { from: p.rights, to: clean });
        p.rights = clean;
      }
      save();
      await wait();
    },
    actionsBrief: async () => wait(db.events.map(({ id, slug, title, city, status, starts_at, ends_at }) => ({ id, slug, title, city, status, starts_at, ends_at }))),

    // blog: same rules as the database (supabase/migrations/20261021120000_blog_and_rights.sql)
    async posts() {
      return wait(db.posts.map((p) => {
        const en = db.posts.find((x) => x.translation_of === p.id);
        return {
          id: p.id, lang: p.lang, translation_of: p.translation_of, slug: p.slug, title: p.title, status: p.status, updated_at: p.updated_at,
          updated_by_name: nameOf(p.updated_by), author_id: p.author_id, author_name: nameOf(p.author_id),
          has_changes: p.status === 'publie' && p.published_version_id !== latest(p.id),
          first_published_at: p.first_published_at, published_at: p.published_at, en_id: en?.id ?? null, en_status: en?.status ?? null,
        };
      }).sort((a, b) => b.updated_at.localeCompare(a.updated_at)));
    },
    getPost: async (id) => wait(structuredClone(db.posts.find((p) => p.id === id) || null)),
    async createPost(fields) {
      if (fields.slug && db.posts.some((p) => p.lang === (fields.lang || 'fr') && p.slug === fields.slug)) throw new ApiError('duplicate');
      if (fields.translation_of && db.posts.some((p) => p.translation_of === fields.translation_of)) throw new ApiError('duplicate');
      const at = new Date().toISOString();
      const p = { lang: 'fr', translation_of: null, slug: null, title: '', summary: '', category: null, publish_date: null, cover_path: null, cover_alt: '', cover_credit: '',
        author_display: 'collectif', blocks: [], ...fields, id: crypto.randomUUID(), status: 'brouillon', author_id: me().id, created_at: at, updated_at: at, updated_by: me().id,
        first_published_at: null, published_at: null, published_version_id: null };
      db.posts.push(p);
      saveVersion(p);
      save();
      return wait(structuredClone(p));
    },
    async savePost(id, fields, expected) {
      const p = db.posts.find((x) => x.id === id);
      if (!p) throw new ApiError('forbidden');
      if (expected && p.updated_at !== expected) throw Object.assign(new ApiError('conflict'), { who: nameOf(p.updated_by), at: p.updated_at });
      if (fields.slug && fields.slug !== p.slug && db.posts.some((x) => x.id !== id && x.lang === p.lang && x.slug === fields.slug)) throw new ApiError('duplicate');
      if (fields.author_display && fields.author_display !== 'collectif' && fields.author_display !== p.author_display && p.author_id !== me().id) throw new ApiError('author');
      const next = { ...p, ...fields, slug: p.first_published_at ? p.slug : fields.slug ?? p.slug };
      if (JSON.stringify(pick(next)) !== JSON.stringify(pick(p))) {
        Object.assign(p, next, { updated_at: new Date().toISOString(), updated_by: me().id });
        saveVersion(p);
      }
      save();
      return wait(structuredClone(p));
    },
    async publishPost(id, expected) {
      const p = db.posts.find((x) => x.id === id);
      if (expected && p.updated_at !== expected) throw new ApiError('conflict');
      if (p.status === 'corbeille') throw new ApiError('error', 'trashed');
      const fr = db.posts.find((x) => x.id === p.translation_of);
      const details = postProblems(p, { authorName: authorLabel(p), frPublished: fr?.status === 'publie', today: parisDay(Date.now()) });
      if (details.length) throw Object.assign(new ApiError('incomplete'), { details });
      log('post.publish', postTarget(p), { first: !p.first_published_at });
      Object.assign(p, { status: 'publie', published_version_id: latest(p.id), first_published_at: p.first_published_at || new Date().toISOString(), published_at: new Date().toISOString() });
      save();
      await wait();
    },
    async trashPost(id) {
      for (const p of db.posts.filter((x) => (x.id === id || x.translation_of === id) && x.status !== 'corbeille')) {
        log(p.status === 'publie' ? 'post.unpublish' : 'post.trash', postTarget(p));
        p.status = 'corbeille';
      }
      save();
      await wait();
    },
    async restorePost(id, withTranslation = false) {
      for (const p of db.posts.filter((x) => x.status === 'corbeille' && (x.id === id || (withTranslation && x.translation_of === id)))) {
        log('post.restore', postTarget(p));
        p.status = 'brouillon';
      }
      save();
      await wait();
    },
    async postHistory(id) {
      const p = db.posts.find((x) => x.id === id);
      return wait(db.versions.filter((v) => v.post_id === id).reverse().map((v) => ({
        id: v.id, saved_at: v.saved_at, who: nameOf(v.saved_by), restored_from: v.restored_from,
        restored_from_at: db.versions.find((o) => o.id === v.restored_from)?.saved_at ?? null, live: v.id === p.published_version_id && p.status === 'publie',
      })));
    },
    postVersion: async (versionId) => wait(structuredClone(db.versions.find((v) => v.id === versionId))),
    async restoreVersion(versionId, expected) {
      const v = db.versions.find((x) => x.id === versionId);
      const p = db.posts.find((x) => x.id === v.post_id);
      if (expected && p.updated_at !== expected) throw new ApiError('conflict');
      const display = me().id === p.author_id || v.author_display === 'collectif' ? v.author_display : p.author_display;
      const next = { ...pick(v), slug: p.first_published_at ? p.slug : v.slug, author_display: display };
      if (JSON.stringify(pick({ ...p, ...next })) !== JSON.stringify(pick(p))) {
        Object.assign(p, next, { updated_at: new Date().toISOString(), updated_by: me().id });
        saveVersion(p, versionId);
      }
      log('post.version_restore', postTarget(p), { saved_at: v.saved_at });
      save();
      return wait(p.updated_at);
    },
    postPreview: async (id) => wait(db.previews.find((l) => l.post_id === id && !l.revoked_at && Date.parse(l.expires_at) > Date.now()) || null),
    async createPreview(id) {
      db.previews.forEach((l) => l.post_id === id && (l.revoked_at ||= new Date().toISOString()));
      const token = `demo-${crypto.randomUUID().replace(/-/g, '')}`;
      db.previews.push({ token, post_id: id, created_at: new Date().toISOString(), expires_at: new Date(Date.now() + 7 * day).toISOString(), revoked_at: null });
      log('post.preview', postTarget(db.posts.find((x) => x.id === id)));
      save();
      return wait(token);
    },
    async revokePreview(id) {
      db.previews.forEach((l) => l.post_id === id && (l.revoked_at ||= new Date().toISOString()));
      log('post.preview_revoke', postTarget(db.posts.find((x) => x.id === id)));
      save();
      await wait();
    },
    async uploadBlogImage(blob) {
      const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' }[blob.type];
      if (!ext) throw new ApiError('image_type');
      const path = `${crypto.randomUUID()}.${ext}`;
      images.set(path, URL.createObjectURL(blob));
      return wait(path);
    },
    blogImageUrl: (path) => (path === DEMO_IMAGE ? `${BASE}/crevette-jaune.png` : images.get(path) || null),
    async cancelInvitation(email) {
      db.invitations = db.invitations.filter((i) => i.email !== email);
      log('invitation.delete', email);
      save();
    },
    async setActive(id, active) {
      const p = db.staff.find((s) => s.id === id);
      if (p && p.role !== 'admin') {
        const from = p.role;
        p.role = active ? 'organizer' : 'disabled';
        if (from !== p.role) log('account.role', p.email, { from, to: p.role });
      }
      save();
    },
    publishNow: async () => wait(),
    auditLog: async () => wait(db.audit || []),
    async campaigns() {
      const name = (uid) => db.staff.find((p) => p.id === uid)?.display_name ?? null;
      return wait(db.campaigns.map((c) => {
        const ev = db.events.find((e) => e.id === c.dest_event_id);
        const st = db.campaignStats[c.id] || [];
        const sum = (k, ch) => st.reduce((a, r) => a + (!ch || r.channel === ch ? r[k] : 0), 0);
        return {
          ...c, dest_event_id: ev ? c.dest_event_id : null, creator_name: name(c.created_by),
          event_slug: ev?.slug ?? null, event_title: ev?.title ?? null, event_starts_at: ev?.starts_at ?? null, event_ends_at: ev?.ends_at ?? null, event_status: ev?.status ?? null,
          visits_qr: sum('visits', 'qr'), visits_link: sum('visits', 'link'), rsvps: sum('rsvps'), share_clicks: sum('share_clicks'), shares_done: sum('shares_done'), newsletter: sum('newsletter'),
        };
      }).sort((a, b) => b.created_at.localeCompare(a.created_at)));
    },
    campaignStats: async (id) => wait(structuredClone(db.campaignStats[id] || [])),
    async campaignHistory(id) {
      const c = db.campaigns.find((x) => x.id === id);
      const name = (uid) => db.staff.find((p) => p.id === uid)?.display_name ?? null;
      return wait(!c ? [] : [
        { at: c.created_at, who: name(c.created_by), action: 'campaign.create', fields: null },
        ...(db.audit || []).filter((a) => a.action === 'campaign.update' && a.target === c.code_link).map((a) => ({ at: a.at, who: a.who, action: a.action, fields: a.detail.fields })),
        c.archived_at && { at: c.archived_at, who: name(c.archived_by), action: 'campaign.archive', fields: null },
      ].filter(Boolean).sort((a, b) => a.at.localeCompare(b.at)));
    },
    async createCampaign(fields) {
      const taken = (n) => db.campaigns.some((c) => c.name.toLowerCase() === n.toLowerCase());
      if (taken(fields.name)) throw new ApiError('duplicate');
      const codes = new Set(db.campaigns.flatMap((c) => [c.code_qr, c.code_link]));
      const code = () => {
        let s;
        do s = Array.from({ length: 6 }, () => '23456789abcdefghjkmnpqrstuvwxyz'[Math.floor(Math.random() * 31)]).join('');
        while (codes.has(s));
        codes.add(s);
        return s;
      };
      const c = { id: crypto.randomUUID(), ...fields, code_qr: code(), code_link: code(), created_by: db.profile.id, created_at: new Date().toISOString(), archived_at: null, archived_by: null };
      db.campaigns.push(c);
      log('campaign.create', c.code_link);
      save();
      return wait({ id: c.id });
    },
    async updateCampaign(id, fields) {
      const c = db.campaigns.find((x) => x.id === id);
      if (fields.name && db.campaigns.some((x) => x.id !== id && x.name.toLowerCase() === fields.name.toLowerCase())) throw new ApiError('duplicate');
      const changed = Object.keys(fields).filter((k) => fields[k] !== c[k]).sort();
      Object.assign(c, fields);
      if (changed.length) log('campaign.update', c.code_link, { fields: changed });
      save();
      await wait();
    },
    async archiveCampaign(id) {
      const c = db.campaigns.find((x) => x.id === id);
      if (!c.archived_at) {
        Object.assign(c, { archived_at: new Date().toISOString(), archived_by: db.profile.id });
        log('campaign.archive', c.code_link);
      }
      save();
      await wait();
    },
    // demo: no QR code, any 6 digits work
    mfaStatus: async () => ({ level: db.aal || 'aal1', hasFactor: Boolean(db.mfa) }),
    mfaEnroll: async () => wait({ factorId: 'demo-factor', qr: null, secret: 'DEMO DEMO DEMO DEMO' }),
    async mfaVerify(code) {
      await wait();
      if (!/^\d{6}$/.test(code)) throw new ApiError('mfa_code');
      db.mfa = true;
      db.aal = 'aal2';
      save();
    },
    resetDemo() {
      db = fresh();
      db.signedIn = true;
      save();
    },
  };
}

export const api = DEMO ? demoApi() : realApi();
