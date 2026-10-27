// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import { fileURLToPath } from 'node:url';

// Prototype lives on GitHub Pages under /lavoixdescrevettes.
// When the real domain arrives: set `site` to https://lavoixdescrevettes.org and remove `base`.
export default defineConfig({
  site: 'https://icaw-nonprofit.github.io',
  base: '/lavoixdescrevettes',
  trailingSlash: 'always',
  vite: {
    resolve: {
      // the blog editor's emoji picker is off: don't ship its data (it includes the shrimp emoji)
      alias: {
        '@emoji-mart/data': fileURLToPath(new URL('./src/scripts/espace/no-emoji.js', import.meta.url)),
        'emoji-mart': fileURLToPath(new URL('./src/scripts/espace/no-emoji.js', import.meta.url)),
      },
    },
  },
  integrations: [
    sitemap({
      // noindex pages stay out: thank-you pages, 404, private previews, organiser space, campaign links
      filter: (page) => !/\/(merci|merci-newsletter|thanks|thanks-newsletter|404|apercu|preview)\/$|\/espace\/|\/c\//.test(page),
    }),
  ],
  security: {
    // Content-Security-Policy <meta> with hashes for every inline script/style Astro outputs.
    csp: {
      algorithm: 'SHA-256',
      directives: [
        "default-src 'self'",
        "img-src 'self' data: blob: https://*.supabase.co https://tiles.openfreemap.org https://*.google-analytics.com https://*.googletagmanager.com",
        "font-src 'self' data:",
        "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://data.geopf.fr https://tiles.openfreemap.org https://formspree.io https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com",
        "worker-src 'self' blob:",
        "child-src blob:",
        "form-action 'self' https://*.list-manage.com https://formspree.io",
        "base-uri 'self'",
        "object-src 'none'",
      ],
      scriptDirective: {
        // 'wasm-unsafe-eval': lets the organiser space run the flyer preview (WebAssembly), nothing else
        resources: ["'self'", "'wasm-unsafe-eval'", 'https://*.list-manage.com', 'https://www.googletagmanager.com'],
      },
      styleDirective: {
        resources: ["'self'"],
      },
    },
  },
});
