/**
 * La crevette vivante — lavoixdescrevettes.org
 *
 * A live, hand-drawn-looking shrimp rendered on a 2D canvas, no dependencies.
 * - Eye and antennae follow the cursor (or wander on their own when idle / on touch)
 * - Swimmerets paddle, legs sway, body hovers
 * - Click / tap (or a fast swipe past its face) → tail-flick escape + bubbles
 * - "Line boil" + crayon grain to match the riso / Canva poster look
 * - Static frame for prefers-reduced-motion, paused when off-screen
 *
 * Markup:
 *   <section data-crevette-scene>
 *     <canvas data-crevette aria-hidden="true"></canvas>   ← covers the whole scene
 *     <div data-crevette-stage></div>                       ← box where the body lives (CSS decides size/position)
 *   </section>
 */

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;

/* The body is designed in a 1100 × 600 "world" box, facing left. */
const BOX_W = 1100;

const INK = '#FFC907';
const EYE = '#00192E';
const SHINE = '#EEF2FF';
const BUBBLE = '#00192E';

const ROOT_X = 530; // carapace / abdomen junction (dorsal)
const ROOT_Y = 236;

const SEG_LEN = [95, 92, 88, 82, 75, 98];
const SEG_H = [142, 138, 128, 115, 99, 82, 62];
const SEG_BEND = [0, 8, 11, 13, 14, 14];
const TELSON_BEND = 8;
const ABD_START = -10;

const LEGS = [
  { x: -248, y: 124, a1: 130, a2: 106, l1: 80, l2: 68, claw: true },
  { x: -206, y: 134, a1: 119, a2: 99, l1: 78, l2: 70, claw: true },
  { x: -162, y: 141, a1: 107, a2: 92, l1: 76, l2: 68 },
  { x: -118, y: 145, a1: 97, a2: 83, l1: 72, l2: 64 },
  { x: -74, y: 147, a1: 87, a2: 75, l1: 68, l2: 58 },
];

const ANTENNAE = [
  { bx: -302, by: 86, len: 680, n: 28, base: 196, off: -5, phase: 0, w0: 6.5, w1: 1.1, stiff: 3 },
  { bx: -300, by: 90, len: 600, n: 25, base: 207, off: 7, phase: 2.1, w0: 5.6, w1: 1, stiff: 3 },
];
const ANTENNULES = [
  { bx: -306, by: 66, len: 175, n: 10, base: 206, off: 0, phase: 1.3, w0: 4.4, w1: 1, stiff: 2 },
  { bx: -306, by: 68, len: 140, n: 9, base: 220, off: 0, phase: 3.7, w0: 3.8, w1: 1, stiff: 2 },
];

/* Dash patterns: [erased, kept, …] → nicks on outlines, broken dry-brush streaks inside */
const NICKS = [[2, 11, 3, 17, 1, 9], [3, 8, 1, 14, 2, 21], [1, 13, 2, 7, 4, 16]];
const STREAKS = [[18, 5, 7, 4, 30, 6], [10, 4, 22, 7, 6, 3], [26, 6, 5, 3, 12, 5]];
const BOIL = 1.8;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const easeOut = (x) => 1 - Math.pow(1 - x, 3);
function rnd(n) {
  const s = Math.sin(n * 91.345 + 47.853) * 43758.5453;
  return (s - Math.floor(s)) * 2 - 1;
}

/* Crayon grain: sparse speckles + tiny scratches, erased out of the yellow. One small tile, made once. */
function makeGrain(w, h) {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  const img = g.createImageData(w, h);
  const d = img.data;
  for (let i = 3; i < d.length; i += 4) {
    if (Math.random() < 0.075) d[i] = 110 + Math.random() * 145;
  }
  g.putImageData(img, 0, 0);
  g.strokeStyle = '#000';
  g.lineCap = 'round';
  const n = ((w * h) / 700) | 0;
  for (let i = 0; i < n; i++) {
    const x = Math.random() * w;
    const y = Math.random() * h;
    const a = Math.random() * Math.PI;
    const len = 2 + Math.random() * 8;
    g.globalAlpha = 0.25 + Math.random() * 0.55;
    g.lineWidth = 0.6 + Math.random() * 1.2;
    g.beginPath();
    g.moveTo(x, y);
    g.lineTo(x + Math.cos(a) * len, y + Math.sin(a) * len);
    g.stroke();
  }
  return c;
}

