// Camera looks. `tone` is fixed per camera; `fx` holds the starting values for the
// effect sliders, which the user can change per photo.
//
// tone fields (all optional, 0 = neutral):
//   ev, con, sat, warm      exposure offset, contrast, saturation, warmth
//   lift, gain              rgb black point / white point (split toning)
//   mono, mix               black and white with channel weights
//   cross                   cross-processing strength
//   soft, cornerSoft        blur (negative sharpens), extra blur toward corners
//   chroma                  lateral chromatic aberration
//   grainColor              0 = film grain, 1 = digital colour noise
//   pix, palette            pixel grid and 4-shade palette (Game Boy)
//   leakColor               light leak tint
// output fields: aspect (long/short), frame, out (max long edge), q (JPEG quality)

const FX = { grain: 0, vignette: 0, halation: 0, leak: 0, dust: 0, date: false };

export const CAMERAS = [
  { id: 'digital', name: 'Digital', film: 'No look, straight from the sensor', tone: {}, fx: {} },
  {
    id: 'funsaver', name: 'Kodak FunSaver', film: 'Kodak 800, built-in flash',
    tone: { ev: 0.1, con: 0.25, sat: 0.15, warm: 0.3, lift: [0.06, 0.04, 0.02], gain: [1, 0.97, 0.87], soft: 0.25, chroma: 0.3 },
    fx: { grain: 0.45, vignette: 0.45, halation: 0.3, dust: 0.15, date: true },
  },
  {
    id: 'sx70', name: 'Polaroid SX-70', film: 'SX-70 integral instant film',
    tone: { con: -0.15, sat: -0.2, warm: 0.15, lift: [0.07, 0.11, 0.12], gain: [0.98, 0.93, 0.8], soft: 0.35 },
    aspect: 1, frame: 'sx70',
    fx: { grain: 0.2, vignette: 0.35, halation: 0.2, dust: 0.1 },
  },
  {
    id: 'instax', name: 'Fujifilm Instax Mini 55', film: 'Instax Mini instant film',
    tone: { ev: 0.2, con: -0.05, warm: -0.05, lift: [0.05, 0.06, 0.08], gain: [1, 1, 0.97], soft: 0.15 },
    aspect: 62 / 46, frame: 'instax',
    fx: { grain: 0.1, vignette: 0.2, halation: 0.15 },
  },
  {
    id: 'ixus', name: 'Canon Digital IXUS 70', film: '7.1 MP CCD, 2007',
    tone: { con: 0.2, sat: 0.15, warm: -0.15, gain: [1, 1, 1.03], soft: -0.6, grainColor: 1 },
    out: 3072, q: 0.85,
    fx: { grain: 0.2 },
  },
  {
    id: 'm6', name: 'Leica M6', film: 'Kodak Tri-X 400',
    tone: { mono: 1, mix: [0.3, 0.55, 0.15], con: 0.45, lift: [0.03, 0.03, 0.03], gain: [0.97, 0.97, 0.97] },
    fx: { grain: 0.55, vignette: 0.25 },
  },
  {
    id: 'k1000', name: 'Pentax K1000', film: 'Kodak Gold 200',
    tone: { con: 0.15, sat: 0.2, warm: 0.35, lift: [0.05, 0.04, 0.01], gain: [1, 0.96, 0.84] },
    fx: { grain: 0.3, vignette: 0.2, halation: 0.15, dust: 0.1 },
  },
  {
    id: 'mju2', name: 'Olympus mju-II', film: 'Kodak Portra 400',
    tone: { ev: 0.15, con: -0.05, sat: -0.1, warm: 0.2, lift: [0.05, 0.045, 0.04], gain: [1, 0.97, 0.92] },
    fx: { grain: 0.3, vignette: 0.25, halation: 0.2 },
  },
  {
    id: 'lca', name: 'LOMO LC-A', film: 'Slide film, cross-processed',
    tone: { con: 0.45, sat: 0.3, cross: 0.5, warm: 0.15, lift: [0, 0.02, 0.09], gain: [1, 0.98, 0.84], leakColor: [1, 0.35, 0.1] },
    fx: { grain: 0.35, vignette: 0.8, halation: 0.1, leak: 0.2 },
  },
  {
    id: 'holga', name: 'Holga 120N', film: 'Kodak Portra 160, plastic lens',
    tone: { con: 0.2, sat: 0.1, warm: 0.1, lift: [0.04, 0.03, 0.05], soft: 0.2, cornerSoft: 0.8, chroma: 0.6, leakColor: [1, 0.25, 0.05] },
    aspect: 1,
    fx: { grain: 0.3, vignette: 0.9, leak: 0.5, dust: 0.2 },
  },
  {
    id: 'hassel', name: 'Hasselblad 500 EL', film: 'Kodak Ektachrome 100',
    tone: { con: 0.3, sat: 0.3, warm: -0.15, lift: [0, 0.01, 0.03], gain: [0.98, 1, 1.02], soft: -0.2 },
    aspect: 1,
    fx: { grain: 0.12, vignette: 0.15 },
  },
  {
    id: 'super8', name: 'Canon 514XL-S', film: 'Kodachrome 40, Super 8',
    tone: { con: 0.3, sat: 0.2, warm: 0.3, lift: [0.08, 0.05, 0.04], gain: [1, 0.93, 0.82], soft: 0.45, chroma: 0.4, leakColor: [1, 0.45, 0.15] },
    aspect: 4 / 3, frame: 'super8',
    fx: { grain: 0.7, vignette: 0.5, halation: 0.4, leak: 0.15, dust: 0.5 },
  },
  {
    id: 'gbcam', name: 'Game Boy Camera', film: '128 × 112, four shades of green',
    tone: { mono: 1, mix: [0.3, 0.59, 0.11], ev: -0.35, con: 0.6, pix: [128, 112], palette: 1 },
    aspect: 128 / 112, out: 1024,
    fx: {},
  },
  {
    id: 'mavica', name: 'Sony Mavica FD-100', film: '1.2 MP, saved to floppy disk',
    tone: { con: 0.1, sat: -0.05, warm: -0.1, soft: 0.3, chroma: 0.3, grainColor: 1 },
    out: 1280, q: 0.5,
    fx: { grain: 0.25 },
  },
  {
    id: 'ae1', name: 'Canon AE-1', film: 'Fujicolor Superia 400',
    tone: { con: 0.2, sat: 0.15, warm: -0.05, lift: [0.02, 0.05, 0.04], gain: [0.98, 1, 0.96] },
    fx: { grain: 0.35, vignette: 0.15, halation: 0.15 },
  },
  {
    id: 't2', name: 'Contax T2', film: 'Fujifilm Pro 400H',
    tone: { ev: 0.25, con: -0.1, sat: -0.05, warm: -0.1, lift: [0.04, 0.07, 0.08], gain: [0.99, 1, 1], soft: -0.15 },
    fx: { grain: 0.2, vignette: 0.1, halation: 0.1 },
  },
  {
    id: 'trip', name: 'Olympus Trip 35', film: 'Ilford HP5 Plus',
    tone: { mono: 1, mix: [0.33, 0.5, 0.17], con: 0.1, lift: [0.05, 0.05, 0.05], gain: [0.95, 0.95, 0.95] },
    fx: { grain: 0.45, vignette: 0.3, dust: 0.2 },
  },
];

