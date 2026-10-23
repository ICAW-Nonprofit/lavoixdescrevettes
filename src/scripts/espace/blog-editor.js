// /espace/blog/article/?id= — write, publish and unpublish a blog post (Blog right; the database checks every step).
// Each save is a version (history). The live page changes only on « Publier » / « Publier les modifications ».
// The body is BlockNote (blog-blocknote.js, loaded only on this page); everything else is built with el().
import { api, SITE } from './api.js';
import { el, fill, mount, header, link, toast, errorText, requireSession, requireRight, loading, pageLink, slugify, fmtDate, fmtDateTime } from './ui.js';
import { postProblems } from './blog-rules.js';
import { uploadImage, imageError } from './blog-images.js';
import { parisDay } from './calc.js';
import '../../styles/blog-editor.css';

const params = new URLSearchParams(location.search);
// Markdown posts (their addresses are taken too), passed at build time by the page
const FILE_POSTS = JSON.parse(document.getElementById('build-posts')?.dataset.posts || '[]');
const CATS = [['science', 'Science'], ['campagne', 'Campagne']];
const STATUS = { brouillon: 'Brouillon', publie: 'Publié', corbeille: 'Corbeille' };
const CONTENT = ['title', 'slug', 'summary', 'category', 'publish_date', 'cover_path', 'cover_alt', 'cover_credit', 'author_display'];
// a new post starts with a « Sources » section: every factual claim is sourced (team rule)
const STARTER = [{ type: 'paragraph' }, { type: 'heading', props: { level: 2 }, content: 'Sources' }, { type: 'bulletListItem' }];

let ctx;
let post; // the row as saved
let draft; // the form's values
let others = []; // post_list(): names, translations, taken addresses
let editor; // { getBlocks, setBlocks, setEditable, focus }
let dirty = false;
let silent = false; // blocks being replaced by the page, not typed
let viewing = null; // an old version open read-only: { row, saved }
let slugTouched = false;
let busy = false;
let settingsOpen = null;

const mainEl = el('main', { class: 'esp-main blog-page' }, loading());
const alertBox = el('div', { class: 'blog-alerts', 'aria-live': 'polite' });
const side = el('aside', { class: 'blog-side', 'aria-label': 'Réglages de l’article' });
const bar = el('div', { class: 'blog-actions' });
const bodyBox = el('div', { class: 'blog-body' });
const title = el('textarea', { id: 'p-title', class: 'blog-title', rows: 1, maxlength: 120, placeholder: 'Titre de l’article', 'aria-label': 'Titre de l’article' });

const postUrl = (p) => `${SITE}${p.lang === 'fr' ? '/blog/' : '/en/blog/'}${p.slug}/`;
const previewUrl = (token) => `${SITE}${post.lang === 'fr' ? '/apercu/' : '/en/preview/'}?t=${token}`;
const editUrl = (id) => `${link('/espace/blog/article/')}?id=${id}`;
const isAuthor = () => !post.author_id || post.author_id === ctx.user.id;
const row = () => others.find((r) => r.id === post.id);
const translation = () => (post.lang === 'fr' ? others.find((r) => r.translation_of === post.id) : others.find((r) => r.id === post.translation_of));

function markDirty() {
  if (silent || viewing) return;
  dirty = true;
  renderBar();
}

function setBlocks(blocks) {
  silent = true;
  editor.setBlocks(blocks);
  silent = false;
}

function fromPost() {
  draft = Object.fromEntries(CONTENT.map((k) => [k, post[k] ?? '']));
  draft.author_display ||= 'collectif';
  title.value = draft.title;
  growTitle();
  slugTouched = Boolean(post.slug) && post.slug !== slugify(post.title || '');
}

function collect() {
  return {
    ...draft,
    title: draft.title.trim(),
    slug: draft.slug || null,
    category: draft.category || null,
    publish_date: draft.publish_date || null,
    cover_path: draft.cover_path || null,
    summary: draft.summary.trim(),
    cover_alt: draft.cover_alt.trim(),
    cover_credit: draft.cover_credit.trim(),
    blocks: editor.getBlocks(),
  };
}

