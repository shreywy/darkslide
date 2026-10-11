// Camera access. Safari has no ImageCapture API, so stills are frames grabbed from
// the video track. The resolution list is what we ask for; the track reports what
// the phone actually gave us.

export const RESOLUTIONS = [
  { id: 'max', label: 'Max', w: 4032, h: 3024 },
  { id: '4k', label: '4K', w: 3840, h: 2160 },
  { id: '1440', label: '1440', w: 1920, h: 1440 },
  { id: '1080', label: '1080', w: 1920, h: 1080 },
  { id: '720', label: '720', w: 1280, h: 720 },
];

let stream = null;

// applyConstraints replaces every constraint on the track, so a bare
// { advanced: [{ zoom }] } silently dropped the resolution back to the default
// (blurry after zooming). base and adv are resent together on every change.
let base = {}, adv = {};
const sizeOf = (res) => {
  const r = RESOLUTIONS.find((x) => x.id === res) || RESOLUTIONS[0];
  return { width: { ideal: r.w }, height: { ideal: r.h }, frameRate: { ideal: 30 } };
};
const send = () => track().applyConstraints({ ...base, advanced: Object.entries(adv).map(([k, v]) => ({ [k]: v })) });

export async function start({ deviceId, facing = 'environment', res = 'max', demo = false } = {}) {
  stop();
  base = sizeOf(res);
  adv = {};
  if (demo) return (stream = demoStream());
  const video = { ...base };
  if (deviceId) video.deviceId = { exact: deviceId };
  else video.facingMode = facing;
  try {
    stream = await navigator.mediaDevices.getUserMedia({ video, audio: false });
  } catch (e) {
    if (deviceId && e.name === 'OverconstrainedError') return start({ facing, res });
    throw e;
  }
  return stream;
}

export function stop() {
  stream?.getTracks().forEach((t) => t.stop());
  stream = null;
}

export const track = () => stream?.getVideoTracks()[0];
export const caps = () => track()?.getCapabilities?.() || {};
export const current = () => track()?.getSettings?.() || {};

export async function apply(c) {
  Object.assign(adv, c);
  try {
    await send();
    return true;
  } catch {
    for (const k in c) delete adv[k];
    return false;
  }
}

// iOS lists each physical lens plus virtual "Dual Wide"/"Triple" devices that zoom
// across lenses the way the Camera app does. Labels only appear after permission.
export async function lenses() {
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  return devs.map((d, i) => {
    const l = d.label.toLowerCase();
    const kind = /front|user|facetime/.test(l) ? 'front' : /dual|triple/.test(l) ? 'multi'
      : /ultra/.test(l) ? 'ultra' : /tele/.test(l) ? 'tele' : l ? 'wide' : 'cam' + i;
    return { id: d.deviceId, label: d.label, kind };
  });
}

// Changes resolution on the running track, which avoids a new permission prompt.
export async function resize(id) {
  base = sizeOf(id);
  try {
    await send();
    return true;
  } catch {
    return false;
  }
}

// Moving test scene for desktop testing (?demo) and screenshots.
function demoStream() {
  const c = Object.assign(document.createElement('canvas'), { width: 1440, height: 1920 });
  const x = c.getContext('2d');
  const t0 = performance.now();
  const out = c.captureStream(30);
  requestAnimationFrame(function draw() {
    if (out.getVideoTracks()[0].readyState === 'ended') return;
    const t = (performance.now() - t0) / 1000;
    x.fillStyle = '#8fb3cf'; x.fillRect(0, 0, 1440, 1920);
    x.fillStyle = '#f2d6a2'; x.beginPath(); x.arc(1050, 520, 150, 0, 7); x.fill();
    x.fillStyle = '#5d7a52'; x.fillRect(0, 1180, 1440, 740);
    x.fillStyle = '#a8553a'; x.fillRect(260, 760, 420, 520);
    x.fillStyle = '#3b2f2a'; x.fillRect(400, 1040, 120, 240);
    x.fillStyle = '#e9e4da'; x.fillRect(820, 900, 300, 380);
    x.fillStyle = '#1e1e1c'; x.beginPath(); x.arc(200 + ((t * 160) % 1100), 1500, 70, 0, 7); x.fill();
    x.fillStyle = '#fff'; x.font = '48px monospace'; x.fillText(t.toFixed(1) + ' s', 60, 100);
    requestAnimationFrame(draw);
  });
  return out;
}
