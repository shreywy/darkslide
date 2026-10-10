import { $, $$, el, prefs, toast, sheet, slider, toggle, fmtDuration, fmtBytes } from './dom.js';
import * as cam from './camera.js';
import { CAMERAS, camera, fxFor, newRecipe, cameraCard } from './looks.js';
import { Renderer, makeThumb, encodeBitmap, plan } from './render.js';
import { totalShots, newRun, step, everyLabel } from './interval.js';
import { addShot, allShots, allRolls, putRoll, newId } from './store.js';
import { initGallery, openGallery } from './gallery.js';

export const SHORTCUT_NAME = 'Darkslide Interval';
const REPO = 'https://github.com/shreywy/darkslide';

// interval choices, in ms
const EVERY = [100, 125, 200, 250, 333, 500, 1000, 2000, 3000, 5000, 10000, 15000, 30000, 60000, 120000, 300000, 600000];
const STOP_TIME = [10, 30, 60, 120, 300, 600, 900, 1800, 3600, 7200, 14400, 28800].map((s) => s * 1000);
const STOP_SHOTS = [10, 25, 50, 100, 200, 300, 500, 1000, 2000];
const DELAY = [0, 3000, 5000, 10000, 30000, 60000];
const ASPECTS = [['full', 0], ['4:3', 4 / 3], ['3:2', 3 / 2], ['16:9', 16 / 9], ['1:1', 1]];

const S = prefs.get('settings', {
  res: 'max', aspect: 4 / 3, grid: 'thirds', level: false, histo: false, mirror: true, sound: false,
  quality: 0.92, timer: 0, flash: 'off', cam: 'digital', fx: fxFor('digital'), mode: 'photo',
  facing: 'environment', deviceId: null,
  interval: { every: 5, stopKind: 'time', time: 2, shots: 3, delay: 0, mode: 'app' },
});
const save = () => prefs.set('settings', S);
const demo = new URLSearchParams(location.search).has('demo');

const video = $('#video'), frame = $('#frame'), previewCanvas = $('#preview'), shutter = $('#shutter');
let preview;
let lensList = [], dzoom = 1, swEv = 0, paused = false, inflight = 0;
let run = null, runTimer = 0, hudTimer = 0, runRoll = null, wakeLock = null, useDemo = demo;
const knownRolls = new Set();

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const isFront = () => (lensList.find((l) => l.id === cam.current().deviceId)?.kind ?? (S.facing === 'user' ? 'front' : '')) === 'front';
const mirrored = () => isFront() && S.mirror;
const viewAspect = () => camera(S.cam).aspect || S.aspect || null;

// ---------- camera ----------

async function startCamera() {
  $('#vfMsg').hidden = true;
  $('#roRes').textContent = 'starting';
  try {
    if (!useDemo && !navigator.mediaDevices?.getUserMedia) throw Object.assign(new Error(), { name: 'Insecure' });
    const stream = await cam.start({ deviceId: S.deviceId, facing: S.facing, res: S.res, demo: useDemo });
    video.srcObject = stream;
    await video.play().catch(() => {});
    stream.getVideoTracks()[0].addEventListener('ended', () => { if (!document.hidden) startCamera(); });
    lensList = useDemo ? [] : await cam.lenses();
    dzoom = 1;
    renderLenses();
    applyCaps();
  } catch (e) {
    const msg = {
      NotAllowedError: 'Darkslide needs the camera. Allow access when Safari asks, or turn it on in Settings › Apps › Safari › Camera.',
      NotFoundError: 'No camera found on this device.',
      NotReadableError: 'The camera is in use by another app. Close it and try again.',
      Insecure: 'The camera only works over https. Open the GitHub Pages link instead of a local file.',
    }[e.name] || `The camera didn't start (${e.name || e.message}).`;
    $('#vfMsgText').textContent = msg;
    $('#vfMsg').hidden = false;
    $('#roRes').textContent = 'no camera';
  }
}

