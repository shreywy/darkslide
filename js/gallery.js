import { $, $$, el, toast, sheet, slider, toggle } from './dom.js';
import { CAMERAS, camera, fxFor, newRecipe, cameraCard } from './looks.js';
import { offscreen, compose, makeThumb, toJpeg, renderShot, plan } from './render.js';
import { allShots, allRolls, getRaw, putShots, deleteShots, deleteRolls, addShot, putRoll, newId } from './store.js';
import { everyLabel } from './interval.js';
import { Muxer, ArrayBufferTarget } from './vendor/mp4-muxer.mjs';

const BATCH = 20; // files per share sheet; bigger batches run iOS out of memory
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let shots = [], byId = new Map(), rolls = new Map(), order = [], urls = [];
let selecting = false;
const selected = new Set();
let onClose = () => {};

export function initGallery(opts) {
  onClose = opts.onClose;
  wireGallery();
  wireViewer();
}

export async function openGallery() {
  $('#gallery').hidden = false;
  await load();
}

function closeGallery() {
  $('#gallery').hidden = true;
  exitSelect();
  urls.forEach(URL.revokeObjectURL);
  urls = [];
  $('#rolls').innerHTML = '';
  onClose();
}

async function load() {
  shots = (await allShots()).sort((a, b) => b.t - a.t);
  byId = new Map(shots.map((s) => [s.id, s]));
  rolls = new Map((await allRolls()).map((r) => [r.id, r]));
  render();
}

function rollTitle(id, list) {
  const r = rolls.get(id) || {}, d = new Date(list[list.length - 1].t);
  const day = d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
  const time = d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
  const n = list.length + (list.length === 1 ? ' photo' : ' photos');
  if (r.kind === 'interval') return [`Interval, ${day} ${time}`, `${n} · ${everyLabel(r.every)}`];
  if (r.kind === 'burst') return [`Burst, ${day} ${time}`, n];
  if (r.kind === 'import') return [`Imported ${day}`, n];
  return [d.toLocaleDateString(undefined, { weekday: 'long', day: 'numeric', month: 'long' }), n];
}

function render() {
  urls.forEach(URL.revokeObjectURL);
  urls = [];
  order = [];
  const box = $('#rolls');
  box.innerHTML = '';
  if (!shots.length) {
    box.innerHTML = '<div class="empty"><b>No photos yet</b>Photos you take or import show up here, grouped by roll.</div>';
    return;
  }
  const groups = new Map();
  for (const s of shots) {
    if (!groups.has(s.roll)) groups.set(s.roll, []);
    groups.get(s.roll).push(s);
  }
  for (const [id, list] of groups) {
    const [t, m] = rollTitle(id, list);
    const head = el(`<div class="roll-head"><div><div class="t">${t}</div><div class="m">${m}</div></div><button>select roll</button></div>`);
    $('button', head).onclick = () => { startSelect(); list.forEach((s) => selected.add(s.id)); syncSel(); };
    const grid = el('<div class="thumbs"></div>');
    for (const s of [...list].reverse()) {
      order.push(s.id);
      const url = URL.createObjectURL(s.thumb);
      urls.push(url);
      const b = el(`<button class="thumb" data-id="${s.id}" aria-label="Photo"><img src="${url}" alt="" loading="lazy" decoding="async"></button>`);
      b.onclick = () => (selecting ? toggleSel(s.id) : openViewer(s.id));
      grid.append(b);
    }
    box.append(head, grid);
  }
  syncSel();
}

// ---------- selection ----------

function startSelect() {
  selecting = true;
  $('#galSelect').textContent = 'Cancel';
  $('#selbar').hidden = false;
}
function exitSelect() {
  selecting = false;
  selected.clear();
  $('#galSelect').textContent = 'Select';
  $('#selbar').hidden = true;
  syncSel();
}
function toggleSel(id) {
  selected.has(id) ? selected.delete(id) : selected.add(id);
  syncSel();
}
function syncSel() {
  $$('.thumb').forEach((t) => t.classList.toggle('sel', selected.has(t.dataset.id)));
  $('#selCount').textContent = `${selected.size} selected`;
}
const needSel = (fn) => () => (selected.size ? fn([...selected]) : toast('Select some photos first'));

