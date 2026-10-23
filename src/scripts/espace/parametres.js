// /espace/parametres/ — organiser accounts, security log, republish. Admins only (the database checks it too).
import { api } from './api.js';
import { el, fill, mount, header, toast, errorText, requireSession, requireRight, fmtDate, fmtDateTime, loading, table } from './ui.js';

// Rights an admin ticks per account (the database checks them on every call)
const RIGHTS = [
  ['actions', 'Actions', 'créer et modifier les actions, voir leurs chiffres et les prénoms des participant·es'],
  ['campaigns', 'Campagnes', 'créer, modifier et archiver les liens et QR codes'],
  ['blog', 'Blog', 'écrire, publier et dépublier les articles'],
];
const rightsText = (list) => RIGHTS.filter(([k]) => (list || []).includes(k)).map(([, label]) => label).join(' · ') || '—';

/** Three checkboxes; returns [node, () => ticked rights]. */
function rightsPicker(prefix, ticked, withHelp = false) {
  const boxes = RIGHTS.map(([k]) => el('input', { type: 'checkbox', id: `${prefix}-${k}`, value: k, checked: ticked.includes(k) }));
  const node = el('div', { class: 'rights-picker', role: 'group', 'aria-label': 'Droits' },
    RIGHTS.map(([k, label, help], i) => el('label', { class: 'check rights-option', for: `${prefix}-${k}` }, boxes[i], el('span', {}, el('strong', {}, label), withHelp && el('span', { class: 'small' }, ` : ${help}`)))));
  return [node, () => boxes.filter((b) => b.checked).map((b) => b.value)];
}

function inviteForm(reload) {
  const email = el('input', { id: 'inv-email', type: 'email', required: true, autocomplete: 'off' });
  const name = el('input', { id: 'inv-name', type: 'text', maxlength: 80 });
  const city = el('input', { id: 'inv-city', type: 'text', maxlength: 80 });
  const [picker, ticked] = rightsPicker('inv', ['actions'], true);
  const btn = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Inviter');
  return el('form', {
      class: 'paper',
      onsubmit: async (e) => {
        e.preventDefault();
        if (!ticked().length) return toast('Coche au moins un droit.', 'error');
        btn.disabled = true;
        try {
          await api.invite({ email: email.value, display_name: name.value.trim(), city: city.value.trim(), rights: ticked() });
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
    el('p', { class: 'small' }, 'La personne reçoit un lien de connexion par email. Elle ne voit que les onglets de ses droits, et jamais les emails des participant·es.'),
    el('div', { class: 'form-grid three' },
      el('div', { class: 'field' }, el('label', { for: 'inv-email' }, 'Email'), email),
      el('div', { class: 'field' }, el('label', { for: 'inv-name' }, 'Prénom ou pseudo'), name),
      el('div', { class: 'field' }, el('label', { for: 'inv-city' }, 'Ville'), city)),
    el('div', { class: 'field' }, el('span', { class: 'label' }, 'Droits'), picker),
    el('div', { class: 'form-foot' }, btn),
  );
}

/** The « Droits » cell: the rights, and « Modifier » opens the checkboxes in place. */
function rightsCell(r, me, reload) {
  if (r.role === 'admin') return 'Tous (admin)';
  const cell = el('span', { class: 'rights-cell' });
  const show = () => fill(cell, el('span', {}, rightsText(r.rights)), r.id !== me && el('button', { class: 'linkish', type: 'button', 'aria-label': `Modifier les droits de ${r.display_name || r.email}`, onclick: edit }, 'Modifier'));
  function edit() {
    const [picker, ticked] = rightsPicker(`r-${r.id}`, r.rights || []);
    const save = el('button', { class: 'btn btn-primary btn-small', type: 'button' }, 'Enregistrer');
    save.onclick = async () => {
      if (!ticked().length) return toast('Coche au moins un droit (pour tout retirer : « Désactiver »).', 'error');
      save.disabled = true;
      try {
        await api.setRights(r.id, ticked());
        toast(`Droits de ${r.display_name || r.email} : ${rightsText(ticked())}`);
        reload();
      } catch (err) {
        toast(errorText(err), 'error');
        save.disabled = false;
      }
    };
    fill(cell, picker, el('span', { class: 'row-actions' }, save, el('button', { class: 'linkish', type: 'button', onclick: show }, 'Annuler')));
    cell.querySelector('input')?.focus();
  }
  show();
  return cell;
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
        { label: 'Droits', render: (r) => rightsCell(r, me, reload) },
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
          { label: 'Droits', render: (r) => rightsText(r.rights) },
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
  'account.rights': 'Droits modifiés',
  'post.publish': 'Article publié',
  'post.unpublish': 'Article dépublié',
  'post.trash': 'Brouillon mis à la corbeille',
  'post.restore': 'Article restauré',
  'post.version_restore': 'Version restaurée',
  'post.preview': 'Lien d’aperçu créé',
  'post.preview_revoke': 'Lien d’aperçu révoqué',
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
  if (r.action === 'account.rights') return `${rightsText(d.from)} → ${rightsText(d.to)}`;
  if (r.action === 'invitation.create' && d.rights) return rightsText(d.rights);
  if (r.action === 'post.publish') return d.first ? 'première publication' : 'modifications publiées';
  if (r.action === 'post.version_restore' && d.saved_at) return `version du ${fmtDateTime(d.saved_at)}`;
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
    el('p', { class: 'small' }, 'Les 200 dernières opérations de l’espace orga : connexions, actions créées, modifiées ou supprimées, campagnes créées, modifiées ou archivées, articles publiés, dépubliés ou restaurés, liens d’aperçu, comptes, droits et invitations, listes de participant·es ouvertes. Gardé un an. Le contenu des textes n’est pas enregistré, seulement les champs modifiés.'),
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
  if (!ctx || !requireRight(ctx, 'admin', 'settings')) return;
  const mainEl = el('main', { class: 'esp-main esp-dash' });
  mount(header(ctx, 'settings'), mainEl);
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