function renderLenses() {
  const box = $('#lenses');
  box.innerHTML = '';
  const back = lensList.filter((l) => l.kind !== 'front');
  if (isFront() || back.length < 2) return;
  const order = { ultra: 0, wide: 1, tele: 2 };
  const label = { ultra: '.5', wide: '1×', tele: 'tele' };
  const active = cam.current().deviceId;
  for (const l of back.sort((a, b) => (order[a.kind] ?? 3) - (order[b.kind] ?? 3))) {
    const b = el(`<button class="${l.id === active ? 'on' : ''}" aria-label="${l.label}">${label[l.kind] || l.kind.replace('cam', '')}</button>`);
    b.onclick = () => { S.deviceId = l.id; S.facing = 'environment'; save(); startCamera(); };
    box.append(b);
  }
}

function applyCaps() {
  const c = cam.caps();
  $('#flashBtn').hidden = !(c.torch || isFront());
  if (S.flash === 'torch' && c.torch) cam.apply({ torch: true });
  if (c.zoom) cam.apply({ zoom: c.zoom.min });
  if (c.exposureCompensation) cam.apply({ exposureCompensation: 0 });
  swEv = 0;
  updateReadout();
  layout();
}

function captureRect(vw, vh) {
  const P = plan(vw, vh, { cam: 'digital' }, { aspect: S.aspect || null, zoom: dzoom });
  return { sx: (vw - P.cw) / 2, sy: (vh - P.ch) / 2, sw: P.cw, sh: P.ch };
}

let storageFree = Infinity;
async function refreshStorage() {
  const e = await navigator.storage?.estimate?.().catch(() => null);
  if (e) storageFree = e.quota - e.usage;
  updateReadout();
}
const bytesPerShot = () => {
  const r = captureRect(video.videoWidth || 3024, video.videoHeight || 4032);
  return r.sw * r.sh * (S.quality > 0.95 ? 0.5 : S.quality > 0.85 ? 0.32 : 0.18) + 40e3;
};

function updateReadout() {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (vw) {
    const r = captureRect(vw, vh);
    $('#roRes').textContent = `${Math.round(r.sw)}×${Math.round(r.sh)}`;
  }
  const c = cam.caps(), z = c.zoom ? cam.current().zoom || 1 : dzoom;
  $('#roZoom').textContent = z.toFixed(1) + '×';
  const ev = c.exposureCompensation ? cam.current().exposureCompensation || 0 : swEv;
  $('#roEv').textContent = 'ev ' + (ev >= 0 ? '+' : '') + ev.toFixed(1);
  $('#roLeft').textContent = isFinite(storageFree) ? `~${Math.max(0, Math.floor(storageFree / bytesPerShot()))} left` : '';
  if (S.mode === 'interval') updateInterval();
}

// ---------- viewfinder ----------

function layout() {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw) return;
  const P = plan(vw, vh, { cam: S.cam }, { aspect: viewAspect(), zoom: dzoom });
  const box = $('#vf').getBoundingClientRect();
  const k = Math.min(box.width / P.cw, box.height / P.ch);
  const w = Math.floor(P.cw * k), h = Math.floor(P.ch * k);
  frame.style.width = w + 'px';
  frame.style.height = h + 'px';
  const dpr = Math.min(devicePixelRatio || 1, 2), s = Math.min(1, 1600 / Math.max(w * dpr, h * dpr));
  previewCanvas.width = Math.round(w * dpr * s);
  previewCanvas.height = Math.round(h * dpr * s);
  layout.key = `${vw}x${vh}`;
  drawGrid(w, h);
  updateReadout();
}

