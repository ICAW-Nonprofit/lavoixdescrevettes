// Campaigns: what the list (/espace/campagnes/) and the details page (/espace/campagnes/details/) share.
// A destination is an action (its id) or one of our pages (home, report, agenda, blog/<slug>), never a web address.
import { el, fmtDate, errorText } from './ui.js';
import { fallbackReason } from './calc.js';

export const SUPPORTS = { flyer: 'Flyer', affiche: 'Affiche', instagram: 'Instagram', autre: 'Autre' };

// French blog posts, passed by the page at build time (data, not a script: nothing for the CSP to allow)
const POSTS = JSON.parse(document.getElementById('build-pages')?.dataset.pages || '[]');
const PAGES = { home: 'Accueil', report: 'Rapport Souffrance en rayon', agenda: 'Agenda' };

/** « Accueil », « Article : … »; null when the article no longer exists. */
export function pageName(p) {
  if (PAGES[p]) return PAGES[p];
  const post = p?.startsWith('blog/') && POSTS.find((x) => x.slug === p.slice(5));
  return post ? `Article : ${post.title}` : null;
}

/** The campaign's destination, as the team reads it. */
export function destLabel(c) {
  if (c.dest_event_id) return `${c.event_title} · ${fmtDate(c.event_starts_at)}`;
  if (c.dest_page) return pageName(c.dest_page) || 'Article supprimé';
  return 'Action supprimée';
}

/** « Redirige vers la page de secours (Agenda) : action passée », or null when the link goes to its destination. */
export function flagText(c, now = Date.now()) {
  const dest = c.dest_event_id ? { status: c.event_status, ends_at: c.event_ends_at } : pageName(c.dest_page) ? {} : null;
  const reason = fallbackReason(dest, now);
  if (!reason) return null;
  const why = { deleted: c.dest_page ? 'article supprimé' : 'action supprimée', cancelled: 'action annulée', ended: 'action passée' }[reason];
  return `Redirige vers la page de secours (${pageName(c.fallback_page) || 'Agenda'}) : ${why}`;
}

/** <select> of destinations: upcoming actions (not cancelled), then our pages. When editing, the current one stays listed. */
export function destSelect(id, events, c = {}) {
  const value = c.dest_event_id ? `event:${c.dest_event_id}` : c.dest_page ? `page:${c.dest_page}` : '';
  const open = events.filter((e) => e.status !== 'cancelled' && Date.parse(e.ends_at) > Date.now()).sort((a, b) => a.starts_at.localeCompare(b.starts_at));
  if (c.dest_event_id && !open.some((e) => e.id === c.dest_event_id)) open.unshift({ id: c.dest_event_id, title: `${c.event_title} (passée ou annulée)`, starts_at: c.event_starts_at });
  const opt = (v, label) => el('option', { value: v, selected: v === value }, label);
  return el('select', { id, required: true },
    el('option', { value: '' }, 'Choisis une page…'),
    open.length > 0 && el('optgroup', { label: 'Actions à venir' }, open.map((e) => opt(`event:${e.id}`, `${e.title} · ${fmtDate(e.starts_at)}`))),
    el('optgroup', { label: 'Pages du site' }, opt('page:home', PAGES.home), opt('page:report', PAGES.report)),
    POSTS.length > 0 && el('optgroup', { label: 'Articles' }, POSTS.map((p) => opt(`page:blog/${p.slug}`, p.title))),
    opt('page:agenda', 'Agenda (toutes les actions)'));
}

/** Value of destSelect → the two database columns. */
export const readDest = (v) => (v.startsWith('event:') ? { dest_event_id: v.slice(6), dest_page: null } : { dest_event_id: null, dest_page: v.slice(5) });

/** <select> of fallback pages (never an action: it could be over too). */
export function fallbackSelect(id, value = 'agenda') {
  const opt = (v, label) => el('option', { value: v, selected: v === value }, label);
  return el('select', { id },
    opt('agenda', PAGES.agenda), opt('home', PAGES.home), opt('report', PAGES.report),
    POSTS.length > 0 && el('optgroup', { label: 'Articles' }, POSTS.map((p) => opt(`blog/${p.slug}`, p.title))));
}

export const campaignError = (err) =>
  err?.code === 'duplicate' ? 'Une campagne porte déjà ce nom.'
  : /destination closed/.test(err?.message) ? 'Cette action est passée ou annulée : choisis une autre destination.'
  : /destination/.test(err?.message) ? 'Choisis une page de destination.'
  : errorText(err);
