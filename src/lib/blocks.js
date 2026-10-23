// Blog posts written in the organiser space are stored as blocks (BlockNote JSON), never as HTML.
// This turns them into HTML through an allowlist:
//   paragraph, heading (h2 / h3), bulleted and numbered lists (3 levels), quote, divider, our image block;
//   bold and italic; links to https://, http:// and mailto: only (other sites open in a new tab, noopener noreferrer).
// Everything else (other blocks, styles, props, attributes, the shrimp emoji) is dropped, and every text and attribute
// is escaped. Shared by the build (views/Post.astro) and the preview page (scripts/preview.js): no Node, no DOM.
// scripts/verify.mjs checks that it keeps doing so.

export const IMAGE_PATH = /^[0-9a-f-]{36}\.(jpg|png|webp)$/;
const MAX_DEPTH = 3;

const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clean = (s) => String(s ?? '').replace(/\u{1F990}/gu, '');
const list = (x) => (Array.isArray(x) ? x : []);

function safeHref(href) {
  const h = String(href ?? '').trim();
  return /^(https?:\/\/[^\s"'<>\\]+|mailto:[^\s"'<>\\]+)$/i.test(h) ? h : null;
}

function text(t) {
  if (t?.type !== 'text') return '';
  let s = esc(clean(t.text)).replace(/\n/g, '<br>');
  if (t.styles?.italic === true) s = `<em>${s}</em>`;
  if (t.styles?.bold === true) s = `<strong>${s}</strong>`;
  return s;
}

function inline(content, site) {
  return list(content)
    .map((c) => {
      if (c?.type === 'text') return text(c);
      if (c?.type !== 'link') return '';
      const inner = list(c.content).map(text).join('');
      const href = safeHref(c.href);
      if (!href) return inner;
      const outside = !/^mailto:/i.test(href) && !(site && href.startsWith(site));
      return `<a href="${esc(href)}"${outside ? ' target="_blank" rel="noopener noreferrer"' : ''}>${inner}</a>`;
    })
    .join('');
}

function figure(b, image) {
  const path = String(b.props?.path ?? '');
  const img = IMAGE_PATH.test(path) ? image(path) : null;
  if (!img?.src) return '';
  const attrs = [
    `src="${esc(img.src)}"`,
    img.srcset && `srcset="${esc(img.srcset)}"`,
    img.srcset && `sizes="${esc(img.sizes || '100vw')}"`,
    img.width && `width="${esc(img.width)}"`,
    img.height && `height="${esc(img.height)}"`,
    `alt="${esc(clean(b.props?.alt))}"`,
    'loading="lazy"',
    'decoding="async"',
  ].filter(Boolean);
  const credit = clean(b.props?.credit).trim();
  return `<figure class="post-image credited"><img ${attrs.join(' ')}>${credit ? `<span class="photo-credit">${esc(credit)}</span>` : ''}</figure>`;
}

function render(blocks, opts, depth) {
  if (depth > MAX_DEPTH) return '';
  const out = [];
  const items = list(blocks);
  for (let i = 0; i < items.length; i++) {
    const b = items[i];
    const children = () => render(b.children, opts, depth + 1);
    if (b?.type === 'bulletListItem' || b?.type === 'numberedListItem') {
      // consecutive items of the same kind make one list
      const tag = b.type === 'bulletListItem' ? 'ul' : 'ol';
      const group = [];
      while (i < items.length && items[i]?.type === b.type) group.push(items[i++]);
      i--;
      out.push(`<${tag}>${group.map((it) => `<li>${inline(it.content, opts.site)}${render(it.children, opts, depth + 1)}</li>`).join('')}</${tag}>`);
      continue;
    }
    if (b?.type === 'paragraph') {
      const html = inline(b.content, opts.site);
      if (html) out.push(`<p>${html}</p>`);
      out.push(children());
    } else if (b?.type === 'heading') {
      const tag = Number(b.props?.level) === 2 ? 'h2' : 'h3';
      const html = inline(b.content, opts.site);
      if (html) out.push(`<${tag}>${html}</${tag}>`);
      out.push(children());
    } else if (b?.type === 'quote') {
      const html = inline(b.content, opts.site);
      if (html) out.push(`<blockquote><p>${html}</p></blockquote>`);
      out.push(children());
    } else if (b?.type === 'divider') {
      out.push('<hr>');
    } else if (b?.type === 'image') {
      out.push(figure(b, opts.image));
    }
    // anything else is dropped, with its children
  }
  return out.join('');
}

/**
 * Blocks → HTML string, safe to insert as is.
 * image(path) → { src, srcset?, sizes?, width?, height? } or null (the image is then left out).
 * site: the site's own address; links to it stay in the same tab.
 */
export function renderBlocks(blocks, { image = () => null, site = '' } = {}) {
  return render(blocks, { image, site }, 0);
}

/** The words of a post (reading time, like the Markdown posts: words / 200). */
export function blocksText(blocks) {
  const words = [];
  const walk = (items) => {
    for (const b of list(items)) {
      for (const c of list(b?.content)) {
        if (c?.type === 'text') words.push(c.text);
        if (c?.type === 'link') for (const t of list(c.content)) words.push(t?.text);
      }
      walk(b?.children);
    }
  };
  walk(blocks);
  return words.filter((w) => typeof w === 'string').join(' ');
}

/** Paths of the post's images (valid ones only), in document order. */
export function blockImages(blocks) {
  const out = [];
  const walk = (items) => {
    for (const b of list(items)) {
      if (b?.type === 'image' && IMAGE_PATH.test(String(b.props?.path ?? ''))) out.push(b.props.path);
      walk(b?.children);
    }
  };
  walk(blocks);
  return out;
}
