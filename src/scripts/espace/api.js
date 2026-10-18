// Organiser space: everything that talks to the backend goes through `api`.
// Real mode = Supabase (login links, database rules). Demo mode (?demo) = in-memory data in this tab,
// so the space can be tried before Supabase is set up. Nothing in demo mode is ever sent anywhere.
import { createClient } from '@supabase/supabase-js';
import cfg from '../../supabase.json';
import seed from '../../content/events.json';

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
    const first = { ...seed[0], created_by: 'demo-admin' };
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
    };
    return {
      profile: { id: 'demo-admin', email: 'demo@example.org', display_name: 'Démo', city: 'Paris', role: 'admin' },
      events: [first, past],
      rsvps: {
        [first.id]: Array.from({ length: 12 }, (_, i) => ({ name: ['Camille', 'Sam', 'Léa', 'Noé', 'Inès', 'Yanis'][i % 6], email: i % 3 ? null : `demo${i}@example.org`, created_at: iso(now - (i % 9) * day) })),
        [past.id]: Array.from({ length: 30 }, (_, i) => ({ name: 'Militant·e ' + (i + 1), email: null, created_at: iso(now - (22 + (i % 6)) * day) })),
      },
      stats: { [first.id]: { views: 412, shares: 57, newsletter: 9, calendar: 23 }, [past.id]: { views: 980, shares: 121, newsletter: 31, calendar: 40 } },
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
      return JSON.parse(sessionStorage.getItem(KEY)) || fresh();
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
            return { ...e, creator_name: creator?.display_name || 'Démo', rsvps: r.length, rsvps_with_email: r.filter((x) => x.email).length, ...s };
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
      return wait(db.rsvps[id] || []);
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
