/**
 * Tiny Markdown subset for short texts (FAQ answers, action descriptions written by organisers):
 * paragraphs, "- " lists, **bold**, *italic*, [links](https://…) and bare https:// links.
 * Input is escaped first; only http(s), mailto and site-relative links are allowed.
 */
const escape = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const SAFE_HREF = /^(https?:\/\/|mailto:|\/|\.\.?\/|#)/i;

function inline(s: string) {
  return escape(s)
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*(.+?)\*/g, '<em>$1</em>')
    .replace(/\[([^\]]+)\]\(([^)\s]+)\)|(^|[\s(])(https?:\/\/[^\s<)]+)/g, (m, text, href, pre, bare) => {
      if (bare) return `${pre}<a href="${bare}" rel="noopener" target="_blank">${bare.replace(/^https?:\/\//, '')}</a>`;
      if (!SAFE_HREF.test(href)) return text; // e.g. javascript: links are dropped, the text stays
      const ext = /^https?:/i.test(href);
      return `<a href="${href}"${ext ? ' rel="noopener" target="_blank"' : ''}>${text}</a>`;
    });
}

export function md(src: string) {
  return src
    .trim()
    .split(/\n\s*\n/)
    .map((block) => {
      const lines = block.split('\n');
      if (lines.every((l) => /^\s*-\s+/.test(l))) {
        return `<ul>${lines.map((l) => `<li>${inline(l.replace(/^\s*-\s+/, ''))}</li>`).join('')}</ul>`;
      }
      return `<p>${inline(lines.join(' '))}</p>`;
    })
    .join('');
}

export function stripMd(src: string) {
  return src
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .trim();
}
