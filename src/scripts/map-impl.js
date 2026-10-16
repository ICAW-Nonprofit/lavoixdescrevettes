// Map of actions in France: MapLibre + OpenFreeMap (free, no API key, no tracking cookies),
// recoloured in the brand palette, with yellow pins and a popup per event.
import * as maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
// MapLibre 6 runs in a separate worker file; ship it with the site and point the library at it.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

import { directionsUrl, googleMapsUrl, isIOS } from './directions.js';

maplibregl.setWorkerUrl(workerUrl);

const C = { bleu: '#9cb3f7', pale: '#c9d6fb', marine: '#00192e', blanc: '#eef2ff', jaune: '#ffc907' };

const PIN = `<svg viewBox="0 0 34 44" aria-hidden="true"><path d="M17 2C8.7 2 2 8.6 2 16.8 2 28 17 42 17 42s15-14 15-25.2C32 8.6 25.3 2 17 2z" fill="${C.jaune}" stroke="${C.marine}" stroke-width="3"/><circle cx="17" cy="16" r="5.5" fill="${C.marine}"/></svg>`;

// Mainland France + Corsica
const FRANCE = [
  [-5.3, 41.3],
  [9.7, 51.2],
];

function recolor(map, lang) {
  for (const layer of map.getStyle().layers) {
    const id = layer.id;
    try {
      // place names in the page language (falls back to the local name)
      const tf = layer.type === 'symbol' ? map.getLayoutProperty(id, 'text-field') : null;
      if (tf && JSON.stringify(tf).includes('name')) {
        map.setLayoutProperty(id, 'text-field', ['coalesce', ['get', `name:${lang}`], ['get', 'name:latin'], ['get', 'name']]);
      }
      if (layer.type === 'background') map.setPaintProperty(id, 'background-color', C.blanc);
      else if (layer.type === 'fill' && /water/.test(id)) map.setPaintProperty(id, 'fill-color', C.bleu);
      else if (layer.type === 'line' && /water/.test(id)) map.setPaintProperty(id, 'line-color', C.bleu);
      else if (layer.type === 'fill' && /(park|landcover|landuse|wood|grass)/.test(id)) map.setPaintProperty(id, 'fill-color', C.pale);
      else if (layer.type === 'line' && /boundary/.test(id)) map.setPaintProperty(id, 'line-color', C.marine);
      else if (layer.type === 'symbol' && map.getLayoutProperty(id, 'text-field')) {
        map.setPaintProperty(id, 'text-color', C.marine);
        map.setPaintProperty(id, 'text-halo-color', C.blanc);
      }
    } catch {
      /* layer without that property */
    }
  }
}

const link = (href, text, extra = {}) => {
  const a = Object.assign(document.createElement('a'), { href, textContent: text, ...extra });
  if (href.startsWith('https://')) Object.assign(a, { target: '_blank', rel: 'noopener' });
  return a;
};

function popupNode(ev, labels) {
  const box = document.createElement('div');
  box.className = 'popup';
  const h = document.createElement('h3');
  h.textContent = ev.title;
  const when = document.createElement('p');
  when.textContent = ev.when;
  const where = document.createElement('p');
  where.textContent = ev.where;

  // directions: maps app on phones, Google Maps on computers (+ Google Maps as a second choice on iPhone)
  const go = document.createElement('div');
  go.className = 'links';
  go.append(link(directionsUrl(ev), `${labels.directions} ↗`, { className: 'popup-btn' }));
  if (isIOS) go.append(link(googleMapsUrl(ev), 'Google Maps'));

  const more = document.createElement('div');
  more.className = 'links';
  more.append(link(ev.url, `${labels.details} →`));

  box.append(h, when, where, go, more);
  if (!ev.past) {
    const cal = document.createElement('p');
    cal.className = 'popup-cal';
    cal.append(`${labels.addCal} : `, link(ev.ics, labels.calIcs, { download: '' }), ' · ', link(ev.google, labels.calGoogle));
    box.append(cal);
  }
  return box;
}

export function initMap(el) {
  const events = JSON.parse(el.dataset.events);
  const labels = JSON.parse(el.dataset.labels);
  const single = events.length === 1 && el.dataset.single === 'true';
  const lang = el.dataset.lang || 'fr';

  const map = new maplibregl.Map({
    container: el,
    style: 'https://tiles.openfreemap.org/styles/positron',
    ...(single ? { center: [events[0].lng, events[0].lat], zoom: 13 } : { bounds: FRANCE, fitBoundsOptions: { padding: 24 } }),
    minZoom: 3,
    maxZoom: 17,
    cooperativeGestures: true,
    attributionControl: { compact: true },
  });
  el.map = map; // handy for debugging from the console
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
  map.on('style.load', () => recolor(map, lang));
  map.once('load', () => el.classList.add('is-ready'));
  map.on('error', (e) => {
    el.dataset.mapError = String(e?.error?.message || e?.error || 'error');
    console.warn('[map]', e?.error);
  });

  for (const ev of events) {
    const pin = document.createElement('button');
    pin.type = 'button';
    pin.className = 'map-pin' + (ev.past ? ' is-past' : '');
    pin.setAttribute('aria-label', `${ev.title}, ${ev.when}`);
    pin.innerHTML = PIN;
    const popup = new maplibregl.Popup({ offset: [0, -40], maxWidth: '300px' }).setDOMContent(popupNode(ev, labels));
    new maplibregl.Marker({ element: pin, anchor: 'bottom' }).setLngLat([ev.lng, ev.lat]).setPopup(popup).addTo(map);
  }
}
