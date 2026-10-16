// /espace/ — login, then the list of actions with their numbers.
import { api, DEMO, SITE } from './api.js';
import { el, mount, header, link, toast, errorText, fmtDay, fmtTime, isPast, loading } from './ui.js';

function loginView() {
  const msg = el('p', { class: 'form-msg', role: 'status' });
  const email = el('input', { id: 'login-email', type: 'email', required: true, autocomplete: 'email', placeholder: 'ton@email.fr' });
  const btn = el('button', { class: 'btn btn-primary', type: 'submit' }, DEMO ? 'Entrer dans la démo' : 'Recevoir mon lien de connexion');
  const form = el(
    'form',
    {
      class: 'paper esp-login',
      onsubmit: async (e) => {
        e.preventDefault();
        btn.disabled = true;
        msg.textContent = 'Envoi…';
        try {
          await api.sendLoginLink(email.value);
          if (DEMO) return start();
          form.replaceChildren(
            el('h1', {}, 'Regarde tes emails'),
            el('p', { class: 'big-text' }, 'On vient d’envoyer un lien de connexion à ', el('strong', {}, email.value.trim()), '.'),
            el('p', {}, 'Ouvre-le sur cet appareil (ou n’importe lequel). Il est valable une heure. Pas reçu ? Regarde dans les spams, ou réessaie dans une minute.'),
            el('button', { class: 'linkish', type: 'button', onclick: () => mount(header(null), el('main', { class: 'esp-main' }, loginView())) }, 'Utiliser une autre adresse'),
          );
        } catch (err) {
          msg.textContent = errorText(err);
          btn.disabled = false;
        }
      },
    },
    el('h1', {}, 'Espace organisation'),
    el('p', { class: 'big-text' }, 'Crée et gère les actions pour les crevettes. Pas de mot de passe : on t’envoie un lien de connexion par email.'),
    el('div', { class: 'field' }, el('label', { for: 'login-email' }, 'Ton email'), email),
    el('div', { class: 'form-foot' }, btn, msg),
    el('p', { class: 'small' }, 'Accès sur invitation uniquement. Tu veux organiser une action ? ', el('a', { href: link('/contact/') }, 'Écris-nous'), '.'),
  );
  return form;
}

function profileForm(ctx, onDone) {
  const name = el('input', { id: 'pf-name', type: 'text', maxlength: 80, required: true, value: ctx.profile.display_name || '' });
  const city = el('input', { id: 'pf-city', type: 'text', maxlength: 80, value: ctx.profile.city || '' });
  return el(
    'form',
    {
      class: 'paper',
      onsubmit: async (e) => {
        e.preventDefault();
        try {
          await api.updateProfile({ display_name: name.value.trim(), city: city.value.trim() || null });
          toast('Profil enregistré');
          onDone();
        } catch (err) {
          toast(errorText(err), 'error');
        }
      },
    },
    el('h2', {}, 'Bienvenue !'),
    el('p', {}, 'Dis-nous comment t’appeler (visible seulement par l’équipe).'),
    el('div', { class: 'form-grid' },
      el('div', { class: 'field' }, el('label', { for: 'pf-name' }, 'Prénom ou pseudo'), name),
      el('div', { class: 'field' }, el('label', { for: 'pf-city' }, 'Ville ', el('span', { class: 'opt' }, '(facultatif)')), city)),
    el('div', { class: 'form-foot' }, el('button', { class: 'btn btn-primary', type: 'submit' }, 'Enregistrer')),
  );
}

const stat = (n, label) => el('span', { class: 'stat' }, el('strong', {}, String(n ?? 0)), ' ', label);

