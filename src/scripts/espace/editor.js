// /espace/action/ — create or edit an action, with a live flyer preview.
import { api, SITE } from './api.js';
import { el, fill, $, mount, header, link, toast, errorText, requireSession, parisToISO, isoToParis, slugify, fmtDateTime, loading, pageLink, onReturn } from './ui.js';
import { addressSearch } from './address.js';
import { renderPreview, previewToJpeg } from './flyer-preview.js';
import { defaultTagline, flyerDateLine, flyerPlaceLine } from '../../lib/flyer.js';

const KINDS = [
  ['rassemblement', 'Rassemblement'],
  ['tractage', 'Tractage'],
  ['en-ligne', 'En ligne'],
  ['autre', 'Autre'],
];
const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const nn = (v) => (typeof v === 'string' ? v.trim() || null : v ?? null);

const id = new URLSearchParams(location.search).get('id');
let ctx;
let ev; // the row being edited (null fields for a new action)
let dirty = false;
let previewUrl;
const f = {}; // form controls

const field = (key, label, control, hint) =>
  el('div', { class: 'field' }, el('label', { for: `f-${key}` }, label, hint && el('span', { class: 'opt' }, ` ${hint}`)), control);

function input(key, attrs = {}) {
  return (f[key] = el('input', { id: `f-${key}`, name: key, type: 'text', value: ev[key] ?? '', ...attrs }));
}
function textarea(key, attrs = {}) {
  return (f[key] = el('textarea', { id: `f-${key}`, name: key, value: ev[key] ?? '', rows: 4, ...attrs }));
}
function counter(ctl, max) {
  const out = el('span', { class: 'counter' });
  const upd = () => (out.textContent = `${ctl.value.length} / ${max}`);
  ctl.addEventListener('input', upd);
  upd();
  return out;
}

// ───────────── derived suggestions (shown as placeholders; used when a field is left empty) ─────────────
const target = () => f.target.value.trim();
const city = () => f.city.value.trim() || (kind() === 'en-ligne' ? 'En ligne' : '');
const kind = () => f.form.querySelector('[name="kind"]:checked')?.value || 'rassemblement';
const titleSuggestion = () => (target() ? `Action devant le siège de ${target()}` : `Action pour les crevettes${city() ? ` à ${city()}` : ''}`);
function startISO() {
  return f.date.value && f.start.value ? parisToISO(f.date.value, f.start.value) : null;
}
function shareSuggestion() {
  const s = f.summary.value.trim() || 'On se mobilise pour les crevettes.';
  return `${s} Les crevettes ressentent la douleur.\n\nManifester est l'un des moyens d'action les plus efficaces. Militant·e chevronné·e ou novice, tout le monde est bienvenu : viens, et fais tourner !`;
}
function refreshSuggestions() {
  f.title.placeholder = titleSuggestion();
  f.flyer_tagline.placeholder = defaultTagline(target());
  f.flyer_place.placeholder = flyerPlaceLine({ street: f.street.value, city: city() });
  f.share_text.placeholder = shareSuggestion();
}

// ───────────── flyer preview ─────────────
let previewTimer;
function schedulePreview() {
  clearTimeout(previewTimer);
  previewTimer = setTimeout(updatePreview, 350);
}
async function updatePreview() {
  const box = $('#flyer-box');
  const custom = f.custom_poster.value;
  $('#flyer-auto').hidden = Boolean(custom);
  $('#flyer-custom').hidden = !custom;
  if (custom) {
    $('#flyer-img').src = custom.startsWith('/') ? `${SITE}${custom}` : custom;
    box.dataset.state = 'ready';
    return;
  }
  const start = startISO();
  if (!start) {
    box.dataset.state = 'empty';
    return;
  }
  box.dataset.state = 'loading';
  try {
    const url = await renderPreview({
      tagline: f.flyer_tagline.value.trim() || defaultTagline(target()),
      dateLine: flyerDateLine(start),
      placeLine: f.flyer_place.value.trim() || flyerPlaceLine({ street: f.street.value, city: city() }),
    });
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    previewUrl = url;
    $('#flyer-img').src = url;
    box.dataset.state = 'ready';
  } catch (err) {
    console.error(err);
    box.dataset.state = 'error';
  }
}

