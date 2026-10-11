import { camera } from './looks.js';

// Which part of a sw×sh source a recipe shows, and at what output size.
// cw/ch are in source pixels, measured in the rotated frame.
export function plan(sw, sh, recipe, { aspect, zoom = 1, maxLong = Infinity } = {}) {
  const cam = camera(recipe.cam);
  const quarter = Math.round((recipe.rotate || 0) / 90) & 3;
  const W = quarter & 1 ? sh : sw, H = quarter & 1 ? sw : sh;
  const a = aspect ?? recipe.crop ?? cam.aspect ?? null;
  let cw = W, ch = H;
  if (a) {
    const r = W >= H ? a : 1 / a;
    if (W / H > r) cw = H * r; else ch = W / r;
  }
  // shrink the crop until its straightened corners stay inside the source
  const th = ((recipe.straighten || 0) * Math.PI) / 180;
  const c = Math.abs(Math.cos(th)), s = Math.abs(Math.sin(th));
  const k = Math.min(1, W / (cw * c + ch * s), H / (cw * s + ch * c));
  cw = (cw * k) / zoom;
  ch = (ch * k) / zoom;
  const scale = Math.min(1, Math.min(maxLong, cam.out || Infinity) / Math.max(cw, ch));
  return {
    cw, ch, angle: -(quarter * Math.PI) / 2 - th,
    ow: Math.max(1, Math.round(cw * scale)), oh: Math.max(1, Math.round(ch * scale)),
  };
}

// yflip = -1 when rendering into the framebuffer that gets read back, so rows come
// out top-first like a 2D canvas.
const VERT = `attribute vec2 p; varying vec2 v; uniform float yflip;
void main() { v = vec2(p.x * .5 + .5, .5 - p.y * .5); gl_Position = vec4(p.x, p.y * yflip, 0., 1.); }`;