function growTitle() {
  title.style.height = 'auto';
  title.style.height = `${title.scrollHeight}px`;
}

// ───────────── addresses ─────────────
function takenBy(slug) {
  if (!slug) return null;
  const db = others.find((r) => r.id !== post.id && r.lang === post.lang && r.slug === slug);
  const file = FILE_POSTS.find((p) => p.lang === post.lang && p.slug === slug);
  return db ? db.title || 'Sans titre' : file?.title || null;
}

function freeSlug(base) {
  for (let n = 2; ; n++) if (!takenBy(`${base}-${n}`)) return `${base}-${n}`;
}

function slugAlert(slug) {
  const other = takenBy(slug) || 'un autre article';
  const proposal = freeSlug(slug);
  fill(alertBox, el('div', { class: 'paper blog-alert', role: 'alert' },
    el('p', {}, `Ce lien est déjà pris par « ${other} ». Proposition : `, el('code', {}, proposal)),
    el('div', { class: 'esp-card-actions' },
      el('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: () => { draft.slug = proposal; slugTouched = true; fill(alertBox); renderSide(); save(); } }, `Utiliser ${proposal}`),
      el('button', { class: 'linkish', type: 'button', onclick: () => fill(alertBox) }, 'Choisir moi-même'))));
}

// ───────────── server calls ─────────────
function setBusy(on) {
  busy = on;
  renderBar();
}

async function reload() {
  [post, others] = await Promise.all([api.getPost(post.id), api.posts()]);
}

function onError(err) {
  if (err?.code === 'conflict') return conflictAlert(err);
  if (err?.code === 'duplicate') return slugAlert(draft.slug);
  if (err?.code === 'incomplete') return problemsAlert(err.details || []);
  if (err?.code === 'author') return toast('Seule la personne qui a écrit l’article peut le signer de son nom.', 'error');
  if (/trashed/.test(err?.message)) return toast('Cet article est dans la corbeille : restaure-le pour le publier.', 'error');
  toast(errorText(err), 'error');
}

function conflictAlert(err) {
  fill(alertBox, el('div', { class: 'paper blog-alert', role: 'alert' },
    el('p', {}, el('strong', {}, `${err.who || 'Quelqu’un'} a enregistré cet article${err.at ? ` à ${fmtDateTime(err.at)}` : ''} pendant que tu le modifiais.`)),
    el('p', { class: 'small' }, '« Enregistrer quand même » garde ta version ; l’autre reste dans l’historique. « Recharger » affiche la sienne (tes modifications non enregistrées seront perdues).'),
    el('div', { class: 'esp-card-actions' },
      el('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: () => { fill(alertBox); save({ force: true }); } }, 'Enregistrer quand même'),
      el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () => { dirty = false; location.reload(); } }, 'Recharger'))));
}

function problemsAlert(list) {
  fill(alertBox, el('div', { class: 'paper blog-alert', role: 'alert' },
    el('p', {}, el('strong', {}, 'Pas encore publiable. À compléter :')),
    el('ul', {}, list.map((p) => el('li', {}, p))),
    el('button', { class: 'linkish', type: 'button', onclick: () => fill(alertBox) }, 'Fermer')));
}

async function save({ force = false } = {}) {
  if (viewing || busy) return false;
  const f = collect();
  if (takenBy(f.slug)) {
    slugAlert(f.slug);
    return false;
  }
  setBusy(true);
  try {
    if (!post.id) {
      post = await api.createPost({ ...f, lang: post.lang });
      history.replaceState(null, '', `?id=${post.id}`);
    } else {
      post = await api.savePost(post.id, f, force ? null : post.updated_at);
    }
    others = await api.posts();
    dirty = false;
    fill(alertBox);
    toast('Enregistré.');
    renderSide();
    return true;
  } catch (err) {
    onError(err);
    return false;
  } finally {
    setBusy(false);
  }
}

