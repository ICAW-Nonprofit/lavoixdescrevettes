// /espace/admin/ — Tableau de bord: key numbers, newsletter chart with notes, « J'y vais » per day, tables. Whole team.
import { api } from './api.js';
import { el, fill, mount, header, link, toast, errorText, requireSession, fmtDate, isPast, loading, table, statusBadge, creator } from './ui.js';
import { avgPast, creatorLabel, cumulative, days, daysLeft, fmtNum, groupBy, monthsBack, nextAction, parisDay, presentInMonth } from './calc.js';
import { timeChart, sparkline, miniBars, noteKey } from './charts.js';

const sum = (rows, k) => rows.reduce((a, r) => a + (r[k] || 0), 0);
const plural = (n, word) => `${n} ${word}${n > 1 ? 's' : ''}`;
const monthName = (m) => new Intl.DateTimeFormat('fr-FR', { month: 'short', timeZone: 'UTC' }).format(new Date(`${m}-01T00:00:00Z`));
const fmtDay = (day) => fmtDate(`${day}T12:00:00Z`); // "YYYY-MM-DD" → « 12 oct. 2026 »
const daysBefore = (day, n) => new Date(Date.parse(`${day}T00:00:00Z`) - n * 86400000).toISOString().slice(0, 10);
const buildNotes = JSON.parse(document.getElementById('build-notes')?.dataset.notes || '[]');

const kpi = ({ label, value, sub, extra, href }) =>
  el(href ? 'a' : 'div', { class: 'kpi', href }, el('span', { class: 'kpi-label' }, label), el('strong', { class: 'kpi-value' }, value), sub && el('span', { class: 'kpi-sub' }, sub), extra);

function keyNumbers(rows, signups, today) {
  // newsletter: total via the site, trend over 30 days
  const total = signups.reduce((a, r) => a + r.n, 0);
  const last30 = cumulative(signups, daysBefore(today, 29), today);
  const gain = last30.at(-1).total - last30[0].total + last30[0].n;
  // people present: this month vs the 5 before
  const months = monthsBack(6);
  const per = months.map((m) => presentInMonth(rows, m).people);
  const now = presentInMonth(rows, months[5]);
  const diff = per[5] - per[4];
  // next action
  const nx = nextAction(rows);
  const d = nx && daysLeft(nx.starts_at);
  return el('div', { class: 'kpis' },
    kpi({
      label: 'Inscriptions newsletter',
      value: fmtNum(total),
      sub: total ? `via le site depuis le ${fmtDay(signups[0].day)}` : 'via le site · aucune pour l’instant',
      extra: el('span', { class: 'kpi-trend' }, sparkline(last30.map((x) => x.total)), `+${fmtNum(gain)} en 30 jours`),
    }),
    kpi({
      label: 'Présent·es ce mois-ci',
      value: fmtNum(now.people),
      sub: now.actions ? `${monthName(months[5])} · d’après ${plural(now.recaps, 'bilan')} sur ${plural(now.actions, 'action')}` : `${monthName(months[5])} · aucune action passée ce mois-ci`,
      extra: el('span', { class: 'kpi-trend' }, miniBars(per), `${diff < 0 ? '−' : '+'}${fmtNum(Math.abs(diff))} vs ${monthName(months[4])}`),
    }),
    nx
      ? kpi({
          label: 'Prochaine action',
          value: d === 0 ? 'Aujourd’hui' : `J-${d}`,
          sub: `${nx.title} · ${fmtDate(nx.starts_at)} · ${nx.city}`,
          extra: el('span', { class: 'kpi-trend' }, el('strong', {}, fmtNum(nx.rsvps)), ` « J’y vais » · moy. ${fmtNum(avgPast(rows, 'rsvps', nx.id))}`),
          href: `${link('/espace/details/')}?id=${nx.id}`,
        })
      : kpi({ label: 'Prochaine action', value: '—', sub: 'Aucune action prévue', extra: el('a', { class: 'kpi-trend', href: link('/espace/action/') }, '+ Nouvelle action') }),
  );
}

