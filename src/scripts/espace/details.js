// /espace/details/?id= — one action: participants (list + CSV), its numbers vs past actions, the bilan.
// First names for the whole team; emails only reach admins (the database leaves them out for everyone else).
import { api, SITE } from './api.js';
import { el, fill, $, mount, header, link, toast, errorText, requireSession, requireRight, fmtDay, fmtDate, fmtTime, fmtDateTime, isPast, loading, pageLink, onReturn, table, statusBadge, creator } from './ui.js';
import { avgPast, csvCell, days, fmtNum, fmtPct, parisDay, pctDiff, tookPlace } from './calc.js';
import { timeChart } from './charts.js';

const id = new URLSearchParams(location.search).get('id');
const nn = (v) => v.trim() || null;
let ctx, ev;

/** « J'y vais » per day, from the day the action was created to its day; the tooltip names who signed up. */
function rsvpChart(rows) {
  const today = parisDay(Date.now());
  const end = parisDay(ev.starts_at);
  const byDay = new Map();
  for (const r of rows) byDay.set(parisDay(r.created_at), [...(byDay.get(parisDay(r.created_at)) || []), r.name]);
  // earliest of: creation, first sign-up, the action itself (an action can be entered after it took place)
  const from = [parisDay(ev.created_at || ev.starts_at), ...byDay.keys(), end].sort()[0];
  const points = days(from, end).map((day) => ({ day, value: byDay.get(day)?.length || 0 }));
  const names = (list) => (list.length > 8 ? `${list.slice(0, 8).join(', ')} et ${list.length - 8} autres` : list.join(', '));
  return timeChart({
    title: '« J’y vais » par jour',
    subtitle: 'Inscriptions à cette action, du jour de sa création au jour de l’action.',
    kind: 'bar',
    label: '« J’y vais »',
    points,
    notes: [{ day: end, kind: 'A', label: 'Jour de l’action' }],
    tip: (p) => (p.day > today ? ['Jour à venir'] : byDay.has(p.day) ? [names(byDay.get(p.day))] : []),
    summary: `${fmtNum(rows.length)} « J’y vais » du ${fmtDate(`${from}T12:00:00Z`)} au ${fmtDate(`${end}T12:00:00Z`)}.`,
    data: { cols: [{ label: 'Jour', render: (p) => fmtDate(`${p.day}T12:00:00Z`) }, { label: '« J’y vais »', key: 'value', num: true }], rows: points.filter((p) => p.value).reverse() },
  });
}

/** The attendee list (once) feeds both the participants card and the « J'y vais » per day chart. */
async function loadAttendees(box, chartBox) {
  const admin = ctx.profile.role === 'admin';
  try {
    const rows = await api.attendees(ev.id);
    fill(chartBox, rsvpChart(rows));
    const csv = () => {
      const lines = rows.map((r) => (admin ? [r.name, r.email, r.created_at] : [r.name, r.created_at]).map(csvCell).join(';'));
      const text = [admin ? 'prénom;email;inscrit le' : 'prénom;inscrit le', ...lines].join('\n');
      const a = el('a', { href: URL.createObjectURL(new Blob(['﻿' + text], { type: 'text/csv' })), download: `participants-${ev.slug}.csv` });
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 2000);
    };
    const withEmail = rows.filter((r) => r.email).length;
    fill(box,
      el('div', { class: 'notes-head' },
        el('h2', {}, `Participant·es (${rows.length})`),
        rows.length > 0 && el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: csv }, 'Exporter (CSV)')),
      el('p', { class: 'small is-muted' },
        admin && withEmail ? `Dont ${fmtNum(withEmail)} avec email. ` : '',
        'Les emails sont visibles par les admins uniquement et effacés 30 jours après l’action.'),
      rows.length
        ? table([
            { label: 'Prénom / pseudo', key: 'name' },
            admin && { label: 'Email', render: (r) => r.email || '—' },
            { label: 'Inscrit·e le', render: (r) => fmtDateTime(r.created_at) },
          ].filter(Boolean), rows)
        : el('p', {}, 'Personne pour l’instant.'),
    );
  } catch (err) {
    fill(box, el('h2', {}, 'Participant·es'), el('p', {}, errorText(err)));
    fill(chartBox);
  }
}