function problemContext() {
  const p = ctx.profile;
  const name = draft.author_display === 'nom' ? p.full_name : draft.author_display === 'prenom' ? p.display_name : null;
  return {
    authorName: isAuthor() ? name?.trim() || null : 'checked by the database',
    frPublished: post.lang === 'en' ? translation()?.status === 'publie' : true,
    today: parisDay(Date.now()),
  };
}

async function publish() {
  if (dirty || !post.id) if (!(await save())) return;
  const problems = postProblems({ ...collect(), lang: post.lang }, problemContext());
  if (problems.length) return problemsAlert(problems);
  const first = !post.first_published_at;
  setBusy(true);
  try {
    await api.publishPost(post.id, post.updated_at);
    await reload();
    fill(alertBox);
    toast(first ? 'Publié : la page sera en ligne dans 2 à 3 minutes.' : 'Modifications publiées : en ligne dans 2 à 3 minutes.');
    renderSide();
  } catch (err) {
    onError(err);
  } finally {
    setBusy(false);
  }
}

async function trash() {
  const live = post.status === 'publie';
  const en = post.lang === 'fr' && translation();
  const text = (live
    ? 'Dépublier cet article ? Il quitte le site, le flux RSS et le plan du site dans 2 à 3 minutes, et va dans la corbeille (on pourra le restaurer).'
    : 'Mettre ce brouillon à la corbeille ? On pourra le restaurer.') + (en && en.status !== 'corbeille' ? ' La version anglaise va aussi dans la corbeille.' : '');
  if (!confirm(text)) return;
  setBusy(true);
  try {
    await api.trashPost(post.id);
    await reload();
    toast(live ? 'Dépublié : l’article quitte le site dans 2 à 3 minutes.' : 'Mis à la corbeille.');
    renderSide();
  } catch (err) {
    onError(err);
  } finally {
    setBusy(false);
  }
}

async function restore() {
  const en = post.lang === 'fr' && translation();
  const withEn = en?.status === 'corbeille' && confirm('Restaurer aussi la version anglaise ? (OK : les deux, Annuler : seulement celle-ci)');
  setBusy(true);
  try {
    await api.restorePost(post.id, withEn);
    await reload();
    toast('Restauré en brouillon.');
    renderSide();
  } catch (err) {
    onError(err);
  } finally {
    setBusy(false);
  }
}

// ───────────── history ─────────────
async function openHistory() {
  if (dirty && !(await save())) return;
  const dlg = el('dialog', { class: 'blog-history', 'aria-labelledby': 'h-title' });
  dlg.addEventListener('close', () => dlg.remove());
  document.body.append(dlg);
  fill(dlg, loading());
  dlg.showModal();
  try {
    const list = await api.postHistory(post.id);
    fill(dlg,
      el('div', { class: 'esp-head' }, el('h2', { id: 'h-title' }, 'Historique'), el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () => dlg.close() }, 'Fermer')),
      el('p', { class: 'small' }, 'Chaque enregistrement est une version. Ouvre-en une pour la relire ; « Restaurer » en fait la version actuelle (une nouvelle version : rien n’est perdu).'),
      el('ol', { class: 'history-list' }, list.map((v) =>
        el('li', {}, el('button', { type: 'button', class: 'history-item', onclick: () => { dlg.close(); viewVersion(v); } },
          el('strong', {}, fmtDateTime(v.saved_at)), ` · ${v.who || 'compte supprimé'}`,
          v.live && el('span', { class: 'badge' }, 'En ligne'),
          v.restored_from_at && el('span', { class: 'small' }, ` · restaurée depuis la version du ${fmtDateTime(v.restored_from_at)}`))))));
  } catch (err) {
    fill(dlg, el('p', {}, errorText(err)), el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () => dlg.close() }, 'Fermer'));
  }
}

