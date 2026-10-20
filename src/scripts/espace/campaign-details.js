// /espace/campagnes/details/?id= — one campaign: visits per day (QR code / link), its numbers, edit, history, archive.
import { api, SITE } from './api.js';
import { el, fill, mount, header, link, toast, errorText, requireSession, loading, table, fmtDate, fmtDay, fmtDateTime } from './ui.js';
import { days, parisDay, pctOf, fmtNum } from './calc.js';
import { timeChart } from './charts.js';
import { SUPPORTS, destSelect, fallbackSelect, readDest, destLabel, flagText, campaignError } from './campaign-ui.js';

const id = new URLSearchParams(location.search).get('id');
const mainEl = el('main', { class: 'esp-main esp-dash' }, loading());
let c, events;

function chart(stats) {
  const perDay = new Map();
  for (const r of stats) {
    const d = perDay.get(r.day) || { qr: 0, link: 0 };
    d[r.channel] += r.visits;
    perDay.set(r.day, d);
  }
  const points = days(parisDay(c.created_at), parisDay(Date.now())).map((day) => ({ day, value: perDay.get(day)?.qr || 0, value2: perDay.get(day)?.link || 0 }));
  return timeChart({
    title: 'Visites par jour',
    subtitle: 'Depuis la création de la campagne. Une visite par onglet, robots exclus.',
    label: 'scans (QR code)',
    label2: 'clics (lien)',
    points,
    summary: `${fmtNum(c.visits_qr)} scans et ${fmtNum(c.visits_link)} clics depuis le ${fmtDay(c.created_at)}.`,
    data: {
      cols: [{ label: 'Jour', render: (r) => fmtDay(r.day) }, { label: 'Scans (QR)', key: 'value', num: true }, { label: 'Clics (lien)', key: 'value2', num: true }],
      rows: points.filter((p) => p.value || p.value2).reverse(),
    },
  });
}

function numbers(stats) {
  const sum = (k, ch) => stats.reduce((a, r) => a + (!ch || r.channel === ch ? r[k] : 0), 0);
  const visits = sum('visits');
  const row = (label, k) => ({ label, qr: fmtNum(sum(k, 'qr')), link: fmtNum(sum(k, 'link')), total: fmtNum(sum(k)), pct: k === 'visits' ? '' : pctOf(sum(k), visits) == null ? '—' : `${pctOf(sum(k), visits)} %` });
  const rows = [
    row('Visites', 'visits'),
    c.dest_page ? { label: 'J’y vais', qr: 'n/a', link: 'n/a', total: 'n/a', pct: 'n/a' } : row('J’y vais', 'rsvps'),
    row('Inscriptions newsletter', 'newsletter'),
    row('Partages (clics sur Partager)', 'share_clicks'),
    row('Partages terminés (téléphones)', 'shares_done'),
  ];
  return el('section', { class: 'paper' },
    el('h2', {}, 'Chiffres'),
    el('p', { class: 'small is-muted' }, 'Ce que les gens arrivés par cette campagne ont fait pendant la même visite. « J’y vais » ne compte que pour l’action de destination ; seuls les téléphones disent si un partage est allé au bout.'),
    table([
      { label: 'Chiffre', key: 'label' },
      { label: 'QR code', key: 'qr', num: true },
      { label: 'Lien', key: 'link', num: true },
      { label: 'Total', key: 'total', num: true },
      { label: '% des visites', key: 'pct', num: true },
    ], rows));
}

