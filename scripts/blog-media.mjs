// Blog images for the build. For each image of a published post: download it from our own bucket, check it really is
// a JPEG, PNG or WebP (by its content, never its name: SVG and everything else is refused), and write a clean copy
// without metadata (EXIF, GPS, camera) into src/assets/blog-media/. Astro then makes the web sizes.
// Never throws: a bad or missing image is skipped with a warning, and the post builds without it.
// The folder is committed by the deploy bot as a backup, like events.json.
import { existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import sharp from 'sharp';
import { blockImages, IMAGE_PATH } from '../src/lib/blocks.js';

export const MEDIA_DIR = new URL('../src/assets/blog-media/', import.meta.url);
export const MAX_BYTES = 2 * 1024 * 1024; // same limit as the bucket
const MAX_PX = 6000;

function kindOf(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if (b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'png';
  if (b.subarray(0, 4).toString('latin1') === 'RIFF' && b.subarray(8, 12).toString('latin1') === 'WEBP') return 'webp';
  return null;
}

/** A clean copy of an uploaded image, or null when it isn't a JPEG/PNG/WebP within the limits. */
export async function cleanImage(buffer) {
  if (!buffer?.length || buffer.length > MAX_BYTES) return null;
  const kind = kindOf(buffer); // first bytes: sharp alone would also open SVG, GIF, TIFF…
  if (!kind) return null;
  try {
    const img = sharp(buffer, { failOn: 'error', limitInputPixels: MAX_PX * MAX_PX });
    const meta = await img.metadata();
    if (meta.format !== kind || !meta.width || meta.width > MAX_PX || meta.height > MAX_PX) return null;
    // rotate() applies the camera's orientation; sharp writes no metadata unless asked to
    const { data, info } = await img.rotate().toFormat(kind, kind === 'png' ? {} : { quality: 90 }).toBuffer({ resolveWithObject: true });
    return { buffer: data, ext: { jpeg: 'jpg', png: 'png', webp: 'webp' }[kind], width: info.width, height: info.height };
  } catch {
    return null;
  }
}

/** Download and clean the images of the published posts; remove the ones no live post uses any more. */
export async function syncBlogMedia(posts, supabaseUrl) {
  mkdirSync(MEDIA_DIR, { recursive: true });
  const wanted = new Set(posts.flatMap((p) => [p.cover_path, ...blockImages(p.blocks)]).filter((p) => IMAGE_PATH.test(p || '')));
  let added = 0;
  for (const path of wanted) {
    const file = new URL(path, MEDIA_DIR);
    if (existsSync(file)) continue;
    try {
      const res = await fetch(`${supabaseUrl}/storage/v1/object/public/blog/${path}`, { signal: AbortSignal.timeout(20000) });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const clean = await cleanImage(Buffer.from(await res.arrayBuffer()));
      if (!clean) throw new Error('not a JPEG, PNG or WebP within 2 MB and 6000 px');
      if (clean.ext !== path.split('.').pop()) throw new Error(`a ${clean.ext} file named .${path.split('.').pop()}`);
      writeFileSync(file, clean.buffer);
      added++;
    } catch (err) {
      console.warn(`[snapshot] Blog image ${path} skipped (${err.message}).`);
    }
  }
  let removed = 0;
  for (const name of readdirSync(MEDIA_DIR)) {
    if (name === '.gitkeep' || wanted.has(name)) continue;
    rmSync(new URL(name, MEDIA_DIR));
    removed++;
  }
  console.log(`[snapshot] Blog images: ${added} added, ${removed} removed, ${wanted.size} in use.`);
}
