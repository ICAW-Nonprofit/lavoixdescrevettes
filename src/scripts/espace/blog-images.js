// Blog images, in the browser, before anything is uploaded:
//   • the file must really be a JPEG, PNG or WebP (its first bytes, then the browser must decode it; the name and the
//     type the system gives don't count: an SVG renamed .jpg is refused);
//   • at most 20 MB in; resized to 2400 px on the long side, orientation applied;
//   • re-drawn on a canvas and re-encoded (WebP, or JPEG if the browser can't make WebP): the copy has no EXIF, no GPS,
//     no camera data, so the original never leaves the phone;
//   • at most 2 MB out (the bucket refuses more). The build checks and cleans each image again (scripts/blog-media.mjs).
import { api, ApiError } from './api.js';

const MAX_IN = 20 * 1024 * 1024;
const MAX_OUT = 2 * 1024 * 1024;
const MAX_SIDE = 2400;

export const imageError = (err) =>
  ({
    image_type: 'Ce fichier n’est pas une image JPG, PNG ou WebP.',
    image_big: 'Image trop lourde : 20 Mo maximum.',
    image_heavy: 'Même compressée, l’image dépasse 2 Mo : choisis-en une plus petite.',
  })[err?.code];

function kindOf(b) {
  if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return 'jpeg';
  if ([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((x, i) => b[i] === x)) return 'png';
  const ascii = (from, to) => String.fromCharCode(...b.slice(from, to));
  if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') return 'webp';
  return null;
}

const toBlob = (canvas, type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality));

/** A clean, light copy of the chosen file (a Blob), or an ApiError image_type / image_big / image_heavy. */
export async function prepareImage(file) {
  if (file.size > MAX_IN) throw new ApiError('image_big');
  if (!kindOf(new Uint8Array(await file.slice(0, 12).arrayBuffer()))) throw new ApiError('image_type');
  let bitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new ApiError('image_type');
  }
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const draw = (background) => {
    const g = canvas.getContext('2d');
    g.clearRect(0, 0, canvas.width, canvas.height);
    if (background) {
      g.fillStyle = background;
      g.fillRect(0, 0, canvas.width, canvas.height);
    }
    g.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  };
  draw();
  for (const quality of [0.85, 0.75, 0.6]) {
    let blob = await toBlob(canvas, 'image/webp', quality);
    if (blob?.type !== 'image/webp') {
      draw('#ffffff'); // JPEG has no transparency
      blob = await toBlob(canvas, 'image/jpeg', quality);
    }
    if (blob && blob.size <= MAX_OUT) return blob;
  }
  throw new ApiError('image_heavy');
}

/** Check, clean and upload; returns the path in the bucket. */
export async function uploadImage(file) {
  return api.uploadBlogImage(await prepareImage(file));
}
