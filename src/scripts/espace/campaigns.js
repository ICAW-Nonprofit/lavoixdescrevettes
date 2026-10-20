// /espace/campagnes/ — a short link and a QR code per flyer, poster or post, and what visitors did during that visit.
// The whole team sees and manages every campaign. Never deleted, only archived: QR codes are printed.
import { api, SITE } from './api.js';
import { el, fill, $, mount, header, link, toast, errorText, requireSession, loading, pageLink, onReturn, slugify, fmtDate } from './ui.js';
import { SUPPORTS, destSelect, fallbackSelect, readDest, destLabel, flagText, campaignError } from './campaign-ui.js';

const mainEl = el('main', { class: 'esp-main' }, loading());
const listBox = el('div');
let rows = [];
let events = [];
const filter = { support: '', dest: '' };
const qrUrl = (c) => `${SITE}/c/${c.code_qr}/`;
const linkUrl = (c) => `${SITE}/c/${c.code_link}/`;

async function copy(url) {
  try {
    await navigator.clipboard.writeText(url);
    toast('Lien copié');
  } catch {
    prompt('', url);
  }
}

function download(blob, name) {
  const a = el('a', { href: URL.createObjectURL(blob), download: name });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

async function qrPanel(c) {
  const { qrSvg, qrPng } = await import('./qr.js');
  const url = qrUrl(c);
  const svg = new Blob([qrSvg(url)], { type: 'image/svg+xml' });
  const name = `qr-${slugify(c.name) || c.code_qr}`;
  return [
    el('img', { class: 'qr-img', src: URL.createObjectURL(svg), width: 200, height: 200, alt: `QR code de la campagne ${c.name}` }),
    el('div', { class: 'qr-side' },
      el('p', { class: 'small' }, 'Il ouvre ', el('code', {}, url), '. Les visites par ce code comptent comme scans, celles par « Copier le lien » comme clics.'),
      el('div', { class: 'esp-card-actions' },
        el('button', {
          class: 'btn btn-primary btn-small',
          type: 'button',
          onclick: async () => {
            try {
              download(await qrPng(url), `${name}.png`);
            } catch (err) {
              toast(errorText(err), 'error');
            }
          },
        }, 'Télécharger PNG'),
        el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () => download(svg, `${name}.svg`) }, 'Télécharger SVG'),
        pageLink(url, { label: 'Tester le lien ↗' })),
      el('p', { class: 'small is-muted' }, 'PNG de plus de 1000 px pour les réseaux, SVG pour l’impression (net à toutes les tailles). Un nouveau lien marche 2 à 3 minutes après la création.')),
  ];
}

async function toggleQr(c, box, btn) {
  const open = box.hidden;
  box.hidden = !open;
  btn.setAttribute('aria-expanded', String(open));
  if (open && !box.childElementCount) {
    fill(box, loading('QR code…'));
    try {
      fill(box, await qrPanel(c));
    } catch (err) {
      fill(box, el('p', {}, errorText(err)));
    }
  }
}

const stat = (n, label) => el('span', { class: 'stat' }, el('strong', {}, String(n ?? 0)), ' ', label);

function card(c) {
  const flag = flagText(c);
  const box = el('div', { class: 'qr-panel', id: `qr-${c.id}`, hidden: true });
  const qrBtn = el('button', { class: 'btn btn-ghost btn-small', type: 'button', 'aria-expanded': 'false', 'aria-controls': box.id }, 'QR code');
  qrBtn.addEventListener('click', () => toggleQr(c, box, qrBtn));
  return el('li', { class: `esp-card${c.archived_at ? ' is-past' : ''}`, id: `c-${c.id}` },
    el('div', { class: 'esp-card-date' }, el('span', {}, SUPPORTS[c.support]), el('span', {}, fmtDate(c.created_at))),
    el('div', { class: 'esp-card-body' },
      el('h3', {}, c.name),
      el('p', { class: 'meta' }, 'Vers ', destLabel(c), ' · par ', c.creator_name || 'compte supprimé'),
      flag && el('p', { class: 'camp-flag' }, flag),
      el('p', { class: 'stats' },
        stat(c.visits_qr + c.visits_link, 'visites'), el('span', { class: 'stat' }, `(QR ${c.visits_qr} · lien ${c.visits_link})`),
        c.dest_page ? el('span', { class: 'stat' }, el('strong', {}, 'n/a'), ' j’y vais') : stat(c.rsvps, 'j’y vais'),
        stat(c.share_clicks, 'partages'), stat(c.newsletter, 'newsletter')),
      el('div', { class: 'esp-card-actions' },
        el('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: () => copy(linkUrl(c)) }, 'Copier le lien'),
        qrBtn,
        el('a', { class: 'btn btn-ghost btn-small', href: `${link('/espace/campagnes/details/')}?id=${c.id}` }, 'Détails')),
      box));
}

const matches = (c) => (!filter.support || c.support === filter.support) && (!filter.dest || (filter.dest === 'pages' ? !c.dest_event_id : c.dest_event_id === filter.dest));

function renderLists() {
  const shown = rows.filter(matches);
  const active = shown.filter((c) => !c.archived_at);
  const archived = shown.filter((c) => c.archived_at);
  fill(listBox,
    el('h2', { class: 'esp-h2' }, `En cours (${active.length})`),
    active.length
      ? el('ul', { class: 'esp-cards' }, active.map(card))
      : el('p', { class: 'paper' }, rows.length ? 'Aucune campagne en cours avec ces filtres.' : 'Aucune campagne pour l’instant. Crée la première !'),
    archived.length > 0 && el('h2', { class: 'esp-h2' }, `Archivées (${archived.length})`),
    archived.length > 0 && el('ul', { class: 'esp-cards' }, archived.map(card)),
  );
}

function filters() {
  const support = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Support' },
    [['', 'Tous'], ...Object.entries(SUPPORTS)].map(([v, label]) =>
      el('label', { class: 'chip-radio' },
        el('input', { type: 'radio', name: 'filter-support', value: v, checked: filter.support === v, onchange: () => { filter.support = v; renderLists(); } }),
        el('span', {}, label))));
  const used = new Map(rows.filter((c) => c.dest_event_id).map((c) => [c.dest_event_id, `${c.event_title} · ${fmtDate(c.event_starts_at)}`]));
  const dest = el('select', { id: 'filter-dest', 'aria-label': 'Destination', onchange: () => { filter.dest = dest.value; renderLists(); } },
    el('option', { value: '' }, 'Toutes les destinations'),
    [...used].map(([id, label]) => el('option', { value: id, selected: filter.dest === id }, label)),
    el('option', { value: 'pages', selected: filter.dest === 'pages' }, 'Autres pages'));
  return el('div', { class: 'camp-filters' }, support, dest);
}