function eventCard(e, admin) {
  const past = isPast(e);
  const status = { cancelled: 'Annulée', postponed: 'Reportée' }[e.status];
  const pageUrl = `${SITE}/agenda/${e.slug}/`;
  return el(
    'li',
    { class: `esp-card${past ? ' is-past' : ''}` },
    el('div', { class: 'esp-card-date' }, el('span', {}, fmtDay(e.starts_at)), el('span', {}, fmtTime(e.starts_at))),
    el('div', { class: 'esp-card-body' },
      el('h3', {}, e.title, status && el('span', { class: 'badge' }, status)),
      el('p', { class: 'meta' }, e.city, e.creator_name && ` · par ${e.creator_name}`),
      el('p', { class: 'stats' },
        stat(e.rsvps, 'j’y vais'), admin && e.rsvps_with_email ? el('span', { class: 'stat' }, `(${e.rsvps_with_email} avec email)`) : null,
        stat(e.views, 'vues'), stat(e.shares, 'partages'), stat(e.newsletter, 'newsletter'),
        past && e.recap_participants ? stat(e.recap_participants, 'présent·es') : null),
      el('div', { class: 'esp-card-actions' },
        el('a', { class: 'btn btn-primary btn-small', href: `${link('/espace/action/')}?id=${e.id}` }, past && !e.recap_participants ? 'Ajouter le bilan' : 'Modifier'),
        el('a', { class: 'btn btn-ghost btn-small', href: pageUrl, target: '_blank', rel: 'noopener' }, 'Voir la page ↗'),
        el('button', {
          class: 'btn btn-ghost btn-small',
          type: 'button',
          onclick: async () => {
            try {
              await navigator.clipboard.writeText(pageUrl);
              toast('Lien copié');
            } catch {
              prompt('', pageUrl);
            }
          },
        }, 'Copier le lien'))),
  );
}

async function dashboard(ctx) {
  const admin = ctx.profile.role === 'admin';
  const main = el('main', { class: 'esp-main' }, loading());
  mount(header(ctx, 'home'), main);
  if (!ctx.profile.display_name) {
    main.replaceChildren(profileForm(ctx, start));
    return;
  }
  let rows = [];
  try {
    rows = await api.overview();
  } catch (err) {
    main.replaceChildren(el('p', { class: 'paper' }, errorText(err)));
    return;
  }
  const upcoming = rows.filter((e) => !isPast(e)).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  const past = rows.filter(isPast);
  main.replaceChildren(
    el('div', { class: 'esp-head' },
      el('h1', {}, 'Les actions'),
      el('a', { class: 'btn btn-primary', href: link('/espace/action/') }, '+ Nouvelle action')),
    el('p', {}, 'Tout le monde dans l’équipe peut modifier toutes les actions. Chaque enregistrement met le site à jour en ~2 minutes.'),
    el('h2', { class: 'esp-h2' }, `À venir (${upcoming.length})`),
    upcoming.length ? el('ul', { class: 'esp-cards' }, upcoming.map((e) => eventCard(e, admin))) : el('p', { class: 'paper' }, 'Aucune action prévue. Lance la prochaine !'),
    past.length > 0 && el('h2', { class: 'esp-h2' }, `Passées (${past.length})`),
    past.length > 0 && el('ul', { class: 'esp-cards' }, past.map((e) => eventCard(e, admin))),
  );
}

async function start() {
  const ctx = await api.session();
  if (!ctx) {
    mount(header(null), el('main', { class: 'esp-main' }, loginView()));
    return;
  }
  if (!ctx.profile || ctx.profile.role === 'disabled') {
    mount(header(ctx), el('main', { class: 'esp-main' }, el('div', { class: 'paper' }, el('h1', {}, 'Compte désactivé'), el('p', {}, 'Ton compte n’est pas (ou plus) actif. Contacte l’équipe si c’est une erreur.'))));
    return;
  }
  const back = sessionStorage.getItem('lvdc-return');
  if (back) {
    sessionStorage.removeItem('lvdc-return');
    location.replace(back);
    return;
  }
  dashboard(ctx);
}

api.onAuthChange((event) => {
  if (event === 'SIGNED_IN') start();
});
start();
