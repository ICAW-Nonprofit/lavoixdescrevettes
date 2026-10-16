// Contact form → form service (Formspree-compatible JSON API), then our thank-you page.
const form = document.querySelector('[data-contact]');
if (form && form.action.startsWith('http')) {
  const msg = form.querySelector('[data-msg]');
  const btn = form.querySelector('button[type="submit"]');
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    if (form.querySelector('[name="_gotcha"]')?.value) return; // bot
    const label = btn.textContent;
    btn.disabled = true;
    btn.textContent = form.dataset.sending;
    try {
      const res = await fetch(form.action, { method: 'POST', body: new FormData(form), headers: { Accept: 'application/json' } });
      if (!res.ok) throw new Error(String(res.status));
      location.href = form.dataset.thanks;
    } catch {
      btn.disabled = false;
      btn.textContent = label;
      msg.textContent = form.dataset.error;
    }
  });
}
