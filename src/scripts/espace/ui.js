// Small DOM helpers for the organiser space. Text always goes in as text (never innerHTML).
import { api, BASE, DEMO, CONFIGURED } from './api.js';
import { creatorLabel } from './calc.js';

/** el('div', { class: 'x', onclick: fn }, 'text', child, [children]) */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2), v);
    else if (k === 'class') node.className = v;
    else if (k === 'value') node.value = v; // textareas have no value attribute
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else if (k in node && typeof v !== 'string') node[k] = v;
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

export const $ = (sel, root = document) => root.querySelector(sel);

/** Replace a node's content, skipping empty parts (`cond && el(...)` would otherwise print "false"). */
export function fill(node, ...children) {
  node.replaceChildren(...children.flat(Infinity).filter((c) => c != null && c !== false && c !== ''));
  return node;
}
export const link = (path) => `${BASE}${path}`;

/**
 * "Voir la page" for an action. A new action's page only exists 2–3 minutes after saving (the site rebuilds),
 * so until it answers we show "Publication en cours…" and check again every 15 s.
 */
export function pageLink(url, { label = 'Voir la page ↗', cls = 'btn btn-ghost btn-small' } = {}) {
  const a = el('a', { class: cls, href: url, target: '_blank', rel: 'noopener' }, label);
  if (api.demo) return a;
  const wrap = el('span', { class: 'page-link' }, a);
  const pending = el('span', { class: `${cls} is-pending`, role: 'status', title: 'La page apparaît 2 à 3 minutes après l’enregistrement.' }, 'Publication en cours…');
  let tries = 0;
  const check = async () => {
    try {
      const res = await fetch(url, { method: 'HEAD', cache: 'no-store' });
      if (res.ok) return fill(wrap, a);
    } catch {
      /* offline: try again */
    }
    fill(wrap, pending);
    if (++tries < 40) setTimeout(check, 15000);
  };
  check();
  return wrap;
}

/** Re-run `fn` when the tab comes back into view (numbers stay fresh without reloading). */
export function onReturn(fn) {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) fn();
  });
}

const TZ = 'Europe/Paris';
export const fmtDay = (d) => new Intl.DateTimeFormat('fr-FR', { weekday: 'long', day: 'numeric', month: 'long', timeZone: TZ }).format(new Date(d));
export const fmtDate = (d) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', year: 'numeric', timeZone: TZ }).format(new Date(d));
export const fmtTime = (d) => new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(d)).replace(':', ' h ');
export const fmtDateTime = (d) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: TZ }).format(new Date(d));
export const isPast = (e) => Date.parse(e.ends_at) < Date.now();

/** Paris wall-clock date ("2026-11-04") + time ("11:00") → ISO instant, DST-safe. */
export function parisToISO(date, time) {
  const [y, m, d] = date.split('-').map(Number);
  const [hh, mm] = time.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const offset = (t) => {
    const p = Object.fromEntries(
      new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
        .formatToParts(new Date(t))
        .map((x) => [x.type, x.value]),
    );
    return Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute) - t;
  };
  let t = guess - offset(guess);
  t = guess - offset(t);
  return new Date(t).toISOString();
}

/** ISO instant → { date: '2026-11-04', time: '11:00' } in Paris time */
export function isoToParis(iso) {
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
      .formatToParts(new Date(iso))
      .map((x) => [x.type, x.value]),
  );
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

export function slugify(s) {
  return s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 90)
    .replace(/-+$/, '');
}

let toastTimer;
export function toast(message, kind = 'ok') {
  let t = $('#toast');
  if (!t) document.body.append((t = el('div', { id: 'toast', role: 'status', 'aria-live': 'polite' })));
  t.className = `toast is-${kind} is-shown`;
  t.textContent = message;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('is-shown'), kind === 'error' ? 7000 : 4000);
}

