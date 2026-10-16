/**
 * Flyer template (Instagram post, 1080 × 1350), shared by the site build (PNG/JPEG per action)
 * and the live preview in the organiser space (SVG in the browser).
 *
 * Fixed parts (colour, grain, shrimp, crowd, logos) live in /flyer/background.jpg.
 * Variable parts: the headline lockup, a 3-line tagline, the date bar and the meeting-point bar.
 * To switch to the designer's Canva template: replace background.jpg and adjust ZONES below.
 */

export const FLYER = { width: 1080, height: 1350 };

const NAVY = '#00192e';
const BLEU = '#9cb3f7';

// Measured on the 4 November Canva flyer (cap tops / sizes in px). CAP = where capitals start
// inside a line box of line-height 1, as a fraction of the font size.
const CAP = 0.17;
const ZONES = {
  action: { capTop: 54, size: 225, spacing: 5.6 },
  pourLes: { capTop: 224, size: 72, spacing: 1.8 },
  crevettes: { capTop: 291, size: 239, spacing: 7.6 },
  tagline: { capTop: 485, size: 43, pitch: 42, spacing: 0.7, maxWidth: 980 },
  date: { top: 656, height: 70, size: 62, maxWidth: 1000 },
  place: { top: 756, height: 70, size: 62, maxWidth: 1040 },
};

// Bricolage Grotesque, condensed width (static cuts of the variable font, opsz 28)
export const FLYER_FONTS = [
  { name: 'Bricolage', weight: 500, file: 'bricolage-condensed-500.ttf' },
  { name: 'Bricolage', weight: 700, file: 'bricolage-condensed-700.ttf' },
  { name: 'Bricolage', weight: 800, file: 'bricolage-condensed-800.ttf' },
];

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const DAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

/** Date/time parts in Paris time, without depending on Intl data (works the same in Node and browsers). */
function parisParts(date) {
  const d = new Date(date);
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-GB', {
      timeZone: 'Europe/Paris',
      year: 'numeric',
      month: 'numeric',
      day: 'numeric',
      weekday: 'short',
      hour: 'numeric',
      minute: '2-digit',
      hourCycle: 'h23',
    })
      .formatToParts(d)
      .map((p) => [p.type, p.value]),
  );
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday);
  return { day: Number(parts.day), month: Number(parts.month) - 1, weekday: wd, hour: Number(parts.hour), minute: parts.minute };
}

/** "MERCREDI 4 NOVEMBRE, 11 H" */
export function flyerDateLine(startsAt) {
  const p = parisParts(startsAt);
  const day = p.day === 1 ? '1er' : String(p.day);
  const time = p.minute === '00' ? `${p.hour} H` : `${p.hour} H ${p.minute}`;
  return `${DAYS[p.weekday]} ${day} ${MONTHS[p.month]}, ${time}`.toUpperCase();
}

const ABBR = [
  [/\bavenue\b/i, 'av.'],
  [/\bboulevard\b/i, 'bd'],
  [/\bplace\b/i, 'pl.'],
  [/\bsaint\b/i, 'st'],
];

/** "RDV : 35 AV. SULLY PRUDHOMME" (+ city when it isn't Paris) */
export function flyerPlaceLine({ street, city }) {
  let s = (street || '').trim();
  for (const [re, short] of ABBR) s = s.replace(re, short);
  const showCity = city && !/^paris\b/i.test(city.trim()) && s;
  const where = [s, showCity ? city : s ? '' : city].filter(Boolean).join(', ');
  return `RDV : ${where}`.toUpperCase();
}

/** Default tagline (3 lines) from the action's target. */
export function defaultTagline(target) {
  const t = (target || '').trim();
  return t
    ? `Les crevettes ont besoin de toi !\nRejoins notre campagne pour exiger que ${t}\narrête de les asphyxier`
    : 'Les crevettes ont besoin de toi !\nRejoins-nous pour mettre fin\naux pires pratiques infligées aux crevettes';
}

// --- tiny element helper for satori ---
const h = (type, style, children) => ({ type, props: { style, children } });

/** Font size that keeps a single line inside maxWidth (condensed caps ≈ 0.47 em per character). */
function fit(text, size, maxWidth, ratio = 0.47) {
  const est = text.length * size * ratio;
  return est > maxWidth ? Math.max(28, Math.floor((maxWidth / (text.length * ratio)) * 10) / 10) : size;
}

function bar(text, zone) {
  const size = fit(text, zone.size, zone.maxWidth - 90, 0.42);
  return h(
    'div',
    { position: 'absolute', top: zone.top, left: 0, width: FLYER.width, height: zone.height, display: 'flex', justifyContent: 'center' },
    [
      h(
        'div',
        {
          display: 'flex',
          alignItems: 'center',
          height: zone.height,
          padding: '0 44px',
          background: NAVY,
          color: BLEU,
          fontFamily: 'Bricolage',
          fontWeight: 800,
          fontSize: size,
          letterSpacing: 0,
          lineHeight: 1,
        },
        text,
      ),
    ],
  );
}

/** One centred line whose capitals start exactly at `capTop`. */
function line(text, { capTop, size, spacing }, weight) {
  return h(
    'div',
    {
      position: 'absolute',
      top: Math.round(capTop - CAP * size),
      left: 0,
      width: FLYER.width,
      display: 'flex',
      justifyContent: 'center',
      fontSize: size,
      fontWeight: weight,
      lineHeight: 1,
      letterSpacing: spacing,
    },
    text,
  );
}

/**
 * @param {{ tagline: string, dateLine: string, placeLine: string, background: string }} f
 *   background: URL or data URI of /flyer/background.jpg
 */
export function flyerTree(f) {
  const lines = (f.tagline || '').toUpperCase().split('\n').slice(0, 3);
  const z = ZONES;
  return h(
    'div',
    {
      width: FLYER.width,
      height: FLYER.height,
      display: 'flex',
      position: 'relative',
      backgroundImage: `url(${f.background})`,
      backgroundSize: `${FLYER.width}px ${FLYER.height}px`,
      fontFamily: 'Bricolage',
      color: NAVY,
    },
    [
      // headline lockup (fixed text)
      line('ACTION', z.action, 800),
      line('POUR LES', z.pourLes, 500),
      line('CREVETTES', z.crevettes, 800),
      // tagline: up to 3 lines, each shrunk if too long
      ...lines.map((t, i) =>
        line(t, { capTop: z.tagline.capTop + i * z.tagline.pitch, size: fit(t, z.tagline.size, z.tagline.maxWidth, 0.42), spacing: z.tagline.spacing }, 700),
      ),
      bar(f.dateLine, z.date),
      bar(f.placeLine, z.place),
    ],
  );
}

/** Flyer texts for an action (DB row or site event). */
export function flyerTexts(ev) {
  return {
    tagline: ev.flyer_tagline || ev.flyerTagline || defaultTagline(ev.target),
    dateLine: flyerDateLine(ev.starts_at || ev.start),
    placeLine: ev.flyer_place || ev.flyerPlace || flyerPlaceLine({ street: ev.street ?? ev.venue?.street, city: ev.city ?? ev.venue?.city }),
  };
}
