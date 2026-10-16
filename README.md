# La Voix des Crevettes

Site of **La Voix des Crevettes**, a grassroots group organising actions in France against the worst shrimp farming practices, run with the [International Council for Animal Welfare (ICAW)](https://www.i-caw.org/).

Prototype online: https://nicolas-cozzarin.github.io/lavoixdescrevettes-prototype/

Built with [Astro](https://astro.build) (static site, French + English). The full roadmap is in [PLAN.md](PLAN.md).

## Editing content

Everything lives in plain files under `src/content/`:

| What | Where |
|---|---|
| Actions / events (map, agenda, "next action" on the home page) | `src/content/events/<slug>.yaml` (one file per action) |
| Blog posts | `src/content/blog/fr/*.md` and `src/content/blog/en/*.md` (same `translationKey` links the two languages) |
| FAQ | `src/content/faq.yaml` |
| Links on the Resources page | `src/content/resources.yaml` |
| Media coverage ("Ils en parlent") | `src/content/press.yaml` |
| "Souffrance en rayon" report figures and ranking | `src/lib/report.ts` |
| Newsletter, contact form, analytics IDs, Instagram | `src/config.ts` |

Campaign rule: retailer names (Lidl, etc.) only appear on event pages and on the report page.

The home page always shows the soonest upcoming action. The site rebuilds every morning (GitHub Actions) so it moves on by itself once an action is over.

## Running it locally

Requires Node.js 22+.

```bash
npm install
npm run dev
```

Then open http://localhost:4321/lavoixdescrevettes-prototype/

## Deploying

Every push to `main` builds and deploys to GitHub Pages (`.github/workflows/deploy.yml`).

To move to the real domain later: in `astro.config.mjs` set `site` to `https://lavoixdescrevettes.org` and remove `base`.

## Privacy and security

- No secrets in this repo; only public IDs (Mailchimp list, form endpoint, GA ID) live in `src/config.ts`.
- Original photos stay out of git (`/assets/` is ignored). Only processed copies are published, with logos blurred and EXIF/GPS metadata removed.
- A strict Content-Security-Policy is generated at build time. Google Analytics only loads after consent.
