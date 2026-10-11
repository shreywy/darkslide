export const $ = (s, r = document) => r.querySelector(s);
export const $$ = (s, r = document) => [...r.querySelectorAll(s)];

export function el(html) {
  const t = document.createElement('template');
  t.innerHTML = html.trim();
  return t.content.firstElementChild;
}

// localStorage can throw in private mode; settings just won't persist there.
export const prefs = {
  get(k, d) {
    try {
      const v = localStorage.getItem('darkslide.' + k);
      return v ? { ...d, ...JSON.parse(v) } : d;
    } catch {
      return d;
    }
  },
  set(k, v) {
    try { localStorage.setItem('darkslide.' + k, JSON.stringify(v)); } catch {}
  },
};

let toastTimer;
export function toast(msg, ms = 2400) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove('show'), ms);
}

const motion = () => !matchMedia('(prefers-reduced-motion: reduce)').matches;

// Full-screen panels slide in and out. hidden is only set once the exit animation ends.
export function showScreen(el) {
  clearTimeout(el._t);
  el.hidden = false;
  el.classList.remove('out');
  el.classList.add('in');
  el._t = setTimeout(() => el.classList.remove('in'), 260);
}
export function hideScreen(el) {
  if (el.hidden) return;
  clearTimeout(el._t);
  el.classList.remove('in');
  el.classList.add('out');
  el._t = setTimeout(() => { el.hidden = true; el.classList.remove('out'); }, motion() ? 150 : 0);
}

// <dialog> sheets close when the backdrop is tapped, with a short slide down.
export function closeSheet(d) {
  if (!d.open || d.classList.contains('closing')) return;
  d.classList.add('closing');
  setTimeout(() => { d.classList.remove('closing'); d.close(); }, motion() ? 160 : 0);
}
export function sheet(id) {
  const d = document.getElementById(id);
  if (!d.dataset.wired) {
    d.dataset.wired = 1;
    d.addEventListener('click', (e) => { if (e.target === d) closeSheet(d); });
    d.addEventListener('cancel', (e) => { e.preventDefault(); closeSheet(d); });
    $$('[data-close]', d).forEach((b) => b.addEventListener('click', () => closeSheet(d)));
  }
  d.classList.remove('closing');
  if (!d.open) d.showModal();
  return d;
}

// Labelled range input bound to obj[key]. fmt formats the readout.
export function slider(label, obj, key, min, max, step, onInput, fmt = (v) => v.toFixed(2)) {
  const row = el(`<label class="slide"><span class="k">${label}</span>
    <input type="range" min="${min}" max="${max}" step="${step}"><span class="v mono"></span></label>`);
  const input = $('input', row), out = $('.v', row);
  const sync = () => { input.value = obj[key]; out.textContent = fmt(+obj[key]); };
  input.addEventListener('input', () => { obj[key] = +input.value; out.textContent = fmt(+input.value); onInput?.(); });
  input.addEventListener('dblclick', () => { obj[key] = 0; sync(); onInput?.(); });
  sync();
  row.sync = sync;
  return row;
}

export function toggle(label, obj, key, onChange) {
  const row = el(`<label class="slide tog"><span class="k">${label}</span><input type="checkbox" role="switch"></label>`);
  const input = $('input', row);
  input.checked = !!obj[key];
  input.addEventListener('change', () => { obj[key] = input.checked; onChange?.(); });
  row.sync = () => { input.checked = !!obj[key]; };
  return row;
}

export const fmtDuration = (ms) => {
  const s = Math.round(ms / 1000);
  if (s < 60) return s + ' s';
  if (s < 3600) return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
  return Math.floor(s / 3600) + ' h ' + String(Math.floor((s % 3600) / 60)).padStart(2, '0') + ' m';
};

export const fmtBytes = (b) => (b > 1e9 ? (b / 1e9).toFixed(1) + ' GB' : Math.round(b / 1e6) + ' MB');
