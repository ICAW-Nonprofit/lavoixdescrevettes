/*! QR encoding: uqr (MIT) — Copyright (c) Project Nayuki, Copyright (c) 2023 Anthony Fu */
// QR codes for campaign links, drawn here (no outside service). Loaded only when a « QR code » panel is opened.
import { encode } from 'uqr';

const NAVY = '#00192e';

// error correction Q: still reads with a fold or a stain (flyers); 4 modules of white around it, as the standard asks
const modules = (text) => encode(text, { ecc: 'Q', border: 4 }).data;

/** SVG file content: one path of whole modules, sharp at any print size. Only numbers go in, never text. */
export function qrSvg(text) {
  const m = modules(text);
  let d = '';
  m.forEach((row, y) => row.forEach((on, x) => on && (d += `M${x} ${y}h1v1h-1z`)));
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${m.length} ${m.length}" shape-rendering="crispEdges"><rect width="${m.length}" height="${m.length}" fill="#fff"/><path fill="${NAVY}" d="${d}"/></svg>`;
}

/** PNG at least `min` px wide, with a whole number of pixels per module (no blur). */
export function qrPng(text, min = 1000) {
  const m = modules(text);
  const px = Math.ceil(min / m.length);
  const canvas = Object.assign(document.createElement('canvas'), { width: m.length * px, height: m.length * px });
  const g = canvas.getContext('2d');
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = NAVY;
  m.forEach((row, y) => row.forEach((on, x) => on && g.fillRect(x * px, y * px, px, px)));
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNG'))), 'image/png'));
}
