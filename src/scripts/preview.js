// Private preview of a draft blog post (views/PostPreview.astro). Reads that one draft through blog_preview(token)
// and fills the page with the same markup as a published post. Text goes in as text; the body goes through
// src/lib/blocks.js, which escapes everything and keeps only the allowed blocks (scripts/verify.mjs checks it).
// No editor code here.
import cfg from '../supabase.json';
import { rpc } from './supabase-rpc.js';
import { renderBlocks, blocksText } from '../lib/blocks.js';
import { formatDate, ui } from '../i18n';

const BASE = import.meta.env.BASE_URL.replace(/\/$/, '');
const COLLECTIVE = 'La Voix des Crevettes';
const CATEGORIES = { science: { fr: 'Science', en: 'Science' }, campagne: { fr: 'Campagne', en: 'Campaign' } };
const box = document.getElementById('preview');
const lang = box.dataset.lang;
const token = new URLSearchParams(location.search).get('t') || '';
const $ = (id) => document.getElementById(id);

async function fromDatabase() {
  if (!/^[0-9a-f]{64}$/.test(token) || !cfg.url) return null;
  const res = await rpc(cfg.url, cfg.anonKey, 'blog_preview', { p_token: token });
  if (!res.ok) return null;
  const [p] = await res.json();
  return p ? { ...p, image: (path) => `${cfg.url}/storage/v1/object/public/blog/${path}` } : null;
}

// Demo mode of the organiser space (?demo): the draft is in this tab's memory, nothing is sent anywhere.
function fromDemo() {
  const db = JSON.parse(sessionStorage.getItem('lvdc-demo-db') || 'null');
  const link = db?.previews?.find((l) => l.token === token && !l.revoked_at && Date.parse(l.expires_at) > Date.now());
  const p = link && db.posts.find((x) => x.id === link.post_id && x.status !== 'corbeille');
  if (!p) return null;
  const person = [db.profile, ...db.staff].find((s) => s.id === p.author_id);
  const name = p.author_display === 'nom' ? person?.full_name : p.author_display === 'prenom' ? person?.display_name : null;
  return {
    ...p,
    publish_date: p.publish_date || new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris' }).format(new Date()),
    author: name?.trim() || COLLECTIVE,
    expires_at: link.expires_at,
    image: (path) => (path === '00000000-0000-4000-8000-000000000000.png' ? `${BASE}/crevette-jaune.png` : null),
  };
}

function show(p) {
  const t = ui[lang];
  const minutes = Math.max(1, Math.round(blocksText(p.blocks).split(/\s+/).length / 200));
  const by = p.author && p.author !== COLLECTIVE ? ` · ${t.by} ${p.author}` : '';
  $('pv-banner').textContent = `${box.dataset.banner} ${box.dataset.until} ${formatDate(new Date(p.expires_at), lang)}.`;
  $('pv-meta').textContent = `${CATEGORIES[p.category]?.[lang] ?? 'Blog'} · ${formatDate(new Date(`${p.publish_date}T12:00:00Z`), lang)} · ${minutes}${t.minRead}${by}`;
  $('pv-title').textContent = p.title;
  $('pv-intro').textContent = p.summary;
  const cover = p.cover_path && p.image(p.cover_path);
  if (cover) {
    $('pv-cover-img').src = cover;
    $('pv-cover-img').alt = p.cover_alt || '';
    $('pv-credit').textContent = p.cover_credit || '';
    $('pv-cover').hidden = false;
  }
  // renderBlocks escapes every text and attribute: its output is safe to insert as HTML
  $('pv-body').innerHTML = renderBlocks(p.blocks, {
    image: (path) => {
      const src = p.image(path);
      return src ? { src } : null;
    },
    site: new URL(`${BASE}/`, location.origin).href,
  });
  $('pv-article').hidden = false;
}

(token.startsWith('demo-') ? Promise.resolve().then(fromDemo) : fromDatabase())
  .catch(() => null)
  .then((post) => {
    if (post) return show(post);
    $('pv-banner').hidden = true;
    $('pv-gone').hidden = false;
  });
