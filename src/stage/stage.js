// The stage: one fixed canvas behind the page that draws every plate.
//
// A plate is declared in the HTML as
//   <figure class="plate" data-plate="slug"> <img ...> <figcaption>...</figcaption> </figure>
// The figure's box (set in CSS) says WHERE the photograph sits in the viewport.
// The closest ancestor with [data-beat] says WHEN: the plate condenses as that element
// scrolls into view, the camera travels through it while it passes, and it disperses
// as it leaves. Art direction per plate lives in CSS custom properties (see readConfig).

import { SPLAT_VERT, NEAREST_FRAG, GATHER_FRAG, RESOLVE_VERT, RESOLVE_FRAG } from './shaders.js';

// Quality steps: canvas pixel ratio cap, and how far apart the discs stand (css px).
// The photograph supplies the detail, so wider spacing costs geometry at edges, not sharpness.
const TIERS = [
  { ratio: 1.5, spacing: 2.4 },
  { ratio: 1.25, spacing: 2.8 },
  { ratio: 1, spacing: 3.2 },
  { ratio: 0.85, spacing: 4.0 },
  { ratio: 0.7, spacing: 5.0 },
];
const ACC_SCALE = 0.5;

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const ramp = (x, from, to) => {
  const t = clamp((x - from) / (to - from || 1e-6));
  return t * t * (3 - 2 * t);
};
const mix = (a, b, t) => a + (b - a) * t;
const norm = (v) => {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
};
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];

function program(gl, vs, fs) {
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s) || 'shader failed');
    return s;
  };
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) || 'link failed');
  const u = {};
  const n = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < n; i++) {
    const info = gl.getActiveUniform(p, i);
    u[info.name] = gl.getUniformLocation(p, info.name);
  }
  return { p, u };
}

/** Reads a plate's art direction from CSS custom properties on its figure. */
function readConfig(el) {
  const cs = getComputedStyle(el);
  const raw = (name) => cs.getPropertyValue(name).trim();
  const num = (name, def) => {
    const v = parseFloat(raw(name));
    return Number.isFinite(v) ? v : def;
  };
  const list = (name, def) => {
    const s = raw(name);
    if (!s) return def;
    const a = s.split(/[\s,/]+/).map(parseFloat);
    return a.length === def.length && a.every(Number.isFinite) ? a : def;
  };
  return {
    fit: raw('--plate-fit') === 'contain' ? 'contain' : 'cover',
    zoom: num('--plate-zoom', 1.08),
    pos: list('--plate-pos', [50, 50]).map((v) => v / 100),
    // Where the subject goes, whatever the shape of the screen: this point of the photograph's
    // width (0 left .. 1 right) sits at this point of the box's width. Replaces the horizontal --plate-pos.
    anchor: raw('--plate-anchor') ? list('--plate-anchor', [0.5, 0.5]) : null,
    soft: list('--plate-soft', [0.22, 0.22, 0.22, 0.22]), // top right bottom left, fraction of the box's short side
    travel: list('--plate-travel', [0.02, 0, 0.2]), // camera travel over the beat: right, down, forward (share of the nearest depth). A push-in reads as space; a sideways move needs real foreground layers
    sway: num('--plate-sway', 0.012), // how far the pointer moves the camera (same unit)
    focus: list('--plate-focus', [0.5, 0.5]), // focal plane at the start and end of the beat: 0 far .. 1 near
    aperture: num('--plate-aperture', 0), // css px of blur between the far and near limits; 0 keeps everything sharp
    gain: num('--plate-gain', 1),
    shade: num('--plate-shade', 0), // 1 darkens the picture towards the lower left, under a heading
    grain: num('--plate-grain', 0.07),
    occlude: num('--plate-occlude', 1),
    enter: list('--plate-enter', [0.95, 0.3]), // beat top travels between these viewport fractions while the plate condenses
    exit: list('--plate-exit', [0.08, 0.7]), // beat bottom travels between these while it disperses
    bokeh: num('--plate-bokeh', 9), // css px of blur for free grains at the far or near limit when the plate itself is sharp
    scatter: num('--plate-scatter', 0.45), // how far free grains spread along their line of sight
    drift: num('--plate-drift', 0), // 1 keeps the camera gently moving when nothing scrolls
    grow: num('--plate-grow', 0), // extra scale gained over the beat (the bubble inflates)
    overflow: num('--plate-overflow', 0), // 1 lets the picture leave its box; the box then only places it
    dim: num('--plate-dim', 1), // brightness once text scrolls over the plate (small screens)
    dimAt: list('--plate-dim-at', [0.05, 0.2]),
  };
}

