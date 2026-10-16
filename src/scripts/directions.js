// "Itinéraire" links that open the right maps app:
// Android → app chooser (Google Maps, Waze, Citymapper…), iPhone/iPad → Apple Plans,
// computer → Google Maps on the web.
const ua = navigator.userAgent;
export const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
export const isAndroid = /Android/.test(ua);

export const googleMapsUrl = ({ address }) => `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(address)}`;

export function directionsUrl({ lat, lng, address }) {
  const q = encodeURIComponent(address);
  if (isAndroid) return `geo:${lat},${lng}?q=${q}`;
  if (isIOS) return `https://maps.apple.com/?ll=${lat},${lng}&q=${q}`;
  return googleMapsUrl({ address });
}

// Static links in pages: <a data-directions data-lat data-lng data-address href="(Google Maps)">
for (const a of document.querySelectorAll('a[data-directions]')) {
  const { lat, lng, address } = a.dataset;
  a.href = directionsUrl({ lat, lng, address });
  // app links (geo:, Apple Plans) open the app directly instead of a new tab
  if (isAndroid || isIOS) a.removeAttribute('target');
}
