/**
 * PlektoLace — a living kaleidoscope of elastic lace.
 *
 * Vanilla JS, Canvas2D, zero dependencies. Drop this file into a
 * `site/js/` style folder and mount it on any <canvas>.
 *
 * Behavior (matches the reference "Plekto" effect):
 *  - A single evolving polar curve r(theta, time) is the "generator".
 *  - It's drawn with K-fold rotational symmetry (plus an optional mirror
 *    fold) to form the flower, and multiple time-phase-shifted copies
 *    ("trace layers") are layered with falling opacity to form the dense
 *    lace weave and a sense of trailing motion.
 *  - The generator's harmonics slowly evolve over time, so petals
 *    continuously open, fold, and reform.
 *  - Dragging samples the nearest angle on the base curve and pulls its
 *    radius toward the pointer, with an angular falloff — because every
 *    symmetric copy and trace layer reads from the same displacement
 *    buffer, the whole weave stretches together, then springs back.
 *  - Scrolling adds a radius-dependent angular twist, spiraling the
 *    whole pattern around its own center.
 *
 * Usage:
 *   import { PlektoLace } from './plekto-lace.js';
 *   const fx = new PlektoLace(document.querySelector('#plekto-canvas'));
 *   fx.start();
 *   // later: fx.stop(); fx.destroy();
 */

export class PlektoLace {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.opts = Object.assign({
      symmetry: 6,
      mirrorFold: true,
      samples: 220,              // points sampled around the base curve
      layers: 18,                // time-phase-shifted trace copies
      layerSpacingSec: 0.35,
      harmonics: [2, 3, 5],       // sine harmonics composing the base curve
      evolveSpeed: 1.2,           // how fast the harmonics drift
      color: 'rgba(255,255,255,0.5)',
      coreColor: 'rgba(0,0,0,1)', // negative-space core, like the reference
      coreRadiusFrac: 0.12,
      background: null,
      grabFalloff: 0.5,           // angular falloff (radians) for drag influence
      spring: 7.0,
      damping: 0.86,
      twistStep: 0.0008,          // radians of twist added per wheel-delta unit
    }, opts);

    this._resize = this._resize.bind(this);
    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._onWheel = this._onWheel.bind(this);
    this._tick = this._tick.bind(this);

    this._time = 0;
    this._twist = 0;
    this._grip = null;
    this._running = false;

    const n = this.opts.samples;
    this._disp = Array.from({ length: n }, () => ({ r: 0, vr: 0 }));

