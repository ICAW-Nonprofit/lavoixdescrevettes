// Newsletter → ICAW's Mailchimp audience.
// With JS: submit through Mailchimp's JSONP endpoint, then go to our thank-you page.
// Without JS: the form posts normally and Mailchimp shows its own confirmation page.
import { rpc } from './supabase-rpc.js';

/** Anonymous count of the sign-up: site-wide, and for the last action page seen in this tab (if any). */
function count(form) {
  const { trackUrl: base, trackKey: key } = form.dataset;
  if (!base) return;
  let slug = null;
  try {
    slug = sessionStorage.getItem('lvdc-last-action');
  } catch {
    /* storage blocked: still counted site-wide */
  }
  rpc(base, key, 'track', { p_slug: slug, p_kind: 'newsletter' }).catch(() => {});
}

for (const form of document.querySelectorAll('[data-newsletter]')) {
  const msg = form.querySelector('[data-msg]');
  const btn = form.querySelector('button[type="submit"]');

  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = form.dataset.sending;
    msg.textContent = '';

    const cb = `lvdc_mc_${Date.now()}`;
    const params = new URLSearchParams(new FormData(form));
    params.set('c', cb);
    const src = form.action.replace('/subscribe/post?', '/subscribe/post-json?') + '&' + params.toString();
    const script = document.createElement('script');

    const fail = (text) => {
      btn.disabled = false;
      btn.textContent = label;
      msg.innerHTML = '';
      msg.append(`${form.dataset.error} `);
      const a = document.createElement('a');
      a.href = form.dataset.hosted;
      a.textContent = form.dataset.errorLink;
      msg.append(a, '.');
      if (text) console.warn('Mailchimp:', text);
    };
    const timer = setTimeout(() => fail('timeout'), 12000);

    window[cb] = (res) => {
      clearTimeout(timer);
      delete window[cb];
      script.remove();
      if (res && res.result === 'success') {
        count(form);
        location.href = form.dataset.thanks;
      }
      else if (res && /already subscribed/i.test(res.msg || '')) location.href = form.dataset.thanks;
      else fail(res && res.msg);
    };
    script.onerror = () => {
      clearTimeout(timer);
      fail('network');
    };
    script.src = src;
    document.body.append(script);
  });
}
