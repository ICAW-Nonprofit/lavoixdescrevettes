// Charts of the organiser space: plain SVG, no library. Light grid, legend on top, tooltip on hover, touch
// and keyboard. Data marks are navy only; notes are lettered markers (A/M/B/N), so nothing relies on colour alone.
import { el, fill, table } from './ui.js';
import { fmtNum, fmtPct, pctDiff } from './calc.js';

const NS = 'http://www.w3.org/2000/svg';
function svgEl(tag, attrs = {}, text) {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  if (text != null) n.textContent = text;
  return n;
}
const utc = (day) => new Date(`${day}T00:00:00Z`);
const fmtTick = (day) => new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(utc(day));
const fmtLong = (day) => new Intl.DateTimeFormat('fr-FR', { weekday: 'short', day: 'numeric', month: 'short', year: 'numeric', timeZone: 'UTC' }).format(utc(day));
const compact = new Intl.NumberFormat('fr-FR', { notation: 'compact', maximumFractionDigits: 1 });

export const NOTE_KINDS = { A: 'Action', M: 'Média', B: 'Article', N: 'Note' };
export const noteKey = (kind) => el('span', { class: `note-key note-${kind}`, 'aria-hidden': 'true' }, kind);

/** Clean axis step for counts: 1, 2, 5, 10, 20… so that about 4 steps cover `max`. */
function niceStep(max) {
  const raw = Math.max(max, 4) / 4;
  const p = 10 ** Math.floor(Math.log10(raw));
  const f = raw / p;
  return Math.max(1, (f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10) * p);
}
/** Bar with a 4 px rounded top, square on the baseline. */
function barPath(x, y, w, h, r) {
  r = Math.min(r, w / 2, h);
  return `M${x},${y + h}V${y + r}Q${x},${y} ${x + r},${y}H${x + w - r}Q${x + w},${y} ${x + w},${y + r}V${y + h}Z`;
}

/**
 * Chart over days. points: [{ day: 'YYYY-MM-DD', value }], notes: [{ day, kind: 'A'|'M'|'B'|'N', label }].
 * tip(point) → extra tooltip lines. data: { cols, rows } for the « Voir les données » table.
 */
