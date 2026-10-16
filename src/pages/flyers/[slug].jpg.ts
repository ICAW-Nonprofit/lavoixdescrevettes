// One flyer per action at /flyers/<slug>.jpg (Instagram post, 1080 × 1350):
// the organiser's own flyer if they uploaded one, otherwise generated from the template.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { readFile } from 'node:fs/promises';
import sharp from 'sharp';
import supabase from '../../supabase.json';
import { renderFlyer } from '../../lib/flyer-render.js';

export async function getStaticPaths() {
  const events = await getCollection('events');
  return events.map((event) => ({ params: { slug: event.id }, props: { event } }));
}

/** Custom flyers: a file in /public, or an image in the Supabase "posters" bucket. Nothing else is fetched. */
async function customFlyer(src: string): Promise<Buffer | null> {
  try {
    if (src.startsWith('/') && !src.includes('..')) return await readFile(new URL(`../../../public${src}`, import.meta.url));
    const allowed = supabase.url && src.startsWith(`${supabase.url}/storage/v1/object/public/posters/`);
    if (!allowed) return null;
    const res = await fetch(src, { signal: AbortSignal.timeout(20000) });
    const type = res.headers.get('content-type') || '';
    if (!res.ok || !type.startsWith('image/')) return null;
    const buf = Buffer.from(await res.arrayBuffer());
    return buf.length <= 6 * 1024 * 1024 ? buf : null;
  } catch {
    return null;
  }
}

export const GET: APIRoute = async ({ props }) => {
  const d = props.event.data;
  const custom = d.customPoster ? await customFlyer(d.customPoster) : null;
  const jpg = custom
    ? await sharp(custom).rotate().resize({ width: 1080, withoutEnlargement: false }).jpeg({ quality: 86, mozjpeg: true }).toBuffer() // metadata dropped
    : await renderFlyer({ start: d.start, target: d.target, venue: d.venue, flyerTagline: d.flyerTagline, flyerPlace: d.flyerPlace });
  return new Response(jpg, { headers: { 'Content-Type': 'image/jpeg' } });
};