    this._bindEvents();
    this._resize();
  }

  // ---- geometry -------------------------------------------------------

  _baseRadius(theta, t) {
    const { harmonics } = this.opts;
    let r = 1;
    for (let i = 0; i < harmonics.length; i++) {
      const n = harmonics[i];
      const amp = (0.18 / (i + 1)) * (0.6 + 0.4 * Math.sin(t * 0.17 + i * 1.7));
      const phase = t * (0.25 + i * 0.07) + i * 2.1;
      r += amp * Math.sin(n * theta + phase);
    }
    return r;
  }

  _dispAt(theta) {
    const n = this.opts.samples;
    const a = ((theta % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const idxF = (a / (Math.PI * 2)) * n;
    const i0 = Math.floor(idxF) % n;
    const i1 = (i0 + 1) % n;
    const f = idxF - Math.floor(idxF);
    return this._disp[i0].r * (1 - f) + this._disp[i1].r * f;
  }

  _radiusAt(theta, t) {
    return this._baseRadius(theta, t) + this._dispAt(theta);
  }

  // ---- interaction ------------------------------------------------------

  _bindEvents() {
    window.addEventListener('resize', this._resize);
    const c = this.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
    c.addEventListener('wheel', this._onWheel, { passive: true });
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._w = rect.width;
    this._h = rect.height;
    this._scale = Math.min(this._w, this._h) * 0.42;
  }

  _screenToLocal(px, py) {
    const dx = (px - this._w / 2) / this._scale;
    const dy = (py - this._h / 2) / this._scale;
    const r = Math.hypot(dx, dy);
    // undo the display twist to recover the angle in base-curve space
    const theta = Math.atan2(dy, dx) - this._twist * r;
    return { r, theta };
  }

  _onDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const local = this._screenToLocal(e.clientX - rect.left, e.clientY - rect.top);
    this.canvas.setPointerCapture?.(e.pointerId);
    this._grip = { px: e.clientX - rect.left, py: e.clientY - rect.top, active: true };
  }

  _onMove(e) {
    if (!this._grip?.active) return;
    const rect = this.canvas.getBoundingClientRect();
    this._grip.px = e.clientX - rect.left;
    this._grip.py = e.clientY - rect.top;
  }

  _onUp() {
    if (this._grip) this._grip.active = false;
    setTimeout(() => { this._grip = null; }, 0);
  }

  _onWheel(e) {
    this._twist += e.deltaY * this.opts.twistStep;
  }

  _applyGrip(dt) {
    const n = this.opts.samples;
    const grip = this._grip;
    let gripR = 0, gripTheta = 0, gripActive = false;

    if (grip?.active) {
      const local = this._screenToLocal(grip.px, grip.py);
      gripR = local.r;
      gripTheta = local.theta;
      gripActive = true;
    }

    for (let i = 0; i < n; i++) {
      const theta = (i / n) * Math.PI * 2;
      let target = 0;
      if (gripActive) {
        let dTheta = Math.abs(theta - gripTheta);
        dTheta = Math.min(dTheta, Math.PI * 2 - dTheta);
        const w = Math.max(0, 1 - dTheta / this.opts.grabFalloff);
        if (w > 0) {
          target = (gripR - this._baseRadius(theta, this._time)) * w * w;
        }
      }
      const d = this._disp[i];
      d.vr += (target - d.r) * this.opts.spring * dt;
      d.vr *= this.opts.damping;
      d.r += d.vr * dt;
    }
  }

  // ---- lifecycle --------------------------------------------------------

  start() {
    if (this._running) return;
    this._running = true;
    this._lastT = performance.now();
    this._raf = requestAnimationFrame(this._tick);
  }

  stop() { this._running = false; cancelAnimationFrame(this._raf); }

  draw() { this._draw(); }

  destroy() {
    this.stop();
    this.canvas.removeEventListener('pointerdown', this._onDown);
    this.canvas.removeEventListener('wheel', this._onWheel);
    window.removeEventListener('resize', this._resize);
    window.removeEventListener('pointermove', this._onMove);
    window.removeEventListener('pointerup', this._onUp);
  }

  _tick(now) {
    if (!this._running) return;
    const dt = Math.min((now - this._lastT) / 1000, 0.05);
    this._lastT = now;
    this._time += dt * this.opts.evolveSpeed;
    this._applyGrip(dt);
    this._draw();
    this._raf = requestAnimationFrame(this._tick);
  }

  _draw() {
    const { ctx, _w: w, _h: h } = this;
    ctx.clearRect(0, 0, w, h);
    if (this.opts.background) {
      ctx.fillStyle = this.opts.background;
      ctx.fillRect(0, 0, w, h);
    }

    ctx.save();
    ctx.translate(w / 2, h / 2);

    const { symmetry, mirrorFold, layers, layerSpacingSec, samples } = this.opts;
    ctx.strokeStyle = this.opts.color;
    ctx.lineWidth = 1;

    for (let L = 0; L < layers; L++) {
      const tOffset = this._time - L * layerSpacingSec;
      const alpha = 1 - L / layers;
      ctx.globalAlpha = Math.max(0.03, alpha * 0.55);

      for (let s = 0; s < symmetry; s++) {
        for (let m = 0; m < (mirrorFold ? 2 : 1); m++) {
          ctx.save();
          ctx.rotate((s / symmetry) * Math.PI * 2);
          if (m === 1) ctx.scale(1, -1);

          ctx.beginPath();
          for (let i = 0; i <= samples; i++) {
            const theta = (i / samples) * Math.PI * 2;
            const r = this._radiusAt(theta, tOffset) * this._scale;
            const twisted = theta + this._twist * (r / this._scale);
            const x = Math.cos(twisted) * r;
            const y = Math.sin(twisted) * r;
            if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
          }
          ctx.stroke();
          ctx.restore();
        }
      }
    }

    // negative-space core, like the dark flower center in the reference
    ctx.globalAlpha = 1;
    ctx.fillStyle = this.opts.coreColor;
    ctx.beginPath();
    const coreN = 48;
    for (let i = 0; i <= coreN; i++) {
      const theta = (i / coreN) * Math.PI * 2;
      const r = this._scale * this.opts.coreRadiusFrac * (1 + 0.35 * Math.sin(symmetry * theta + this._time * 0.6));
      const x = Math.cos(theta) * r, y = Math.sin(theta) * r;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fill();

    ctx.restore();
  }
}
