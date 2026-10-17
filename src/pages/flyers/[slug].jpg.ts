// One flyer per action at /flyers/<slug>.jpg (Instagram post, 1080 × 1350):
// the organiser's own flyer if they uploaded one, otherwise generated from the template.
import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { readFile } from 'node:fs/promises';
import { join, normalize } from 'node:path';
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
    if (src.startsWith('/') && !src.includes('..')) return await readFile(join(process.cwd(), 'public', normalize(src)));
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
  let jpg: Buffer;
  try {
    const custom = d.customPoster ? await customFlyer(d.customPoster) : null;
    jpg = custom
      ? await sharp(custom).rotate().resize({ width: 1080, withoutEnlargement: false }).jpeg({ quality: 86, mozjpeg: true }).toBuffer() // metadata dropped
      : await renderFlyer({ start: d.start, target: d.target, venue: d.venue, flyerTagline: d.flyerTagline, flyerPlace: d.flyerPlace });
  } catch (err) {
    // one broken flyer must never block a whole publish: fall back to the plain background and say so in the build log
    console.warn(`[flyer] ${props.event.id}: ${(err as Error).message}. Using the plain background instead.`);
    jpg = await readFile(join(process.cwd(), 'public', 'flyer', 'background.jpg'));
  }
  return new Response(jpg, { headers: { 'Content-Type': 'image/jpeg' } });
};
