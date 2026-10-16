// Contact form → form service (Formspree-compatible JSON API), then our thank-you page.
// Prototype: while no endpoint is set in src/config.ts (data-preview), the form behaves normally
// (checks, "Sending…", thank-you page) but nothing is sent.
const form = document.querySelector('[data-contact]');
if (form) {
  const preview = form.dataset.preview === 'true';
  const msg = form.querySelector('[data-msg]');
  const btn = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    if (form.querySelector('[name="_gotcha"]')?.value) return; // bot
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = form.dataset.sending;
    msg.textContent = '';
    try {
      if (preview) {
        await new Promise((r) => setTimeout(r, 900));
      } else {
        const res = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
        if (!res.ok) throw new Error(String(res.status));
      }
      location.href = form.dataset.thanks;
    } catch {
      btn.disabled = false;
      btn.textContent = label;
      msg.textContent = form.dataset.error;
    }
  });
}