const FRAG = `precision highp float;
varying vec2 v;
uniform sampler2D tex;
uniform vec2 texSize, crop, outSize, pix;
uniform float angle, flip;
uniform float ev, con, sat, warm, fade, xpro, mono, soft, cornerSoft, chroma, grainColor, palette;
uniform vec3 lift, gain, mixw, leakColor;
uniform float grain, vignette, halation, leak, dust, seed;

vec2 toSrc(vec2 q) {
  vec2 p = (q - .5) * crop * vec2(flip, 1.);
  float c = cos(angle), s = sin(angle);
  return vec2(c * p.x - s * p.y, s * p.x + c * p.y) / texSize + .5;
}
vec3 at(vec2 q) { return texture2D(tex, toSrc(q)).rgb; }
vec3 ring(vec2 q, float r) {
  vec2 o = r / outSize; float d = .7071;
  return (at(q + o * vec2(1., 0.)) + at(q - o * vec2(1., 0.)) + at(q + o * vec2(0., 1.)) + at(q - o * vec2(0., 1.))
        + at(q + o * vec2(d, d)) + at(q - o * vec2(d, d)) + at(q + o * vec2(d, -d)) + at(q - o * vec2(d, -d))) / 8.;
}
float hash(vec2 p) { vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
float vnoise(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3. - 2. * f);
  return mix(mix(hash(i), hash(i + vec2(1., 0.)), f.x), mix(hash(i + vec2(0., 1.)), hash(i + 1.), f.x), f.y);
}
float bayer2(vec2 a) { a = floor(a); return fract(a.x / 2. + a.y * a.y * .75); }
float bayer4(vec2 a) { return bayer2(.5 * a) * .25 + bayer2(a); }

void main() {
  vec2 q = v;
  if (pix.x > 0.) q = (floor(q * pix) + .5) / pix;
  float sh = min(outSize.x, outSize.y);
  float vd = length((v - .5) * outSize / sh);

  vec3 c = at(q);
  if (chroma > 0.) {
    vec2 d = (q - .5) * chroma * .008;
    c.r = at(q + d).r; c.b = at(q - d).b;
  }
  float s = soft + cornerSoft * smoothstep(.2, .8, vd);
  if (s > 0.) {
    float r = s * .004 * sh;
    c = mix(c, (c + ring(q, r * .5) * 8. + ring(q, r) * 8.) / 17., min(s * 1.5, 1.));
  } else if (s < 0.) {
    c += (c - ring(q, max(1., .0007 * sh))) * -s * 1.5;
  }

  c *= exp2(ev);
  c *= vec3(1. + .12 * warm, 1. + .02 * warm, 1. - .12 * warm);
  if (xpro > 0.) {
    vec3 x = vec3(smoothstep(.05, .95, c.r), smoothstep(0., 1., c.g) * 1.03, c.b * .7 + .12);
    c = mix(c, x, xpro);
  }
  c = clamp(c, 0., 1.);
  c = con > 0. ? mix(c, c * c * (3. - 2. * c), con) : mix(c, vec3(.5), -con * .5);
  float l = dot(c, vec3(.2126, .7152, .0722));
  c = clamp(mix(vec3(l), c, 1. + sat), 0., 1.);
  if (mono > 0.) c = vec3(dot(c, mixw));
  vec3 lo = lift + fade * .18;
  c = lo + c * (gain - lo);

  if (halation > 0.) {
    vec3 hb = ring(q, .012 * sh);
    float hl = max(dot(hb, vec3(.333)) - .6, 0.) * 2.5;
    c += vec3(1., .3, .12) * hl * halation * .6;
  }
  if (grain > 0.) {
    vec2 g = v * outSize / sh * 1400.;
    float n = vnoise(g + seed * 91.) + vnoise(g * 2.1 + seed * 37.) * .5 - .75;
    vec3 nv = vec3(n);
    if (grainColor > 0.) nv = mix(nv, (vec3(vnoise(g + seed * 13.), vnoise(g + seed * 29.), vnoise(g + seed * 53.)) - .5) * 1.4, grainColor);
    float lum = dot(c, vec3(.299, .587, .114));
    c += nv * grain * .22 * sqrt(min(1., sh / 1400.)) * (1. - abs(lum - .5) * 1.2);
  }
  c *= 1. - vignette * .9 * smoothstep(.25, .95, vd);
  if (leak > 0.) {
    float ex = mix(v.x, 1. - v.x, step(.5, fract(seed * 7.13)));
    float m = exp(-ex * ex * 18.) * (.45 + .55 * (.5 + .5 * sin(v.y * 2.6 + seed * 40.)));
    c = 1. - (1. - c) * (1. - clamp(leakColor * m * leak * 1.3, 0., 1.));
  }
  if (dust > 0.) {
    vec2 g = v * outSize / sh * 70.;
    vec2 id = floor(g);
    if (hash(id + seed * 17.) > .995 - dust * .01) {
      float sz = .04 + .1 * hash(id + 1.3);
      float d = length(fract(g) - vec2(hash(id + 3.1), hash(id + 7.7)));
      c = mix(c, vec3(.92), smoothstep(sz, sz * .4, d) * dust);
    }
  }
  if (palette > 0.) {
    float lv = clamp(floor(dot(c, vec3(.299, .587, .114)) * 3. + (bayer4(q * pix) - .5) * .9 + .5), 0., 3.);
    c = lv < .5 ? vec3(.06, .22, .06) : lv < 1.5 ? vec3(.19, .38, .19) : lv < 2.5 ? vec3(.55, .67, .06) : vec3(.61, .74, .06);
  }
  gl_FragColor = vec4(clamp(c, 0., 1.), 1.);
}`;

// One WebGL context does everything: the live viewfinder draws to the visible
// canvas, and thumbnails, the viewer and exports draw into a framebuffer that is read
// back with readPixels. iOS doesn't reliably survive a second context or copying a
// WebGL canvas into a 2D one, which is what turned photos black.
export class Renderer {
  constructor(canvas = document.createElement('canvas')) {
    this.canvas = canvas;
    canvas.addEventListener('webglcontextlost', (e) => { e.preventDefault(); this.lost = true; });
    canvas.addEventListener('webglcontextrestored', () => this.init());
    this.init();
  }