export class Crevette {
  constructor(canvas, stage, scene) {
    this.c = canvas;
    this.ctx = canvas.getContext('2d');
    this.stage = stage;
    this.scene = scene;
    this.reduced = matchMedia('(prefers-reduced-motion: reduce)');

    this.t = 0;
    this.boilT = 0;
    this.boilFrame = 0;
    this.look = { x: 120, y: 60 };
    this.pointer = null;
    this.moveT = -1e9;
    this.ptrTime = 0;
    this.ptrSpeed = 0;
    this.pitch = 0;
    this.rotB = 0;
    this.rotH = 0;
    this.curl = 0;
    this.flickT = -1;
    this.cool = 0;
    this.bx = ROOT_X;
    this.by = ROOT_Y;
    this.bubbles = [];
    this.nextBubble = 1.2;
    this.raf = 0;
    this.visible = true;
    this.grain = this.ctx.createPattern(makeGrain(320, 320), 'repeat');

    const rig = (a) => ({
      ...a,
      ang: new Float32Array(a.n).fill(a.base * DEG),
      pts: Array.from({ length: a.n }, () => ({ x: 0, y: 0 })),
    });
    this.antennae = ANTENNAE.map(rig);
    this.antennules = ANTENNULES.map(rig);

    this.tick = this.tick.bind(this);
    this.onMove = this.onMove.bind(this);
    this.onDown = this.onDown.bind(this);

    addEventListener('pointermove', this.onMove, { passive: true });
    scene.addEventListener('pointerdown', this.onDown);
    new ResizeObserver(() => this.resize()).observe(canvas);
    new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting;
      this.visible ? this.start() : this.stop();
    }).observe(canvas);
    document.addEventListener('visibilitychange', () => (document.hidden ? this.stop() : this.start()));
    this.reduced.addEventListener('change', () => {
      this.stop();
      this.reduced.matches ? this.renderStill() : this.start();
    });

    this.resize();
  }

  /* ---------- lifecycle ---------- */

  resize() {
    const r = this.c.getBoundingClientRect();
    if (!r.width || !r.height) return;
    // cap the backing store (≤ 4096 px per side) so a very tall scene can't exhaust memory
    this.dpr = Math.min(window.devicePixelRatio || 1, 2, 4096 / r.width, 4096 / r.height);
    const w = Math.round(r.width * this.dpr);
    const h = Math.round(r.height * this.dpr);
    if (w !== this.c.width || h !== this.c.height) {
      this.c.width = w;
      this.c.height = h;
    }
    if (this.reduced.matches) this.renderStill();
    else if (!this.raf) {
      this.update(1 / 60);
      this.draw();
    }
  }

  start() {
    if (this.raf || this.reduced.matches || !this.visible || document.hidden) return;
    this.last = performance.now();
    this.raf = requestAnimationFrame(this.tick);
  }

  stop() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
  }

  tick(now) {
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.update(dt);
    this.draw();
    this.raf = requestAnimationFrame(this.tick);
  }

  renderStill() {
    for (let i = 0; i < 90; i++) this.update(1 / 30);
    this.draw();
  }

  /* ---------- input ---------- */

  onMove(e) {
    const now = performance.now();
    if (this.pointer) {
      const dtm = (now - this.ptrTime) / 1000;
      if (dtm > 0.004) {
        const v = Math.hypot(e.clientX - this.pointer.x, e.clientY - this.pointer.y) / dtm;
        this.ptrSpeed = this.ptrSpeed * 0.5 + v * 0.5;
      }
    }
    this.pointer = { x: e.clientX, y: e.clientY };
    this.ptrTime = now;
    this.moveT = this.t;
  }

  onDown(e) {
    if (this.reduced.matches) return;
    if (e.target.closest('a, button, input, textarea, select, label, summary')) return;
    this.pointer = { x: e.clientX, y: e.clientY };
    this.moveT = this.t;
    this.flick();
  }

  flick() {
    if (this.flickT >= 0 && this.flickT < 0.7) return;
    this.flickT = 0;
    this.cool = this.t + 2.5;
    for (let i = 0; i < 10; i++) {
      this.addBubble(
        this.bx + 220 + Math.random() * 300,
        this.by + 90 + Math.random() * 160,
        3 + Math.random() * 10,
        80 + Math.random() * 90,
      );
    }
  }

  addBubble(x, y, r, vy = 45 + Math.random() * 35) {
    this.bubbles.push({ x, y, r, vy, ph: Math.random() * TAU, age: 0, life: 2.6 + Math.random() * 2 });
  }

  /* ---------- coordinates ---------- */

  measure() {
    const cr = this.c.getBoundingClientRect();
    const sr = this.stage.getBoundingClientRect();
    this.cr = cr;
    this.s = sr.width / BOX_W;
    this.ox = sr.left - cr.left;
    this.oy = sr.top - cr.top;
  }

  toWorld(cx, cy) {
    return { x: (cx - this.cr.left - this.ox) / this.s, y: (cy - this.cr.top - this.oy) / this.s };
  }

  headToWorld(x, y) {
    const a = this.rotB + this.rotH;
    const c = Math.cos(a);
    const s = Math.sin(a);
    return { x: this.bx + x * c - y * s, y: this.by + x * s + y * c };
  }

  /* seeded jitter that changes ~9×/s → hand-drawn "line boil" */
  j(k) {
    return rnd(k * 1.618 + this.boilFrame * 7.31) * BOIL;
  }

  /* ---------- simulation ---------- */

  update(dt) {
    this.measure();
    if (!this.s) return;
    const still = this.reduced.matches;
    this.t += dt;
    const t = this.t;

    if (!still) {
      this.boilT += dt;
      if (this.boilT > 0.11) {
        this.boilT = 0;
        this.boilFrame = (this.boilFrame + 1) % 997;
      }
    }

    // Where it looks: the pointer, or a lazy wander when idle / on touch screens.
    const tracking = !still && this.pointer && t - this.moveT < 6;
    let tx;
    let ty;
    if (tracking) ({ x: tx, y: ty } = this.toWorld(this.pointer.x, this.pointer.y));
    else if (still) [tx, ty] = [80, -40];
    else {
      tx = 250 + Math.sin(t * 0.29) * 420 + Math.sin(t * 0.71) * 110;
      ty = 150 + Math.sin(t * 0.47 + 1.2) * 240;
    }
    const kl = 1 - Math.exp(-dt * (tracking ? 8 : 1.6));
    this.look.x += (tx - this.look.x) * kl;
    this.look.y += (ty - this.look.y) * kl;

    // Startle: a fast swipe right past its face → escape flick.
    this.ptrSpeed *= Math.exp(-dt * 8);
    if (tracking && this.ptrSpeed > 2400 && t - this.moveT < 0.06 && t > this.cool) {
      const p = this.toWorld(this.pointer.x, this.pointer.y);
      const h = this.headToWorld(-300, 60);
      if (Math.hypot(p.x - h.x, p.y - h.y) < 190) this.flick();
    }

    // Tail-flick timeline: fast ventral curl + dart backwards, then swim back.
    let curl = 0;
    let dash = 0;
    if (this.flickT >= 0) {
      this.flickT += dt;
      const f = this.flickT;
      curl = f < 0.08 ? easeOut(f / 0.08) : Math.exp(-(f - 0.08) * 9) * Math.cos((f - 0.08) * 11);
      dash = f < 0.14 ? easeOut(f / 0.14) : Math.exp(-(f - 0.14) * 2.4);
      if (f > 3) this.flickT = -1;
    }
    this.curl = curl;

    const bob = still ? 0 : 1;
    this.bx = ROOT_X + Math.sin(t * 0.5) * 5 * bob + dash * 120;
    this.by = ROOT_Y + Math.sin(t * 0.9) * 7 * bob - dash * 45;

    // Head pitches toward what it looks at.
    const hx = this.bx - 260;
    const hy = this.by + 50;
    const pitch = Math.atan2(hy - this.look.y, Math.max(280, Math.abs(this.look.x - hx)));
    const target = clamp(pitch * 0.45, -9 * DEG, 13 * DEG);
    this.pitch += (target - this.pitch) * (1 - Math.exp(-dt * 3.5));
    this.rotB = this.pitch * 0.35 + Math.sin(t * 0.6) * 0.8 * DEG * bob - curl * 6 * DEG;
    this.rotH = this.pitch * 0.65;

    const headRot = (this.rotB + this.rotH) / DEG;
    for (const a of this.antennae) this.steer(a, dt, headRot, 1);
    for (const a of this.antennules) this.steer(a, dt, headRot, 0.18);

    // Bubbles: a few now and then from the mouthparts.
    if (!still) {
      this.nextBubble -= dt;
      if (this.nextBubble <= 0) {
        const m = this.headToWorld(-296, 116);
        const n = 1 + ((Math.random() * 2) | 0);
        for (let i = 0; i < n; i++) this.addBubble(m.x + (Math.random() - 0.5) * 12, m.y - i * 16, 4 + Math.random() * 5);
        this.nextBubble = 2.4 + Math.random() * 3.2;
      }
    }
    for (const b of this.bubbles) {
      b.age += dt;
      b.y -= b.vy * dt;
      b.x += Math.sin(t * 2.4 + b.ph) * 16 * dt;
      b.r += dt * 0.7;
    }
    this.bubbles = this.bubbles.filter((b) => b.age < b.life);
  }

  /* Antenna = chain of angles easing toward the look direction; tips lag → whip-like motion. */
  steer(a, dt, headRot, reach) {
    const B = this.headToWorld(a.bx, a.by);
    let target = Math.atan2(this.look.y - B.y, this.look.x - B.x) / DEG;
    if (target < 0) target += 360;
    if (target < 60) target += 360; // prefer sweeping over the back, never through the legs
    target = clamp(target, 95, 412) + a.off;
    const base = a.base + headRot;
    const t = this.t;
    const n = a.n;
    for (let k = 0; k < n; k++) {
      const f = k / (n - 1);
      const w = (0.2 + 0.8 * Math.pow(f, 0.8)) * reach;
      const wave =
        Math.sin(t * 1.6 + k * 0.34 + a.phase) * (1.5 + 9 * f) +
        Math.sin(t * 0.63 + k * 0.11 + a.phase * 1.7) * 5 * f +
        this.curl * 25 * f;
      const desired = (base + (target - base) * w + wave) * DEG;
      a.ang[k] += (desired - a.ang[k]) * (1 - Math.exp(-dt * (11 - 8 * f)));
    }
    const seg = a.len / (n - 1);
    a.pts[0].x = B.x;
    a.pts[0].y = B.y;
    for (let k = 1; k < n; k++) {
      a.pts[k].x = a.pts[k - 1].x + Math.cos(a.ang[k - 1]) * seg;
      a.pts[k].y = a.pts[k - 1].y + Math.sin(a.ang[k - 1]) * seg;
    }
  }

  abdomen() {
    const t = this.t;
    const segs = [];
    let a = ABD_START * DEG;
    let x = 0;
    let y = 0;
    for (let i = 0; i < 6; i++) {
      const breathe = i ? Math.sin(t * 1.1 + i * 0.6) * 1.3 : 0;
      a += (SEG_BEND[i] + breathe + (i ? this.curl * 22 : 0)) * DEG;
      segs.push({ x, y, a, L: SEG_LEN[i] });
      x += Math.cos(a) * SEG_LEN[i];
      y += Math.sin(a) * SEG_LEN[i];
    }
    a += (TELSON_BEND + this.curl * 18) * DEG;
    this.tailFrame = { x, y, a };
    return segs;
  }

  /* ---------- drawing ---------- */

  draw() {
    const { ctx, c } = this;
    if (!this.s || !c.width) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, c.width, c.height);
    const k = this.dpr * this.s;
    ctx.setTransform(k, 0, 0, k, this.dpr * this.ox, this.dpr * this.oy);
    ctx.fillStyle = INK;
    ctx.strokeStyle = INK;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    for (const a of this.antennules) this.ribbon(a);
    for (const a of this.antennae) this.ribbon(a);

    ctx.save();
    ctx.translate(this.bx, this.by);
    ctx.rotate(this.rotB);
    const segs = this.abdomen();
    for (let i = 0; i < 5; i++) this.inFrame(segs[i], () => this.pleopod(i, segs[i].L, (SEG_H[i] + SEG_H[i + 1]) / 2));

    ctx.save();
    ctx.rotate(this.rotH);
    this.legs();
    this.maxilliped();
    ctx.restore();

    this.inFrame(this.tailFrame, () => this.tailFan(SEG_H[6]));
    for (const i of [5, 4, 3, 2, 0, 1]) this.inFrame(segs[i], () => this.segment(i, segs[i].L, SEG_H[i], SEG_H[i + 1]));

    ctx.save();
    ctx.rotate(this.rotH);
    this.antennalScale();
    this.carapace();
    this.rostrum();
    this.limb(-288, 64, -314, 50, 20, 900); // eye stalk
    this.headM = ctx.getTransform();
    ctx.restore();
    ctx.restore();

    // crayon grain eaten out of everything yellow (a small tile, repeated)
    ctx.save();
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.globalCompositeOperation = 'destination-out';
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = this.grain;
    ctx.fillRect(0, 0, c.width / this.dpr, c.height / this.dpr);
    ctx.restore();

    this.eye();

    ctx.setTransform(k, 0, 0, k, this.dpr * this.ox, this.dpr * this.oy);
    this.drawBubbles();
  }

  inFrame(f, fn) {
    const { ctx } = this;
    ctx.save();
    ctx.translate(f.x, f.y);
    ctx.rotate(f.a);
    fn();
    ctx.restore();
  }

  /* fill the current path, then nibble its outline like a dry crayon */
  ink(k) {
    const { ctx } = this;
    ctx.fill();
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.lineWidth = 4.5;
    ctx.setLineDash(NICKS[k % NICKS.length]);
    ctx.lineDashOffset = (k * 13 + this.boilFrame * 7) % 60;
    ctx.stroke();
    ctx.restore();
  }

  /* erase a broken streak (call inside destination-out) */
  streak(x1, y1, x2, y2, w, k) {
    const { ctx } = this;
    ctx.lineWidth = w;
    ctx.setLineDash(STREAKS[k % STREAKS.length]);
    ctx.lineDashOffset = k * 7;
    ctx.beginPath();
    ctx.moveTo(x1 + this.j(k), y1 + this.j(k + 1));
    ctx.quadraticCurveTo(
      (x1 + x2) / 2 + this.j(k + 2) * 2,
      (y1 + y2) / 2 + this.j(k + 3) * 2,
      x2 + this.j(k + 4),
      y2 + this.j(k + 5),
    );
    ctx.stroke();
  }

  erase(fn) {
    const { ctx } = this;
    ctx.save();
    ctx.globalCompositeOperation = 'destination-out';
    ctx.globalAlpha = 0.88;
    fn();
    ctx.restore();
  }

  limb(x1, y1, x2, y2, w, k) {
    const { ctx } = this;
    ctx.lineWidth = w;
    ctx.beginPath();
    ctx.moveTo(x1 + this.j(k), y1 + this.j(k + 1));
    ctx.lineTo(x2 + this.j(k + 2), y2 + this.j(k + 3));
    ctx.stroke();
  }

  ribbon(a) {
    const { ctx } = this;
    const p = a.pts;
    const n = p.length;
    const L = [];
    const R = [];
    for (let k = 0; k < n; k++) {
      const p0 = p[Math.max(0, k - 1)];
      const p1 = p[Math.min(n - 1, k + 1)];
      let tx = p1.x - p0.x;
      let ty = p1.y - p0.y;
      const m = Math.hypot(tx, ty) || 1;
      tx /= m;
      ty /= m;
      const f = k / (n - 1);
      const w = (k < a.stiff ? a.w0 * 1.6 : a.w0 * (1 - f) + a.w1 * f) / 2;
      L.push(p[k].x - ty * w, p[k].y + tx * w);
      R.push(p[k].x + ty * w, p[k].y - tx * w);
    }
    ctx.beginPath();
    ctx.moveTo(L[0], L[1]);
    for (let k = 1; k < n; k++) ctx.lineTo(L[k * 2], L[k * 2 + 1]);
    for (let k = n - 1; k >= 0; k--) ctx.lineTo(R[k * 2], R[k * 2 + 1]);
    ctx.closePath();
    ctx.fill();
  }

  legs() {
    const t = this.t;
    LEGS.forEach((L, i) => {
      const sway = (Math.sin(t * 1.7 + i * 1.3) * 4 + this.curl * 12) * DEG;
      const a1 = L.a1 * DEG + sway;
      const a2 = L.a2 * DEG + sway * 1.5;
      const kx = L.x + Math.cos(a1) * L.l1;
      const ky = L.y + Math.sin(a1) * L.l1;
      const fx = kx + Math.cos(a2) * L.l2;
      const fy = ky + Math.sin(a2) * L.l2;
      const id = 100 + i * 20;
      this.limb(L.x, L.y, kx, ky, 8.5, id);
      this.limb(kx, ky, fx, fy, 5.5, id + 4);
      if (L.claw) {
        for (const d of [-24, 16]) {
          const a3 = a2 + d * DEG;
          this.limb(fx, fy, fx + Math.cos(a3) * 18, fy + Math.sin(a3) * 18, 3.6, id + 8 + d);
        }
      } else {
        const a3 = a2 + 26 * DEG;
        this.limb(fx, fy, fx + Math.cos(a3) * 22, fy + Math.sin(a3) * 22, 3, id + 12);
      }
    });
  }

  maxilliped() {
    const t = this.t;
    const a1 = (158 + Math.sin(t * 1.3) * 4) * DEG;
    const a2 = (128 + Math.sin(t * 1.3 + 1) * 6) * DEG;
    const kx = -292 + Math.cos(a1) * 62;
    const ky = 112 + Math.sin(a1) * 62;
    this.limb(-292, 112, kx, ky, 7, 500);
    this.limb(kx, ky, kx + Math.cos(a2) * 58, ky + Math.sin(a2) * 58, 4, 504);
  }

  pleopod(i, L, h) {
    const bx = L * 0.42;
    const by = h + 8;
    const beat = Math.sin(this.t * 7 + i * 0.9);
    const a = (96 + beat * 24 + this.curl * 30) * DEG;
    const len = 66 - i * 5;
    [-9, 9].forEach((d, k) => {
      const aa = a + d * DEG;
      const mx = bx + Math.cos(aa) * len * 0.5;
      const my = by + Math.sin(aa) * len * 0.5;
      const ex = bx + Math.cos(aa + 0.14) * len;
      const ey = by + Math.sin(aa + 0.14) * len;
      this.limb(bx, by, mx, my, 6.5, 300 + i * 9 + k * 4);
      this.limb(mx, my, ex, ey, 3.4, 340 + i * 9 + k * 4);
    });
  }

  segment(i, L, hf, hb) {
    const { ctx } = this;
    const J = (k) => this.j(i * 40 + k);
    const big = i === 1; // 2nd pleuron overlaps its neighbours, like real carideans
    const lobe = big ? 30 : 20;
    const fx = big ? -16 : -3;
    const bx = big ? L + 12 : L - 4;
    ctx.beginPath();
    ctx.moveTo(-3 + J(1), J(2));
    ctx.quadraticCurveTo(L * 0.5 + J(3), -8 + J(4), L - 2 + J(5), J(6));
    ctx.bezierCurveTo(L + 4, hb * 0.35, L + 6 + J(7), hb * 0.75, bx + J(8), hb + 6 + J(9));
    ctx.quadraticCurveTo(L * 0.45 + J(10), Math.max(hf, hb) + lobe + J(11), fx + J(12), hf + 6 + J(13));
    ctx.bezierCurveTo(-8, hf * 0.65, -6, hf * 0.25, -3 + J(1), J(2));
    ctx.closePath();
    this.ink(i * 7 + 3);

    this.erase(() => {
      // the white gap that separates segments
      this.streak(L - 3, 2, L - 1, hb * 0.92, 6, i * 50 + 1);
      // dry-brush streaks across the segment
      [0.3, 0.58].forEach((s, k) => {
        const u = L * s;
        this.streak(u, 10, u + 5, hf * (0.72 + 0.12 * k), 3 + Math.abs(rnd(i * 5 + k)) * 3, i * 50 + 10 + k * 7);
      });
    });
  }

  tailFan(h) {
    const { ctx } = this;
    const fan = Math.sin(this.t * 1.3) * 0.12 + this.curl * 0.55;
    const leaf = (x, y, len, wid, rot, k) => {
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.bezierCurveTo(len * 0.3, -wid + this.j(k), len * 0.85, -wid * 0.8, len + this.j(k + 1), this.j(k + 2));
      ctx.bezierCurveTo(len * 0.85, wid * 0.7, len * 0.3, wid * 0.9 + this.j(k + 3), 0, 0);
      ctx.closePath();
      this.ink(k);
      this.erase(() => this.streak(10, 0, len * 0.85, 1, 2.6, k + 5));
      ctx.restore();
    };
    leaf(2, h * 0.38, 124, 26, (-8 + fan * 10) * DEG, 700);
    leaf(4, h * 0.5, 130, 31, (16 + fan * 22) * DEG, 720);
    leaf(6, h * 0.6, 112, 26, (32 + fan * 36) * DEG, 740);

    const J = (k) => this.j(760 + k);
    ctx.beginPath();
    ctx.moveTo(-4, 2);
    ctx.quadraticCurveTo(60 + J(1), -2 + J(2), 118 + J(3), h * 0.38 + J(4));
    ctx.quadraticCurveTo(60 + J(5), h * 0.78 + J(6), -4, h * 0.82);
    ctx.closePath();
    this.ink(761);
    this.erase(() => this.streak(8, h * 0.4, 100, h * 0.4, 3, 770));
  }

  carapace() {
    const { ctx } = this;
    const J = (k) => this.j(800 + k);
    ctx.beginPath();
    ctx.moveTo(J(1), -2 + J(2));
    ctx.bezierCurveTo(-70 + J(3), -24 + J(4), -190 + J(5), -16 + J(6), -282 + J(7), 24 + J(8));
    ctx.lineTo(-300 + J(9), 34 + J(10));
    ctx.bezierCurveTo(-318 + J(11), 54, -314, 80, -298 + J(12), 98 + J(13));
    ctx.bezierCurveTo(-240, 132 + J(14), -120, 152 + J(15), -6 + J(16), 147 + J(17));
    ctx.bezierCurveTo(10, 112, 12, 40, J(1), -2 + J(2));
    ctx.closePath();
    this.ink(811);

    this.erase(() => {
      this.streak(-150, 4, -186, 104, 5, 820); // cervical groove
      this.streak(-255, 42, -40, 26, 3.5, 830);
      this.streak(-236, 80, -30, 94, 4.5, 840);
      this.streak(-205, 118, -55, 132, 3, 850);
    });
  }

  rostrum() {
    const { ctx } = this;
    const x0 = -262;
    const y0 = 20;
    const x1 = -448;
    const y1 = -36;
    const len = Math.hypot(x1 - x0, y1 - y0);
    const dx = (x1 - x0) / len;
    const dy = (y1 - y0) / len;
    const ux = dy; // dorsal normal
    const uy = -dx;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    const teeth = 8;
    for (let i = 1; i <= teeth; i++) {
      const f = i / (teeth + 1);
      const nx = x0 + (x1 - x0) * f;
      const ny = y0 + (y1 - y0) * f;
      const hgt = 13 - f * 7;
      ctx.lineTo(nx + ux * hgt + dx * 7 + this.j(860 + i), ny + uy * hgt + dy * 7);
      ctx.lineTo(nx + dx * 13, ny + dy * 13);
    }
    ctx.lineTo(x1 + this.j(880), y1 + this.j(881));
    ctx.quadraticCurveTo(-372, 6 + this.j(882), -298, 44);
    ctx.lineTo(-270, 40);
    ctx.closePath();
    this.ink(883);
  }

  antennalScale() {
    const { ctx } = this;
    const sway = Math.sin(this.t * 1.2 + 0.5) * 2;
    const J = (k) => this.j(900 + k);
    ctx.beginPath();
    ctx.moveTo(-290, 70);
    ctx.quadraticCurveTo(-350 + J(1), 50 + sway, -418 + J(2), 46 + sway + J(3));
    ctx.quadraticCurveTo(-410, 68 + sway, -382 + J(4), 80 + sway);
    ctx.quadraticCurveTo(-330, 94, -292, 98);
    ctx.closePath();
    this.ink(905);
    this.erase(() => this.streak(-300, 82, -400, 58 + sway, 2.6, 910));
  }

  eye() {
    const { ctx } = this;
    if (!this.headM) return;
    const ex = -320;
    const ey = 46;
    const E = this.headToWorld(ex, ey);
    const ga = Math.atan2(this.look.y - E.y, this.look.x - E.x) - (this.rotB + this.rotH);
    const gx = Math.cos(ga);
    const gy = Math.sin(ga);
    ctx.setTransform(this.headM);
    ctx.fillStyle = EYE;
    ctx.beginPath();
    ctx.arc(ex + gx * 4, ey + gy * 4, 19.5, 0, TAU);
    ctx.fill();
    ctx.fillStyle = SHINE;
    ctx.beginPath();
    ctx.arc(ex + gx * 10, ey + gy * 10, 6, 0, TAU);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(ex + gx * 4 - 6, ey + gy * 4 + 8, 2.2, 0, TAU);
    ctx.fill();
  }

  drawBubbles() {
    const { ctx } = this;
    ctx.strokeStyle = BUBBLE;
    ctx.setLineDash([]);
    for (const b of this.bubbles) {
      const life = b.age / b.life;
      ctx.globalAlpha = Math.min(1, b.age * 5) * Math.pow(1 - life, 0.6) * 0.75;
      ctx.lineWidth = 2.6;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r, 0, TAU);
      ctx.stroke();
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.r * 0.55, -2.4, -1.5);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }
}

for (const scene of document.querySelectorAll('[data-crevette-scene]')) {
  const canvas = scene.querySelector('canvas[data-crevette]');
  const stage = scene.querySelector('[data-crevette-stage]');
  if (canvas && stage) new Crevette(canvas, stage, scene);
}