function drawGrid(w, h) {
  const g = $('#grid'), L = (x1, y1, x2, y2) => `M${x1} ${y1}L${x2} ${y2}`;
  let d = '';
  const at = { thirds: [100, 200], '4x4': [75, 150, 225], golden: [114.6, 185.4] }[S.grid];
  if (at) for (const p of at) d += L(p, 0, p, 300) + L(0, p, 300, p);
  if (S.grid === 'square') {
    if (w > h) { const x = (150 * (w - h)) / w; d += L(x, 0, x, 300) + L(300 - x, 0, 300 - x, 300); }
    else { const y = (150 * (h - w)) / h; d += L(0, y, 300, y) + L(0, 300 - y, 300, 300 - y); }
  }
  g.innerHTML = d ? `<path d="${d}"/>` : '';
}

const liveRecipe = () => ({ ...newRecipe(S.cam, S.fx), exposure: swEv, seed: 0.37 });
let lastHisto = 0;
function loop() {
  if (!paused && video.videoWidth && video.readyState >= 2) {
    if (layout.key !== `${video.videoWidth}x${video.videoHeight}`) layout();
    preview.draw(video, video.videoWidth, video.videoHeight, liveRecipe(), {
      aspect: viewAspect(), zoom: dzoom, outW: previewCanvas.width, outH: previewCanvas.height, mirror: mirrored(), mip: false,
    });
    if (S.histo && performance.now() - lastHisto > 250) { lastHisto = performance.now(); histogram(); }
  }
  if (video.requestVideoFrameCallback) video.requestVideoFrameCallback(loop);
  else requestAnimationFrame(loop);
}

const hc = Object.assign(document.createElement('canvas'), { width: 64, height: 48 });
const hx = hc.getContext('2d', { willReadFrequently: true });
function histogram() {
  hx.drawImage(previewCanvas, 0, 0, 64, 48);
  const px = hx.getImageData(0, 0, 64, 48).data, bins = new Array(64).fill(0);
  for (let i = 0; i < px.length; i += 4) bins[(px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114) >> 2]++;
  const c = $('#histo').getContext('2d'), max = Math.max(...bins);
  c.clearRect(0, 0, 128, 40);
  c.fillStyle = 'rgba(233,228,218,.75)';
  bins.forEach((b, i) => { const h = (b / max) * 40; c.fillRect(i * 2, 40 - h, 2, h); });
}

function levelListener(e) {
  const a = e.accelerationIncludingGravity;
  if (!a || a.x == null) return;
  const roll = (Math.atan2(a.x, a.y) * 180) / Math.PI;
  const d = ((((roll + 45) % 90) + 90) % 90) - 45;
  $('#level i').style.transform = `rotate(${d}deg)`;
  $('#level').classList.toggle('flat', Math.abs(d) < 1);
}
async function setLevel(on) {
  removeEventListener('devicemotion', levelListener);
  $('#level').hidden = !on;
  if (!on) return;
  if (typeof DeviceMotionEvent !== 'undefined' && DeviceMotionEvent.requestPermission) {
    const r = await DeviceMotionEvent.requestPermission().catch(() => 'denied');
    if (r !== 'granted') { toast('Motion access is needed for the level'); return; }
  }
  addEventListener('devicemotion', levelListener);
}