async function viewVersion(v) {
  let version;
  try {
    version = await api.postVersion(v.id);
  } catch (err) {
    return toast(errorText(err), 'error');
  }
  viewing = { row: v, saved: { blocks: editor.getBlocks(), title: title.value } };
  setBlocks(version.blocks);
  editor.setEditable(false);
  title.value = version.title || '';
  title.readOnly = true;
  growTitle();
  mainEl.classList.add('is-viewing');
  fill(alertBox, el('div', { class: 'paper blog-alert is-version', role: 'status' },
    el('p', {}, el('strong', {}, `Version du ${fmtDateTime(v.saved_at)}`), ` (${v.who || 'compte supprimé'}), en lecture seule.`),
    version.summary && el('p', { class: 'small' }, 'Résumé : ', version.summary),
    el('div', { class: 'esp-card-actions' },
      el('button', { class: 'btn btn-primary btn-small', type: 'button', onclick: restoreVersion }, 'Restaurer cette version'),
      el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: leaveVersion }, 'Revenir à la version actuelle'))));
  renderSide();
}

function leaveVersion() {
  setBlocks(viewing.saved.blocks);
  title.value = viewing.saved.title;
  title.readOnly = false;
  growTitle();
  viewing = null;
  editor.setEditable(true);
  mainEl.classList.remove('is-viewing');
  fill(alertBox);
  renderSide();
}

async function restoreVersion() {
  if (!confirm('Restaurer cette version ? Elle devient la version actuelle (une nouvelle version : rien n’est perdu). Le site ne change qu’au moment de publier.')) return;
  setBusy(true);
  try {
    await api.restoreVersion(viewing.row.id, post.updated_at);
    await reload();
    viewing = null;
    mainEl.classList.remove('is-viewing');
    title.readOnly = false;
    fromPost();
    setBlocks(post.blocks);
    editor.setEditable(true);
    dirty = false;
    fill(alertBox);
    toast('Version restaurée.');
    renderSide();
  } catch (err) {
    onError(err);
  } finally {
    setBusy(false);
  }
}

// ───────────── side panel ─────────────
const field = (id, label, control, hint) =>
  el('div', { class: 'field' }, el('label', { for: id }, label), control, hint && el('p', { class: 'small field-hint' }, hint));

function input(key, { onEdit, ...attrs } = {}) {
  return el(attrs.rows ? 'textarea' : 'input', {
    id: `p-${key}`, type: attrs.rows ? null : attrs.type || 'text', ...attrs, value: draft[key] || '',
    oninput: (e) => {
      draft[key] = e.target.value;
      onEdit?.(e);
      markDirty();
    },
  });
}

function counter(box, value) {
  const n = value.trim().length;
  fill(box, `${n} caractères`, n < 50 ? ' (50 minimum)' : n > 170 ? ' (170 maximum)' : ' ✓');
}

async function chooseImage(onPath, state) {
  const picker = el('input', { type: 'file', accept: 'image/jpeg,image/png,image/webp' });
  picker.onchange = async () => {
    const file = picker.files?.[0];
    if (!file) return;
    fill(state, 'Préparation et envoi de l’image…');
    try {
      onPath(await uploadImage(file));
      fill(state);
    } catch (err) {
      fill(state, imageError(err) || errorText(err));
    }
  };
  picker.click();
}

function coverBox() {
  const state = el('p', { class: 'small', role: 'status' });
  const url = draft.cover_path && api.blogImageUrl(draft.cover_path);
  return el('section', { class: 'blog-card' },
    el('h2', {}, 'Couverture'),
    url ? el('img', { class: 'blog-cover', src: url, alt: '' }) : draft.cover_path && el('p', { class: 'small' }, 'Image enregistrée.'),
    el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () => chooseImage((path) => { draft.cover_path = path; markDirty(); renderSide(); }, state) },
      draft.cover_path ? 'Remplacer l’image' : 'Choisir une image'),
    state,
    field('p-cover_alt', 'Texte alternatif (obligatoire)', input('cover_alt', { maxlength: 300 }), 'Ce que montre l’image, pour les personnes qui ne la voient pas.'),
    field('p-cover_credit', 'Crédit photo (obligatoire)', input('cover_credit', { maxlength: 120, placeholder: 'Ex. : @come_closer_project' })));
}