export const errorText = (err) =>
  ({
    forbidden: "Tu n'as pas les droits pour faire ça (compte désactivé ?).",
    duplicate: 'Cette action existe déjà.',
    not_invited: "Cette adresse n'a pas été invitée. Demande une invitation à l'équipe.",
    rate: 'Trop de demandes : attends une minute avant de réessayer.',
    email_send: 'L’email de connexion n’a pas pu partir (souci du côté de l’envoi des emails). Réessaie dans quelques minutes, et préviens l’équipe si ça continue.',
    mfa_code: 'Code incorrect ou expiré. Tape le code affiché en ce moment dans ton appli.',
  })[err?.code] || `Oups, ça n'a pas marché. ${err?.message ? `(${err.message})` : ''}`;

/** Table with optional number columns ({ label, key, num, render }) and a class per row (e.g. grey past rows). */
export function table(cols, rows, rowClass) {
  return el('div', { class: 'table-wrap' },
    el('table', { class: 'esp-table' },
      el('thead', {}, el('tr', {}, cols.map((c) => el('th', { scope: 'col', class: c.num ? 'num' : null }, c.label)))),
      el('tbody', {}, rows.map((r) => el('tr', { class: rowClass?.(r) || null }, cols.map((c) => el('td', { class: c.num ? 'num' : null }, c.render ? c.render(r) : r[c.key] ?? '—')))))));
}

const STATUS = { cancelled: 'Annulée', postponed: 'Reportée' };
export const statusBadge = (e) => STATUS[e.status] && el('span', { class: 'badge' }, STATUS[e.status]);

/** Who created an action: grey for deleted accounts, actions made in SQL and deactivated accounts. */
export const creator = (r) =>
  r.creator_status && r.creator_status !== 'active'
    ? el('span', { class: 'is-muted' }, creatorLabel(r), r.creator_status === 'disabled' && ' (désactivé·e)')
    : creatorLabel(r);

/** Header of every organiser page: the tabs. Sub-pages of Actions (details, editor) keep that tab lit. */
export function header(ctx, current) {
  const admin = ctx?.profile?.role === 'admin';
  const staff = admin || ctx?.profile?.role === 'organizer';
  const tab = (key, href, label, lit = [key]) =>
    el('a', { class: 'esp-tab', href: link(href), 'aria-current': current === key ? 'page' : lit.includes(current) ? 'true' : null }, label);
  const nav = el(
    'nav',
    { class: 'esp-nav', 'aria-label': 'Espace organisation' },
    staff && tab('admin', '/espace/admin/', 'Tableau de bord'),
    tab('home', '/espace/', 'Actions', ['home', 'edit', 'details']),
    admin && tab('settings', '/espace/parametres/', 'Paramètres'),
    el('span', { class: 'esp-nav-end' },
      el('a', { href: link('/') }, 'Voir le site ↗'),
      ctx &&
        el('button', {
          class: 'linkish',
          type: 'button',
          onclick: async () => {
            await api.signOut();
            location.href = link('/espace/');
          },
        }, 'Se déconnecter')),
  );
  return el(
    'header',
    { class: 'esp-header' },
    DEMO &&
      el('p', { class: 'esp-demo' }, CONFIGURED ? 'Mode démo : rien n’est enregistré. ' : 'Mode démo (Supabase pas encore branché) : rien n’est enregistré. ',
        api.resetDemo && el('button', { class: 'linkish', type: 'button', onclick: () => { api.resetDemo(); location.reload(); } }, 'Réinitialiser'),
        CONFIGURED && el('a', { href: `${link('/espace/')}?nodemo` }, ' Quitter la démo')),
    el('div', { class: 'esp-bar' },
      el('a', { class: 'esp-brand', href: link('/espace/') }, el('img', { src: link('/logo-bleu.svg'), alt: 'La Voix des Crevettes', width: 875, height: 655 }), el('strong', {}, 'Espace orga')),
      ctx && el('span', { class: 'esp-who' }, ctx.profile?.display_name || ctx.user.email, admin && el('span', { class: 'chip' }, 'admin')),
    ),
    ctx && nav,
  );
}

