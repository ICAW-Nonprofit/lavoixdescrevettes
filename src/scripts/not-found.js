// GitHub Pages serves a single 404 page (French). For missing /en/… addresses, send visitors to the
// English 404 and put the address they typed back in the address bar.
const el = document.querySelector('[data-404]');
if (el) {
  const base = el.dataset.base;
  const enPrefix = `${base}/en/`;
  if (el.dataset['404'] === 'fr' && location.pathname.startsWith(enPrefix)) {
    const from = location.pathname + location.search + location.hash;
    location.replace(`${enPrefix}404/?from=${encodeURIComponent(from)}`);
  } else if (el.dataset['404'] === 'en') {
    const from = new URLSearchParams(location.search).get('from');
    if (from && from.startsWith(enPrefix)) history.replaceState(null, '', from);
  }
}
