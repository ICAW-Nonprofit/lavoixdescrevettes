// Organiser space: everything that talks to the backend goes through `api`.
// Real mode = Supabase (login links, database rules). Demo mode (?demo) = in-memory data in this tab,
// so the space can be tried before Supabase is set up. Nothing in demo mode is ever sent anywhere.
import { createClient } from '@supabase/supabase-js';
import cfg from '../../supabase.json';
import seed from '../../content/events.json';
import { parisDay } from './calc.js';

export const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
export const SITE = `${location.origin}${BASE}`;

const params = new URLSearchParams(location.search);
if (params.has('demo')) sessionStorage.setItem('lvdc-demo', '1');
if (params.has('nodemo')) sessionStorage.removeItem('lvdc-demo');
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
        profileCache = check(await sb.from('profiles').select('id, email, display_name, city, role').eq('id', user.id).maybeSingle());
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
    async invite({ email, display_name, city }) {
      const clean = email.trim().toLowerCase();
      const res = await sb.from('invitations').insert({ email: clean, display_name: display_name || null, city: city || null });
      if (res.error && res.error.code !== '23505') check(res);
      await this.sendLoginLink(clean);
    },
    cancelInvitation: async (email) => check(await sb.from('invitations').delete().eq('email', email)),
    setActive: async (id, active) => check(await sb.rpc('set_organizer_active', { p_user: id, p_active: active })),
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
    return {
      version: 4,
      campaigns,
      campaignStats,
      profile: { id: 'demo-admin', email: 'demo@example.org', display_name: 'Démo', city: 'Paris', role: 'admin' },
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
        { id: 'demo-admin', email: 'demo@example.org', display_name: 'Démo', city: 'Paris', role: 'admin', created_at: iso(now - 40 * day), last_sign_in_at: iso(now), actions: 1 },
        { id: 'demo-orga', email: 'orga.lyon@example.org', display_name: 'Orga Lyon', city: 'Lyon', role: 'organizer', created_at: iso(now - 30 * day), last_sign_in_at: iso(now - 3 * day), actions: 1 },
      ],
      invitations: [{ email: 'nouvelle@example.org', display_name: 'Nouvelle orga', city: 'Marseille', role: 'organizer', created_at: iso(now - day) }],
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
      return saved?.version === 4 ? saved : fresh(); // older demo data lacks the dashboard's numbers, the campaigns or the actions' creation dates
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

  return {
    demo: true,
    session: async () => (db.signedIn ? { user: { id: db.profile.id, email: db.profile.email }, profile: db.profile } : null),
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
      return wait((db.rsvps[id] || []).map((r) => (db.profile.role === 'admin' ? r : { ...r, email: null })));
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
    async invite({ email, display_name, city }) {
      const clean = email.trim().toLowerCase();
      if (!db.invitations.some((i) => i.email === clean)) {
        db.invitations.unshift({ email: clean, display_name, city, role: 'organizer', created_at: new Date().toISOString() });
        log('invitation.create', clean, { role: 'organizer' });
      }
      save();
      await wait();
    },
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