function wireGallery() {
  $('#galClose').onclick = closeGallery;
  $('#galSelect').onclick = () => (selecting ? exitSelect() : startSelect());
  $('#galImport').onclick = () => $('#importInput').click();
  $('#importInput').onchange = importFiles;
  $('#selSave').onclick = needSel(saveToPhotos);
  $('#selTl').onclick = needSel(timelapse);
  $('#selDel').onclick = needSel(async (ids) => {
    if (!confirm(`Delete ${ids.length} photo${ids.length > 1 ? 's' : ''}? This can't be undone.`)) return;
    await remove(ids);
    exitSelect();
  });
  $('#selLook').onclick = needSel((ids) => {
    const grid = $('#pickGrid');
    grid.innerHTML = '';
    for (const c of CAMERAS) {
      const card = cameraCard(c, false);
      card.onclick = async () => {
        $('#pickSheet').close();
        const list = ids.map((id) => byId.get(id));
        list.forEach((s) => Object.assign(s.recipe, fxFor(c.id), { cam: c.id }));
        await rethumb(list);
        exitSelect();
        render();
      };
      grid.append(card);
    }
    sheet('pickSheet');
  });
}

async function remove(ids) {
  await deleteShots(ids);
  const gone = new Set(ids);
  shots = shots.filter((s) => !gone.has(s.id));
  ids.forEach((id) => byId.delete(id));
  const used = new Set(shots.map((s) => s.roll));
  await deleteRolls([...rolls.keys()].filter((r) => !used.has(r)));
  render();
}

async function rethumb(list) {
  for (const [i, s] of list.entries()) {
    if (list.length > 3) toast(`Updating ${i + 1} of ${list.length}`);
    const bmp = await createImageBitmap(await getRaw(s.id));
    s.thumb = await makeThumb(bmp, bmp.width, bmp.height, s.recipe);
    bmp.close();
  }
  await putShots(list);
}

async function importFiles(e) {
  const files = [...e.target.files];
  e.target.value = '';
  if (!files.length) return;
  const roll = 'imp-' + Date.now();
  await putRoll({ id: roll, t: Date.now(), kind: 'import' });
  rolls.set(roll, { id: roll, kind: 'import' });
  for (const [i, f] of files.entries()) {
    toast(`Importing ${i + 1} of ${files.length}`);
    try {
      // An <img> applies EXIF rotation when drawn, so the stored raw comes out upright.
      const url = URL.createObjectURL(f);
      const img = new Image();
      img.src = url;
      await img.decode();
      URL.revokeObjectURL(url);
      const c = Object.assign(document.createElement('canvas'), { width: img.naturalWidth, height: img.naturalHeight });
      c.getContext('2d').drawImage(img, 0, 0);
      const recipe = newRecipe('digital');
      const [raw, thumb] = await Promise.all([toJpeg(c, 0.95), makeThumb(c, c.width, c.height, recipe)]);
      await addShot({ id: newId(), roll, t: f.lastModified || Date.now(), w: c.width, h: c.height, recipe, thumb }, raw);
    } catch {
      toast(`Skipped ${f.name}, it couldn't be read`);
    }
  }
  toast(`Imported ${files.length} photo${files.length > 1 ? 's' : ''}`);
  load();
}

// ---------- saving ----------

const stamp = (t) => {
  const d = new Date(t), p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
};

function progress(text, frac) {
  $('#saveStatus').textContent = text;
  $('#saveBar').style.width = Math.round(frac * 100) + '%';
}

// Safari needs a fresh tap to open the share sheet, so each batch gets its own button.
function shareStep(files, label) {
  const go = $('#saveGo');
  go.hidden = false;
  go.textContent = label;
  return new Promise((resolve) => {
    go.onclick = async () => {
      go.hidden = true;
      try {
        if (navigator.canShare?.({ files })) await navigator.share({ files });
        else download(files);
      } catch (e) {
        if (e.name !== 'AbortError') toast(e.message);
      }
      resolve();
    };
  });
}

function download(files) {
  for (const f of files) {
    const a = el(`<a download="${f.name}"></a>`);
    a.href = URL.createObjectURL(f);
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10000);
  }
}