function stats(row, rows) {
  const KEYS = [['views', 'Vues'], ['calendar', 'Ajouts au calendrier'], ['rsvps', 'J’y vais'], ['newsletter', 'Inscriptions newsletter']];
  const past = rows.filter((r) => r.id !== ev.id && tookPlace(r)).length;
  return el('section', { class: 'paper chart-card', 'aria-label': 'Statistiques de l’action' },
    el('h2', {}, 'Statistiques de l’action'),
    el('p', { class: 'chart-sub' },
      past > 1 ? `Cette action comparée à la moyenne des ${past} actions passées.` : past ? 'Cette action comparée à l’action passée.' : 'Pas encore d’action passée pour comparer.'),
    KEYS.every(([k]) => !row[k])
      ? el('p', { class: 'chart-empty' }, 'Pas encore de données.')
      : el('dl', { class: 'compare-rows' },
          KEYS.map(([k, label]) => {
            const value = row[k] || 0;
            const avg = avgPast(rows, k, ev.id);
            return el('div', { class: 'compare' },
              el('dt', {}, label),
              el('dd', {}, el('strong', {}, fmtNum(value)), avg != null && ` · moy. ${fmtNum(avg)} · ${fmtPct(pctDiff(value, avg))}`));
          })),
    !isPast(ev) && el('p', { class: 'small is-muted' }, 'Action à venir : les chiffres vont encore monter.'),
    ev.status === 'cancelled' && el('p', { class: 'small is-muted' }, 'Action annulée : elle ne compte pas dans les moyennes.'),
  );
}

function bilanForm() {
  const field = (key, label, control) => el('div', { class: 'field' }, el('label', { for: `f-${key}` }, label), control);
  const n = el('input', { id: 'f-recap_participants', type: 'number', min: 0, max: 100000, inputmode: 'numeric', value: ev.recap_participants ?? '' });
  const text = el('textarea', { id: 'f-recap_text', rows: 5, maxlength: 6000, value: ev.recap_text ?? '' });
  const links = el('textarea', { id: 'f-recap_links', rows: 3, maxlength: 2000, placeholder: 'Un lien https:// par ligne', value: ev.recap_links ?? '' });
  const btn = el('button', { class: 'btn btn-primary', type: 'submit' }, 'Enregistrer le bilan');
  const state = el('p', { class: 'small', role: 'status' });
  return el('form', {
      class: 'paper esp-form',
      id: 'bilan',
      onsubmit: async (e) => {
        e.preventDefault();
        btn.disabled = true;
        try {
          ev = await api.saveEvent({
            id: ev.id,
            recap_participants: n.value === '' ? null : Math.max(0, Math.round(Number(n.value))),
            recap_text: nn(text.value),
            recap_links: nn(links.value),
          });
          state.textContent = api.demo ? 'Bilan enregistré (démo : rien n’est publié).' : 'Bilan enregistré : la page de l’action se met à jour dans 2 à 3 minutes.';
        } catch (err) {
          toast(errorText(err), 'error');
        } finally {
          btn.disabled = false;
        }
      },
    },
    el('h2', {}, 'Après l’action : le bilan'),
    el('p', { class: 'small' }, 'Le bilan s’affiche sur la page de l’action une fois passée.'),
    field('recap_participants', 'Nombre de personnes présentes', n),
    field('recap_text', 'Comment ça s’est passé', text),
    field('recap_links', 'Liens (presse, posts Instagram…)', links),
    el('div', { class: 'form-foot' }, btn, state),
  );
}

async function main() {
  ctx = await requireSession();
  if (!ctx || !requireRight(ctx, 'actions', 'details')) return;
  const mainEl = el('main', { class: 'esp-main esp-dash' }, loading());
  mount(header(ctx, 'details'), mainEl);
  let rows;
  try {
    [ev, rows] = id ? await Promise.all([api.getEvent(id), api.overview()]) : [null, []];
  } catch (err) {
    return fill(mainEl, el('p', { class: 'paper' }, errorText(err)));
  }
  const row = ev && rows.find((r) => r.id === ev.id);
  if (!row) return fill(mainEl, el('p', { class: 'paper' }, 'Action introuvable. ', el('a', { href: link('/espace/') }, 'Retour')));

  const people = el('section', { class: 'paper', id: 'attendees' }, el('h2', {}, 'Participant·es'), loading());
  const perDay = el('div', {}, loading());
  fill(mainEl,
    el('p', { class: 'small' }, el('a', { href: link('/espace/') }, '← Actions')),
    el('h1', {}, ev.title, statusBadge(ev)),
    el('p', { class: 'meta' }, `${fmtDay(ev.starts_at)} à ${fmtTime(ev.starts_at)} · ${ev.city} · par `, creator(row)),
    el('div', { class: 'event-actions' },
      el('a', { class: 'btn btn-primary btn-small', href: `${link('/espace/action/')}?id=${ev.id}` }, 'Modifier'),
      pageLink(`${SITE}/agenda/${ev.slug}/`)),
    el('div', { class: 'details-grid' }, people, el('div', { class: 'details-side' }, stats(row, rows), perDay)),
    bilanForm(),
  );
  if (location.hash === '#bilan') $('#bilan').scrollIntoView();
  loadAttendees(people, perDay);
  onReturn(() => loadAttendees(people, perDay));
}

main();