const BY_ID = Object.fromEntries(CAMERAS.map((c) => [c.id, c]));
export const camera = (id) => BY_ID[id] || BY_ID.digital;

export const fxFor = (id) => ({ ...FX, ...camera(id).fx });

export function newRecipe(cam = 'digital', fx = fxFor(cam)) {
  return {
    cam, exposure: 0, contrast: 0, saturation: 0, warmth: 0, fade: 0,
    ...fx, frame: true, rotate: 0, straighten: 0, crop: null, seed: Math.random(),
  };
}

export function cameraCard(cam, selected) {
  const b = document.createElement('button');
  b.className = 'cam-card' + (selected ? ' on' : '');
  b.dataset.cam = cam.id;
  b.innerHTML = (cam.id === 'digital'
    ? '<span class="cam-photo cam-none">no look</span>'
    : `<img class="cam-photo" src="cameras/${cam.id}.jpg" alt="" loading="lazy">`)
    + `<span class="cam-name">${cam.name}</span><span class="cam-film">${cam.film}</span>`;
  return b;
}

// Pinned cameras live in localStorage and float to the top of every camera list.
const PIN_KEY = 'darkslide.pins';
export function pins() {
  try { return JSON.parse(localStorage.getItem(PIN_KEY)) || []; } catch { return []; }
}
function togglePin(id) {
  const p = pins(), next = p.includes(id) ? p.filter((x) => x !== id) : [...p, id];
  try { localStorage.setItem(PIN_KEY, JSON.stringify(next)); } catch {}
}
export const byPins = () => {
  const p = pins();
  return [...CAMERAS].sort((a, b) => (p.includes(b.id) ? 1 : 0) - (p.includes(a.id) ? 1 : 0));
};

// List of cameras with a pin button on each row. Rebuilds itself when pins change.
export function cameraList(box, selected, onPick) {
  const draw = () => {
    const p = pins(), pinned = CAMERAS.filter((c) => p.includes(c.id)), rest = CAMERAS.filter((c) => !p.includes(c.id));
    box.innerHTML = '';
    box.className = 'cam-list';
    const section = (title, list) => {
      if (!list.length) return;
      box.insertAdjacentHTML('beforeend', `<p class="cam-sec mono">${title}</p>`);
      for (const c of list) {
        const on = p.includes(c.id);
        const row = document.createElement('div');
        row.className = 'cam-row' + (c.id === selected ? ' on' : '');
        row.innerHTML = `<button class="cam-pick">${c.id === 'digital' ? '<span class="cam-thumb cam-none">raw</span>' : `<img class="cam-thumb" src="cameras/${c.id}.jpg" alt="">`}<span class="cam-text"><b>${c.name}</b><small>${c.film}</small></span></button>`
          + `<button class="pin${on ? ' on' : ''}" aria-pressed="${on}" aria-label="${on ? 'Unpin' : 'Pin'} ${c.name}"><svg><use href="#i-star"/></svg></button>`;
        row.firstChild.onclick = () => { selected = c.id; onPick(c.id); draw(); };
        row.lastChild.onclick = () => { togglePin(c.id); draw(); };
        box.append(row);
      }
    };
    section('pinned', pinned);
    section(pinned.length ? 'all cameras' : 'cameras', rest);
  };
  draw();
}