export function timeChart({ title, subtitle, kind = 'line', label, points, notes = [], summary, tip, data }) {
  const n = points.length;
  const index = new Map(points.map((p, i) => [p.day, i]));
  const notesByIdx = new Map();
  for (const nt of notes) {
    const i = index.get(nt.day);
    if (i != null) notesByIdx.set(i, [...(notesByIdx.get(i) || []), nt]);
  }
  const kinds = Object.keys(NOTE_KINDS).filter((k) => notes.some((nt) => nt.kind === k && index.has(nt.day)));

  const svg = svgEl('svg', { class: 'chart-svg', 'aria-hidden': 'true' });
  const tipBox = el('div', { class: 'chart-tip', 'aria-live': 'polite', hidden: true });
  const plot = el('div', { class: 'chart-plot', tabindex: 0, role: 'group', 'aria-label': `${summary} Flèches gauche et droite : lire jour par jour.` }, svg, tipBox);
  let geo = null;
  let cur = null;

  function draw() {
    const W = plot.clientWidth;
    if (!W || !n) return;
    const H = W < 520 ? 190 : 230;
    const max = Math.max(0, ...points.map((p) => p.value));
    const step = niceStep(max);
    const yMax = Math.max(1, Math.ceil(max / step)) * step; // stop at the first clean step above the data
    const yLabels = Array.from({ length: yMax / step + 1 }, (_, k) => compact.format(k * step));
    const L = 10 + 7 * Math.max(...yLabels.map((s) => s.length));
    const R = 10, T = kinds.length ? 28 : 10, B = 26;
    const pw = W - L - R, ph = H - T - B, bw = pw / n;
    const xAt = (i) => L + bw * (i + 0.5);
    const yAt = (v) => T + ph - (v / yMax) * ph;
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('width', W);
    svg.setAttribute('height', H);
    svg.replaceChildren();

    yLabels.forEach((s, k) => {
      const y = yAt(k * step);
      svg.append(svgEl('line', { class: 'grid', x1: L, x2: W - R, y1: y, y2: y }), svgEl('text', { class: 'tick', x: L - 8, y: y + 4, 'text-anchor': 'end' }, s));
    });
    const count = Math.min(n, Math.max(2, Math.floor(pw / 76)));
    for (let j = 0; j < count; j++) {
      const i = count === 1 ? 0 : Math.round((j * (n - 1)) / (count - 1));
      svg.append(svgEl('text', { class: 'tick', x: xAt(i), y: H - 7, 'text-anchor': j === 0 ? 'start' : j === count - 1 ? 'end' : 'middle' }, fmtTick(points[i].day)));
    }

    // notes: a hairline on every note day and a lettered marker. Days whose markers would be closer than 14 px
    // share one marker, centred over the group, showing the count; hovering any of those days lists the whole group.
    const clusters = [];
    for (const i of [...notesByIdx.keys()].sort((a, b) => a - b)) {
      const last = clusters.at(-1);
      if (last && xAt(i) - xAt(last.at(-1)) < 14) last.push(i);
      else clusters.push([i]);
    }
    const groups = new Map();
    for (const group of clusters) {
      const items = group.flatMap((i) => notesByIdx.get(i));
      const cls = `note-${items.length === 1 ? items[0].kind : 'many'}`;
      const x = (xAt(group[0]) + xAt(group.at(-1))) / 2;
      for (const i of group) {
        svg.append(svgEl('line', { class: 'note-line', x1: xAt(i), x2: xAt(i), y1: T - 6, y2: T + ph }));
        groups.set(i, { items, spread: group.length > 1 });
      }
      svg.append(
        svgEl('rect', { class: `note-mark ${cls}`, x: x - 8, y: 2, width: 16, height: 16, rx: 3 }),
        svgEl('text', { class: `note-text ${cls}`, x, y: 14, 'text-anchor': 'middle' }, items.length === 1 ? items[0].kind : String(items.length)),
      );
    }

    let bars = [];
    if (kind === 'bar') {
      const w = Math.max(1, Math.min(24, bw - 2));
      bars = points.map((p, i) => {
        const h = (p.value / yMax) * ph;
        if (h <= 0) return null;
        const b = svgEl('path', { class: 'bar', d: barPath(xAt(i) - w / 2, T + ph - h, w, h, 4) });
        svg.append(b);
        return b;
      });
    } else {
      const line = points.map((p, i) => `${i ? 'L' : 'M'}${xAt(i)},${yAt(p.value)}`).join('');
      svg.append(
        svgEl('path', { class: 'area', d: `${line}L${xAt(n - 1)},${T + ph}L${xAt(0)},${T + ph}Z` }),
        svgEl('path', { class: 'line', d: line }),
        svgEl('circle', { class: 'dot', cx: xAt(n - 1), cy: yAt(points[n - 1].value), r: 4 }),
      );
      const ey = yAt(points[n - 1].value);
      svg.append(svgEl('text', { class: 'end-label', x: xAt(n - 1) - 8, y: ey < T + 18 ? ey + 18 : ey - 10, 'text-anchor': 'end' }, fmtNum(points[n - 1].value)));
    }
    const cross = svgEl('line', { class: 'cross', y1: T, y2: T + ph, visibility: 'hidden' });
    const dot = svgEl('circle', { class: 'dot', r: 4, visibility: 'hidden' });
    svg.append(cross, dot);
    geo = { W, T, L, bw, xAt, yAt, bars, cross, dot, groups };
    if (cur != null) show(cur);
  }

  function show(i) {
    if (!geo) return;
    cur = Math.max(0, Math.min(n - 1, i));
    const p = points[cur];
    const g = geo.groups.get(cur);
    const x = geo.xAt(cur);
    geo.cross.setAttribute('x1', x);
    geo.cross.setAttribute('x2', x);
    geo.cross.setAttribute('visibility', 'visible');
    if (kind === 'bar') {
      svg.classList.add('is-hovering');
      geo.bars.forEach((b, j) => b?.classList.toggle('is-hot', j === cur));
    } else {
      geo.dot.setAttribute('cx', x);
      geo.dot.setAttribute('cy', geo.yAt(p.value));
      geo.dot.setAttribute('visibility', 'visible');
    }
    fill(tipBox,
      el('p', { class: 'tip-date' }, fmtLong(p.day)),
      el('p', { class: 'tip-row' }, el('span', { class: `key key-${kind}`, 'aria-hidden': 'true' }), el('strong', {}, fmtNum(p.value)), ` ${label}`),
      (tip ? tip(p) : []).map((t) => el('p', { class: 'tip-extra' }, t)),
      // a group spread over several days: each note with its own date
      (g?.items || []).map((nt) => el('p', { class: 'tip-note' }, noteKey(nt.kind), g.spread ? `${fmtTick(nt.day)} · ${nt.label}` : nt.label)));
    tipBox.hidden = false;
    const tw = tipBox.offsetWidth;
    let left = x + 14;
    if (left + tw > geo.W) left = Math.max(0, x - 14 - tw);
    tipBox.style.transform = `translate(${left}px, ${geo.T}px)`;
  }
  function hide() {
    cur = null;
    tipBox.hidden = true;
    svg.classList.remove('is-hovering');
    if (geo) for (const m of [geo.cross, geo.dot]) m.setAttribute('visibility', 'hidden');
  }
  const at = (e) => Math.floor((e.clientX - plot.getBoundingClientRect().left - geo.L) / geo.bw);
  plot.addEventListener('pointermove', (e) => geo && show(at(e)));
  plot.addEventListener('pointerdown', (e) => geo && show(at(e)));
  plot.addEventListener('pointerleave', () => document.activeElement !== plot && hide());
  plot.addEventListener('focus', () => show(cur ?? n - 1));
  plot.addEventListener('blur', hide);
  plot.addEventListener('keydown', (e) => {
    const to = { ArrowLeft: (cur ?? n) - 1, ArrowRight: (cur ?? -1) + 1, Home: 0, End: n - 1 }[e.key];
    if (to == null) return;
    e.preventDefault();
    show(to);
  });
  // draw at the real width (text never shrinks on phones), again when it changes
  new ResizeObserver(() => plot.clientWidth !== geo?.W && draw()).observe(plot);

  return el('figure', { class: 'chart-card' },
    el('figcaption', {}, el('h3', {}, title), el('p', { class: 'chart-sub' }, subtitle)),
    el('ul', { class: 'chart-legend' },
      el('li', {}, el('span', { class: `key key-${kind}`, 'aria-hidden': 'true' }), label),
      kinds.map((k) => el('li', {}, noteKey(k), NOTE_KINDS[k]))),
    n ? plot : el('p', { class: 'chart-empty' }, 'Pas encore de données.'),
    data && data.rows.length > 0 && el('details', { class: 'chart-data' }, el('summary', {}, 'Voir les données'), table(data.cols, data.rows)),
  );
}