// ───────────── building the form ─────────────
function buildForm() {
  const isNew = !ev.id;
  const when = ev.starts_at ? isoToParis(ev.starts_at) : { date: '', time: '11:00' };
  const end = ev.ends_at ? isoToParis(ev.ends_at).time : '12:30';
  const admin = ctx.profile.role === 'admin';

  f.date = el('input', { id: 'f-date', type: 'date', required: true, value: when.date });
  f.start = el('input', { id: 'f-start', type: 'time', required: true, value: when.time, step: 300 });
  f.end = el('input', { id: 'f-end', type: 'time', required: true, value: end, step: 300 });
  let endTouched = Boolean(ev.ends_at);
  f.end.addEventListener('input', () => (endTouched = true));
  f.start.addEventListener('input', () => {
    if (endTouched || !f.start.value) return;
    const [h, m] = f.start.value.split(':').map(Number);
    const t = h * 60 + m + 90; // actions last 1 h 30 by default
    f.end.value = `${String(Math.floor(t / 60) % 24).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
  });

  // address
  const coords = el('p', { class: 'small coords' });
  const showCoords = () =>
    (coords.textContent = f.lat.value
      ? '📍 Position trouvée : l’action apparaîtra sur la carte.'
      : 'Pas de position : choisis une adresse dans la liste pour que l’action apparaisse sur la carte.');
  f.lat = el('input', { type: 'hidden', value: ev.lat ?? '' });
  f.lng = el('input', { type: 'hidden', value: ev.lng ?? '' });
  const search = addressSearch({
    id: 'f-address',
    onPick: (r) => {
      f.street.value = r.street;
      f.postal_code.value = r.postal_code;
      f.city.value = r.city;
      f.lat.value = r.lat;
      f.lng.value = r.lng;
      showCoords();
      changed();
    },
  });
  showCoords();

  f.custom_poster = el('input', { type: 'hidden', value: ev.custom_poster ?? '' });
  const upload = el('input', {
    id: 'f-upload',
    type: 'file',
    accept: 'image/jpeg,image/png,image/webp',
    class: 'visually-hidden',
    onchange: async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      if (file.size > 5 * 1024 * 1024) return toast('Image trop lourde (5 Mo maximum).', 'error');
      try {
        toast('Envoi de l’affiche…');
        f.custom_poster.value = await api.uploadPoster(file, ev.slug || slugify(titleSuggestion()) || 'affiche');
        changed();
        toast('Affiche ajoutée. Enregistre pour la publier.');
      } catch (err) {
        toast(errorText(err), 'error');
      }
      e.target.value = '';
    },
  });

  const kindChips = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Type d’action' },
    KINDS.map(([v, label]) =>
      el('label', { class: 'chip-radio' }, el('input', { type: 'radio', name: 'kind', value: v, checked: (ev.kind || 'rassemblement') === v }), el('span', {}, label))));

  const form = (f.form = el(
    'form',
    { class: 'esp-form', novalidate: true, oninput: changed, onsubmit: (e) => (e.preventDefault(), save()) },

    el('fieldset', { class: 'paper' },
      el('legend', {}, '1. L’action'),
      field('kind', 'Type', kindChips),
      field('target', 'Enseigne visée', input('target', { maxlength: 60, placeholder: 'ex. Lidl' }), '(facultatif)'),
      field('title', 'Titre', input('title', { maxlength: 120 }), '(laisser vide = suggestion)'),
      !isNew &&
        field('status', 'Statut', (f.status = el('select', { id: 'f-status' },
          [['published', 'Prévue'], ['postponed', 'Reportée'], ['cancelled', 'Annulée']].map(([v, l]) => el('option', { value: v, selected: ev.status === v }, l))))),
    ),

    el('fieldset', { class: 'paper' },
      el('legend', {}, '2. Quand'),
      el('div', { class: 'form-grid three' }, field('date', 'Date', f.date), field('start', 'Début', f.start), field('end', 'Fin', f.end, '(1 h 30 par défaut)')),
    ),

    el('fieldset', { class: 'paper' },
      el('legend', {}, '3. Où'),
      field('address', 'Chercher l’adresse', search),
      coords,
      el('div', { class: 'form-grid three' },
        field('street', 'Adresse', input('street', { maxlength: 160, autocomplete: 'off' })),
        field('postal_code', 'Code postal', input('postal_code', { maxlength: 10, inputmode: 'numeric' })),
        field('city', 'Ville', input('city', { maxlength: 80, required: true }))),
      f.lat, f.lng,
      field('meeting_point', 'Point de rendez-vous précis', input('meeting_point', { maxlength: 300, placeholder: 'ex. devant l’entrée principale, côté parking' }), '(facultatif)'),
      field('access', 'Accès / transports', input('access', { maxlength: 200, placeholder: 'ex. RER B ou tram T10' }), '(facultatif)'),
    ),

    el('fieldset', { class: 'paper' },
      el('legend', {}, '4. Les textes'),
      field('summary', 'Résumé', [textarea('summary', { rows: 3, maxlength: 400, required: true, placeholder: 'ex. On retourne devant le siège de Lidl pour exiger que l’enseigne arrête d’asphyxier les crevettes.' })], '(1 ou 2 phrases, en haut de la page)'),
      counter(f.summary, 400),
      field('description', 'Description', textarea('description', { rows: 7, maxlength: 6000 }), '(une ligne vide = nouveau paragraphe · **gras** · les liens https:// deviennent cliquables)'),
      field('share_text', 'Texte du bouton « Partager l’action »', textarea('share_text', { rows: 6, maxlength: 1500 }), '(laisser vide = suggestion · la date, le lieu et les liens sont ajoutés tout seuls)'),
      el('p', { class: 'small' }, '⚠️ Garde ce texte à jour si la cible, la date, le lieu ou le contexte changent.'),
      field('whatsapp_url', 'Lien du groupe WhatsApp', input('whatsapp_url', { type: 'url', maxlength: 300, placeholder: 'https://chat.whatsapp.com/…', pattern: 'https://.*' }), '(facultatif)'),
    ),

    el('fieldset', { class: 'paper esp-flyer' },
      el('legend', {}, '5. L’affiche'),
      el('div', { class: 'esp-flyer-grid' },
        el('div', { id: 'flyer-box', class: 'flyer-box', dataset: { state: 'empty' } },
          el('img', { id: 'flyer-img', alt: 'Aperçu de l’affiche', width: 1080, height: 1350 }),
          el('p', { class: 'flyer-empty' }, 'Choisis une date pour voir l’affiche.')),
        el('div', {},
          el('div', { id: 'flyer-auto' },
            el('p', {}, 'L’affiche est créée automatiquement à partir du modèle. Tu peux ajuster les textes :'),
            field('flyer_tagline', 'Accroche (3 lignes max)', textarea('flyer_tagline', { rows: 3, maxlength: 200 }), '(laisser vide = suggestion)'),
            field('flyer_place', 'Ligne « RDV »', input('flyer_place', { maxlength: 80 }), '(laisser vide = adresse)'),
            el('div', { class: 'event-actions' },
              el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: downloadPreview }, 'Télécharger l’aperçu'),
              el('label', { class: 'btn btn-ghost btn-small', for: 'f-upload' }, 'Utiliser ma propre affiche'),
              upload)),
          el('div', { id: 'flyer-custom', hidden: true },
            el('p', {}, 'Cette action utilise sa propre affiche (format conseillé : 1080 × 1350).'),
            el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () => ((f.custom_poster.value = ''), changed()) }, 'Revenir à l’affiche automatique')),
          f.custom_poster,
        ),
      ),
    ),

    el('details', { class: 'paper', open: Boolean(ev.title_en || ev.summary_en) },
      el('summary', {}, '6. En anglais (facultatif)'),
      el('p', { class: 'small' }, 'Sans traduction, la version anglaise du site affiche le texte français.'),
      field('title_en', 'Title', input('title_en', { maxlength: 120 })),
      field('summary_en', 'Summary', textarea('summary_en', { rows: 3, maxlength: 400 })),
      field('description_en', 'Description', textarea('description_en', { rows: 5, maxlength: 6000 })),
      field('access_en', 'Getting there', input('access_en', { maxlength: 200 })),
      field('share_text_en', 'Share text', textarea('share_text_en', { rows: 4, maxlength: 1500 })),
    ),

    !isNew && el('p', { class: 'paper small' }, 'Après l’action, le bilan (nombre de personnes présentes, récit, liens) et la liste des participant·es sont dans ',
      el('a', { href: `${link('/espace/details/')}?id=${ev.id}#bilan` }, 'Détails'), '.'),

    el('div', { class: 'esp-savebar' },
      el('p', { class: 'small', id: 'save-state' }, isNew ? 'Nouvelle action' : `Modifiée le ${fmtDateTime(ev.updated_at)}`),
      admin && !isNew && el('button', { class: 'linkish danger', type: 'button', onclick: remove }, 'Supprimer'),
      el('button', { class: 'btn btn-primary', type: 'submit', id: 'save-btn' }, isNew ? 'Publier l’action' : 'Enregistrer'),
    ),
  ));
  return form;
}

