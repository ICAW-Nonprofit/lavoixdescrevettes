// /espace/blog/ — the blog posts: drafts, live posts and the Corbeille, in French and English. Blog right
// (the database checks it too). Anyone with the right edits every post; nothing is ever deleted.
import { api } from './api.js';
import { el, fill, mount, header, link, toast, errorText, requireSession, requireRight, loading, pageLink, onReturn, fmtDate, fmtDateTime } from './ui.js';

// Markdown posts written in the repo: listed read-only (passed at build time by the page)
const FILE_POSTS = JSON.parse(document.getElementById('build-posts')?.dataset.posts || '[]');
const STATUS = { brouillon: 'Brouillon', publie: 'Publié', corbeille: 'Corbeille' };
const EN_STATUS = { brouillon: 'en brouillon', publie: 'en ligne', corbeille: 'dans la corbeille' };
const mainEl = el('main', { class: 'esp-main' }, loading());
const listBox = el('div');
const filter = { status: '', lang: '' };
let rows = [];

const postUrl = (lang, slug) => link(lang === 'fr' ? `/blog/${slug}/` : `/en/blog/${slug}/`);
const editUrl = (id) => `${link('/espace/blog/article/')}?id=${id}`;

async function restore(p) {
  const withEn = p.lang === 'fr' && p.en_status === 'corbeille' && confirm('Restaurer aussi la version anglaise ? (OK : les deux, Annuler : seulement la version française)');
  try {
    await api.restorePost(p.id, withEn);
    toast(withEn ? 'Restaurés en brouillon (français et anglais).' : 'Restauré en brouillon.');
    load();
  } catch (err) {
    toast(errorText(err), 'error');
  }
}

function card(p) {
  const trashed = p.status === 'corbeille';
  return el('li', { class: `esp-card${trashed ? ' is-past' : ''}` },
    el('div', { class: 'esp-card-date' }, el('span', {}, STATUS[p.status]), el('span', {}, `${p.lang.toUpperCase()} · ${fmtDate(p.updated_at)}`)),
    el('div', { class: 'esp-card-body' },
      el('h3', {}, p.title?.trim() || 'Sans titre'),
      el('p', { class: 'meta' }, `Modifié par ${p.updated_by_name || 'compte supprimé'} le ${fmtDateTime(p.updated_at)}`, p.author_name && ` · écrit par ${p.author_name}`),
      p.has_changes && el('p', { class: 'camp-flag' }, 'Modifications pas encore publiées'),
      p.lang === 'fr' && el('p', { class: 'small' }, p.en_id ? `Version anglaise ${EN_STATUS[p.en_status]}` : 'Pas de version anglaise'),
      el('div', { class: 'esp-card-actions' },
        el('a', { class: 'btn btn-primary btn-small', href: editUrl(p.id) }, trashed ? 'Ouvrir' : 'Modifier'),
        p.status === 'publie' && p.slug && pageLink(postUrl(p.lang, p.slug)),
        trashed && el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () => restore(p) }, 'Restaurer'))));
}

function fileCard(p) {
  return el('li', { class: 'esp-card' },
    el('div', { class: 'esp-card-date' }, el('span', {}, 'Publié'), el('span', {}, `${p.lang.toUpperCase()} · ${fmtDate(p.date)}`)),
    el('div', { class: 'esp-card-body' },
      el('h3', {}, p.title),
      el('p', { class: 'meta' }, 'Article du site, modifiable par l’équipe technique (fichier dans le code)'),
      p.lang === 'fr' && el('p', { class: 'small' }, p.translated ? 'Version anglaise en ligne' : 'Pas de version anglaise'),
      el('div', { class: 'esp-card-actions' }, el('a', { class: 'btn btn-ghost btn-small', href: postUrl(p.lang, p.slug), target: '_blank', rel: 'noopener' }, 'Voir la page ↗'))));
}

function chips(name, label, options, key) {
  return el('div', { class: 'chips', role: 'radiogroup', 'aria-label': label },
    options.map(([v, text]) =>
      el('label', { class: 'chip-radio' },
        el('input', { type: 'radio', name, value: v, checked: filter[key] === v, onchange: () => { filter[key] = v; renderList(); } }),
        el('span', {}, text))));
}

function renderList() {
  const lang = (p) => !filter.lang || p.lang === filter.lang;
  const live = rows.filter((p) => p.status !== 'corbeille' && lang(p) && (!filter.status || p.status === filter.status));
  const files = filter.status === 'brouillon' || filter.status === 'corbeille' ? [] : FILE_POSTS.filter(lang);
  const trash = filter.status && filter.status !== 'corbeille' ? [] : rows.filter((p) => p.status === 'corbeille' && lang(p));
  fill(listBox,
    filter.status !== 'corbeille' && [
      live.length + files.length
        ? el('ul', { class: 'esp-cards' }, live.map(card), files.map(fileCard))
        : el('p', { class: 'paper' }, rows.length ? 'Aucun article avec ces filtres.' : 'Aucun article pour l’instant. Écris le premier !'),
    ],
    (filter.status === 'corbeille' || !filter.status) && [
      el('h2', { class: 'esp-h2' }, `Corbeille (${trash.length})`),
      trash.length
        ? el('ul', { class: 'esp-cards' }, trash.map(card))
        : el('p', { class: 'small' }, 'Vide. Un article dépublié arrive ici ; on peut le restaurer, rien n’est jamais effacé.'),
    ],
  );
}

async function load() {
  try {
    rows = await api.posts();
  } catch (err) {
    return fill(mainEl, el('p', { class: 'paper' }, errorText(err)));
  }
  fill(mainEl,
    el('div', { class: 'esp-head' },
      el('h1', {}, 'Blog'),
      el('a', { class: 'btn btn-primary', href: link('/espace/blog/article/') }, '+ Nouvel article')),
    el('p', {}, 'Tout le monde dans l’équipe qui a le droit Blog peut modifier tous les articles. « Publier » met l’article en ligne en 2 à 3 minutes.'),
    el('div', { class: 'camp-filters' },
      chips('f-status', 'Statut', [['', 'Tous'], ['brouillon', 'Brouillons'], ['publie', 'Publiés'], ['corbeille', 'Corbeille']], 'status'),
      chips('f-lang', 'Langue', [['', 'FR et EN'], ['fr', 'FR'], ['en', 'EN']], 'lang')),
    listBox,
  );
  renderList();
}

async function main() {
  const ctx = await requireSession();
  if (!ctx || !requireRight(ctx, 'blog', 'blog')) return;
  mount(header(ctx, 'blog'), mainEl);
  await load();
  onReturn(load);
}

main();