function totals(rows) {
  return el('section', { class: 'totals', 'aria-label': 'Depuis le début' },
    el('h2', { class: 'kpi-label' }, 'Depuis le début'),
    el('dl', {},
      [['actions', rows.length], ['« J’y vais »', sum(rows, 'rsvps')], ['vues des pages', sum(rows, 'views')], ['partages', sum(rows, 'shares')], ['ajouts au calendrier', sum(rows, 'calendar')]]
        .map(([l, v]) => el('div', {}, el('dt', {}, l), el('dd', {}, fmtNum(v))))));
}

/** Manual notes: add one (date + text), delete your own (admins: any). */
function notesBox(list, ctx, reload) {
  const admin = ctx.profile.role === 'admin';
  const dayIn = el('input', { id: 'note-day', type: 'date', required: true, value: parisDay(Date.now()) });
  const text = el('input', { id: 'note-text', type: 'text', required: true, maxlength: 80, placeholder: 'ex. Post Instagram repris par un média' });
  const form = el('form', {
      class: 'note-form',
      hidden: true,
      onsubmit: async (e) => {
        e.preventDefault();
        if (!text.value.trim()) return;
        try {
          await api.addNote(dayIn.value, text.value.trim());
          reload();
        } catch (err) {
          toast(errorText(err), 'error');
        }
      },
    },
    el('div', { class: 'field' }, el('label', { for: 'note-day' }, 'Date'), dayIn),
    el('div', { class: 'field' }, el('label', { for: 'note-text' }, 'Note (80 caractères max.)'), text),
    el('div', { class: 'form-foot' }, el('button', { class: 'btn btn-primary btn-small', type: 'submit' }, 'Ajouter'), el('button', { class: 'linkish', type: 'button', onclick: () => (form.hidden = true) }, 'Annuler')));
  const add = el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () => ((form.hidden = false), text.focus()) }, '+ Ajouter une note');
  return el('section', { class: 'notes', 'aria-label': 'Notes du graphique' },
    el('div', { class: 'notes-head' }, el('h3', {}, 'Notes'), add),
    form,
    list.length
      ? el('ul', { class: 'notes-list' },
          list.map((nt) =>
            el('li', {},
              noteKey(nt.kind),
              el('span', { class: 'notes-day' }, fmtDay(nt.day)),
              el('span', { class: 'notes-label' }, nt.label),
              nt.kind === 'N' && (admin || nt.created_by === ctx.user.id) &&
                el('button', {
                  class: 'linkish danger',
                  type: 'button',
                  onclick: async () => {
                    try {
                      await api.deleteNote(nt.id);
                      reload();
                    } catch (err) {
                      toast(errorText(err), 'error');
                    }
                  },
                }, 'Supprimer'))))
      : el('p', { class: 'small' }, 'Aucune note sur la période.'),
  );
}

function newsletterChart(rows, signups, manual, ctx, today, reload) {
  let from = signups[0] && signups[0].day < daysBefore(today, 89) ? signups[0].day : daysBefore(today, 89);
  if (from < daysBefore(today, 364)) from = daysBefore(today, 364);
  const series = cumulative(signups, from, today);
  const notes = [
    ...rows.filter((r) => r.status !== 'cancelled').map((r) => ({ day: parisDay(r.starts_at), kind: 'A', label: `${r.title} (${r.city})` })),
    ...buildNotes,
    ...manual.map((nt) => ({ ...nt, kind: 'N' })),
  ].filter((nt) => nt.day >= from && nt.day <= today);
  const gain = series.at(-1).total - series[0].total + series[0].n;
  return el('section', { class: 'chart-section' },
    timeChart({
      title: 'Inscriptions à la newsletter',
      subtitle: 'Total cumulé des inscriptions faites sur le site, avec les actions, passages média et articles.',
      label: 'inscriptions au total',
      points: series.map((x) => ({ day: x.day, value: x.total, n: x.n })),
      notes,
      tip: (p) => [p.n ? `+${fmtNum(p.n)} ce jour-là` : 'Aucune inscription ce jour-là'],
      summary: `Inscriptions newsletter via le site : ${fmtNum(series.at(-1).total)} au total, ${fmtNum(gain)} depuis le ${fmtDay(from)}.`,
      data: {
        cols: [{ label: 'Jour', render: (r) => fmtDay(r.day) }, { label: 'Inscriptions', key: 'n', num: true }, { label: 'Total', key: 'total', num: true }],
        rows: series.filter((x) => x.n).reverse(),
      },
    }),
    notesBox(notes.sort((a, b) => b.day.localeCompare(a.day)), ctx, reload),
  );
}

