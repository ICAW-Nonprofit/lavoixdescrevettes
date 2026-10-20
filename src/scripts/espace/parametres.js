// /espace/parametres/ — organiser accounts, security log, republish. Admins only (the database checks it too).
import { api } from './api.js';
import { el, fill, mount, header, link, toast, errorText, requireSession, fmtDate, fmtDateTime, loading, table } from './ui.js';

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
    el('p', { class: 'small' }, 'La personne reçoit un lien de connexion par email. Elle pourra créer et modifier toutes les actions et verra les prénoms des participant·es, jamais leurs emails.'),
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
      (r) => r.role === 'disabled' && 'is-muted',
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
  'campaign.create': 'Campagne créée',
  'campaign.update': 'Campagne modifiée',
  'campaign.archive': 'Campagne archivée',
};
const ROLE = { admin: 'admin', organizer: 'orga', disabled: 'désactivé' };
const FIELD = {
  title: 'titre', title_en: 'titre EN', status: 'statut', kind: 'type', target: 'cible', starts_at: 'date', ends_at: 'fin',
  street: 'adresse', postal_code: 'adresse', city: 'adresse', lat: 'adresse', lng: 'adresse', meeting_point: 'point de RDV',
  summary: 'résumé', summary_en: 'résumé EN', description: 'description', description_en: 'description EN',
  share_text: 'texte de partage', share_text_en: 'texte de partage EN', whatsapp_url: 'WhatsApp', custom_poster: 'affiche',
  flyer_tagline: 'affiche', flyer_place: 'affiche', recap_participants: 'bilan', recap_text: 'bilan', recap_links: 'bilan',
  // campaigns
  name: 'nom', dest_event_id: 'destination', dest_page: 'destination', fallback_page: 'page de secours',
};
function logDetail(r) {
  const d = r.detail || {};
  if ((r.action === 'action.update' || r.action === 'campaign.update') && Array.isArray(d.fields)) return [...new Set(d.fields.map((f) => FIELD[f] || f))].join(', ');
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
    el('p', { class: 'small' }, 'Les 200 dernières opérations de l’espace orga : connexions, actions créées, modifiées ou supprimées, campagnes créées, modifiées ou archivées, comptes et invitations, listes de participant·es ouvertes. Gardé un an. Le contenu des textes n’est pas enregistré, seulement les champs modifiés.'),
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
  const mainEl = el('main', { class: 'esp-main esp-dash' });
  mount(header(ctx, 'settings'), mainEl);
  if (ctx.profile.role !== 'admin') return fill(mainEl, el('p', { class: 'paper' }, 'Réservé aux admins. ', el('a', { href: link('/espace/') }, 'Retour')));
  const orgBox = el('section', { 'aria-label': 'Organisateur·ices' }, loading());
  const logBox = el('section', { class: 'u-mt36', 'aria-label': 'Journal de sécurité' }, loading());
  fill(mainEl,
    el('div', { class: 'esp-head' },
      el('h1', {}, 'Paramètres'),
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
    orgBox,
    logBox,
  );
  organisers(orgBox, ctx.user.id);
  journal(logBox);
}

main();
