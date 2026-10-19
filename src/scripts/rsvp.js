// "J'y vais" + live count + anonymous counters (views, shares, calendar adds, newsletter sign-ups).
// Talks to Supabase's REST API directly (no library), with the public anon key.

import { rpc } from './supabase-rpc.js';

const box = document.querySelector('[data-rsvp]');
const tracker = document.querySelector('[data-track-slug]');

// ---------- anonymous counters ----------
if (tracker) {
  const { trackSlug: slug, trackUrl: base, trackKey: key } = tracker.dataset;
  const track = (kind) => rpc(base, key, 'track', { p_slug: slug, p_kind: kind }).catch(() => {});
  const seen = `lvdc-view-${slug}`;
  try {
    sessionStorage.setItem('lvdc-last-action', slug); // a newsletter sign-up later in this tab counts for this action (newsletter.js)
    if (!sessionStorage.getItem(seen)) {
      sessionStorage.setItem(seen, '1');
      track('view');
    }
  } catch {
    track('view');
  }
  document.addEventListener('click', (e) => {
    const el = e.target.closest('[data-share-go], [data-share-panel] a, [data-share-copy], [data-share-signal]');
    if (el) track('share');
    if (e.target.closest('.cal-menu a, .popup-cal a, [data-cal-link]')) track('calendar');
  });
}

// ---------- "J'y vais" ----------
if (box) {
  const { slug, url: base, key } = box.dataset;
  const i18n = JSON.parse(box.dataset.i18n);
  const form = box.querySelector('[data-rsvp-form]');
  const done = box.querySelector('[data-rsvp-done]');
  const msg = box.querySelector('[data-rsvp-msg]');
  const countEl = box.querySelector('[data-rsvp-count]');
  const btn = form.querySelector('button[type="submit"]');
  const storeKey = `lvdc-rsvp-${slug}`;

  const showCount = (n) => {
    if (typeof n === 'number' && n >= 10) {
      countEl.textContent = i18n.count.replace('{n}', n);
      countEl.hidden = false;
    }
  };
  const showDone = (withMail) => {
    form.hidden = true;
    done.hidden = false;
    done.querySelector('[data-rsvp-mail]').hidden = !withMail;
  };

  rpc(base, key, 'rsvp_public_count', { p_slug: slug })
    .then((r) => (r.ok ? r.json() : null))
    .then(showCount)
    .catch(() => {});

  try {
    const prev = JSON.parse(localStorage.getItem(storeKey) || 'null');
    if (prev) showDone(prev.mail);
  } catch {}

  const openedAt = Date.now();
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    if (form.website.value || Date.now() - openedAt < 1500) return; // bots
    const label = btn.innerHTML;
    btn.disabled = true;
    btn.textContent = i18n.sending;
    msg.textContent = '';
    const email = form.email.value.trim();
    try {
      const res = await rpc(base, key, 'rsvp', { p_slug: slug, p_name: form.name.value.trim(), p_email: email || null });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const m = String(data.message || '');
        throw new Error(['closed', 'too many', 'name', 'email'].find((k) => m.includes(k)) || 'other');
      }
      showCount(data.count);
      try {
        localStorage.setItem(storeKey, JSON.stringify({ mail: Boolean(email) }));
      } catch {}
      showDone(Boolean(email));
      form.reset();
    } catch (err) {
      msg.textContent = i18n.errors[err.message] || i18n.errors.other;
    } finally {
      btn.disabled = false;
      btn.innerHTML = label;
    }
  });

  box.querySelector('[data-rsvp-again]').addEventListener('click', () => {
    try {
      localStorage.removeItem(storeKey);
    } catch {}
    done.hidden = true;
    form.hidden = false;
    form.name.focus();
  });
}