function signatureBox() {
  const p = ctx.profile;
  const labels = { collectif: 'La Voix des Crevettes', prenom: 'Prénom', nom: 'Nom complet' };
  if (!isAuthor()) {
    const r = row();
    return el('div', { class: 'field' }, el('span', { class: 'label' }, 'Auteur·ice affiché·e'),
      el('p', {}, draft.author_display === 'collectif' ? 'La Voix des Crevettes' : `${labels[draft.author_display]} de ${r?.author_name || 'l’auteur·ice'}`),
      draft.author_display !== 'collectif' && el('button', { class: 'linkish', type: 'button', onclick: () => { draft.author_display = 'collectif'; markDirty(); renderSide(); } }, 'Signer « La Voix des Crevettes »'),
      el('p', { class: 'small field-hint' }, 'Seule la personne qui a écrit l’article peut afficher son propre nom.'));
  }
  const option = (value, text, disabled) =>
    el('label', { class: 'check rights-option' },
      el('input', { type: 'radio', name: 'p-author', value, checked: draft.author_display === value, disabled, onchange: () => { draft.author_display = value; markDirty(); } }),
      el('span', {}, text));
  const fullName = el('input', { type: 'text', id: 'p-fullname', maxlength: 120, autocomplete: 'name', value: p.full_name || '' });
  return el('div', { class: 'field' }, el('span', { class: 'label' }, 'Auteur·ice affiché·e'),
    el('div', { class: 'rights-picker', role: 'radiogroup', 'aria-label': 'Auteur·ice affiché·e' },
      option('collectif', 'La Voix des Crevettes'),
      option('prenom', `Mon prénom : ${p.display_name || '—'}`, !p.display_name),
      option('nom', `Mon nom complet : ${p.full_name || 'à remplir ci-dessous'}`, !p.full_name)),
    el('details', { class: 'blog-fullname', open: !p.full_name && draft.author_display === 'nom' },
      el('summary', {}, p.full_name ? 'Changer mon nom complet' : 'Remplir mon nom complet'),
      el('div', { class: 'field' }, el('label', { for: 'p-fullname' }, 'Nom complet (dans ton profil)'), fullName),
      el('button', {
        class: 'btn btn-ghost btn-small', type: 'button',
        onclick: async () => {
          try {
            await api.updateProfile({ full_name: fullName.value.trim() || null });
            ctx = await api.session();
            toast('Nom enregistré dans ton profil.');
            renderSide();
          } catch (err) {
            toast(errorText(err), 'error');
          }
        },
      }, 'Enregistrer dans mon profil')),
    el('p', { class: 'small field-hint' }, 'Ton nom n’apparaît que si tu le choisis ici.'));
}

function translationBox() {
  const t = translation();
  if (post.lang === 'en') {
    return el('section', { class: 'blog-card' }, el('h2', {}, 'Version française'),
      t ? el('p', {}, el('a', { href: editUrl(t.id) }, t.title || 'Sans titre'), ` (${STATUS[t.status].toLowerCase()})`) : el('p', {}, '—'),
      el('p', { class: 'small' }, 'La version anglaise ne peut être publiée que si la version française l’est.'));
  }
  return el('section', { class: 'blog-card' }, el('h2', {}, 'Version anglaise'),
    t
      ? el('p', {}, el('a', { href: editUrl(t.id) }, t.title || 'Sans titre'), ` (${STATUS[t.status].toLowerCase()})`)
      : [
          el('p', { class: 'small' }, 'Facultative. Elle part de cet article (blocs et images) : il reste à traduire le texte, puis à la publier.'),
          el('button', { class: 'btn btn-ghost btn-small', type: 'button', disabled: !post.id || post.status === 'corbeille', onclick: createEnglish }, 'Créer la version anglaise'),
          !post.id && el('p', { class: 'small' }, 'Enregistre d’abord l’article.'),
        ]);
}

async function createEnglish() {
  if (dirty && !(await save())) return;
  try {
    const en = await api.createPost({ lang: 'en', translation_of: post.id, title: '', blocks: editor.getBlocks(), category: draft.category || null, cover_path: draft.cover_path || null, cover_credit: draft.cover_credit });
    location.href = editUrl(en.id);
  } catch (err) {
    onError(err);
  }
}

