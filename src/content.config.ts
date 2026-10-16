import { defineCollection } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';

const l10n = z.object({ fr: z.string(), en: z.string() });

/** One YAML file per action. The file name is the URL slug. */
const events = defineCollection({
  loader: glob({ pattern: '*.yaml', base: './src/content/events' }),
  schema: ({ image }) =>
    z.object({
      title: l10n,
      /** Neutral short title used on the home page (no brand names there). */
      teaser: l10n,
      summary: l10n,
      description: l10n,
      start: z.coerce.date(),
      end: z.coerce.date(),
      venue: z.object({ street: z.string(), postalCode: z.string(), city: z.string() }),
      lat: z.number(),
      lng: z.number(),
      access: l10n.optional(),
      type: z.enum(['manif', 'tractage', 'en-ligne', 'autre']),
      status: z.enum(['prevu', 'annule', 'reporte']).default('prevu'),
      poster: image().optional(),
      posterAlt: l10n.optional(),
      /** WhatsApp group for this action (overrides site.whatsappGroup) */
      whatsapp: z.string().url().optional(),
      /** custom text for the share button (otherwise built from title, date, place and summary) */
      shareText: l10n.optional(),
    }),
});

/** Blog posts live in blog/fr and blog/en; translations share a translationKey. */
const blog = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/blog' }),
  schema: ({ image }) =>
    z.object({
      title: z.string().max(80),
      description: z.string().min(50).max(170),
      lang: z.enum(['fr', 'en']),
      translationKey: z.string(),
      date: z.coerce.date(),
      updated: z.coerce.date().optional(),
      author: z.string().default('La Voix des Crevettes'),
      category: z.string(),
      cover: image(),
      coverAlt: z.string().min(5),
      coverStyle: z.enum(['photo', 'drawing']).default('photo'),
      draft: z.boolean().default(false),
    }),
});

const faq = defineCollection({
  loader: file('src/content/faq.yaml'),
  schema: z.object({ order: z.number(), question: l10n, answer: l10n }),
});

const resources = defineCollection({
  loader: file('src/content/resources.yaml'),
  schema: z.object({
    order: z.number(),
    category: z.enum(['science', 'elevage', 'enquetes', 'debats', 'organisations']),
    title: z.string(),
    url: z.string().url(),
    source: z.string(),
    year: z.number().optional(),
    lang: z.enum(['fr', 'en']),
    description: l10n,
  }),
});

/** Media coverage, newest first on the site. */
const press = defineCollection({
  loader: file('src/content/press.yaml'),
  schema: z.object({
    outlet: z.string(),
    kind: z.enum(['radio', 'web', 'presse', 'tv']),
    date: z.coerce.date(),
    title: z.string(),
    url: z.string().url(),
  }),
});

export const collections = { events, blog, faq, resources, press };
