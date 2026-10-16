# La Voix des Crevettes

Site of **La Voix des Crevettes**, a grassroots group organising actions in France against the worst shrimp farming practices, run with the [International Council for Animal Welfare (ICAW)](https://www.i-caw.org/).

Prototype online: https://nicolas-cozzarin.github.io/lavoixdescrevettes-prototype/

Built with [Astro](https://astro.build) (static site, French + English). The roadmap (PLAN.md) is kept locally, outside the repo.

## Editing content

Everything lives in plain files under `src/content/`:

| What | Where |
|---|---|
| Actions (map, agenda, "next action", flyers, "J'y vais") | the organiser space `/espace/` (Supabase, see [SETUP.md](SETUP.md)); backup copy in `src/content/events.json` |
| Blog posts | `src/content/blog/fr/*.md` and `src/content/blog/en/*.md` (same `translationKey` links the two languages) |
| FAQ | `src/content/faq.yaml` |
| Links on the Resources page | `src/content/resources.yaml` |
| Media coverage ("Ils en parlent") | `src/content/press.yaml` |
| "Souffrance en rayon" report figures and ranking | `src/lib/report.ts` |
| Newsletter, contact form, analytics IDs, Instagram | `src/config.ts` |

Campaign rule: retailer names (Lidl, etc.) only appear on event pages and on the report page.

The home page always shows the soonest upcoming action. The site rebuilds every morning (GitHub Actions) so it moves on by itself once an action is over.

## Organiser space

`/espace/`: organisers log in with an email link, create and edit actions (with a live flyer preview) and see their numbers; admins also invite organisers and see attendees and the dashboard. Until Supabase is set up it runs in demo mode (`/espace/?demo`). Setup: [SETUP.md](SETUP.md).

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
