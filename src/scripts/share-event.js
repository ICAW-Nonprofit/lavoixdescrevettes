// "Share this action": native share sheet with flyer + text on phones/tablets,
// a panel of links (WhatsApp, Signal, Telegram, email, copy, download) on computers or older browsers.
import { trackCampaign } from './campaign.js';

const touch = matchMedia('(pointer: coarse)').matches;
const files = new Map(); // flyer URL → File, prepared in advance: Safari only allows sharing right after the tap
const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 300));

async function prepare(src, name) {
  if (!src || files.has(src) || !navigator.canShare) return;
  files.set(src, null);
  try {
    const blob = await (await fetch(src)).blob();
    const file = new File([blob], name, { type: blob.type || 'image/jpeg' });
    if (navigator.canShare({ files: [file] })) files.set(src, file);
  } catch {
    files.delete(src); // try again on the next tap
  }
}

for (const box of document.querySelectorAll('[data-share-event]')) {
  const btn = box.querySelector('[data-share-go]');
  const panel = box.querySelector('[data-share-panel]');
  const status = box.querySelector('[data-share-status]');
  const { title, text, flyer, flyerName, copied, thanks, signalHint } = box.dataset;
  const useNative = touch && 'share' in navigator;

  // Prepare the flyer as soon as the page is idle (the box itself may have no layout box,
  // e.g. `display: contents` inside a row of buttons, so don't wait for it to be "visible").
  if (useNative) idle(() => prepare(flyer, flyerName));

  const togglePanel = (open = panel.hidden) => {
    panel.hidden = !open;
    btn.setAttribute('aria-expanded', String(open));
  };

  btn.addEventListener('click', async () => {
    if (!useNative) {
      if (panel.hidden) trackCampaign('share_click'); // opening the panel, not closing it
      return togglePanel();
    }
    const file = files.get(flyer);
    if (!file) prepare(flyer, flyerName); // not ready yet: share the text now, the flyer next time
    // Open the share sheet first (Safari only allows it right after the tap)…
    const sharing = navigator.share(file ? { files: [file], title, text } : { title, text });
    trackCampaign('share_click');
    // …then best-effort copy of the text, because some apps (Instagram, WhatsApp on iPhone) keep only the image.
    let didCopy = false;
    if (file) navigator.clipboard?.writeText(text).then(() => (didCopy = true), () => {});
    try {
      await sharing;
      trackCampaign('share_done'); // the phone says the share went through
      status.textContent = didCopy ? `${thanks} ${copied}` : thanks;
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

  // Signal has no "share" web link: copy the text, then open Signal Desktop (if installed).
  box.querySelector('[data-share-signal]')?.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      prompt('', text);
    }
    status.textContent = signalHint;
    location.href = 'sgnl://';
  });
}
