// Blog: what a post needs before it can go live. The database checks the same rules in post_publish()
// (supabase/migrations/20261021120000_blog_and_rights.sql): keep both in step. Used by the editor (to list what's
// missing before publishing) and by the demo. No DOM here: scripts/verify.mjs tests it.
import { IMAGE_PATH } from '../../lib/blocks.js';

// Same list as scripts/verify.mjs: retailers are named only on action pages and the report page, never in the blog.
export const RETAILERS =
  /(?<![a-z])(lidl|carrefour|leclerc|auchan|intermarch[ée]|mousquetaires|monoprix|franprix|aldi|casino|biocoop|grand frais|picard|syst[èe]me u|coop[ée]rative u)(?![a-zà-ÿ])/iu;
const SHRIMP_EMOJI = /\u{1F990}/u;

/** Every image block, in document order (nested ones included). */
export function imageBlocks(blocks) {
  const out = [];
  const walk = (list) => {
    for (const b of Array.isArray(list) ? list : []) {
      if (b?.type === 'image') out.push(b);
      walk(b?.children);
    }
  };
  walk(blocks);
  return out;
}

/** All the text a post shows (for the content rules and the word count). */
export function postText(p) {
  return [p.title, p.summary, p.cover_alt, p.cover_credit, JSON.stringify(p.blocks || [])].join(' ');
}

/**
 * What is missing before publishing, as the team reads it ([] = ready).
 * ctx: { authorName: name the chosen signature resolves to (null if not filled), frPublished: for an English post, today: 'YYYY-MM-DD' }
 */
export function postProblems(p, ctx = {}) {
  const out = [];
  const len = (s) => (s || '').trim().length;
  if (len(p.title) < 3 || len(p.title) > 80) out.push('Titre : entre 3 et 80 caractères');
  if (!p.slug) out.push('Lien de l’article');
  if (len(p.summary) < 50 || len(p.summary) > 170) out.push('Résumé : entre 50 et 170 caractères');
  if (!p.category) out.push('Catégorie');
  if (p.publish_date && ctx.today && p.publish_date > ctx.today) out.push('Date de publication : pas dans le futur');
  if (!p.cover_path) out.push('Image de couverture');
  if (len(p.cover_alt) < 5) out.push('Couverture : texte alternatif');
  if (!len(p.cover_credit)) out.push('Couverture : crédit photo');
  imageBlocks(p.blocks).forEach((b, i) => {
    if (!IMAGE_PATH.test(b.props?.path || '')) out.push(`Image ${i + 1} : fichier manquant`);
    if (len(b.props?.alt) < 5) out.push(`Image ${i + 1} : texte alternatif`);
    if (!len(b.props?.credit)) out.push(`Image ${i + 1} : crédit photo`);
  });
  const text = postText(p);
  if (SHRIMP_EMOJI.test(text)) out.push('Pas d’emoji crevette (elle a l’air cuite)');
  const shop = text.match(RETAILERS)?.[1];
  if (shop) out.push(`Pas de nom d’enseigne dans le blog (« ${shop.toLowerCase()} »)`);
  if (p.author_display && p.author_display !== 'collectif' && !ctx.authorName) out.push('Signature : le nom choisi n’est pas rempli dans le profil');
  if (p.lang === 'en' && !ctx.frPublished) out.push('Publie d’abord la version française');
  return out;
}