function createForm() {
  const field = (key, label, control, hint) => el('div', { class: 'field' }, el('label', { for: `n-${key}` }, label, hint && el('span', { class: 'opt' }, ` ${hint}`)), control);
  const name = el('input', { id: 'n-name', type: 'text', maxlength: 80, required: true, autocomplete: 'off', placeholder: 'Ex. : Flyers marché Croix-Rousse' });
  const dest = destSelect('n-dest', events);
  const fallback = fallbackSelect('n-fallback');
  const support = el('div', { class: 'chips', role: 'radiogroup', 'aria-labelledby': 'n-support' },
    Object.entries(SUPPORTS).map(([v, label], i) =>
      el('label', { class: 'chip-radio' }, el('input', { type: 'radio', name: 'n-support', value: v, checked: i === 0 }), el('span', {}, label))));
  const btn = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Créer la campagne');
  const form = el('form', {
      class: 'paper esp-form',
      hidden: true,
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        const missing = [!name.value.trim() && 'le nom', !dest.value && 'la page de destination'].filter(Boolean);
        if (missing.length) return toast(`Il manque ${missing.join(' et ')}.`, 'error');
        btn.disabled = true;
        try {
          const { id } = await api.createCampaign({
            name: name.value.trim(),
            support: form.querySelector('[name="n-support"]:checked').value,
            ...readDest(dest.value),
            fallback_page: fallback.value,
          });
          Object.assign(filter, { support: '', dest: '' }); // the new campaign must be in view
          await load();
          const box = $(`#qr-${id}`);
          if (box) {
            $(`[aria-controls="qr-${id}"]`).click();
            box.closest('li').scrollIntoView({ block: 'start' });
            $(`[aria-controls="qr-${id}"]`).focus({ preventScroll: true });
          }
          toast(api.demo ? 'Campagne créée (démo : rien n’est publié).' : 'Campagne créée. Le lien marche dans 2 à 3 minutes.');
        } catch (err) {
          toast(campaignError(err), 'error');
        } finally {
          btn.disabled = false;
        }
      },
    },
    el('h2', {}, 'Nouvelle campagne'),
    field('name', 'Nom', name, '(pour l’équipe, jamais public)'),
    field('dest', 'Page de destination', dest),
    field('fallback', 'Page de secours', fallback, '(si l’action est passée, annulée ou supprimée)'),
    el('div', { class: 'field' }, el('span', { class: 'label', id: 'n-support' }, 'Support'), support),
    el('div', { class: 'form-foot' }, btn),
  );
  return form;
}

async function load() {
  try {
    [rows, events] = await Promise.all([api.campaigns(), api.overview()]);
  } catch (err) {
    return fill(mainEl, el('p', { class: 'paper' }, errorText(err)));
  }
  const form = createForm();
  const now = new Intl.DateTimeFormat('fr-FR', { hour: '2-digit', minute: '2-digit' }).format(new Date());
  fill(mainEl,
    el('div', { class: 'esp-head' },
      el('h1', {}, 'Campagnes'),
      el('button', {
        class: 'btn btn-primary',
        type: 'button',
        onclick: () => {
          form.hidden = !form.hidden;
          if (!form.hidden) $('#n-name').focus();
        },
      }, '+ Nouvelle campagne')),
    form,
    el('p', {}, 'Un lien court et un QR code par flyer, affiche ou post, vers une page du site. On compte ce que les gens font pendant la même visite : visites (scan du QR code ou clic sur le lien), J’y vais, partages, inscriptions à la newsletter. Rien sur les personnes.'),
    el('p', { class: 'small refresh' }, `Chiffres à jour à ${now}. `, el('button', { class: 'linkish', type: 'button', onclick: load }, 'Actualiser')),
    rows.length > 0 && filters(),
    listBox,
  );
  renderLists();
}

async function main() {
  const ctx = await requireSession();
  if (!ctx) return;
  mount(header(ctx, 'campaigns'), mainEl);
  await load();
  // fresh numbers when coming back to this tab, unless something is being typed or a QR code is open
  onReturn(() => $('form.esp-form')?.hidden !== false && !$('.qr-panel:not([hidden])') && load());
}

main();