  init() {
    const gl = (this.gl = this.canvas.getContext('webgl2', { preserveDrawingBuffer: true, antialias: false, alpha: false }));
    if (!gl) throw new Error('This browser has no WebGL2');
    const shader = (type, src) => {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      return s;
    };
    const p = gl.createProgram();
    gl.attachShader(p, shader(gl.VERTEX_SHADER, VERT));
    gl.attachShader(p, shader(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(p);
    gl.useProgram(p);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(p, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    const tex = () => {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      return t;
    };
    this.fboTex = tex();
    this.fbo = gl.createFramebuffer();
    this.fboSize = '';
    this.tex = tex();
    this.max = gl.getParameter(gl.MAX_TEXTURE_SIZE);
    this.u = {};
    for (let i = gl.getProgramParameter(p, gl.ACTIVE_UNIFORMS); i--;) {
      const name = gl.getActiveUniform(p, i).name;
      this.u[name] = gl.getUniformLocation(p, name);
    }
    this.lost = false;
  }

  // Draws to the visible canvas. opts: aspect, zoom, outW/outH, mirror.
  draw(src, sw, sh, recipe, opts = {}) {
    return this.pass(false, src, sw, sh, recipe, opts);
  }

  // Renders off screen and returns a 2D canvas. opts: aspect, maxLong.
  render(src, sw, sh, recipe, opts = {}) {
    const { ow, oh } = this.pass(true, src, sw, sh, recipe, opts);
    const gl = this.gl, px = new Uint8ClampedArray(ow * oh * 4);
    gl.readPixels(0, 0, ow, oh, gl.RGBA, gl.UNSIGNED_BYTE, px);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    const c = Object.assign(document.createElement('canvas'), { width: ow, height: oh });
    c.getContext('2d').putImageData(new ImageData(px, ow, oh), 0, 0);
    return c;
  }

  // RGBA bytes of a region of the viewfinder, in canvas pixels from the top left.
  sample(x, y, w, h) {
    const gl = this.gl, W = this.canvas.width, H = this.canvas.height;
    x = Math.min(W - 1, Math.max(0, Math.round(x)));
    y = Math.min(H - 1, Math.max(0, Math.round(y)));
    w = Math.max(1, Math.min(Math.round(w), W - x));
    h = Math.max(1, Math.min(Math.round(h), H - y));
    const px = new Uint8Array(w * h * 4);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.readPixels(x, H - y - h, w, h, gl.RGBA, gl.UNSIGNED_BYTE, px);
    return px;
  }

  pass(off, src, sw, sh, recipe, opts) {
    const gl = this.gl;
    if (this.lost || gl.isContextLost()) throw new Error('The graphics were reset. Try again.');
    const maxLong = Math.min(opts.maxLong ?? Infinity, this.max);
    const P = plan(sw, sh, recipe, { ...opts, maxLong }), t = camera(recipe.cam).tone;
    const ow = opts.outW || P.ow, oh = opts.outH || P.oh;
    if (off) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.fbo);
      if (this.fboSize !== ow + 'x' + oh) {
        gl.bindTexture(gl.TEXTURE_2D, this.fboTex);
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, ow, oh, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
        gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, this.fboTex, 0);
        this.fboSize = ow + 'x' + oh;
      }
    } else {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      if (this.canvas.width !== ow) this.canvas.width = ow;
      if (this.canvas.height !== oh) this.canvas.height = oh;
    }
    gl.viewport(0, 0, ow, oh);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, src);
    const mip = off && Math.max(P.cw, P.ch) > Math.max(ow, oh) * 1.5;
    if (mip) gl.generateMipmap(gl.TEXTURE_2D);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, mip ? gl.LINEAR_MIPMAP_LINEAR : gl.LINEAR);

    const f = (name, ...v) => this.u[name] && gl['uniform' + v.length + 'f'](this.u[name], ...v);
    f('yflip', off ? -1 : 1);
    f('texSize', sw, sh); f('crop', P.cw, P.ch); f('outSize', ow, oh);
    f('angle', P.angle); f('flip', opts.mirror ? -1 : 1);
    const pix = t.pix ? (ow >= oh ? t.pix : [t.pix[1], t.pix[0]]) : [0, 0];
    f('pix', ...pix); f('palette', t.palette || 0);
    f('ev', (t.ev || 0) + recipe.exposure);
    f('con', Math.max(-1, Math.min(1, (t.con || 0) + recipe.contrast)));
    f('sat', (t.sat || 0) + recipe.saturation);
    f('warm', (t.warm || 0) + recipe.warmth);
    f('fade', recipe.fade);
    f('xpro', t.cross || 0); f('mono', t.mono || 0); f('mixw', ...(t.mix || [0.299, 0.587, 0.114]));
    f('soft', t.soft || 0); f('cornerSoft', t.cornerSoft || 0); f('chroma', t.chroma || 0);
    f('grainColor', t.grainColor || 0);
    f('lift', ...(t.lift || [0, 0, 0])); f('gain', ...(t.gain || [1, 1, 1]));
    f('leakColor', ...(t.leakColor || [1, 0.4, 0.1]));
    f('grain', recipe.grain); f('vignette', recipe.vignette); f('halation', recipe.halation);
    f('leak', recipe.leak); f('dust', recipe.dust); f('seed', recipe.seed);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return { ...P, ow, oh };
  }
}

