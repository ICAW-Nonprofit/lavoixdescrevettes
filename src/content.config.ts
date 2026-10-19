import { readFileSync } from 'node:fs';
import { defineCollection } from 'astro:content';
import { file, glob } from 'astro/loaders';
import { z } from 'astro/zod';

const l10n = z.object({ fr: z.string(), en: z.string() });

/**
 * Actions come from Supabase (organiser space). Before each build, scripts/snapshot-events.mjs copies them
 * into src/content/events.json, which is read here and turned into the shape the pages use.
 * English fields fall back to the French text when an organiser didn't translate.
 */
const DATES_FR = new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
const DATES_EN = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'long', timeZone: 'Europe/Paris' });
const both = (fr: string | null | undefined, en?: string | null) => (fr ? { fr, en: en || fr } : undefined);
const STATUS = { published: 'prevu', cancelled: 'annule', postponed: 'reporte' } as const;

const events = defineCollection({
  loader: async () => {
    const rows = JSON.parse(readFileSync('src/content/events.json', 'utf8')) as any[];
    return rows.map((r) => {
      const day = new Date(r.starts_at);
      return {
        id: r.slug,
        title: both(r.title, r.title_en),
        teaser: { fr: `Action pour les crevettes à ${r.city}`, en: `Action for shrimp in ${r.city}` },
        summary: both(r.summary, r.summary_en),
        description: both(r.description || r.summary, r.description_en),
        start: r.starts_at,
        end: r.ends_at,
        venue: { street: r.street || '', postalCode: r.postal_code || '', city: r.city },
        lat: r.lat ?? undefined,
        lng: r.lng ?? undefined,
        meetingPoint: both(r.meeting_point),
        access: both(r.access, r.access_en),
        type: r.kind,
        status: STATUS[r.status as keyof typeof STATUS] ?? 'prevu',
        target: r.target || undefined,
        poster: `/flyers/${r.slug}.jpg`,
        customPoster: r.custom_poster || undefined,
        flyerTagline: r.flyer_tagline || undefined,
        flyerPlace: r.flyer_place || undefined,
        posterAlt: {
          fr: r.poster_alt || `Affiche de l'action pour les crevettes du ${DATES_FR.format(day)} à ${r.city}`,
          en: `Flyer for the action for shrimp on ${DATES_EN.format(day)} in ${r.city}`,
        },
        // a link the schema would reject is left out, so one typo can't fail the whole build
        whatsapp: z.string().url().safeParse(r.whatsapp_url).success ? r.whatsapp_url : undefined,
        shareText: both(r.share_text, r.share_text_en),
        recap: r.recap_participants || r.recap_text || r.recap_links
          ? { participants: r.recap_participants ?? undefined, text: r.recap_text || undefined, links: r.recap_links || undefined }
          : undefined,
        updated: r.updated_at,
      };
    });
  },
  schema: z.object({
    title: l10n,
    /** Neutral short title used on the home page (no brand names there). */
    teaser: l10n,
    summary: l10n,
    description: l10n,
    start: z.coerce.date(),
    end: z.coerce.date(),
    venue: z.object({ street: z.string(), postalCode: z.string(), city: z.string() }),
    lat: z.number().optional(),
    lng: z.number().optional(),
    meetingPoint: l10n.optional(),
    access: l10n.optional(),
    type: z.enum(['rassemblement', 'tractage', 'en-ligne', 'autre']),
    status: z.enum(['prevu', 'annule', 'reporte']).default('prevu'),
    target: z.string().optional(),
    /** site path of the flyer (generated from the template, or the custom one, see pages/flyers) */
    poster: z.string(),
    customPoster: z.string().optional(),
    flyerTagline: z.string().optional(),
    flyerPlace: z.string().optional(),
    posterAlt: l10n,
    /** WhatsApp group for this action (overrides site.whatsappGroup) */
    whatsapp: z.string().url().optional(),
    /** body of the share message (date, place and links are added automatically) */
    shareText: l10n.optional(),
    recap: z.object({ participants: z.number().optional(), text: z.string().optional(), links: z.string().optional() }).optional(),
    updated: z.coerce.date().optional(),
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
    category: z.enum(['science', 'elevage', 'enquetes', 'debats']),
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
