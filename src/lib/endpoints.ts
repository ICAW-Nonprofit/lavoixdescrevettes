import rss from '@astrojs/rss';
import { ics } from './calendar';
import { getEvents, getPosts, postSlug, type EventEntry } from './content';
import { url, eventPath, postPath, type Lang } from '../i18n';

const icsHeaders = { 'Content-Type': 'text/calendar; charset=utf-8' };
const abs = (p: string, site: URL) => new URL(url(p), site).href;

export function eventIcs(event: EventEntry, lang: Lang, site: URL) {
  const body = ics([{ entry: event, url: abs(eventPath(event.id, lang), site) }], lang, event.data.title[lang]);
  return new Response(body, { headers: icsHeaders });
}

export async function feedIcs(lang: Lang, site: URL) {
  const { all } = await getEvents();
  const name = lang === 'fr' ? 'La Voix des Crevettes · Actions' : 'La Voix des Crevettes · Actions';
  const body = ics(
    all.map((entry) => ({ entry, url: abs(eventPath(entry.id, lang), site) })),
    lang,
    name,
  );
  return new Response(body, { headers: icsHeaders });
}

export async function rssFeed(lang: Lang, site: URL) {
  const posts = await getPosts(lang);
  return rss({
    title: 'La Voix des Crevettes',
    description:
      lang === 'fr'
        ? 'Science, campagnes et actions pour les crevettes, êtres sensibles.'
        : 'Science, campaigns and actions for shrimp, sentient beings.',
    site: abs(lang === 'fr' ? '/' : '/en/', site),
    items: posts.map((p) => ({
      title: p.data.title,
      description: p.data.description,
      pubDate: p.data.date,
      link: abs(postPath(postSlug(p), lang), site),
    })),
    customData: `<language>${lang}</language>`,
  });
}