let shared;
export const initRenderer = (canvas) => (shared = new Renderer(canvas));
export const offscreen = () => (shared ||= new Renderer());

// Seven-segment date imprint, the orange kind from 90s compacts.
const SEG = { 0: 'abcdef', 1: 'bc', 2: 'abged', 3: 'abgcd', 4: 'fgbc', 5: 'afgcd', 6: 'afgedc', 7: 'abc', 8: 'abcdefg', 9: 'abcdfg' };
function drawDate(x, right, bottom, long, d) {
  const text = `'${String(d.getFullYear()).slice(2)} ${d.getMonth() + 1} ${d.getDate()}`;
  const h = long * 0.026, w = h * 0.52, gap = h * 0.32, lw = h * 0.13, e = lw * 0.9;
  const adv = (ch) => (ch === ' ' ? w * 0.7 : ch === "'" ? lw * 2 + gap : w + gap);
  const total = [...text].reduce((a, ch) => a + adv(ch), 0);
  const lines = [];
  let cx = 0;
  for (const ch of text) {
    const s = SEG[ch];
    if (s) {
      const P = { a: [0, 0, w, 0], b: [w, 0, w, h / 2], c: [w, h / 2, w, h], d: [0, h, w, h], e: [0, h / 2, 0, h], f: [0, 0, 0, h / 2], g: [0, h / 2, w, h / 2] };
      for (const k of s) {
        const [x1, y1, x2, y2] = P[k], dx = Math.sign(x2 - x1) * e, dy = Math.sign(y2 - y1) * e;
        lines.push([cx + x1 + dx, y1 + dy, cx + x2 - dx, y2 - dy]);
      }
    } else if (ch === "'") lines.push([cx + lw, 0, cx + lw, h * 0.28]);
    cx += adv(ch);
  }
  x.save();
  x.translate(right - long * 0.05 - total, bottom - long * 0.045 - h);
  x.transform(1, 0, -0.1, 1, h * 0.1, 0);
  x.lineCap = 'round';
  for (const [color, blur, width] of [['rgba(255,96,24,.85)', h * 0.45, lw * 1.4], ['#ffb26b', 0, lw]]) {
    x.strokeStyle = color; x.shadowColor = color; x.shadowBlur = blur; x.lineWidth = width;
    x.beginPath();
    for (const [a, b, c, dd] of lines) { x.moveTo(a, b); x.lineTo(c, dd); }
    x.stroke();
  }
  x.restore();
}

