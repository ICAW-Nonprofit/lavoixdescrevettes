// Small site-wide behaviours: mobile menu, sticky mobile CTA, expired "next action" ticket, share buttons.

/* ---------- mobile menu ---------- */
const openBtn = document.querySelector('[data-menu-open]');
const panel = document.querySelector('[data-menu-panel]');
if (openBtn && panel) {
  const closeBtn = panel.querySelector('[data-menu-close]');
  const open = () => {
    panel.classList.add('is-open');
    openBtn.setAttribute('aria-expanded', 'true');
    document.body.style.overflow = 'hidden';
    closeBtn?.focus();
  };
  const close = () => {
    panel.classList.remove('is-open');
    openBtn.setAttribute('aria-expanded', 'false');
    document.body.style.overflow = '';
    openBtn.focus();
  };
  openBtn.addEventListener('click', open);
  closeBtn?.addEventListener('click', close);
  panel.addEventListener('keydown', (e) => e.key === 'Escape' && close());
}

/* ---------- next-action ticket: hide it if the event ended since the last build ---------- */
for (const el of document.querySelectorAll('[data-expires]')) {
  if (Date.now() > Date.parse(el.dataset.expires)) {
    el.hidden = true;
    document.querySelectorAll(el.dataset.fallback || '').forEach((f) => (f.hidden = false));
  }
}

/* ---------- sticky mobile CTA ---------- */
const sticky = document.querySelector('[data-sticky-cta]');
if (sticky) {
  const anchor = document.querySelector('[data-hero-cta]');
  if (anchor) {
    new IntersectionObserver(([e]) => sticky.classList.toggle('is-shown', !e.isIntersecting && e.boundingClientRect.top < 0)).observe(anchor);
  } else {
    const onScroll = () => sticky.classList.toggle('is-shown', scrollY > 280);
    addEventListener('scroll', onScroll, { passive: true });
    onScroll();
  }
}

/* ---------- share buttons ---------- */
for (const box of document.querySelectorAll('[data-share]')) {
  const url = box.dataset.url;
  const title = box.dataset.title;
  const status = box.querySelector('[data-share-status]');
  const native = box.querySelector('[data-share-native]');
  if (native && navigator.share) {
    native.hidden = false;
    native.addEventListener('click', () => navigator.share({ title, url }).catch(() => {}));
  }
  box.querySelector('[data-share-copy]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(url);
      status.textContent = box.dataset.copied;
    } catch {
      prompt('', url);
    }
  });
}