/** This action vs the average of past actions: one row per number, bar = this action, tick = average. */
export function bullets(rows) {
  return el('div', { class: 'bullets' },
    el('ul', { class: 'chart-legend' },
      el('li', {}, el('span', { class: 'key key-bar', 'aria-hidden': 'true' }), 'Cette action'),
      el('li', {}, el('span', { class: 'key key-avg', 'aria-hidden': 'true' }), 'Moyenne des actions passées')),
    el('dl', { class: 'bullet-rows' },
      rows.map((r) => {
        const scale = Math.max(r.value, r.avg ?? 0, 1);
        const bar = el('span', { class: 'bullet-bar' });
        bar.style.width = `${(r.value / scale) * 100}%`;
        const tick = r.avg == null ? null : el('span', { class: 'bullet-avg' });
        if (tick) tick.style.left = `${(r.avg / scale) * 100}%`;
        return el('div', { class: 'bullet' },
          el('dt', {}, r.label),
          el('dd', { class: 'bullet-track' }, bar, tick),
          el('dd', { class: 'bullet-nums' }, el('strong', {}, fmtNum(r.value)), el('span', {}, ` · moy. ${fmtNum(r.avg)} · ${fmtPct(pctDiff(r.value, r.avg))}`)));
      })),
  );
}

/** Small trend line for a KPI card (decoration: the card's text carries the numbers). */
export function sparkline(values, w = 120, h = 32) {
  const max = Math.max(...values), min = Math.min(...values), range = max - min || 1;
  const pts = values.map((v, i) => [2 + (i * (w - 8)) / Math.max(1, values.length - 1), h - 4 - ((v - min) / range) * (h - 8)]);
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x},${y}`).join('');
  const svg = svgEl('svg', { class: 'spark', width: w, height: h, viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true' });
  const [ex, ey] = pts.at(-1);
  svg.append(svgEl('path', { class: 'area', d: `${line}L${ex},${h}L2,${h}Z` }), svgEl('path', { class: 'line', d: line }), svgEl('circle', { class: 'dot', cx: ex, cy: ey, r: 3 }));
  return svg;
}

/** Small bars for a KPI card: the last one (current period) in navy, earlier ones in grey. */
export function miniBars(values, h = 32) {
  const max = Math.max(1, ...values);
  const svg = svgEl('svg', { class: 'minibars', width: values.length * 12, height: h, viewBox: `0 0 ${values.length * 12} ${h}`, 'aria-hidden': 'true' });
  values.forEach((v, i) => {
    const bh = Math.max(1, (v / max) * (h - 2));
    svg.append(svgEl('path', { class: i === values.length - 1 ? 'bar' : 'bar is-past', d: barPath(i * 12 + 2, h - bh, 8, bh, 2) }));
  });
  return svg;
}