async function saveToPhotos(ids) {
  const d = sheet('saveSheet');
  $('#saveTitle').textContent = 'Save to Photos';
  $('#saveNote').hidden = false;
  $('#saveGo').hidden = true;
  const list = ids.map((id) => byId.get(id)).sort((a, b) => a.t - b.t);
  const R = offscreen();
  for (let i = 0; i < list.length; i += BATCH) {
    const files = [];
    for (const [j, s] of list.slice(i, i + BATCH).entries()) {
      if (!d.open) return;
      progress(`Preparing ${i + j + 1} of ${list.length}`, (i + j) / list.length);
      const c = await renderShot(R, await getRaw(s.id), s);
      const blob = await toJpeg(c, camera(s.recipe.cam).q || 0.92);
      files.push(new File([blob], `darkslide-${stamp(s.t)}-${s.id.slice(-2)}.jpg`, { type: 'image/jpeg', lastModified: s.t }));
    }
    const part = list.length > BATCH ? ` (${i / BATCH + 1} of ${Math.ceil(list.length / BATCH)})` : '';
    progress(`${files.length} ready${part}`, Math.min(1, (i + files.length) / list.length));
    await shareStep(files, `Save ${files.length} photo${files.length > 1 ? 's' : ''}${part}`);
    if (!d.open) return;
  }
  d.close();
}

// ---------- timelapse ----------

async function timelapse(ids) {
  if (!('VideoEncoder' in window)) return toast("This browser can't encode video. Safari 16.4 or newer can.");
  const list = ids.map((id) => byId.get(id)).sort((a, b) => a.t - b.t);
  if (list.length < 2) return toast('Pick at least two photos');
  const d = sheet('tlSheet');
  const opt = { fps: 24, size: 1080 };
  const info = () => ($('#tlInfo').textContent = `${list.length} frames · ${(list.length / opt.fps).toFixed(1)} s long`);
  for (const [id, key] of [['#tlFps', 'fps'], ['#tlSize', 'size']]) {
    $$(id + ' button').forEach((b) => {
      b.classList.toggle('on', +b.dataset.v === opt[key]);
      b.onclick = () => { opt[key] = +b.dataset.v; $$(id + ' button').forEach((x) => x.classList.toggle('on', x === b)); info(); };
    });
  }
  info();
  $('#tlGo').onclick = async () => {
    d.close();
    try {
      await encode(list, opt);
    } catch (e) {
      $('#saveSheet').close();
      toast('Video failed: ' + e.message, 4000);
    }
  };
}

async function encode(list, { fps, size }) {
  const d = sheet('saveSheet');
  $('#saveTitle').textContent = 'Timelapse';
  $('#saveNote').hidden = true;
  $('#saveGo').hidden = true;
  const P = plan(list[0].w, list[0].h, list[0].recipe);
  const k = Math.min(1, size / Math.min(P.cw, P.ch)); // size is the short edge, like 1080p
  const W = Math.round((P.cw * k) / 2) * 2, H = Math.round((P.ch * k) / 2) * 2;
  let config;
  for (const codec of ['avc1.640034', 'avc1.4d0034', 'avc1.42003e']) {
    const c = { codec, width: W, height: H, bitrate: Math.round(W * H * fps * 0.12), framerate: fps };
    if ((await VideoEncoder.isConfigSupported(c)).supported) { config = c; break; }
  }
  if (!config) throw new Error(`no H.264 encoder for ${W}×${H}`);
  const muxer = new Muxer({ target: new ArrayBufferTarget(), video: { codec: 'avc', width: W, height: H, frameRate: fps }, fastStart: 'in-memory' });
  let failed;
  const enc = new VideoEncoder({ output: (chunk, meta) => muxer.addVideoChunk(chunk, meta), error: (e) => (failed = e) });
  enc.configure(config);
  const out = Object.assign(document.createElement('canvas'), { width: W, height: H });
  const x = out.getContext('2d');
  const R = offscreen();
  for (const [i, s] of list.entries()) {
    if (!d.open) { enc.close(); return; }
    if (failed) throw failed;
    progress(`Rendering frame ${i + 1} of ${list.length}`, i / list.length);
    const c = await renderShot(R, await getRaw(s.id), s, { maxLong: Math.max(W, H), frame: false });
    const sc = Math.max(W / c.width, H / c.height); // cover, in case a frame has a different shape
    x.fillRect(0, 0, W, H);
    x.drawImage(c, (W - c.width * sc) / 2, (H - c.height * sc) / 2, c.width * sc, c.height * sc);
    const frame = new VideoFrame(out, { timestamp: Math.round((i * 1e6) / fps), duration: Math.round(1e6 / fps) });
    enc.encode(frame, { keyFrame: i % (fps * 2) === 0 });
    frame.close();
    while (enc.encodeQueueSize > 3) await sleep(5);
  }
  await enc.flush();
  muxer.finalize();
  const file = new File([muxer.target.buffer], `darkslide-${stamp(list[0].t)}.mp4`, { type: 'video/mp4' });
  progress(`${W}×${H}, ${(list.length / fps).toFixed(1)} s`, 1);
  $('#saveNote').hidden = false;
  $('#saveNote').textContent = 'In the share sheet, pick “Save Video” to put it in your camera roll.';
  await shareStep([file], 'Save video');
  d.close();
  $('#saveNote').textContent = 'In the share sheet, pick “Save Images” to put them in your camera roll.';
}

