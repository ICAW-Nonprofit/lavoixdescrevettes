// Live flyer preview in the browser, with exactly the same template as the site build (src/lib/flyer.js).
import { FLYER, FLYER_FONTS, flyerTree } from '../../lib/flyer.js';
import { BASE } from './api.js';

let assets;
async function load() {
  if (!assets) {
    assets = (async () => {
      // the renderer is big (~1.5 MB): it's only downloaded once the form is on screen
      const { default: satori } = await import('satori');
      const fonts = await Promise.all(
        FLYER_FONTS.map(async (f) => ({
          name: f.name,
          weight: f.weight,
          style: 'normal',
          data: await (await fetch(`${BASE}/fonts/flyer/${f.file}`)).arrayBuffer(),
        })),
      );
      const blob = await (await fetch(`${BASE}/flyer/background.jpg`)).blob();
      const background = await new Promise((resolve) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.readAsDataURL(blob);
      });
      return { satori, fonts, background };
    })();
  }
  return assets;
}

/** texts: { tagline, dateLine, placeLine } → object URL of an SVG image */
export async function renderPreview(texts) {
  const { satori, fonts, background } = await load();
  const svg = await satori(flyerTree({ ...texts, background }), { width: FLYER.width, height: FLYER.height, fonts });
  return URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
}

/** Turn the preview into a JPEG file (for downloading or sharing before the site has rebuilt). */
export async function previewToJpeg(svgUrl) {
  const img = new Image();
  img.decoding = 'async';
  img.src = svgUrl;
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = FLYER.width;
  canvas.height = FLYER.height;
  canvas.getContext('2d').drawImage(img, 0, 0, FLYER.width, FLYER.height);
  return new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
}
