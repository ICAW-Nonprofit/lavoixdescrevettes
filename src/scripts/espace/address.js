// Address search with the French national address base (Géoplateforme, free, no key, no cookies).
import { el, fill } from './ui.js';

const API = 'https://data.geopf.fr/geocodage/search';

/**
 * Accessible combobox: type an address, pick a suggestion.
 * onPick({ label, street, postal_code, city, lat, lng })
 */
export function addressSearch({ id, onPick, placeholder = 'ex. 35 avenue Sully Prudhomme, Châtenay-Malabry' }) {
  const listId = `${id}-list`;
  const input = el('input', {
    id,
    type: 'search',
    autocomplete: 'off',
    placeholder,
    role: 'combobox',
    'aria-autocomplete': 'list',
    'aria-expanded': 'false',
    'aria-controls': listId,
  });
  const list = el('ul', { id: listId, class: 'addr-list', role: 'listbox', hidden: true });
  let results = [];
  let active = -1;
  let timer;
  let ctrl;

  const close = () => {
    list.hidden = true;
    input.setAttribute('aria-expanded', 'false');
    active = -1;
  };
  const pick = (r) => {
    input.value = r.label;
    close();
    onPick(r);
  };
  const highlight = (i) => {
    active = i;
    [...list.children].forEach((li, j) => li.setAttribute('aria-selected', String(j === i)));
    if (i >= 0) input.setAttribute('aria-activedescendant', `${listId}-${i}`);
  };

  async function search(q) {
    ctrl?.abort();
    ctrl = new AbortController();
    try {
      const res = await fetch(`${API}?q=${encodeURIComponent(q)}&limit=6&index=address&autocomplete=1`, { signal: ctrl.signal });
      const data = await res.json();
      results = (data.features || []).map((f) => {
        const p = f.properties;
        return {
          label: p.label,
          street: p.type === 'municipality' ? '' : p.name,
          postal_code: p.postcode || '',
          city: p.city || p.name,
          lat: f.geometry.coordinates[1],
          lng: f.geometry.coordinates[0],
        };
      });
      fill(list, 
        ...results.map((r, i) =>
          el('li', { id: `${listId}-${i}`, role: 'option', 'aria-selected': 'false', onmousedown: (e) => (e.preventDefault(), pick(r)) }, r.label),
        ),
      );
      list.hidden = results.length === 0;
      input.setAttribute('aria-expanded', String(results.length > 0));
      active = -1;
    } catch (err) {
      if (err.name !== 'AbortError') close();
    }
  }

  input.addEventListener('input', () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < 4) return close();
    timer = setTimeout(() => search(q), 250);
  });
  input.addEventListener('keydown', (e) => {
    if (list.hidden) return;
    if (e.key === 'ArrowDown') (e.preventDefault(), highlight(Math.min(active + 1, results.length - 1)));
    else if (e.key === 'ArrowUp') (e.preventDefault(), highlight(Math.max(active - 1, 0)));
    else if (e.key === 'Enter' && active >= 0) (e.preventDefault(), pick(results[active]));
    else if (e.key === 'Escape') close();
  });
  input.addEventListener('blur', () => setTimeout(close, 150));

  return el('div', { class: 'addr' }, input, list);
}
