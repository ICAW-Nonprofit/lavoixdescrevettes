// Build-time flyer rendering (Node): satori → SVG → resvg → PNG → sharp → JPEG.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import sharp from 'sharp';
import { FLYER, FLYER_FONTS, flyerTree, flyerTexts } from './flyer.js';

// Files are found from the project folder (the build runs there). A path relative to this file would
// break once the build bundles it into dist/.prerender/.
const pub = (p) => join(process.cwd(), 'public', p);

let assets;
async function loadAssets() {
  if (!assets) {
    const fonts = await Promise.all(
      FLYER_FONTS.map(async (f) => ({ name: f.name, weight: f.weight, style: 'normal', data: await readFile(pub(`fonts/flyer/${f.file}`)) })),
    );
    const bg = await readFile(pub('flyer/background.jpg'));
    assets = { fonts, background: `data:image/jpeg;base64,${bg.toString('base64')}` };
  }
  return assets;
}

/** Render a flyer to a JPEG buffer. `ev` is a site event (start, target, venue…) or a DB row. */
export async function renderFlyer(ev) {
  const { fonts, background } = await loadAssets();
  const svg = await satori(flyerTree({ ...flyerTexts(ev), background }), { width: FLYER.width, height: FLYER.height, fonts });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: FLYER.width } }).render().asPng();
  return sharp(png).jpeg({ quality: 86, mozjpeg: true }).toBuffer();
}
