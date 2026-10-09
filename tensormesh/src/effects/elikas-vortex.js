/**
 * ElikasVortex — an axially-stretched vortex of tapered ribbons.
 *
 * Vanilla JS, Canvas2D, zero dependencies. Drop this file into a
 * `site/js/` style folder and mount it on any <canvas>.
 *
 * Behavior (matches the reference "Elikas" effect):
 *  - N ribbons spiral around a vertical axis, widest at the equator,
 *    tapering to points at top and bottom (a spinning-top silhouette).
 *  - Dragging grabs the nearest patch of ribbons and stretches the
 *    surrounding weave; distant parts of the structure lag behind.
 *  - Ribbon contact is *approximated* via falloff-weighted displacement
 *    rather than true collision — it reads as "resistance" without the
 *    cost of a real physics solve.
 *  - Successive pulls accumulate spin (extra turns) and flare (extra
 *    equatorial width), both of which decay slowly back to rest.
 *  - Releasing a grip lets the spring/damper system recoil elastically.
 *
 * Usage:
 *   import { ElikasVortex } from './elikas-vortex.js';
 *   const fx = new ElikasVortex(document.querySelector('#elikas-canvas'));
 *   fx.start();
 *   // later: fx.stop(); fx.destroy();
 */

export class ElikasVortex {
  constructor(canvas, opts = {}) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');

    this.opts = Object.assign({
      ribbonCount: 36,
      pointsPerRibbon: 140,
      turns: 2.6,            // base number of spiral wraps top-to-bottom
      baseRadius: 1,          // in "world units" — scaled to canvas at draw time
      height: 2.2,
      rotationSpeed: 0.05,    // ambient spin, revolutions/sec
      viewSpinSpeed: 0.1,     // camera orbit, revolutions/sec
      color: 'rgba(255,255,255,0.85)',
      lineWidthScale: 1,
      background: null,       // e.g. '#000' — leave null for transparent canvas
      grabRadius: 0.55,       // falloff radius in normalized (ribbon, axial) space
      spring: 6.0,            // return-to-rest stiffness
      damping: 0.88,
      maxSpin: 1.4,
      maxFlare: 0.9,
    }, opts);

    this._resize = this._resize.bind(this);
    this._onDown = this._onDown.bind(this);
    this._onMove = this._onMove.bind(this);
    this._onUp = this._onUp.bind(this);
    this._tick = this._tick.bind(this);

    this._time = 0;
    this._viewRot = 0;
    this._spin = 0;   // accumulated extra turns from pulls, decays over time
    this._flare = 0;  // accumulated extra equatorial width from pulls
    this._grip = null;
    this._running = false;