function previewBox() {
  const box = el('section', { class: 'blog-card' }, el('h2', {}, 'Lien d’aperçu'));
  if (!post.id || post.status === 'corbeille') return fill(box, box.firstChild, el('p', { class: 'small' }, post.id ? 'Pas d’aperçu pour un article dans la corbeille.' : 'Enregistre d’abord l’article.'));
  const show = async () => {
    let l = null;
    try {
      l = await api.postPreview(post.id);
    } catch (err) {
      return fill(box, box.firstChild, el('p', {}, errorText(err)));
    }
    const make = async () => {
      try {
        await api.createPreview(post.id);
        show();
      } catch (err) {
        toast(errorText(err), 'error');
      }
    };
    if (!l) {
      return fill(box, box.firstChild,
        el('p', { class: 'small' }, 'Pour montrer le brouillon à quelqu’un sans compte. Le lien montre la dernière version enregistrée, pendant 7 jours, et n’est pas référencé.'),
        el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: make }, 'Créer un lien'));
    }
    const url = previewUrl(l.token);
    fill(box, box.firstChild,
      el('p', { class: 'small' }, `Valable jusqu’au ${fmtDate(l.expires_at)}. Montre la dernière version enregistrée.`),
      el('code', { class: 'blog-preview-url' }, url),
      el('div', { class: 'esp-card-actions' },
        el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: async () => { try { await navigator.clipboard.writeText(url); toast('Lien copié'); } catch { prompt('', url); } } }, 'Copier'),
        el('button', { class: 'btn btn-ghost btn-small', type: 'button', onclick: () => window.open(url, '_blank') }, 'Ouvrir ↗'),
        el('button', { class: 'linkish danger', type: 'button', onclick: async () => { if (!confirm('Révoquer ce lien ? Il ne marchera plus.')) return; try { await api.revokePreview(post.id); show(); } catch (err) { toast(errorText(err), 'error'); } } }, 'Révoquer')));
  };
  fill(box, box.firstChild, loading());
  show();
  return box;
}

function renderSide() {
  const locked = Boolean(post.first_published_at);
  const summaryCount = el('p', { class: 'small field-hint', 'aria-live': 'polite' });
  counter(summaryCount, draft.summary);
  const slug = input('slug', {
    maxlength: 90, readOnly: locked, autocomplete: 'off', spellcheck: false,
    onEdit: () => { slugTouched = true; },
  });
  slug.addEventListener('change', () => { draft.slug = slugify(slug.value); slug.value = draft.slug; });
  const cats = el('div', { class: 'chips', role: 'radiogroup', 'aria-label': 'Catégorie' },
    CATS.map(([v, label]) => el('label', { class: 'chip-radio' },
      el('input', { type: 'radio', name: 'p-cat', value: v, checked: draft.category === v, onchange: () => { draft.category = v; markDirty(); } }),
      el('span', {}, label))));
  const settings = el('fieldset', { class: 'blog-settings', disabled: Boolean(viewing) },
    el('legend', { class: 'visually-hidden' }, 'Réglages'),
    el('section', { class: 'blog-card' }, el('h2', {}, 'Article'),
      field('p-slug', 'Lien', slug, locked ? 'Le lien ne change plus : il a déjà été partagé.' : `${SITE}${post.lang === 'fr' ? '/blog/' : '/en/blog/'}${draft.slug || '…'}/`),
      field('p-summary', 'Résumé (cartes du blog et moteurs de recherche)', input('summary', { rows: 4, maxlength: 400, onEdit: (e) => counter(summaryCount, e.target.value) })),
      summaryCount,
      el('div', { class: 'field' }, el('span', { class: 'label' }, 'Catégorie'), cats),
      field('p-publish_date', 'Date de publication', input('publish_date', { type: 'date', max: parisDay(Date.now()) }), 'Vide : le jour où l’article est publié.'),
      signatureBox()),
    coverBox(),
    translationBox(),
    previewBox());
  // folded on phones (the text comes first), always open on computers; stays as the person left it
  settingsOpen ??= matchMedia('(min-width: 900px)').matches;
  const details = el('details', { class: 'blog-settings-wrap', open: settingsOpen, ontoggle: (e) => { settingsOpen = e.target.open; } },
    el('summary', {}, 'Réglages de l’article'), settings);
  fill(side, bar, details);
  renderBar();
}

