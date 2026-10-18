// /espace/admin/ — dashboard (numbers per action, city, organiser) and organiser accounts. Admins only.
import { api } from './api.js';
import { el, fill, $, mount, header, link, toast, errorText, requireSession, fmtDate, fmtDateTime, isPast, loading } from './ui.js';

const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
const kpi = (n, label, sub) => el('div', { class: 'kpi' }, el('strong', {}, String(n)), el('span', {}, label), sub && el('small', {}, sub));

/** Bar chart of sign-ups per day (inline SVG, no library). */
function chart(perDay, days = 60) {
  const map = new Map(perDay.map((r) => [String(r.day).slice(0, 10), r.count]));
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(Date.now() - i * 86400000);
    const key = new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(d);
    series.push({ key, n: map.get(key) || 0 });
  }
  const max = Math.max(1, ...series.map((s) => s.n));
  const W = 600, H = 160, bw = W / days;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H + 18}`);
  svg.setAttribute('class', 'chart');
  svg.setAttribute('role', 'img');
  const total = series.reduce((a, s) => a + s.n, 0);
  svg.setAttribute('aria-label', `${total} « J’y vais » sur les ${days} derniers jours, maximum ${max} en un jour`);
  series.forEach((s, i) => {
    const h = (s.n / max) * H;
    const r = document.createElementNS(NS, 'rect');
    Object.entries({ x: i * bw + 1, y: H - h, width: Math.max(1, bw - 2), height: h }).forEach(([k, v]) => r.setAttribute(k, v));
    const t = document.createElementNS(NS, 'title');
    t.textContent = `${s.key} : ${s.n}`;
    r.append(t);
    svg.append(r);
  });
  const axis = document.createElementNS(NS, 'line');
  Object.entries({ x1: 0, y1: H, x2: W, y2: H }).forEach(([k, v]) => axis.setAttribute(k, v));
  svg.append(axis);
  for (const [i, label] of [[0, series[0].key.slice(5)], [days - 1, 'auj.']]) {
    const tx = document.createElementNS(NS, 'text');
    tx.setAttribute('x', i === 0 ? 0 : W);
    tx.setAttribute('y', H + 15);
    tx.setAttribute('text-anchor', i === 0 ? 'start' : 'end');
    tx.textContent = label;
    svg.append(tx);
  }
  return svg;
}

function table(cols, rows) {
  return el('div', { class: 'table-wrap' },
    el('table', { class: 'esp-table' },
      el('thead', {}, el('tr', {}, cols.map((c) => el('th', { scope: 'col', class: c.num ? 'num' : null }, c.label)))),
      el('tbody', {}, rows.map((r) => el('tr', {}, cols.map((c) => el('td', { class: c.num ? 'num' : null }, c.render ? c.render(r) : r[c.key] ?? '—')))))));
}

function groupBy(rows, key) {
  const m = new Map();
  for (const r of rows) {
    const k = r[key] || '—';
    const g = m.get(k) || { name: k, actions: 0, rsvps: 0, views: 0, shares: 0, newsletter: 0, present: 0 };
    g.actions++;
    g.rsvps += r.rsvps || 0;
    g.views += r.views || 0;
    g.shares += r.shares || 0;
    g.newsletter += r.newsletter || 0;
    g.present += r.recap_participants || 0;
    m.set(k, g);
  }
  return [...m.values()].sort((a, b) => b.rsvps - a.rsvps);
}

function inviteForm(reload) {
  const email = el('input', { id: 'inv-email', type: 'email', required: true, autocomplete: 'off' });
  const name = el('input', { id: 'inv-name', type: 'text', maxlength: 80 });
  const city = el('input', { id: 'inv-city', type: 'text', maxlength: 80 });
  const btn = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Inviter');
  return el('form', {
      class: 'paper',
      onsubmit: async (e) => {
        e.preventDefault();
        btn.disabled = true;
        try {
          await api.invite({ email: email.value, display_name: name.value.trim(), city: city.value.trim() });
          toast(api.demo ? 'Invitation ajoutée (démo : aucun email envoyé)' : `Invitation envoyée à ${email.value.trim()}`);
          e.target.reset();
          reload();
        } catch (err) {
          toast(errorText(err), 'error');
        } finally {
          btn.disabled = false;
        }
      },
    },
    el('h3', {}, 'Inviter un·e organisateur·ice'),
    el('p', { class: 'small' }, 'La personne reçoit un lien de connexion par email. Elle pourra créer et modifier toutes les actions, mais ne verra ni les noms ni les emails des participant·es.'),
    el('div', { class: 'form-grid three' },
      el('div', { class: 'field' }, el('label', { for: 'inv-email' }, 'Email'), email),
      el('div', { class: 'field' }, el('label', { for: 'inv-name' }, 'Prénom ou pseudo'), name),
      el('div', { class: 'field' }, el('label', { for: 'inv-city' }, 'Ville'), city)),
    el('div', { class: 'form-foot' }, btn),
  );
}

async function organisers(box, me) {
  const reload = () => organisers(box, me);
  let staff, invites;
  try {
    [staff, invites] = await Promise.all([api.staff(), api.invitations()]);
  } catch (err) {
    return fill(box, el('p', {}, errorText(err)));
  }
  const pending = invites.filter((i) => !staff.some((s) => s.email === i.email));
  fill(box, 
    el('h2', { class: 'esp-h2' }, 'Organisateur·ices'),
    inviteForm(reload),
    table(
      [
        { label: 'Nom', render: (r) => [r.display_name || '—', r.role === 'admin' ? el('span', { class: 'chip' }, 'admin') : null] },
        { label: 'Email', key: 'email' },
        { label: 'Ville', key: 'city' },
        { label: 'Actions créées', key: 'actions', num: true },
        { label: 'Dernière connexion', render: (r) => (r.last_sign_in_at ? fmtDateTime(r.last_sign_in_at) : 'jamais') },
        {
          label: '',
          render: (r) =>
            r.role === 'admin' || r.id === me
              ? ''
              : el('button', {
                  class: 'btn btn-ghost btn-small',
                  type: 'button',
                  onclick: async () => {
                    try {
                      await api.setActive(r.id, r.role === 'disabled');
                      reload();
                    } catch (err) {
                      toast(errorText(err), 'error');
                    }
                  },
                }, r.role === 'disabled' ? 'Réactiver' : 'Désactiver'),
        },
      ],
      staff,
    ),
    pending.length > 0 && el('h3', { class: 'u-mt36' }, `Invitations en attente (${pending.length})`),
    pending.length > 0 &&
      table(
        [
          { label: 'Email', key: 'email' },
          { label: 'Nom', key: 'display_name' },
          { label: 'Invité·e le', render: (r) => fmtDate(r.created_at) },
          {
            label: '',
            render: (r) =>
              el('span', { class: 'row-actions' },
                el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: async () => { try { await api.invite(r); toast('Lien renvoyé'); } catch (err) { toast(errorText(err), 'error'); } } }, 'Renvoyer le lien'),
                el('button', { class: 'linkish danger', type: 'button', onclick: async () => { await api.cancelInvitation(r.email); reload(); } }, 'Annuler')),
          },
        ],
        pending,
      ),
  );
}

// ---------- security log ----------
const WHAT = {
  'action.create': 'Action créée',
  'action.update': 'Action modifiée',
  'action.delete': 'Action supprimée',
  'account.create': 'Compte créé',
  'account.role': 'Compte modifié',
  'invitation.create': 'Invitation envoyée',
  'invitation.delete': 'Invitation annulée',
  login: 'Connexion',
  'attendees.view': 'Liste des participant·es ouverte',
};
const ROLE = { admin: 'admin', organizer: 'orga', disabled: 'désactivé' };
const FIELD = {
  title: 'titre', title_en: 'titre EN', status: 'statut', kind: 'type', target: 'cible', starts_at: 'date', ends_at: 'fin',
  street: 'adresse', postal_code: 'adresse', city: 'adresse', lat: 'adresse', lng: 'adresse', meeting_point: 'point de RDV',
  summary: 'résumé', summary_en: 'résumé EN', description: 'description', description_en: 'description EN',
  share_text: 'texte de partage', share_text_en: 'texte de partage EN', whatsapp_url: 'WhatsApp', custom_poster: 'affiche',
  flyer_tagline: 'affiche', flyer_place: 'affiche', recap_participants: 'bilan', recap_text: 'bilan', recap_links: 'bilan',
};
function logDetail(r) {
  const d = r.detail || {};
  if (r.action === 'action.update' && Array.isArray(d.fields)) return [...new Set(d.fields.map((f) => FIELD[f] || f))].join(', ');
  if (r.action === 'action.delete') return d.title || '';
  if (r.action === 'account.role') return `${ROLE[d.from] || d.from} → ${ROLE[d.to] || d.to}`;
  return '';
}

async function journal(box) {
  let rows;
  try {
    rows = await api.auditLog(200);
  } catch (err) {
    return fill(box, el('p', {}, errorText(err)));
  }
  fill(box,
    el('h2', { class: 'esp-h2' }, 'Journal de sécurité'),
    el('p', { class: 'small' }, 'Les 200 dernières opérations de l’espace orga : connexions, actions créées, modifiées ou supprimées, comptes et invitations, listes de participant·es ouvertes. Gardé un an. Le contenu des textes n’est pas enregistré, seulement les champs modifiés.'),
    rows.length
      ? table(
          [
            { label: 'Quand', render: (r) => fmtDateTime(r.at) },
            { label: 'Qui', render: (r) => r.who || 'Supabase (auto)' },
            { label: 'Quoi', render: (r) => WHAT[r.action] || r.action },
            { label: 'Sur', render: (r) => r.target || '—' },
            { label: 'Détail', render: (r) => logDetail(r) || '—' },
          ],
          rows,
        )
      : el('p', { class: 'paper' }, 'Rien pour l’instant.'),
  );
}

async function main() {
  const ctx = await requireSession();
  if (!ctx) return;
  const mainEl = el('main', { class: 'esp-main' }, loading());
  mount(header(ctx, 'admin'), mainEl);
  if (ctx.profile.role !== 'admin') return fill(mainEl, el('p', { class: 'paper' }, 'Réservé aux admins. ', el('a', { href: link('/espace/') }, 'Retour')));

  let rows, perDay;
  try {
    [rows, perDay] = await Promise.all([api.overview(), api.rsvpsPerDay(60)]);
  } catch (err) {
    return fill(mainEl, el('p', { class: 'paper' }, errorText(err)));
  }
  const upcoming = rows.filter((r) => !isPast(r));
  const past = rows.filter(isPast);
  const orgBox = el('section', { 'aria-label': 'Organisateur·ices' }, loading());
  const logBox = el('section', { class: 'u-mt36', 'aria-label': 'Journal de sécurité' }, loading());

  fill(mainEl, 
    el('div', { class: 'esp-head' },
      el('h1', {}, 'Tableau de bord'),
      el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: main }, 'Actualiser'),
      el('button', {
        class: 'btn btn-ghost btn-small',
        type: 'button',
        onclick: async () => {
          try {
            await api.publishNow();
            toast('Mise à jour du site demandée (2 à 3 minutes).');
          } catch (err) {
            toast(errorText(err), 'error');
          }
        },
      }, 'Republier le site')),
    el('div', { class: 'kpis' },
      kpi(upcoming.length, 'actions à venir', `${past.length} passées`),
      kpi(sum(rows, 'rsvps'), '« J’y vais »', `${sum(rows, 'rsvps_with_email')} avec email`),
      kpi(sum(past, 'recap_participants'), 'personnes présentes', 'd’après les bilans'),
      kpi(sum(rows, 'views'), 'vues des pages', 'sans cookies'),
      kpi(sum(rows, 'shares'), 'partages'),
      kpi(sum(rows, 'newsletter'), 'inscriptions newsletter', 'depuis les pages d’actions'),
      kpi(sum(rows, 'calendar'), 'ajouts au calendrier')),
    el('section', { class: 'paper' }, el('h2', {}, '« J’y vais » par jour'), el('p', { class: 'small' }, '60 derniers jours, toutes actions confondues.'), chart(perDay)),
    el('h2', { class: 'esp-h2' }, 'Par action'),
    table(
      [
        { label: 'Action', render: (r) => el('a', { href: `${link('/espace/action/')}?id=${r.id}` }, r.title) },
        { label: 'Date', render: (r) => fmtDate(r.starts_at) },
        { label: 'Ville', key: 'city' },
        { label: 'Par', key: 'creator_name' },
        { label: 'J’y vais', key: 'rsvps', num: true },
        { label: 'Présent·es', key: 'recap_participants', num: true },
        { label: 'Vues', key: 'views', num: true },
        { label: 'Partages', key: 'shares', num: true },
        { label: 'Newsletter', key: 'newsletter', num: true },
        { label: 'Calendrier', key: 'calendar', num: true },
      ],
      rows,
    ),
    el('div', { class: 'two-col u-mt36' },
      el('section', {}, el('h2', { class: 'esp-h2' }, 'Par ville'),
        table([{ label: 'Ville', key: 'name' }, { label: 'Actions', key: 'actions', num: true }, { label: 'J’y vais', key: 'rsvps', num: true }, { label: 'Partages', key: 'shares', num: true }], groupBy(rows, 'city'))),
      el('section', {}, el('h2', { class: 'esp-h2' }, 'Par organisateur·ice'),
        table([{ label: 'Nom', key: 'name' }, { label: 'Actions', key: 'actions', num: true }, { label: 'J’y vais', key: 'rsvps', num: true }, { label: 'Présent·es', key: 'present', num: true }], groupBy(rows, 'creator_name')))),
    orgBox,
    logBox,
  );
  organisers(orgBox, ctx.user.id);
  journal(logBox);
}

main();
