// Numbers shown in the organiser space (dashboard, action details). Pure functions, no DOM and no network,
// so `npm run verify` can check them.
const TZ = 'Europe/Paris';
const DAY = 86400000;

/** Paris calendar day of an instant: "2026-10-31" */
export const parisDay = (d) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date(d));

/** Days from `from` to `to` included ("YYYY-MM-DD" strings). */
export function days(from, to) {
  const out = [];
  for (let t = Date.parse(`${from}T00:00:00Z`); t <= Date.parse(`${to}T00:00:00Z`); t += DAY) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** Ended and went ahead (not cancelled or postponed): the actions the averages are made of. */
export const tookPlace = (e, now = Date.now()) => Date.parse(e.ends_at) < now && e.status === 'published';

/** Average of `key` over past actions that took place, leaving out `exceptId`. null when there's none. */
export function avgPast(rows, key, exceptId, now = Date.now()) {
  const vals = rows.filter((r) => r.id !== exceptId && tookPlace(r, now)).map((r) => r[key] || 0);
  return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
}

/** Difference to the average in whole percent; null when there's nothing to compare with (no average, or 0). */
export const pctDiff = (value, avg) => (avg ? Math.round(((value - avg) / avg) * 100) : null);

/** People present in a Paris month ("2026-10"), from the bilans of the actions that took place. */
export function presentInMonth(rows, month, now = Date.now()) {
  const list = rows.filter((r) => tookPlace(r, now) && parisDay(r.starts_at).slice(0, 7) === month);
  return {
    people: list.reduce((a, r) => a + (r.recap_participants || 0), 0),
    recaps: list.filter((r) => r.recap_participants != null).length,
    actions: list.length,
  };
}

/** The last `n` Paris months, oldest first, ending with the current one: ["2026-05", …, "2026-10"] */
export function monthsBack(n, now = Date.now()) {
  const [y, m] = parisDay(now).split('-').map(Number);
  return Array.from({ length: n }, (_, i) => {
    const d = new Date(Date.UTC(y, m - 1 - (n - 1 - i), 1));
    return d.toISOString().slice(0, 7);
  });
}

/** Next action: not ended, going ahead (same rule as the site's "next action"). null when none. */
export const nextAction = (rows, now = Date.now()) =>
  rows.filter((r) => Date.parse(r.ends_at) > now && r.status === 'published').sort((a, b) => a.starts_at.localeCompare(b.starts_at))[0] || null;

/** Calendar days until an action, in Paris: 0 = today. */
export const daysLeft = (start, now = Date.now()) => Math.round((Date.parse(parisDay(start)) - Date.parse(parisDay(now))) / DAY);

/** Daily counts [{ day, n }] → every day from `from` to `to` with its count and the running total (earlier days included). */
export function cumulative(perDay, from, to) {
  const map = new Map(perDay.map((r) => [r.day, r.n]));
  let total = perDay.filter((r) => r.day < from).reduce((a, r) => a + r.n, 0);
  return days(from, to).map((day) => {
    const n = map.get(day) || 0;
    total += n;
    return { day, n, total };
  });
}

/** Who created an action, as shown to the team. */
export const creatorLabel = (r) => ({ deleted: 'Compte supprimé', team: 'Équipe' })[r.creator_status] || r.creator_name || '—';

/** Totals per city or per creator, most « J'y vais » first. */
export function groupBy(rows, keyFn) {
  const m = new Map();
  for (const r of rows) {
    const k = keyFn(r) || '—';
    const g = m.get(k) || { name: k, status: r.creator_status, actions: 0, rsvps: 0, views: 0, shares: 0, newsletter: 0, present: 0 };
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

/** One CSV cell. Names come from the public form: a leading = + - @ (or tab, CR) would run as a formula in a spreadsheet. */
export const csvCell = (s) => `"${String(s ?? '').replace(/^[=+\-@\t\r]/, "'$&").replace(/"/g, '""')}"`;

const nf0 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 0 });
const nf1 = new Intl.NumberFormat('fr-FR', { maximumFractionDigits: 1 });
/** 1284 → « 1 284 »; averages under 10 keep one decimal (« 2,5 »); null → « — » */
export const fmtNum = (n) => (n == null ? '—' : (Math.abs(n) < 10 ? nf1 : nf0).format(n));
/** -58 → « −58 % », null → « — » */
export const fmtPct = (p) => (p == null ? '—' : `${p > 0 ? '+' : p < 0 ? '−' : ''}${Math.abs(p)} %`);
