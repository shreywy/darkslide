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

export async function start({ deviceId, facing = 'environment', res = 'max', demo = false } = {}) {
  stop();
  if (demo) return (stream = demoStream());
  const r = RESOLUTIONS.find((x) => x.id === res) || RESOLUTIONS[0];
  const video = { width: { ideal: r.w }, height: { ideal: r.h }, frameRate: { ideal: 30 } };
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
  try {
    await track().applyConstraints({ advanced: [c] });
    return true;
  } catch {
    return false;
  }
}

// iOS lists each physical lens plus virtual "Dual"/"Triple" devices; we only want
// the physical ones. Labels are only filled in after permission is granted.
export async function lenses() {
  const devs = (await navigator.mediaDevices.enumerateDevices()).filter((d) => d.kind === 'videoinput');
  return devs
    .filter((d) => !/dual|triple/i.test(d.label))
    .map((d, i) => {
      const l = d.label.toLowerCase();
      const kind = /front|user|facetime/.test(l) ? 'front' : /ultra/.test(l) ? 'ultra' : /tele/.test(l) ? 'tele' : l ? 'wide' : 'cam' + i;
      return { id: d.deviceId, label: d.label, kind };
    });
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
