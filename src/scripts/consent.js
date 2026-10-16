// Cookie consent (CNIL): Google Analytics only loads after an explicit "yes".
// "No" is as easy as "yes", and the choice can be changed from the footer.
const KEY = 'lvdc-consent';
const banner = document.querySelector('[data-cookie]');
const gaId = banner?.dataset.ga;

const read = () => {
  try {
    return localStorage.getItem(KEY);
  } catch {
    return null;
  }
};
const write = (v) => {
  try {
    localStorage.setItem(KEY, v);
  } catch {}
};

function loadGA() {
  if (!gaId || window.gtag) return;
  window.dataLayer = window.dataLayer || [];
  window.gtag = function () {
    window.dataLayer.push(arguments);
  };
  window.gtag('consent', 'default', { ad_storage: 'denied', ad_user_data: 'denied', ad_personalization: 'denied', analytics_storage: 'granted' });
  window.gtag('js', new Date());
  window.gtag('config', gaId, { anonymize_ip: true });
  const s = document.createElement('script');
  s.async = true;
  s.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(gaId)}`;
  document.head.append(s);
}

if (banner) {
  const choice = read();
  if (choice === 'granted') loadGA();
  else if (!choice && gaId) banner.hidden = false;

  banner.querySelector('[data-accept]').addEventListener('click', () => {
    write('granted');
    banner.hidden = true;
    loadGA();
  });
  banner.querySelector('[data-refuse]').addEventListener('click', () => {
    const wasGranted = read() === 'granted';
    write('denied');
    banner.hidden = true;
    if (wasGranted) location.reload(); // unload GA
  });
  for (const b of document.querySelectorAll('[data-cookie-open]')) {
    b.addEventListener('click', () => {
      banner.hidden = false;
      banner.querySelector('[data-accept]').focus();
    });
  }
}