function changed() {
  dirty = true;
  $('#save-state').textContent = 'Modifications non enregistrées';
  refreshSuggestions();
  schedulePreview();
}

async function downloadPreview() {
  if (!previewUrl) return toast('Choisis d’abord une date.', 'error');
  const blob = await previewToJpeg(previewUrl);
  const a = el('a', { href: URL.createObjectURL(blob), download: `affiche-${ev.slug || slugify(titleSuggestion())}.jpg` });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

// ───────────── saving ─────────────
function collect() {
  const problems = [];
  const start = startISO();
  if (!start) problems.push('la date et l’heure de début');
  const endISO = f.date.value && f.end.value ? parisToISO(f.date.value, f.end.value) : null;
  let ends = endISO;
  if (start && ends && Date.parse(ends) <= Date.parse(start)) ends = new Date(Date.parse(ends) + 86400000).toISOString(); // ends after midnight
  if (!city()) problems.push('la ville');
  if (f.summary.value.trim().length < 10) problems.push('un résumé (au moins 10 caractères)');
  const wa = f.whatsapp_url.value.trim();
  if (wa && !(wa.startsWith('https://') && URL.canParse(wa))) problems.push('un lien WhatsApp valide (https://…)');
  if (problems.length) throw new Error(`Il manque ${problems.join(', ')}.`);
  const lat = f.lat.value ? Number(f.lat.value) : null;
  return {
    kind: kind(),
    status: f.status?.value || 'published',
    title: nn(f.title.value) || titleSuggestion(),
    title_en: nn(f.title_en.value),
    target: nn(f.target.value),
    starts_at: start,
    ends_at: ends,
    street: nn(f.street.value),
    postal_code: nn(f.postal_code.value),
    city: city(),
    lat,
    lng: lat == null ? null : Number(f.lng.value),
    meeting_point: nn(f.meeting_point.value),
    access: nn(f.access.value),
    access_en: nn(f.access_en.value),
    summary: f.summary.value.trim(),
    summary_en: nn(f.summary_en.value),
    description: f.description.value.trim(),
    description_en: nn(f.description_en.value),
    share_text: nn(f.share_text.value),
    share_text_en: nn(f.share_text_en.value),
    whatsapp_url: nn(f.whatsapp_url.value),
    flyer_tagline: nn(f.flyer_tagline.value),
    flyer_place: nn(f.flyer_place.value),
    custom_poster: nn(f.custom_poster.value),
  };
}

function newSlug(row) {
  const p = isoToParis(row.starts_at).date.split('-').map(Number);
  return slugify(`action ${row.target || 'crevettes'} ${row.city} ${p[2]} ${MONTHS[p[1] - 1]} ${p[0]}`);
}

async function save() {
  let row;
  try {
    row = collect();
  } catch (err) {
    return toast(err.message, 'error');
  }
  const btn = $('#save-btn');
  btn.disabled = true;
  btn.textContent = 'Enregistrement…';
  try {
    if (ev.id) {
      ev = await api.saveEvent({ id: ev.id, ...row });
    } else {
      const base = newSlug(row);
      for (let i = 1; ; i++) {
        try {
          ev = await api.saveEvent({ ...row, slug: i === 1 ? base : `${base}-${i}` });
          break;
        } catch (err) {
          if (err.code !== 'duplicate' || i > 8) throw err;
        }
      }
      history.replaceState(null, '', `?id=${ev.id}`);
    }
    dirty = false;
    published();
  } catch (err) {
    toast(errorText(err), 'error');
  } finally {
    btn.disabled = false;
    btn.textContent = 'Enregistrer';
  }
}

function published() {
  const pageUrl = `${SITE}/agenda/${ev.slug}/`;
  $('#save-state').textContent = `Enregistrée le ${fmtDateTime(ev.updated_at || new Date())}`;
  const note = el('div', { class: 'paper esp-published', role: 'status' },
    el('h2', {}, 'C’est enregistré !'),
    el('p', {}, api.demo ? 'Mode démo : rien n’est publié pour de vrai.' : 'Le site se met à jour tout seul : la page sera en ligne dans 2 à 3 minutes.'),
    el('div', { class: 'event-actions' },
      pageLink(pageUrl, { cls: 'btn btn-primary btn-small' }),
      el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () => navigator.clipboard.writeText(pageUrl).then(() => toast('Lien copié')) }, 'Copier le lien'),
      el('a', { class: 'btn btn-ghost btn-small', href: link('/espace/') }, 'Retour aux actions')));
  $('.esp-published')?.remove();
  $('.esp-form').prepend(note);
  note.scrollIntoView({ behavior: 'smooth', block: 'start' });
}

