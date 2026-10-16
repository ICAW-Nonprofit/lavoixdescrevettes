// "Share this action": native share sheet with flyer + text on phones/tablets,
// a panel of links (WhatsApp, Telegram, email, copy, download) on computers or older browsers.

const touch = matchMedia('(pointer: coarse)').matches;
const files = new Map(); // flyer URL → File (prepared in advance: Safari only allows sharing right after the tap)

async function prepare(src, name) {
  if (!src || files.has(src) || !navigator.canShare) return;
  files.set(src, null);
  try {
    const blob = await (await fetch(src)).blob();
    const file = new File([blob], name, { type: blob.type || 'image/jpeg' });
    if (navigator.canShare({ files: [file] })) files.set(src, file);
  } catch {
    /* no flyer, the text is still shared */
  }
}

for (const box of document.querySelectorAll('[data-share-event]')) {
  const btn = box.querySelector('[data-share-go]');
  const panel = box.querySelector('[data-share-panel]');
  const status = box.querySelector('[data-share-status]');
  const { title, text, flyer, flyerName, copied, thanks } = box.dataset;
  const useNative = touch && 'share' in navigator;

  if (useNative) {
    new IntersectionObserver(([e], io) => {
      if (e.isIntersecting) {
        io.disconnect();
        prepare(flyer, flyerName);
      }
    }).observe(box);
  }

  const togglePanel = (open = panel.hidden) => {
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  };

  btn.addEventListener('click', async () => {
    if (!useNative) return togglePanel();
    const file = files.get(flyer);
    try {
      await navigator.share(file ? { files: [file], title, text } : { title, text });
      status.textContent = thanks;
    } catch (err) {
      if (err && err.name === 'AbortError') return; // closed the share sheet
      togglePanel(true); // anything else: fall back to the links
    }
  });

  box.querySelector('[data-share-copy]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
      status.textContent = copied;
    } catch {
      prompt('', text);
    }
  });
}