    this._buildRibbons();
    this._bindEvents();
    this._resize();
  }

  // ---- geometry -----------------------------------------------------

  _buildRibbons() {
    const { ribbonCount, pointsPerRibbon } = this.opts;
    this.ribbons = [];
    for (let i = 0; i < ribbonCount; i++) {
      const phase = (i / ribbonCount) * Math.PI * 2;
      const pts = [];
      for (let j = 0; j < pointsPerRibbon; j++) {
        pts.push({
          t: j / (pointsPerRibbon - 1), // 0..1 along the ribbon, axially
          phase,
          dx: 0, dy: 0, dz: 0,          // displacement from the rest curve
          vx: 0, vy: 0, vz: 0,          // displacement velocity
        });
      }
      this.ribbons.push(pts);
    }
  }

  _radiusProfile(t, extraFlare) {
    // wide at the equator (t=0.5), tapering to points at both ends
    const u = (t - 0.5) * 2; // -1..1
    const taper = Math.pow(1 - Math.abs(u), 0.85);
    return this.opts.baseRadius * (0.15 + 0.85 * taper) * (1 + extraFlare * (1 - Math.abs(u)));
  }

  _curvePoint(ribbon, pointIdx, time) {
    const p = ribbon[pointIdx];
    const t = p.t;
    const turns = this.opts.turns + this._spin * 0.6;
    const angle = p.phase + t * turns * Math.PI * 2 + time * this.opts.rotationSpeed * Math.PI * 2;
    const r = this._radiusProfile(t, this._flare);
    const y = (t - 0.5) * this.opts.height;
    return {
      x: Math.cos(angle) * r + p.dx,
      y: y + p.dy,
      z: Math.sin(angle) * r + p.dz,
    };
  }

  _project(pt, w, h) {
    const rot = this._viewRot;
    const cx = pt.x * Math.cos(rot) - pt.z * Math.sin(rot);
    const cz = pt.x * Math.sin(rot) + pt.z * Math.cos(rot);
    const persp = 1 / (1 + cz * 0.18);
    const scale = Math.min(w, h) * 0.28;
    return {
      x: w / 2 + cx * scale * persp,
      y: h / 2 + pt.y * scale * persp * 0.9,
      scale: persp,
    };
  }

  // ---- interaction ----------------------------------------------------

  _bindEvents() {
    window.addEventListener('resize', this._resize);
    const c = this.canvas;
    c.style.touchAction = 'none';
    c.addEventListener('pointerdown', this._onDown);
    window.addEventListener('pointermove', this._onMove);
    window.addEventListener('pointerup', this._onUp);
  }

  _resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.max(1, Math.round(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.round(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this._w = rect.width;
    this._h = rect.height;
  }

  _nearestPoint(px, py) {
    let best = null, bestD = Infinity;
    for (let ri = 0; ri < this.ribbons.length; ri++) {
      const ribbon = this.ribbons[ri];
      for (let pi = 0; pi < ribbon.length; pi += 2) {
        const cp = this._curvePoint(ribbon, pi, this._time);
        const sp = this._project(cp, this._w, this._h);
        const dx = sp.x - px, dy = sp.y - py;
        const d = dx * dx + dy * dy;
        if (d < bestD) { bestD = d; best = { ri, pi }; }
      }
    }
    return best;
  }

  _onDown(e) {
    const rect = this.canvas.getBoundingClientRect();
    const px = e.clientX - rect.left, py = e.clientY - rect.top;
    const hit = this._nearestPoint(px, py);
    if (!hit) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    this._grip = { ...hit, px, py, active: true };
    this._spin = Math.min(this._spin + 0.12, this.opts.maxSpin);
    this._flare = Math.min(this._flare + 0.08, this.opts.maxFlare);
  }

  _onMove(e) {
    if (!this._grip?.active) return;
    const rect = this.canvas.getBoundingClientRect();
    this._grip.px = e.clientX - rect.left;
    this._grip.py = e.clientY - rect.top;
  }

  _onUp() {
    if (this._grip) this._grip.active = false;
    // let release apply for exactly one more frame of momentum, then clear
    setTimeout(() => { this._grip = null; }, 0);
  }

  _applyGrip(dt) {
    const grip = this._grip;
    const { grabRadius, spring, damping } = this.opts;

    for (let ri = 0; ri < this.ribbons.length; ri++) {
      const ribbon = this.ribbons[ri];
      for (let pi = 0; pi < ribbon.length; pi++) {
        const p = ribbon[pi];
        let targetX = 0, targetY = 0;

        if (grip?.active) {
          const gRibbon = this.ribbons[grip.ri];
          const gp = gRibbon[grip.pi];
          const dRibbon = Math.min(
            Math.abs(ri - grip.ri),
            this.ribbons.length - Math.abs(ri - grip.ri)
          ) / this.ribbons.length;
          const dT = Math.abs(p.t - gp.t);
          const dist = Math.sqrt(dRibbon * dRibbon * 4 + dT * dT);
          const w = Math.max(0, 1 - dist / grabRadius);
          if (w > 0) {
            const cp = this._curvePoint(ribbon, grip.pi, this._time);
            const sp = this._project(cp, this._w, this._h);
            const scale = Math.min(this._w, this._h) * 0.28;
            targetX = ((grip.px - sp.x) / scale) * w * w;
            targetY = ((grip.py - sp.y) / (scale * 0.9)) * w * w;
          }
        }

        p.vx += (targetX - p.dx) * spring * dt;
        p.vy += (targetY - p.dy) * spring * dt;
        p.vx *= damping; p.vy *= damping;
        p.dx += p.vx * dt; p.dy += p.vy * dt;
      }
    }
  }

  // ---- lifecycle ------------------------------------------------------

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
    this._time += dt;
    this._viewRot += dt * this.opts.viewSpinSpeed * Math.PI * 2;
    this._spin *= 0.996;
    this._flare *= 0.995;
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
    ctx.lineCap = 'round';
    ctx.strokeStyle = this.opts.color;

    for (const ribbon of this.ribbons) {
      let prev = null;
      for (let pi = 0; pi < ribbon.length; pi++) {
        const cp = this._curvePoint(ribbon, pi, this._time);
        const sp = this._project(cp, w, h);
        const width = Math.max(
          0.6,
          2.4 * this.opts.lineWidthScale * sp.scale * (0.4 + 0.6 * Math.sin(Math.PI * ribbon[pi].t))
        );
        if (prev) {
          ctx.lineWidth = width;
          ctx.beginPath();
          ctx.moveTo(prev.x, prev.y);
          ctx.lineTo(sp.x, sp.y);
          ctx.stroke();
        }
        prev = sp;
      }
    }
  }
}