// ---------- viewer and editor ----------

let idx = 0, src = null, editing = null, drawQueued = false;
const cur = () => byId.get(order[idx]);

async function openViewer(id) {
  idx = order.indexOf(id);
  $('#viewer').hidden = false;
  await show();
}

function closeViewer() {
  if (editing) finishEdit();
  $('#viewer').hidden = true;
  $('#stage').innerHTML = '';
  src = null;
}

async function show() {
  const s = cur();
  if (!s) return closeViewer();
  const d = new Date(s.t);
  $('#vwInfo').textContent = `${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })} ${d.toLocaleTimeString()} · ${camera(s.recipe.cam).name}`;
  $('#vwIdx').textContent = `${idx + 1} / ${order.length}`;
  // decode once, scaled to the screen, so slider edits redraw quickly
  const bmp = await createImageBitmap(await getRaw(s.id));
  const long = Math.min(2400, Math.max(innerWidth, innerHeight) * Math.min(devicePixelRatio || 1, 2));
  const k = Math.min(1, long / Math.max(bmp.width, bmp.height));
  src = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) });
  src.getContext('2d').drawImage(bmp, 0, 0, src.width, src.height);
  bmp.close();
  draw();
}

function draw() {
  if (drawQueued || !src) return;
  drawQueued = true;
  requestAnimationFrame(() => {
    drawQueued = false;
    const s = cur(), recipe = editing || s.recipe;
    const R = offscreen();
    R.draw(src, src.width, src.height, recipe);
    $('#stage').replaceChildren(compose(R.canvas, recipe, { date: new Date(s.t) }));
  });
}

function go(d) {
  if (editing) return;
  const n = idx + d;
  if (n < 0 || n >= order.length) return;
  idx = n;
  show();
}

function wireViewer() {
  $('#vwClose').onclick = closeViewer;
  $('#vwSave').onclick = () => saveToPhotos([cur().id]);
  $('#vwDel').onclick = async () => {
    if (!confirm("Delete this photo? This can't be undone.")) return;
    const id = cur().id;
    await remove([id]);
    if (!order.length) return closeViewer();
    idx = Math.min(idx, order.length - 1);
    show();
  };
  $('#vwEdit').onclick = startEdit;
  $('#edDone').onclick = finishEdit;
  $('#edReset').onclick = () => {
    editing = { ...newRecipe(editing.cam), seed: editing.seed };
    buildEditor();
    draw();
  };
  $('#edRoll').onclick = async () => {
    const s = cur(), same = shots.filter((x) => x.roll === s.roll && x.id !== s.id);
    if (!confirm(`Apply this camera and these settings to the other ${same.length} photos in the roll? Crop and rotation stay as they are.`)) return;
    const { rotate, straighten, crop, seed, ...look } = editing;
    same.forEach((x) => Object.assign(x.recipe, look));
    await rethumb(same);
    toast('Applied to the roll');
  };
  $$('#edTabs button').forEach((b) => (b.onclick = () => tab(b.dataset.tab)));
  addEventListener('keydown', (e) => {
    if ($('#viewer').hidden) return;
    if (e.key === 'ArrowRight') go(1);
    if (e.key === 'ArrowLeft') go(-1);
    if (e.key === 'Escape' && !editing) closeViewer();
  });
  let x0 = null;
  const stage = $('#stage');
  stage.addEventListener('pointerdown', (e) => (x0 = e.clientX));
  stage.addEventListener('pointerup', (e) => {
    if (x0 == null) return;
    const dx = e.clientX - x0;
    x0 = null;
    if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
  });
}