function editForm() {
  const field = (key, label, control) => el('div', { class: 'field' }, el('label', { for: `f-${key}` }, label), control);
  const name = el('input', { id: 'f-name', maxlength: 80, required: true, autocomplete: 'off', value: c.name });
  const dest = destSelect('f-dest', events, c);
  const fallback = fallbackSelect('f-fallback', c.fallback_page);
  const btn = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Enregistrer');
  const archive = async () => {
    if (!confirm('Archiver cette campagne ? Le lien et le QR code continueront de fonctionner.')) return;
    try {
      await api.archiveCampaign(c.id);
      toast('Campagne archivée.');
      main();
    } catch (err) {
      toast(errorText(err), 'error');
    }
  };
  return el('form', {
      class: 'paper esp-form',
      novalidate: true,
      onsubmit: async (e) => {
        e.preventDefault();
        if (!name.value.trim() || !dest.value) return toast(`Il manque ${!name.value.trim() ? 'le nom' : 'la page de destination'}.`, 'error');
        const next = { name: name.value.trim(), ...readDest(dest.value), fallback_page: fallback.value };
        // only what changed: a rename doesn't rebuild the site
        const changed = Object.fromEntries(Object.entries(next).filter(([k, v]) => v !== (c[k] ?? null)));
        if (!Object.keys(changed).length) return toast('Rien n’a changé.');
        btn.disabled = true;
        try {
          await api.updateCampaign(c.id, changed);
          const rebuild = Object.keys(changed).some((k) => k !== 'name');
          toast(rebuild && !api.demo ? 'Enregistré. Le lien suivra dans 2 à 3 minutes.' : 'Enregistré.');
          main();
        } catch (err) {
          toast(campaignError(err), 'error');
          btn.disabled = false;
        }
      },
    },
    el('h2', {}, 'Modifier'),
    field('name', 'Nom', name),
    field('dest', 'Page de destination', dest),
    field('fallback', 'Page de secours', fallback),
    el('div', { class: 'form-foot' }, btn, !c.archived_at && el('button', { class: 'linkish danger', type: 'button', onclick: archive }, 'Archiver la campagne')),
  );
}

const DID = { 'campaign.create': 'Créée', 'campaign.update': 'Modifiée', 'campaign.archive': 'Archivée' };
const FIELD = { name: 'nom', dest_event_id: 'destination', dest_page: 'destination', fallback_page: 'page de secours' };

function history(rows) {
  return el('section', { class: 'paper' },
    el('h2', {}, 'Historique'),
    el('ul', { class: 'camp-history' },
      rows.map((h) => el('li', {},
        `${DID[h.action] || h.action} par ${h.who || 'compte supprimé'} le ${fmtDateTime(h.at)}`,
        h.fields?.length ? ` (${[...new Set(h.fields.map((f) => FIELD[f] || f))].join(', ')})` : ''))),
    el('p', { class: 'small is-muted' }, 'Les modifications de plus d’un an sortent de l’historique (comme le journal de sécurité).'));
}

async function main() {
  const ctx = await requireSession();
  if (!ctx) return;
  mount(header(ctx, 'campaign'), mainEl);
  let stats, hist;
  try {
    const [rows, list] = await Promise.all([api.campaigns(), api.overview()]);
    events = list;
    c = rows.find((r) => r.id === id);
    if (!c) return fill(mainEl, el('p', { class: 'paper' }, 'Campagne introuvable. ', el('a', { href: link('/espace/campagnes/') }, 'Retour')));
    [stats, hist] = await Promise.all([api.campaignStats(c.id), api.campaignHistory(c.id)]);
  } catch (err) {
    return fill(mainEl, el('p', { class: 'paper' }, errorText(err)));
  }
  const flag = flagText(c);
  fill(mainEl,
    el('p', { class: 'small' }, el('a', { href: link('/espace/campagnes/') }, '← Campagnes')),
    el('h1', {}, c.name, c.archived_at && el('span', { class: 'badge' }, 'Archivée')),
    el('p', { class: 'meta' }, `${SUPPORTS[c.support]} · vers ${destLabel(c)} · créée le ${fmtDate(c.created_at)}`),
    flag && el('p', { class: 'camp-flag' }, flag),
    el('p', { class: 'small camp-links' }, 'QR code : ', el('code', {}, `${SITE}/c/${c.code_qr}/`), el('br'), 'Lien : ', el('code', {}, `${SITE}/c/${c.code_link}/`)),
    chart(stats),
    numbers(stats),
    el('div', { class: 'details-grid' }, editForm(), history(hist)),
  );
}

main();