function renderBar() {
  if (!post) return;
  const r = row();
  const status = post.status || 'brouillon';
  const saved = post.updated_at ? `Enregistré le ${fmtDateTime(post.updated_at)}` : 'Pas encore enregistré';
  const off = busy || Boolean(viewing);
  fill(bar,
    el('p', { class: 'blog-status' },
      el('span', { class: 'badge' }, STATUS[status]), ' ', post.lang.toUpperCase(),
      el('span', { class: 'small' }, ` · ${dirty ? 'Modifications non enregistrées' : saved}`),
      status === 'publie' && (dirty || r?.has_changes) && el('span', { class: 'small' }, ' · pas encore en ligne')),
    status === 'corbeille'
      ? el('div', { class: 'esp-card-actions' }, el('button', { class: 'btn btn-primary btn-small', type: 'button', disabled: off, onclick: restore }, 'Restaurer'))
      : el('div', { class: 'esp-card-actions' },
          el('button', { class: 'btn btn-ghost btn-small', type: 'button', disabled: off, onclick: () => save(), title: 'Ctrl + S' }, 'Enregistrer'),
          el('button', { class: 'btn btn-primary btn-small', type: 'button', disabled: off, onclick: publish }, status === 'publie' ? 'Publier les modifications' : 'Publier'),
          status === 'publie' && post.slug && pageLink(postUrl(post)),
          post.id && el('button', { class: 'btn btn-ghost btn-small', type: 'button', disabled: off, onclick: openHistory }, 'Historique'),
          post.id && el('button', { class: 'linkish danger', type: 'button', disabled: off, onclick: trash }, status === 'publie' ? 'Dépublier' : 'Mettre à la corbeille')),
    status === 'corbeille' && el('p', { class: 'small' }, 'Dans la corbeille : restaure-le pour pouvoir le publier.'));
}

// ───────────── page ─────────────
async function main() {
  ctx = await requireSession();
  if (!ctx || !requireRight(ctx, 'blog', 'post')) return;
  mount(header(ctx, 'post'), mainEl);
  const id = params.get('id');
  try {
    [post, others] = await Promise.all([id ? api.getPost(id) : null, api.posts()]);
  } catch (err) {
    return fill(mainEl, el('p', { class: 'paper' }, errorText(err)));
  }
  if (id && !post) return fill(mainEl, el('p', { class: 'paper' }, 'Article introuvable. ', el('a', { href: link('/espace/blog/') }, 'Retour au blog')));
  post ||= { lang: 'fr', status: 'brouillon', blocks: STARTER };
  fromPost();
  title.addEventListener('input', () => {
    draft.title = title.value;
    growTitle();
    if (!post.first_published_at && !slugTouched) {
      draft.slug = slugify(title.value) || '';
      const slug = document.getElementById('p-slug');
      if (slug) slug.value = draft.slug;
    }
    markDirty();
  });
  fill(mainEl,
    el('p', { class: 'small' }, el('a', { href: link('/espace/blog/') }, '← Blog')),
    alertBox,
    el('div', { class: 'blog-grid' },
      el('div', { class: 'blog-main' }, title, bodyBox),
      side));
  growTitle();
  renderSide();
  editor = await import('./blog-blocknote.js').then((m) => m.mountEditor(bodyBox, {
    blocks: post.blocks,
    onChange: markDirty,
    upload: uploadImage,
    imageUrl: (path) => api.blogImageUrl(path),
    imageError,
  }));
  if (!id) title.focus();
}

document.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 's') {
    e.preventDefault();
    if (editor) save();
  }
});
window.addEventListener('beforeunload', (e) => {
  if (dirty) e.preventDefault();
});

main();