// pinch to zoom, vertical drag for exposure, double tap to reset both
function wireGestures() {
  const pts = new Map();
  let start = null, lastTap = 0;
  frame.addEventListener('pointerdown', (e) => {
    pts.set(e.pointerId, e);
    const c = cam.caps();
    start = { y: e.clientY, ev: c.exposureCompensation ? cam.current().exposureCompensation || 0 : swEv, zoom: c.zoom ? cam.current().zoom || 1 : dzoom, dist: 0, moved: false };
    if (pts.size === 2) { const [a, b] = [...pts.values()]; start.dist = Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
  });
  frame.addEventListener('pointermove', (e) => {
    if (!pts.has(e.pointerId) || !start) return;
    pts.set(e.pointerId, e);
    const c = cam.caps();
    if (pts.size === 2 && start.dist) {
      const [a, b] = [...pts.values()];
      let z = start.zoom * (Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY) / start.dist);
      start.moved = true;
      if (c.zoom) { z = Math.min(c.zoom.max, Math.max(c.zoom.min, z)); cam.apply({ zoom: z }); }
      else { dzoom = Math.min(4, Math.max(1, z)); layout(); }
      updateReadout();
    } else if (pts.size === 1 && Math.abs(e.clientY - start.y) > 12) {
      start.moved = true;
      const r = c.exposureCompensation || { min: -2, max: 2 };
      const ev = Math.min(r.max, Math.max(r.min, start.ev - (e.clientY - start.y) / 120));
      if (c.exposureCompensation) cam.apply({ exposureCompensation: ev }); else swEv = Math.round(ev * 10) / 10;
      updateReadout();
    }
  });
  const end = (e) => {
    pts.delete(e.pointerId);
    if (start && !start.moved && pts.size === 0) {
      if (performance.now() - lastTap < 300) {
        const c = cam.caps();
        dzoom = 1; swEv = 0;
        if (c.zoom) cam.apply({ zoom: c.zoom.min });
        if (c.exposureCompensation) cam.apply({ exposureCompensation: 0 });
        layout();
      }
      lastTap = performance.now();
    }
    if (!pts.size) start = null;
  };
  frame.addEventListener('pointerup', end);
  frame.addEventListener('pointercancel', end);
}

// ---------- capture ----------

let audio;
function click() {
  if (!S.sound) return;
  audio ||= new AudioContext();
  const n = audio.createBuffer(1, 2400, 48000), d = n.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 6) * (i < 300 || i > 1200 ? 1 : 0.3);
  const s = audio.createBufferSource();
  s.buffer = n;
  s.connect(audio.destination);
  s.start();
}

function blink(white) {
  const b = $('#blink');
  b.classList.toggle('white', !!white);
  b.classList.remove('go');
  void b.offsetWidth;
  b.classList.add('go');
}

async function ensureRoll(id, meta = {}) {
  if (knownRolls.has(id)) return;
  knownRolls.add(id);
  await putRoll({ id, t: Date.now(), ...meta });
}

const dayRoll = () => 'day-' + new Date().toLocaleDateString('en-CA');

async function withFlash(fn) {
  const c = cam.caps();
  if (S.flash !== 'on') return fn();
  if (isFront()) {
    document.body.style.background = '#fff';
    $('#cam').style.opacity = 0;
    await sleep(250);
    try { return await fn(); } finally { $('#cam').style.opacity = ''; document.body.style.background = ''; }
  }
  if (!c.torch) return fn();
  await cam.apply({ torch: true });
  await sleep(350);
  try { return await fn(); } finally { cam.apply({ torch: false }); }
}

const MAX_INFLIGHT = 3;

async function capture(roll, meta) {
  const vw = video.videoWidth, vh = video.videoHeight;
  if (!vw || inflight >= MAX_INFLIGHT) return false;
  inflight++;
  try {
    const r = captureRect(vw, vh);
    const bmp = await createImageBitmap(video, Math.round(r.sx), Math.round(r.sy), Math.round(r.sw), Math.round(r.sh));
    click();
    blink();
    const recipe = { ...newRecipe(S.cam, S.fx), exposure: swEv };
    const { width: w, height: h } = bmp, mirror = mirrored();
    const thumbDone = makeThumb(bmp, w, h, recipe, mirror); // draws synchronously, before bmp is handed off
    const [raw, thumb] = await Promise.all([encodeBitmap(bmp, S.quality, mirror), thumbDone]);
    const shot = { id: newId(), roll, t: Date.now(), w, h, recipe, thumb };
    await ensureRoll(roll, meta);
    await addShot(shot, raw);
    setLast(thumb);
    return true;
  } catch (e) {
    toast('Could not save that photo: ' + e.message);
    return false;
  } finally {
    inflight--;
  }
}

