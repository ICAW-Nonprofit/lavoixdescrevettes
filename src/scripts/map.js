// Load the map library only when a map is near the screen (it's the heaviest thing on the site).
async function start(el) {
  if (el.dataset.started) return;
  el.dataset.started = '1';
  const { initMap } = await import('./map-impl.js');
  initMap(el);
}

for (const el of document.querySelectorAll('[data-map]')) {
  if (el.getBoundingClientRect().top < innerHeight * 1.5) {
    start(el);
    continue;
  }
  const io = new IntersectionObserver(
    ([e]) => {
      if (!e.isIntersecting) return;
      io.disconnect();
      start(el);
    },
    { rootMargin: '300px' },
  );
  io.observe(el);
}