async function remove() {
  if (!confirm(`Supprimer définitivement « ${ev.title} » ? Les inscriptions seront perdues. (Pour une action qui n’a pas lieu, préfère le statut « Annulée ».)`)) return;
  try {
    await api.deleteEvent(ev.id);
    dirty = false;
    location.href = link('/espace/');
  } catch (err) {
    toast(errorText(err), 'error');
  }
}

/** This action's numbers (same as on the list), refreshed when coming back to the tab. */
async function loadStats() {
  const box = $('#ev-stats');
  if (!box || !ev.id) return;
  try {
    const row = (await api.overview()).find((r) => r.id === ev.id);
    if (!row) return;
    const s = (n, label) => el('span', { class: 'stat' }, el('strong', {}, String(n ?? 0)), ' ', label);
    fill(box,
      s(row.rsvps, 'j’y vais'), ctx.profile.role === 'admin' && row.rsvps_with_email ? el('span', { class: 'stat' }, `(${row.rsvps_with_email} avec email)`) : null,
      s(row.views, 'vues'), s(row.shares, 'partages'), s(row.newsletter, 'newsletter'), s(row.calendar, 'calendrier'),
      el('a', { class: 'btn btn-ghost btn-small', href: `${link('/espace/details/')}?id=${ev.id}` }, 'Détails'),
      pageLink(`${SITE}/agenda/${ev.slug}/`));
  } catch {
    /* numbers are a bonus: never block the form */
  }
}

async function main() {
  ctx = await requireSession();
  if (!ctx) return;
  const main = el('main', { class: 'esp-main' }, loading());
  mount(header(ctx, 'edit'), main);
  if (id) {
    try {
      ev = await api.getEvent(id);
    } catch (err) {
      return fill(main, el('p', { class: 'paper' }, errorText(err)));
    }
    if (!ev) return fill(main, el('p', { class: 'paper' }, 'Action introuvable. ', el('a', { href: link('/espace/') }, 'Retour')));
  } else ev = {};
  fill(main, 
    el('p', { class: 'small' }, el('a', { href: link('/espace/') }, '← Actions')),
    el('h1', {}, ev.id ? ev.title : 'Nouvelle action'),
    ev.id && el('p', { class: 'stats ev-stats', id: 'ev-stats' }),
    buildForm(),
  );
  refreshSuggestions();
  updatePreview();
  loadStats();
  onReturn(loadStats);
  addEventListener('beforeunload', (e) => {
    if (dirty) e.preventDefault();
  });
}

main();