let lastUrl;
function setLast(blob) {
  if (lastUrl) URL.revokeObjectURL(lastUrl);
  lastUrl = blob ? URL.createObjectURL(blob) : '';
  $('#lastImg').src = lastUrl;
  $('#lastImg').hidden = !blob;
}

async function photo() {
  if (S.timer) {
    const cd = $('#countdown');
    for (let i = S.timer; i > 0; i--) { cd.textContent = i; await sleep(1000); }
    cd.textContent = '';
  }
  await withFlash(() => capture(dayRoll(), { kind: 'day' }));
  refreshStorage();
  navigator.storage?.persist?.();
}

function wireShutter() {
  let hold = 0, bursting = false, burstRoll;
  shutter.addEventListener('pointerdown', () => {
    if (S.mode !== 'photo') return;
    hold = setTimeout(async () => {
      bursting = true;
      burstRoll = 'burst-' + Date.now();
      while (bursting) { capture(burstRoll, { kind: 'burst' }); await sleep(120); }
    }, 350);
  });
  const up = () => { clearTimeout(hold); if (bursting) { bursting = false; refreshStorage(); return true; } };
  shutter.addEventListener('pointerup', (e) => { if (up()) e.preventDefault(); else if (S.mode === 'photo') photo(); });
  shutter.addEventListener('pointerleave', up);
  shutter.addEventListener('click', (e) => {
    if (S.mode === 'interval') run ? stopRun() : startRun();
    else if (e.detail === 0) photo(); // keyboard
  });
}

// ---------- interval ----------

function intervalPlan() {
  const iv = S.interval, everyMs = EVERY[iv.every];
  const total = totalShots({
    everyMs,
    count: iv.stopKind === 'shots' ? STOP_SHOTS[iv.shots] : Infinity,
    durationMs: iv.stopKind === 'time' ? STOP_TIME[iv.time] : Infinity,
  });
  return { everyMs, total, delayMs: DELAY[iv.delay] };
}

function updateInterval() {
  const iv = S.interval, p = intervalPlan();
  $('#ivEvery').textContent = everyLabel(p.everyMs);
  $('#ivStopKind').textContent = 'stop';
  $('#ivStop').textContent = iv.stopKind === 'time' ? 'after ' + fmtDuration(STOP_TIME[iv.time]) : iv.stopKind === 'shots' ? `after ${STOP_SHOTS[iv.shots]} shots` : 'when I tap stop';
  $('#ivDelay').textContent = p.delayMs ? fmtDuration(p.delayMs) : 'none';
  $('#ivMode').textContent = iv.mode === 'app' ? 'in app, with looks' : 'full quality, via Shortcuts';
  const sum = $('#ivSum');
  if (iv.mode === 'shortcut') {
    sum.textContent = p.everyMs < 1000 ? 'Shortcuts can shoot at most once a second'
      : !isFinite(p.total) ? 'Shortcuts runs need a time or shot limit'
      : `${p.total} full-quality shots, saved straight to Photos`;
    return;
  }
  const per = bytesPerShot();
  if (!isFinite(p.total)) { sum.textContent = `runs until you stop it · about ${fmtBytes((per * 60000) / p.everyMs)} a minute`; return; }
  const size = per * p.total;
  sum.textContent = `${p.total} shots over ${fmtDuration(p.total * p.everyMs)} · about ${fmtBytes(size)}` + (size > storageFree ? ' · not enough space' : '');
}