export function createStage(canvas, manifest, { base = '' } = {}) {
  const gl = canvas.getContext('webgl2', {
    alpha: false,
    antialias: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
  });
  if (!gl) return null;
  if (!gl.getExtension('EXT_color_buffer_float') && !gl.getExtension('EXT_color_buffer_half_float')) return null;
  const aniso = gl.getExtension('EXT_texture_filter_anisotropic');

  let nearest, gather, resolve;
  try {
    nearest = program(gl, SPLAT_VERT, NEAREST_FRAG);
    gather = program(gl, SPLAT_VERT, GATHER_FRAG);
    resolve = program(gl, RESOLVE_VERT, RESOLVE_FRAG);
  } catch (err) {
    console.warn('[stage] shaders unavailable:', err.message);
    return null;
  }

  const emptyVao = gl.createVertexArray();
  const front = { fbo: gl.createFramebuffer(), tex: gl.createTexture() };
  const acc = { fbo: gl.createFramebuffer(), place: gl.createTexture(), tone: gl.createTexture(), w: 0, h: 0 };
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
  gl.pixelStorei(gl.UNPACK_COLORSPACE_CONVERSION_WEBGL, gl.NONE);

  const baseTier = (window.devicePixelRatio || 1) > 1.4 ? 1 : 2;
  let tier = baseTier;
  let vw = 1, vh = 1, ratio = 1; // the canvas in css px: what the drawing maths uses
  let sh = 1; // the visible screen height: what "on screen" means for timing
  let ok = true;
  let views = [];

  function resize() {
    // The canvas is as tall as the screen with the phone's toolbar hidden, and stays that
    // tall while the toolbar comes and goes. Its own size is the truth for drawing.
    vw = canvas.clientWidth || window.innerWidth;
    vh = canvas.clientHeight || window.innerHeight;
    sh = window.innerHeight;
    ratio = Math.min(window.devicePixelRatio || 1, TIERS[tier].ratio);
    const cw = Math.max(2, Math.round(vw * ratio));
    const ch = Math.max(2, Math.round(vh * ratio));
    if (canvas.width !== cw || canvas.height !== ch) {
      canvas.width = cw;
      canvas.height = ch;
    }
    const aw = Math.max(2, Math.round(cw * ACC_SCALE));
    const ah = Math.max(2, Math.round(ch * ACC_SCALE));
    if (aw !== acc.w || ah !== acc.h) {
      acc.w = aw;
      acc.h = ah;
      for (const t of [front.tex, acc.place, acc.tone]) {
        gl.bindTexture(gl.TEXTURE_2D, t);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA16F, aw, ah, 0, gl.RGBA, gl.HALF_FLOAT, null);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
        gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      }
      gl.bindFramebuffer(gl.FRAMEBUFFER, front.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, front.tex, 0);
      ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fbo);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, acc.place, 0);
      gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT1, gl.TEXTURE_2D, acc.tone, 0);
      gl.drawBuffers([gl.COLOR_ATTACHMENT0, gl.COLOR_ATTACHMENT1]);
      ok = ok && gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    }
    for (const v of views) v.cfg = readConfig(v.el);
  }

  // ---- plates: a photograph and its scene of discs ----
  const plates = new Map();
  for (const [slug, info] of Object.entries(manifest)) plates.set(slug, { slug, ...info, state: 'idle' });

  function texture(bitmap, mip) {
    const t = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, t);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.R8, gl.RED, gl.UNSIGNED_BYTE, bitmap);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    if (mip) {
      gl.generateMipmap(gl.TEXTURE_2D);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      if (aniso) gl.texParameterf(gl.TEXTURE_2D, aniso.TEXTURE_MAX_ANISOTROPY_EXT, 4);
    } else {
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    }
    return t;
  }

  async function bitmap(url) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`${res.status} ${url}`);
    return createImageBitmap(await res.blob(), { colorSpaceConversion: 'none', premultiplyAlpha: 'none' });
  }

  let pending = 0;
  function load(plate) {
    if (plate.state !== 'idle') return;
    plate.state = 'loading';
    pending++;
    Promise.all([bitmap(base + plate.photo), bitmap(base + plate.depthMap)])
      .then(([photo, depth]) => {
        plate.photoTex = texture(photo, true);
        plate.depthTex = texture(depth, false);
        plate.size = [photo.width, photo.height];
        plate.depthSize = [depth.width, depth.height];
        photo.close();
        depth.close();
        plate.state = 'ready';
      })
      .catch((err) => {
        plate.state = 'failed';
        console.warn('[stage] plate failed to load:', plate.slug, err.message);
        for (const v of views) if (v.plate === plate) v.el.classList.add('plate--failed');
      })
      .finally(() => {
        pending--;
        quietUntil = time + 0.6;
        invalidate();
      });
  }

  // ---- views: the figures in the page ----
  function scan(root = document) {
    views = [...root.querySelectorAll('figure[data-plate]')]
      .map((el, i) => {
        const plate = plates.get(el.dataset.plate);
        if (!plate || plate.flat) {
          console.warn('[stage] no plate named', el.dataset.plate);
          return null;
        }
        // The photograph is drawn on the canvas, so say what it shows in words.
        const img = el.querySelector('img');
        if (img && img.alt && !el.querySelector('.plate__alt')) {
          const alt = document.createElement('span');
          alt.className = 'sr-only plate__alt';
          alt.textContent = `Photograph: ${img.alt} `;
          el.prepend(alt);
        }
        return {
          el,
          plate,
          track: el.closest('[data-beat]') || el.parentElement,
          burst: el.dataset.burst ? document.querySelector(el.dataset.burst) : null,
          caption: el.querySelector('figcaption'),
          seed: (i * 0.618034) % 1,
          presence: 0,
          progress: 0,
          pop: 0,
          cfg: readConfig(el),
        };
      })
      .filter(Boolean);
    invalidate();
  }

  // ---- input ----
  const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
  const fine = window.matchMedia('(pointer: fine)');
  function onPointer(e) {
    if (!fine.matches) return;
    pointer.tx = (e.clientX / vw) * 2 - 1;
    pointer.ty = (e.clientY / vh) * 2 - 1;
    invalidate();
  }

  // ---- frame loop: runs only while something is changing ----
  let raf = 0;
  let last = 0;
  let time = 0;
  let settled = [];
  let destroyed = false;
  const samples = [];

  function invalidate() {
    if (!raf && !destroyed) raf = requestAnimationFrame(frame);
  }

  // Quality follows the frame rate: down a step when frames run long, back up when there is
  // room again. Frames spent decoding a newly arrived photograph say nothing about the GPU
  // and are not counted.
  let quietUntil = 0;
  let lastDrop = -1e9;
  let climbs = 0;
  let best = 0.0167; // the shortest frame this display has delivered; a 30 Hz cap is not overload
  function adapt(dt) {
    if (pending > 0 || time < quietUntil) {
      samples.length = 0;
      return;
    }
    samples.push(dt);
    if (samples.length < 45) return;
    const sorted = samples.slice().sort((a, b) => a - b);
    const median = sorted[sorted.length >> 1];
    best = clamp(Math.min(best * 1.02, sorted[2]), 0.006, 0.034);
    samples.length = 0;
    if (median > Math.max(0.026, best * 1.55) && tier < TIERS.length - 1) {
      tier++;
      lastDrop = time;
      resize();
    } else if (median < best * 1.1 + 0.001 && tier > baseTier && time - lastDrop > 8 && climbs < 3) {
      tier--;
      climbs++;
      quietUntil = time + 1;
      resize();
    }
  }

  function frame(now) {
    raf = 0;
    const dt = last ? Math.min(0.05, (now - last) / 1000) : 0.016;
    last = now;
    time += dt;
    if (vw !== (canvas.clientWidth || window.innerWidth) || vh !== (canvas.clientHeight || window.innerHeight)) resize();
    sh = window.innerHeight;
    if (!ok) {
      fallback();
      return;
    }

    let moving = pending > 0;
    const kp = 1 - Math.exp(-dt * 7);
    pointer.x += (pointer.tx - pointer.x) * kp;
    pointer.y += (pointer.ty - pointer.y) * kp;
    if (Math.abs(pointer.tx - pointer.x) + Math.abs(pointer.ty - pointer.y) > 0.002) moving = true;

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.disable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);

    for (const v of views) {
      const tr = v.track.getBoundingClientRect();
      if (tr.bottom > -sh * 1.5 && tr.top < sh * 2.5) load(v.plate);

      const c = v.cfg;
      const span = tr.height - sh;
      const tProgress = span > sh * 0.05 ? clamp(-tr.top / span) : clamp((sh - tr.top) / (sh + tr.height));
      const tPresence = ramp(tr.top, sh * c.enter[0], sh * c.enter[1]) * ramp(tr.bottom, sh * c.exit[0], sh * c.exit[1]);

      const ka = 1 - Math.exp(-dt * 3.2);
      const kb = 1 - Math.exp(-dt * 6);
      if (v.plate.state === 'ready') v.presence += (tPresence - v.presence) * ka;
      v.progress += (tProgress - v.progress) * kb;
      if (v.burst) {
        const br = v.burst.getBoundingClientRect();
        const tPop = clamp((sh * 0.5 - br.top) / Math.max(1, br.height));
        v.pop += (tPop - v.pop) * kb;
        if (Math.abs(tPop - v.pop) > 0.0005) moving = true;
      }
      const ready = v.plate.state === 'ready';
      if (ready && (Math.abs(tPresence - v.presence) > 0.001 || Math.abs(tProgress - v.progress) > 0.0005)) moving = true;

      if (v.caption) {
        const shown = ramp(v.presence, 0.4, 0.75).toFixed(2);
        if (shown !== v.shown) v.caption.style.opacity = v.shown = shown;
      }
      if (v.presence < 0.003 || !ready) continue;
      if (v.burst && v.pop > 0.995) continue; // the bubble has gone: nothing left to draw
      if (c.drift > 0) moving = true;

      const b = v.el.getBoundingClientRect();
      if (b.width < 2 || b.height < 2 || b.bottom < -vh * 0.5 || b.top > vh * 1.5) continue;
      draw(v, { x: b.left, y: b.top, w: b.width, h: b.height });
    }

    if (moving) {
      adapt(dt);
      invalidate();
    } else {
      last = 0;
      samples.length = 0;
      const waiting = settled;
      settled = [];
      for (const fn of waiting) fn();
    }
  }

  function draw(v, box) {
    const c = v.cfg;
    const plate = v.plate;
    const A = plate.w / plate.h;
    const sphere = plate.sphere;
    const p = v.progress;
    const eased = p * p * (3 - 2 * p);

    // Where the photograph rests on screen (like CSS object-fit), and the lens that puts it there.
    // A bubble is placed by its sphere: the box is the bubble's own square.
    const pcx = sphere ? sphere.cx : 0.5;   // where the optical axis crosses the photograph
    const pcy = sphere ? sphere.cy : 0.5;
    let iw = c.fit === 'contain' ? Math.min(box.w, box.h * A) : Math.max(box.w, box.h * A);
    if (sphere) iw = (Math.min(box.w, box.h) * plate.w * sphere.z) / (2 * plate.f * sphere.r);
    iw *= c.zoom * (1 + c.grow * eased);
    const ih = iw / A;
    let ix = sphere ? box.x + box.w / 2 - pcx * iw : box.x + (box.w - iw) * c.pos[0];
    if (!sphere && c.anchor) ix = box.x + c.anchor[1] * box.w - c.anchor[0] * iw;
    const iy = sphere ? box.y + box.h / 2 - pcy * ih : box.y + (box.h - ih) * c.pos[1];
    const focal = (plate.f * iw) / plate.w;
    const cx = ix + iw * pcx;
    const cy = iy + ih * pcy;

    // The camera travels a little way from where the photograph was taken, keeping the
    // middle of the scene in the middle of the frame. Distances are measured against the
    // nearest surfaces, because those are the ones that move most.
    const [near, mid, far] = plate.depth;
    const unit = plate.near;
    const reach = near; // travel is measured against the nearest real surfaces, not a stray corner
    const s = 2 * p - 1;
    const wob = c.drift > 0 ? time : 0;
    const eye = [
      reach * (c.travel[0] * s + pointer.x * c.sway + Math.sin(wob * 0.23) * 0.02 * c.drift),
      reach * (c.travel[1] * s + pointer.y * c.sway * 0.6 + Math.cos(wob * 0.17) * 0.014 * c.drift),
      reach * c.travel[2] * p,
    ];
    const pivot = sphere ? sphere.z : mid;
    const fwd = norm([-eye[0], -eye[1], pivot - eye[2]]);
    const right = norm([fwd[2], 0, -fwd[0]]);
    const down = cross(fwd, right);
    const rot = [right[0], down[0], fwd[0], right[1], down[1], fwd[1], right[2], down[2], fwd[2]];

    // Screen px -> photograph uv, for a flat scene standing at middle depth.
    const col = (m) => [(plate.f / plate.w) * m[0] + pcx * m[2], (plate.f / plate.h) * m[1] + pcy * m[2], m[2]];
    const k = pivot / focal;
    const plane = [
      ...col([right[0] * k, right[1] * k, right[2] * k]),
      ...col([down[0] * k, down[1] * k, down[2] * k]),
      ...col([
        pivot * fwd[0] - k * (cx * right[0] + cy * down[0]) + eye[0],
        pivot * fwd[1] - k * (cx * right[1] + cy * down[1]) + eye[1],
        pivot * fwd[2] - k * (cx * right[2] + cy * down[2]) + eye[2],
      ]),
    ];

    // Discs stand over the part of the photograph that can be on screen.
    const short = Math.min(box.w, box.h);
    const free = c.overflow > 0;
    const spacing = TIERS[tier].spacing;
    const margin = 0.06 * Math.max(vw, vh);
    const wx0 = Math.max(free ? -margin : box.x - margin, -margin), wx1 = Math.min(free ? vw + margin : box.x + box.w + margin, vw + margin);
    const wy0 = Math.max(free ? -margin : box.y - margin, -margin), wy1 = Math.min(free ? vh + margin : box.y + box.h + margin, vh + margin);
    const u0 = clamp((wx0 - ix) / iw), u1 = clamp((wx1 - ix) / iw);
    const v0 = clamp((wy0 - iy) / ih), v1 = clamp((wy1 - iy) / ih);
    if (u1 - u0 <= 0 || v1 - v0 <= 0) return;
    const cols = Math.max(1, Math.round(((u1 - u0) * iw) / spacing));
    const rows = Math.max(1, Math.round(((v1 - v0) * ih) / spacing));
    const count = cols * rows;

    const farNearness = unit / far;
    // Focus is set by distance, on a scale where each step is the same ratio: 0 is the far
    // background, 1 the nearest things, 0.5 the geometric middle of the scene.
    const tFocus = mix(c.focus[0], c.focus[1], eased);
    const farEnd = Math.min(far, mid * 3);
    const focus = unit / (Math.pow(farEnd, 1 - tFocus) * Math.pow(near, tFocus));
    const loose = 1 - v.presence;
    const gain = c.gain * mix(1, c.dim, ramp(p, c.dimAt[0], c.dimAt[1]));

    const pad = short * 0.3;
    const sx0 = free ? 0 : clamp(box.x - pad, 0, vw), sx1 = free ? vw : clamp(box.x + box.w + pad, 0, vw);
    const sy0 = free ? 0 : clamp(box.y - pad, 0, vh), sy1 = free ? vh : clamp(box.y + box.h + pad, 0, vh);
    if (sx1 - sx0 < 1 || sy1 - sy0 < 1) return;
    const scissor = (m) => gl.scissor(Math.floor(sx0 * m), Math.floor((vh - sy1) * m), Math.ceil((sx1 - sx0) * m), Math.ceil((sy1 - sy0) * m));
    const accK = ratio * ACC_SCALE;

    const splatUniforms = (u) => {
      gl.uniform3f(u.uEye, eye[0], eye[1], eye[2]);
      gl.uniformMatrix3fv(u.uRot, false, rot);
      gl.uniform1f(u.uFocal, focal);
      gl.uniform2f(u.uCenter, cx, cy);
      gl.uniform2f(u.uView, vw, vh);
      gl.uniform1f(u.uPointScale, accK);
      gl.uniform3f(u.uSrc, plate.f, plate.w * pcx, plate.h * pcy);
      gl.uniform2f(u.uSrcSize, plate.w, plate.h);
      gl.uniform1f(u.uNear, unit);
      gl.uniform1i(u.uDepth, 0);
      gl.uniform1i(u.uPhoto, 1);
      gl.uniform2f(u.uDepthSize, plate.depthSize[0], plate.depthSize[1]);
      gl.uniform1f(u.uTexPerPx, plate.size[0] / iw);
      gl.uniform4f(u.uWin, u0, v0, u1, v1);
      gl.uniform2f(u.uGrid, cols, rows);
      gl.uniform4f(u.uRect, ix, iy, iw, ih);
      if (free) {
        gl.uniform4f(u.uBox, -1e5, -1e5, 2e5, 2e5);
        gl.uniform4f(u.uSoft, 0, 0, 0, 0);
      } else {
        // The dissolving edges belong to what is actually shown: where the photograph ends
        // inside its box, they start at the photograph's edge, not at the box's.
        const bx0 = Math.max(box.x, ix), by0 = Math.max(box.y, iy);
        const bx1 = Math.min(box.x + box.w, ix + iw), by1 = Math.min(box.y + box.h, iy + ih);
        gl.uniform4f(u.uBox, bx0, by0, Math.max(1, bx1 - bx0), Math.max(1, by1 - by0));
        gl.uniform4f(u.uSoft, c.soft[0] * short, c.soft[1] * short, c.soft[2] * short, c.soft[3] * short);
      }
      gl.uniform1f(u.uSpacing, spacing);
      gl.uniform1f(u.uPull, (focal * (Math.hypot(eye[0], eye[1]) + 0.5 * Math.abs(eye[2]))) / unit);
      gl.uniform1f(u.uScatter, c.scatter);
      gl.uniform1f(u.uFocus, focus);
      gl.uniform1f(u.uBokeh, (Math.max(c.aperture, c.bokeh) / Math.max(0.05, 1 - farNearness)) * (1 + 2 * loose));
      gl.uniform1f(u.uPresence, v.presence);
      gl.uniform1f(u.uTime, time);
      gl.uniform1f(u.uSeed, v.seed);
      if (sphere) {
        gl.uniform4f(u.uSphere, sphere.z, sphere.r, v.pop, 1);
        gl.uniform3f(u.uPuncture, 0.447, -0.596, -0.667);
      } else {
        gl.uniform4f(u.uSphere, 0, 0, 0, 0);
        gl.uniform3f(u.uPuncture, 0, 0, -1);
      }
    };

    gl.bindVertexArray(emptyVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, plate.depthTex);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, plate.photoTex);
    gl.enable(gl.SCISSOR_TEST);
    gl.viewport(0, 0, acc.w, acc.h);
    gl.blendFunc(gl.ONE, gl.ONE);

    // pass 1: which surface is in front
    gl.bindFramebuffer(gl.FRAMEBUFFER, front.fbo);
    scissor(accK);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.blendEquation(gl.MAX);
    gl.useProgram(nearest.p);
    splatUniforms(nearest.u);
    gl.drawArrays(gl.POINTS, 0, count);

    // pass 2: gather photograph positions and loose tones
    gl.bindFramebuffer(gl.FRAMEBUFFER, acc.fbo);
    scissor(accK);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.blendEquation(gl.FUNC_ADD);
    gl.useProgram(gather.p);
    splatUniforms(gather.u);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, front.tex);
    gl.uniform1i(gather.u.uNearest, 2);
    gl.uniformMatrix3fv(gather.u.uPlane, false, plane);
    gl.drawArrays(gl.POINTS, 0, count);

    // pass 3: resolve onto the screen
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, canvas.width, canvas.height);
    scissor(ratio);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(resolve.p);
    const u = resolve.u;
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, acc.place);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, acc.tone);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, plate.depthTex);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, plate.photoTex);
    gl.uniform1i(u.uPlace, 0);
    gl.uniform1i(u.uTone, 1);
    gl.uniform1i(u.uDepth, 2);
    gl.uniform1i(u.uPhoto, 3);
    gl.uniform1f(u.uPush, eye[2] / unit);
    gl.uniform1f(u.uLod, Math.max(0, Math.log2(plate.size[0] / (iw * ratio))));
    gl.uniform2f(u.uView, vw, vh);
    gl.uniform1f(u.uPixelRatio, ratio);
    gl.uniformMatrix3fv(u.uPlane, false, plane);
    gl.uniform4f(u.uRect, ix, iy, iw, ih);
    gl.uniform2f(u.uPhotoSize, plate.size[0], plate.size[1]);
    gl.uniform1f(u.uFocus, focus);
    gl.uniform1f(u.uAperture, c.aperture / Math.max(0.05, 1 - farNearness));
    gl.uniform1f(u.uDefocus, loose * 6);
    gl.uniform1f(u.uGain, gain * mix(0.7, 1, v.presence));
    gl.uniform1f(u.uShade, c.shade);
    gl.uniform1f(u.uGrain, c.grain);
    gl.uniform1f(u.uOpacity, ramp(v.presence, 0, 0.6));
    gl.uniform1f(u.uOcclude, c.occlude);
    gl.uniform1f(u.uSeed, v.seed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
    gl.disable(gl.SCISSOR_TEST);
  }

  // ---- lifecycle ----
  const onScroll = () => invalidate();
  const onResize = () => {
    resize();
    invalidate();
  };
  function stop() {
    destroyed = true;
    cancelAnimationFrame(raf);
    window.removeEventListener('scroll', onScroll);
    window.removeEventListener('resize', onResize);
    window.removeEventListener('pointermove', onPointer);
  }
  /** Gives the page back to plain photographs: lost graphics context, or the reader asked for less motion. */
  function fallback() {
    if (destroyed) return;
    stop();
    for (const v of views) if (v.caption) v.caption.style.opacity = '';
    document.documentElement.classList.remove('has-stage');
    document.dispatchEvent(new CustomEvent('stage:off'));
    for (const fn of settled) fn();
    settled = [];
  }

  resize();
  if (!ok) return null;
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('resize', onResize);
  window.addEventListener('pointermove', onPointer, { passive: true });
  canvas.addEventListener('webglcontextlost', fallback);
  window.matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', (e) => e.matches && fallback());
  scan();

  return {
    scan,
    invalidate,
    /** Resolves once nothing is animating (used by the screenshot tool). */
    whenSettled(timeout = 4000) {
      return new Promise((done) => {
        const t = setTimeout(done, timeout);
        settled.push(() => {
          clearTimeout(t);
          done();
        });
        invalidate();
      });
    },
    info() {
      const dbg = gl.getExtension('WEBGL_debug_renderer_info');
      return {
        tier,
        ratio,
        canvas: [canvas.width, canvas.height],
        renderer: dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : 'unknown',
        views: views.map((v) => ({ slug: v.plate.slug, state: v.plate.state, presence: +v.presence.toFixed(3), progress: +v.progress.toFixed(3) })),
      };
    },
    destroy: stop,
  };
}
