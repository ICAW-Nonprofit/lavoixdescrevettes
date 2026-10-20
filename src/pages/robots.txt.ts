import type { APIRoute } from 'astro';
import { url } from '../i18n';

// Note: crawlers only read robots.txt at a domain root, so this takes full effect once the site moves to lavoixdescrevettes.org.
export const GET: APIRoute = ({ site }) => {
  const abs = (p: string) => new URL(url(p), site).href;
  const lines = [
    'User-agent: *',
    'Allow: /',
    // /c/: campaign links (redirects printed as QR codes)
    ...['/merci/', '/merci-newsletter/', '/en/thanks/', '/en/thanks-newsletter/', '/c/'].map((p) => `Disallow: ${url(p)}`),
    '',
    `Sitemap: ${abs('/sitemap-index.xml')}`,
  ];
  return new Response(lines.join('\n') + '\n', { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
};