function wireInterval() {
  const lists = { every: EVERY, delay: DELAY };
  $$('#ivl .stp').forEach((b) => b.addEventListener('click', () => {
    const iv = S.interval, d = +b.dataset.d;
    let key = b.dataset.k, list = lists[key];
    if (key === 'stop') {
      if (iv.stopKind === 'manual') return;
      key = iv.stopKind; list = iv.stopKind === 'time' ? STOP_TIME : STOP_SHOTS;
    }
    // "every" list runs slow->fast in ms order reversed: › means faster
    const dir = key === 'every' ? -d : d;
    iv[key] = Math.min(list.length - 1, Math.max(0, iv[key] + dir));
    save(); updateInterval();
  }));
  $('#ivStopKind').onclick = () => {
    const k = ['time', 'shots', 'manual'];
    S.interval.stopKind = k[(k.indexOf(S.interval.stopKind) + 1) % 3];
    save(); updateInterval();
  };
  $('#ivMode').onclick = () => {
    S.interval.mode = S.interval.mode === 'app' ? 'shortcut' : 'app';
    save(); updateInterval();
    if (S.interval.mode === 'shortcut') toast(`Needs the "${SHORTCUT_NAME}" shortcut. Setup steps are in Settings.`, 3500);
  };
}

function setMode(m) {
  if (run) return;
  S.mode = m; save();
  $$('#modes button').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  $('#ivl').hidden = m !== 'interval';
  shutter.classList.toggle('ivl', m === 'interval');
  shutter.setAttribute('aria-label', m === 'interval' ? 'Start interval' : 'Take photo');
  updateInterval();
  requestAnimationFrame(layout);
}

async function lockWake() {
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch { wakeLock = null; }
}

async function startRun() {
  const p = intervalPlan();
  if (S.interval.mode === 'shortcut') return launchShortcut(p);
  if (!video.videoWidth) return toast('The camera is not running');
  runRoll = 'ivl-' + Date.now();
  run = newRun(p, performance.now());
  run.taken = 0;
  run.meta = { kind: 'interval', every: p.everyMs };
  lockWake();
  $('#hud').hidden = false;
  $('#modes').style.visibility = 'hidden';
  $('#ivl').hidden = true;
  shutter.classList.add('stop');
  shutter.setAttribute('aria-label', 'Stop interval');
  hudTimer = setInterval(hud, 500);
  tick();
}

function tick() {
  if (!run) return;
  const r = step(run, performance.now(), inflight >= MAX_INFLIGHT);
  if (r.shoot !== undefined) {
    const mine = run, roll = runRoll;
    withFlash(() => capture(roll, mine.meta)).then((ok) => { if (ok) mine.taken++; hud(); });
  }
  hud();
  if (r.done) return stopRun();
  runTimer = setTimeout(tick, Math.max(0, r.wait));
}

function hud() {
  if (!run) return;
  const now = performance.now(), fin = isFinite(run.total);
  const count = String(run.taken).padStart(3, '0') + (fin ? ' / ' + run.total : '');
  $('#hudCount').textContent = count;
  $('#dimCount').textContent = count;
  $('#hudLeft').textContent = now < run.firstAt ? `starts in ${Math.ceil((run.firstAt - now) / 1000)} s`
    : fin ? fmtDuration(Math.max(0, run.firstAt + (run.total - 1) * run.everyMs - now)) + ' left'
    : fmtDuration(now - run.firstAt);
  $('#hudMissed').textContent = run.missed ? `missed ${run.missed}` : '';
  $('#hudBar').style.width = fin ? (100 * run.next) / run.total + '%' : '100%';
}

async function stopRun() {
  if (!run) return;
  const done = run;
  run = null;
  clearTimeout(runTimer);
  clearInterval(hudTimer);
  while (inflight) await sleep(50);
  $('#hud').hidden = true;
  $('#modes').style.visibility = '';
  $('#dim').hidden = true;
  paused = false;
  shutter.classList.remove('stop');
  setMode(S.mode);
  wakeLock?.release?.();
  wakeLock = null;
  refreshStorage();
  toast(`Roll saved: ${done.taken} shots` + (done.missed ? `, ${done.missed} missed` : ''));
}