// Adds the print border and date imprint. Returns a 2D canvas.
export function compose(src, recipe, { date = null, frame = true } = {}) {
  const cam = camera(recipe.cam), w = src.width, h = src.height, u = Math.min(w, h);
  const kind = frame && recipe.frame ? cam.frame : null;
  let [L, T, R, B, bg] = [0, 0, 0, 0, null];
  if (kind === 'sx70') [L, T, R, B, bg] = [u * 0.06, u * 0.06, u * 0.06, u * 0.24, '#F3F0E8'];
  if (kind === 'instax') [L, T, R, B, bg] = [u * 0.087, u * 0.152, u * 0.087, u * 0.37, '#F6F5F1'];
  if (kind === 'super8') [L, T, R, B, bg] = [u * 0.14, u * 0.05, u * 0.05, u * 0.05, '#0B0B0A'];
  const c = document.createElement('canvas');
  c.width = Math.round(w + L + R);
  c.height = Math.round(h + T + B);
  const x = c.getContext('2d');
  if (bg) { x.fillStyle = bg; x.fillRect(0, 0, c.width, c.height); }
  if (kind === 'super8') {
    x.save();
    x.beginPath(); x.roundRect(L, T, w, h, u * 0.06); x.clip();
    x.drawImage(src, L, T);
    x.restore();
    x.fillStyle = '#2A2925';
    x.beginPath(); x.roundRect(L * 0.3, c.height / 2 - u * 0.07, L * 0.4, u * 0.14, u * 0.02); x.fill();
  } else {
    x.drawImage(src, L, T);
  }
  if (date && recipe.date) drawDate(x, L + w, T + h, Math.max(w, h), date);
  return c;
}

// Chromium defers canvas.toBlob to idle time while the viewfinder draws (about a
// second per call), so there it goes through two workers. Safari's toBlob doesn't
// have that problem and is the most reliable path on iOS.
const useWorkers = typeof OffscreenCanvas !== 'undefined' && typeof navigator !== 'undefined' && /Chrome\//.test(navigator.userAgent);
let workers, jobSeq = 0;
const jobs = new Map();
function pool() {
  return (workers ||= [0, 1].map(() => {
    const w = new Worker(new URL('./encoder.js', import.meta.url));
    w.onmessage = ({ data }) => {
      const j = jobs.get(data.id);
      jobs.delete(data.id);
      data.error ? j.rej(new Error(data.error)) : j.res(data.blob);
    };
    return w;
  }));
}

const viaToBlob = (canvas, q) =>
  new Promise((res, rej) => canvas.toBlob((b) => (b ? res(b) : rej(new Error('Could not encode JPEG'))), 'image/jpeg', q));

export async function toJpeg(canvas, q = 0.92) {
  if (!useWorkers) return viaToBlob(canvas, q);
  const bmp = await createImageBitmap(canvas);
  const ws = pool(), id = ++jobSeq;
  return new Promise((res, rej) => {
    jobs.set(id, { res, rej });
    ws[id % ws.length].postMessage({ id, bmp, q }, [bmp]);
  });
}

// createImageBitmap(blob), falling back to an <img> when that fails.
export async function decode(blob) {
  try {
    return await createImageBitmap(blob);
  } catch {
    const url = URL.createObjectURL(blob), img = new Image();
    img.src = url;
    await img.decode();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
    return img;
  }
}

// Full render of a stored shot: raw blob -> look -> border/date -> 2D canvas.
export async function renderShot(renderer, raw, shot, { maxLong = Infinity, frame = true, date = true, aspect } = {}) {
  const img = await decode(raw);
  const c = renderer.render(img, img.width, img.height, shot.recipe, { maxLong, aspect });
  img.close?.();
  return compose(c, shot.recipe, { frame, date: date ? new Date(shot.t) : null });
}

// Small rendered preview for the gallery grid (look applied, no border or date).
export function makeThumb(src, w, h, recipe) {
  const k = Math.min(1, 360 / Math.max(w, h));
  const small = Object.assign(document.createElement('canvas'), { width: Math.round(w * k), height: Math.round(h * k) });
  small.getContext('2d').drawImage(src, 0, 0, small.width, small.height);
  const c = offscreen().render(small, small.width, small.height, recipe, { maxLong: 360 });
  return toJpeg(compose(c, recipe, { frame: false }), 0.8);
}
