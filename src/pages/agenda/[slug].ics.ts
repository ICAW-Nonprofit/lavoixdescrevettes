import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { eventIcs } from '../../lib/endpoints';

export async function getStaticPaths() {
  const events = await getCollection('events');
  return events.map((event) => ({ params: { slug: event.id }, props: { event } }));
}

export const GET: APIRoute = ({ props, site }) => eventIcs(props.event, 'fr', site!);