function launchShortcut(p) {
  if (p.everyMs < 1000) return toast('Shortcuts can shoot at most once a second. Pick a slower rate.');
  if (!isFinite(p.total)) return toast('Set a time or shot limit for Shortcuts runs.');
  const input = JSON.stringify({ every: p.everyMs / 1000, count: p.total, delay: p.delayMs / 1000 });
  location.href = `shortcuts://run-shortcut?name=${encodeURIComponent(SHORTCUT_NAME)}&input=text&text=${encodeURIComponent(input)}`;
}

// ---------- sheets ----------

function updateLook() {
  const c = camera(S.cam);
  $('#lookName').textContent = c.name;
  const img = $('#lookImg');
  if (c.id === 'digital') img.removeAttribute('src'); else img.src = `cameras/${c.id}.jpg`;
}

function openLookSheet() {
  const grid = $('#camGrid');
  grid.innerHTML = '';
  for (const c of CAMERAS) {
    const card = cameraCard(c, c.id === S.cam);
    card.onclick = () => {
      S.cam = c.id; S.fx = fxFor(c.id); save();
      $$('.cam-card', grid).forEach((x) => x.classList.toggle('on', x === card));
      updateLook(); buildFx(); layout();
    };
    grid.append(card);
  }
  buildFx();
  sheet('lookSheet');
}

function buildFx() {
  const box = $('#camFx'), pct = (v) => Math.round(v * 100) + '%';
  box.innerHTML = '';
  for (const [k, label] of [['grain', 'Grain'], ['vignette', 'Vignette'], ['halation', 'Halation'], ['leak', 'Light leak'], ['dust', 'Dust']]) {
    box.append(slider(label, S.fx, k, 0, 1, 0.01, save, pct));
  }
  box.append(toggle('Date imprint', S.fx, 'date', save));
}

function seg(label, options, value, onPick) {
  const row = el(`<div class="opt-row"><span class="k">${label}</span><span class="seg"></span></div>`);
  for (const [text, v] of options) {
    const b = el(`<button class="${v === value ? 'on' : ''}">${text}</button>`);
    b.onclick = () => { $$('button', row).forEach((x) => x.classList.toggle('on', x === b)); onPick(v); };
    $('.seg', row).append(b);
  }
  return row;
}

async function openSettings() {
  const body = $('#setBody');
  body.innerHTML = '';
  const restart = () => { save(); startCamera(); };
  body.append(
    seg('Resolution', cam.RESOLUTIONS.map((r) => [r.label, r.id]), S.res, (v) => { S.res = v; restart(); }),
    seg('Aspect', ASPECTS, S.aspect, (v) => { S.aspect = v; save(); layout(); }),
    seg('Grid', [['off', 'off'], ['thirds', 'thirds'], ['4×4', '4x4'], ['golden', 'golden'], ['square', 'square']], S.grid, (v) => { S.grid = v; save(); layout(); }),
    seg('JPEG', [['small', 0.8], ['high', 0.92], ['max', 0.98]], S.quality, (v) => { S.quality = v; save(); updateReadout(); }),
  );
  const t = cam.current();
  body.append(el(`<p class="note mono">Camera is giving ${t.width || '?'}×${t.height || '?'} at ${Math.round(t.frameRate || 0) || '?'} fps. Safari only offers the video feed, so this is the most a web app can capture.</p>`));
  const tog = (label, key, fn) => body.append(toggle(label, S, key, () => { save(); fn?.(); }));
  tog('Level', 'level', () => setLevel(S.level));
  tog('Histogram', 'histo', () => { $('#histo').hidden = !S.histo; });
  tog('Mirror front camera', 'mirror');
  tog('Shutter sound', 'sound');
  const e = await navigator.storage?.estimate?.().catch(() => null);
  const shots = (await allShots()).length;
  body.append(el(`<p class="note mono">${shots} photos · ${e ? fmtBytes(e.usage) + ' used · ' + fmtBytes(e.quota - e.usage) + ' free' : ''}</p>`));
  body.append(
    el(`<a class="set-link" href="${REPO}#full-quality-intervals-with-shortcuts" target="_blank" rel="noopener">Set up the full-quality shortcut</a>`),
    el(`<a class="set-link" href="${REPO}#install-on-iphone" target="_blank" rel="noopener">Install on iPhone</a>`),
    el(`<a class="set-link" href="${REPO}/blob/main/CREDITS.md" target="_blank" rel="noopener">Camera photo credits</a>`),
  );
  sheet('setSheet');
}

