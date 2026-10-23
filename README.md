# La Voix des Crevettes
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


## Organiser space

`/espace/`: organisers log in with an email link, create and edit actions (with a live flyer preview) and see their numbers, admins also invite organisers and see attendees and the dashboard

## Running it locally

Requires Node.js 22+.

```bash
npm install
npm run dev
```


## Deploying

Every push to `main` builds and deploys to GitHub Pages (`.github/workflows/deploy.yml`)