function tab(name) {
  $$('#edTabs button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name));
  $$('#editor .pane').forEach((p) => p.classList.toggle('on', p.dataset.pane === name));
}

function startEdit() {
  editing = structuredClone(cur().recipe);
  $('#editor').hidden = false;
  $('#vwBar').hidden = true;
  buildEditor();
  tab('camera');
}

async function finishEdit() {
  const s = cur();
  s.recipe = editing;
  editing = null;
  $('#editor').hidden = true;
  $('#vwBar').hidden = false;
  $('#vwInfo').textContent = $('#vwInfo').textContent.replace(/· .*$/, '· ' + camera(s.recipe.cam).name);
  await rethumb([s]);
  const img = $(`.thumb[data-id="${s.id}"] img`);
  if (img) { const u = URL.createObjectURL(s.thumb); urls.push(u); img.src = u; }
}

function buildEditor() {
  const r = editing, pct = (v) => Math.round(v * 100) + '%', signed = (v) => (v > 0 ? '+' : '') + Math.round(v * 100);

  const strip = $('#edCams');
  strip.innerHTML = '';
  for (const c of CAMERAS) {
    const card = cameraCard(c, c.id === r.cam);
    card.onclick = () => {
      Object.assign(r, fxFor(c.id), { cam: c.id });
      $$('.cam-card', strip).forEach((x) => x.classList.toggle('on', x === card));
      buildEffects();
      draw();
    };
    strip.append(card);
  }
  strip.querySelector('.on')?.scrollIntoView({ inline: 'center', block: 'nearest' });

  const adj = $('#edAdjust');
  adj.innerHTML = '';
  adj.append(slider('Exposure', r, 'exposure', -2, 2, 0.05, draw, (v) => (v > 0 ? '+' : '') + v.toFixed(1)));
  for (const [k, l] of [['contrast', 'Contrast'], ['saturation', 'Saturation'], ['warmth', 'Warmth']]) adj.append(slider(l, r, k, -1, 1, 0.01, draw, signed));
  adj.append(slider('Fade', r, 'fade', 0, 1, 0.01, draw, pct));

  buildEffects();

  const crop = $('#edCrop');
  crop.innerHTML = '';
  const rot = el('<div class="crop-row"><button><svg style="width:16px;height:16px;vertical-align:-3px;transform:scaleX(-1)"><use href="#i-rotate"/></svg> rotate</button></div>');
  $('button', rot).onclick = () => { r.rotate = ((r.rotate || 0) + 90) % 360; draw(); };
  const chips = el('<div class="crop-row"></div>');
  for (const [label, v] of [['camera', null], ['1:1', 1], ['4:3', 4 / 3], ['3:2', 3 / 2], ['16:9', 16 / 9], ['5:4', 5 / 4]]) {
    const b = el(`<button class="${r.crop === v ? 'on' : ''}">${label}</button>`);
    b.onclick = () => { r.crop = v; $$('button', chips).forEach((x) => x.classList.toggle('on', x === b)); draw(); };
    chips.append(b);
  }
  crop.append(rot, chips, slider('Straighten', r, 'straighten', -15, 15, 0.1, draw, (v) => v.toFixed(1) + '°'));
}

function buildEffects() {
  const r = editing, pct = (v) => Math.round(v * 100) + '%';
  const fx = $('#edFx');
  fx.innerHTML = '';
  for (const [k, l] of [['grain', 'Grain'], ['vignette', 'Vignette'], ['halation', 'Halation'], ['leak', 'Light leak'], ['dust', 'Dust']]) {
    fx.append(slider(l, r, k, 0, 1, 0.01, draw, pct));
  }
  fx.append(toggle('Date imprint', r, 'date', draw));
  if (camera(r.cam).frame) fx.append(toggle('Print border', r, 'frame', draw));
  const reseed = el('<div class="crop-row"><button>new grain and leak pattern</button></div>');
  $('button', reseed).onclick = () => { r.seed = Math.random(); draw(); };
  fx.append(reseed);
}
