import { getCollection, type CollectionEntry } from 'astro:content';
import type { Lang } from '../i18n';

export type EventEntry = CollectionEntry<'events'>;
export type PostEntry = CollectionEntry<'blog'>;

/** All events, soonest first. "Upcoming" is decided at build time (the site rebuilds daily). */
export async function getEvents() {
  const all = await getCollection('events');
  const now = Date.now();
  const sorted = all.sort((a, b) => a.data.start.getTime() - b.data.start.getTime());
  const upcoming = sorted.filter((e) => e.data.end.getTime() >= now && e.data.status !== 'annule');
  const past = sorted.filter((e) => e.data.end.getTime() < now).reverse();
  // a postponed action stays listed, but its date isn't known yet: never the "next action"
  return { all: sorted, upcoming, past, next: upcoming.find((e) => e.data.status === 'prevu') };
}

export async function getPosts(lang: Lang) {
  const posts = await getCollection('blog', (p) => p.data.lang === lang && !p.data.draft);
  return posts.sort((a, b) => b.data.date.getTime() - a.data.date.getTime());
}

export const postSlug = (p: PostEntry) => p.id.split('/').pop()!;

export async function translationOf(p: PostEntry) {
  const other = p.data.lang === 'fr' ? 'en' : 'fr';
  const [t] = await getCollection('blog', (x) => x.data.translationKey === p.data.translationKey && x.data.lang === other);
  return t;
}

export function readingTime(body = '') {
  return Math.max(1, Math.round(body.split(/\s+/).length / 200));
}