function rsvpChart(rows, perDay, today) {
  const from = daysBefore(today, 59);
  const map = new Map(perDay.map((r) => [String(r.day).slice(0, 10), r.count]));
  const points = days(from, today).map((day) => ({ day, value: map.get(day) || 0 }));
  const total = points.reduce((a, p) => a + p.value, 0);
  return el('section', { class: 'chart-section' },
    timeChart({
      title: '« J’y vais » par jour',
      subtitle: 'Inscriptions aux actions sur les 60 derniers jours, toutes actions confondues.',
      kind: 'bar',
      label: '« J’y vais »',
      points,
      notes: rows.filter((r) => r.status !== 'cancelled').map((r) => ({ day: parisDay(r.starts_at), kind: 'A', label: `${r.title} (${r.city})` })),
      summary: `${fmtNum(total)} « J’y vais » sur les 60 derniers jours, maximum ${fmtNum(Math.max(...points.map((p) => p.value)))} en un jour.`,
      data: { cols: [{ label: 'Jour', render: (r) => fmtDay(r.day) }, { label: '« J’y vais »', key: 'value', num: true }], rows: points.filter((p) => p.value).reverse() },
    }),
  );
}

async function main() {
  const ctx = await requireSession();
  if (!ctx) return;
  const mainEl = el('main', { class: 'esp-main esp-dash' }, loading());
  mount(header(ctx, 'admin'), mainEl);

  let rows, signups, perDay, manual;
  try {
    [rows, signups, perDay, manual] = await Promise.all([api.overview(), api.newsletterPerDay(), api.rsvpsPerDay(60), api.notes()]);
  } catch (err) {
    return fill(mainEl, el('p', { class: 'paper' }, errorText(err)));
  }
  const today = parisDay(Date.now());
  const muted = (r) => (isPast(r) || r.status === 'cancelled') && 'is-muted';

  fill(mainEl,
    el('div', { class: 'esp-head' },
      el('h1', {}, 'Tableau de bord'),
      el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: main }, 'Actualiser')),
    keyNumbers(rows, signups, today),
    totals(rows),
    newsletterChart(rows, signups, manual, ctx, today, main),
    rsvpChart(rows, perDay, today),
    el('h2', { class: 'esp-h2' }, 'Par action'),
    table(
      [
        { label: 'Action', render: (r) => [el('a', { href: `${link('/espace/details/')}?id=${r.id}` }, r.title), statusBadge(r)] },
        { label: 'Date', render: (r) => fmtDate(r.starts_at) },
        { label: 'Ville', key: 'city' },
        { label: 'Par', render: creator },
        { label: 'J’y vais', key: 'rsvps', num: true },
        { label: 'Présent·es', key: 'recap_participants', num: true },
        { label: 'Vues', key: 'views', num: true },
        { label: 'Partages', key: 'shares', num: true },
        { label: 'Newsletter', key: 'newsletter', num: true },
        { label: 'Calendrier', key: 'calendar', num: true },
      ],
      rows,
      muted,
    ),
    el('div', { class: 'two-col u-mt36' },
      el('section', {}, el('h2', { class: 'esp-h2' }, 'Par ville'),
        table([{ label: 'Ville', key: 'name' }, { label: 'Actions', key: 'actions', num: true }, { label: 'J’y vais', key: 'rsvps', num: true }, { label: 'Partages', key: 'shares', num: true }], groupBy(rows, (r) => r.city))),
      el('section', {}, el('h2', { class: 'esp-h2' }, 'Par organisateur·ice'),
        table(
          [{ label: 'Nom', render: (g) => (g.status === 'disabled' ? `${g.name} (désactivé·e)` : g.name) }, { label: 'Actions', key: 'actions', num: true }, { label: 'J’y vais', key: 'rsvps', num: true }, { label: 'Présent·es', key: 'present', num: true }],
          groupBy(rows, creatorLabel),
          (g) => g.status && g.status !== 'active' && 'is-muted',
        ))),
  );
}

main();