/** Pages other than the home page require a session; otherwise go to the login page and come back. */
export async function requireSession() {
  const ctx = await api.session();
  if (!ctx) {
    sessionStorage.setItem('lvdc-return', location.pathname + location.search);
    location.replace(link('/espace/'));
    return null;
  }
  if (!ctx.profile || ctx.profile.role === 'disabled') {
    mount(header(ctx), el('main', { class: 'esp-main' }, el('div', { class: 'paper' }, el('h1', {}, 'Compte désactivé'), el('p', {}, "Ton compte n'est pas (ou plus) actif. Contacte l'équipe si c'est une erreur."))));
    return null;
  }
  if (!(await secondFactor(ctx))) return null;
  return ctx;
}

/** Form asking for the 6-digit code of the authenticator app. A correct code upgrades the session; then the page reloads. */
function codeForm(title, factorId, ...intro) {
  const code = el('input', { id: 'mfa-code', type: 'text', inputmode: 'numeric', autocomplete: 'one-time-code', pattern: '[0-9 ]{6,7}', maxlength: 7, required: true });
  const msg = el('p', { class: 'form-msg', role: 'status' });
  const btn = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Valider');
  return el(
    'form',
    {
      class: 'paper esp-login',
      onsubmit: async (e) => {
        e.preventDefault();
        btn.disabled = true;
        msg.textContent = 'Vérification…';
        try {
          await api.mfaVerify(code.value.replace(/\s/g, ''), factorId);
          location.reload();
        } catch (err) {
          msg.textContent = errorText(err);
          btn.disabled = false;
          code.select();
        }
      },
    },
    el('h1', {}, title),
    intro,
    el('div', { class: 'field' }, el('label', { for: 'mfa-code' }, 'Code à 6 chiffres'), code),
    el('div', { class: 'form-foot' }, btn, msg),
    el('p', { class: 'small mfa-help' }, 'Téléphone perdu ou changé ? Écris à l’équipe : la personne qui gère Supabase peut réinitialiser ta double authentification.'),
  );
}

let enrolling = null;

/**
 * Admins confirm each login with a code from an authenticator app (the database refuses admin rights without it).
 * Returns true when the page can go on; otherwise shows the set-up or code screen and returns false.
 */
export async function secondFactor(ctx) {
  if (ctx.profile?.role !== 'admin') return true;
  const main = el('main', { class: 'esp-main' }, loading());
  try {
    const st = await api.mfaStatus();
    if (st.level === 'aal2') return true;
    mount(header(ctx), main);
    if (st.hasFactor) {
      fill(main, codeForm('Code de sécurité', null,
        el('p', { class: 'big-text' }, 'Ouvre ton appli d’authentification et tape le code à 6 chiffres de « La Voix des Crevettes ».')));
      return false;
    }
    // start() can run twice on a fresh login (page load + sign-in event): set up only one factor per page
    const s = await (enrolling ||= api.mfaEnroll());
    fill(main, codeForm('Active la double authentification', s.factorId,
      el('p', { class: 'big-text' }, 'Ton compte admin voit les noms et emails des participant·es. Pour le protéger, chaque connexion demande en plus un code à 6 chiffres, donné par une appli sur ton téléphone.'),
      el('ol', { class: 'mfa-steps' },
        el('li', {}, 'Installe une appli d’authentification si tu n’en as pas : Google Authenticator, Microsoft Authenticator, 2FAS ou Aegis.'),
        el('li', {}, 'Dans l’appli, ajoute un compte et scanne ce QR code.'),
        el('li', {}, 'Tape ci-dessous le code à 6 chiffres que l’appli affiche.')),
      s.qr
        ? el('img', { class: 'mfa-qr', src: s.qr, alt: 'QR code à scanner avec l’appli d’authentification', width: 200, height: 200 })
        : el('p', { class: 'small' }, 'Démo : pas de vrai QR code, tape n’importe quels 6 chiffres.'),
      el('p', { class: 'small' }, 'Pas de caméra ? Saisis cette clé dans l’appli : ', el('code', { class: 'mfa-secret' }, s.secret))));
  } catch (err) {
    mount(header(ctx), main);
    fill(main, el('p', { class: 'paper' }, errorText(err)));
  }
  return false;
}

export function mount(...nodes) {
  const app = $('#app');
  fill(app, ...nodes);
}

export function loading(text = 'Chargement…') {
  return el('p', { class: 'esp-loading' }, text);
}
