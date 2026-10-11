// Auto level. Every strong edge votes for how far it leans from the nearest
// horizontal or vertical; horizons, roofs and door frames all agree on the tilt,
// so the peak of the vote is the angle to straighten by.
// gray: luminance 0..255, row-major. Returns degrees for recipe.straighten, or null
// when nothing in the picture is straight enough to go on.
export function levelAngle(gray, w, h, maxDeg = 15) {
  // Two passes of a 1-2-1 blur first, so jagged pixel steps on a sloped edge don't
  // vote for "perfectly level".
  for (let pass = 0; pass < 2; pass++) gray = blur(gray, w, h);
  const BIN = 0.25, N = Math.round((2 * maxDeg) / BIN) + 1, hist = new Float64Array(N);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1] - gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1];
      const gy = gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1] - gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1];
      const m = gx * gx + gy * gy;
      if (m < 4e3) continue;
      const t = (Math.atan2(-gx, gy) * 180) / Math.PI; // edge direction, y down
      const dev = ((((t + 45) % 90) + 90) % 90) - 45;
      if (Math.abs(dev) <= maxDeg) hist[Math.round((dev + maxDeg) / BIN)] += m;
    }
  }
  const sm = hist.map((_, k) => {
    let s = 0;
    for (let j = -4; j <= 4; j++) s += (hist[k + j] || 0) * (5 - Math.abs(j));
    return s;
  });
  let k = 0;
  for (let i = 1; i < N; i++) if (sm[i] > sm[k]) k = i;
  const mean = sm.reduce((a, b) => a + b, 0) / N;
  if (!sm[k] || sm[k] < mean * 2) return null;
  const a = sm[k - 1] ?? sm[k], c = sm[k + 1] ?? sm[k], den = a - 2 * sm[k] + c;
  const dev = (k + (den ? (0.5 * (a - c)) / den : 0)) * BIN - maxDeg;
  return Math.round(-dev * 10) / 10;
}

function blur(g, w, h) {
  const t = new Float32Array(g.length), o = new Float32Array(g.length);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      t[i] = (g[x > 0 ? i - 1 : i] + 2 * g[i] + g[x < w - 1 ? i + 1 : i]) / 4;
    }
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      o[i] = (t[y > 0 ? i - w : i] + 2 * t[i] + t[y < h - 1 ? i + w : i]) / 4;
    }
  return o;
}

// Luminance of an image scaled to about 512 px, for levelAngle.
// Scales down in halves: one big drawImage step skips pixels and leaves jagged edges.
export function grayOf(src, w, h) {
  while (Math.max(w, h) > 1024) {
    w = Math.round(w / 2); h = Math.round(h / 2);
    const half = Object.assign(document.createElement('canvas'), { width: w, height: h });
    half.getContext('2d').drawImage(src, 0, 0, w, h);
    src = half;
  }
  const k = Math.min(1, 512 / Math.max(w, h));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(w * k), height: Math.round(h * k) });
  const x = c.getContext('2d', { willReadFrequently: true });
  x.drawImage(src, 0, 0, c.width, c.height);
  const px = x.getImageData(0, 0, c.width, c.height).data, g = new Float32Array(c.width * c.height);
  for (let i = 0; i < g.length; i++) g[i] = px[i * 4] * 0.299 + px[i * 4 + 1] * 0.587 + px[i * 4 + 2] * 0.114;
  return [g, c.width, c.height];
}