// ---------- startup ----------

function cycle(key, values) {
  S[key] = values[(values.indexOf(S[key]) + 1) % values.length];
  save();
}
function syncTopTags() {
  $('#flashTag').textContent = S.flash;
  $('#flashBtn').classList.toggle('on', S.flash !== 'off');
  $('#timerTag').textContent = S.timer ? S.timer + 's' : 'off';
  $('#timerBtn').classList.toggle('on', !!S.timer);
}

function wire() {
  $('#flashBtn').onclick = () => {
    const opts = isFront() || !cam.caps().torch ? ['off', 'on'] : ['off', 'on', 'torch'];
    cycle('flash', opts);
    if (cam.caps().torch) cam.apply({ torch: S.flash === 'torch' });
    syncTopTags();
  };
  $('#timerBtn').onclick = () => { cycle('timer', [0, 3, 10]); syncTopTags(); };
  $('#lookBtn').onclick = openLookSheet;
  $('#setBtn').onclick = openSettings;
  $('#flipBtn').onclick = () => {
    if (run) return;
    const front = lensList.find((l) => l.kind === 'front');
    if (isFront()) { S.facing = 'environment'; S.deviceId = lensList.find((l) => l.kind === 'wide')?.id || null; }
    else { S.facing = 'user'; S.deviceId = front?.id || null; }
    save(); startCamera();
  };
  $('#retryBtn').onclick = startCamera;
  $('#demoBtn').onclick = () => { useDemo = true; startCamera(); };
  $$('#modes button').forEach((b) => (b.onclick = () => setMode(b.dataset.mode)));
  $('#galBtn').onclick = () => { if (run) return toast('Stop the run to open your photos'); paused = true; openGallery(); };
  $('#dimBtn').onclick = () => { $('#dim').hidden = false; paused = true; };
  $('#dim').onclick = () => { $('#dim').hidden = true; paused = false; };
  addEventListener('resize', () => requestAnimationFrame(layout));
  video.addEventListener('loadedmetadata', layout);
  document.addEventListener('visibilitychange', async () => {
    if (document.hidden) return;
    if (wakeLock || run) lockWake();
    if (cam.track()?.readyState !== 'live') {
      await startCamera();
      if (run) toast('The camera stops while the app is in the background. Those shots are counted as missed.', 4000);
    }
  });
  wireShutter();
  wireInterval();
  wireGestures();
}

async function boot() {
  try {
    preview = new Renderer(previewCanvas);
  } catch (e) {
    $('#vfMsgText').textContent = 'This browser cannot run the viewfinder (' + e.message + ').';
    $('#vfMsg').hidden = false;
    return;
  }
  wire();
  syncTopTags();
  updateLook();
  setMode(S.mode);
  $('#histo').hidden = !S.histo;
  $('#level').hidden = true;
  if (S.level) document.addEventListener('pointerdown', () => setLevel(true), { once: true });
  initGallery({ onClose: () => { paused = false; refreshLast(); refreshStorage(); } });
  (await allRolls()).forEach((r) => knownRolls.add(r.id));
  refreshLast();
  refreshStorage();
  await startCamera();
  loop();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js');
}

async function refreshLast() {
  const shots = await allShots();
  const last = shots.reduce((a, b) => (!a || b.t > a.t ? b : a), null);
  setLast(last?.thumb);
}

boot();
