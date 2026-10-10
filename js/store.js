// IndexedDB. `shots` holds metadata, the edit recipe and a small rendered thumbnail;
// `raws` holds the untouched full-size JPEG, so looks can be changed later.

const open = new Promise((res, rej) => {
  const r = indexedDB.open('darkslide', 1);
  r.onupgradeneeded = () => {
    const db = r.result;
    db.createObjectStore('shots', { keyPath: 'id' }).createIndex('roll', 'roll');
    db.createObjectStore('raws');
    db.createObjectStore('rolls', { keyPath: 'id' });
  };
  r.onsuccess = () => res(r.result);
  r.onerror = () => rej(r.error);
});

async function tx(names, mode, fn) {
  const db = await open;
  return new Promise((res, rej) => {
    const t = db.transaction(names, mode);
    const out = fn(...[].concat(names).map((n) => t.objectStore(n)));
    t.oncomplete = () => res(out && 'result' in out ? out.result : out);
    t.onerror = t.onabort = () => rej(t.error);
  });
}

export const addShot = (shot, raw) =>
  tx(['shots', 'raws'], 'readwrite', (s, r) => { s.put(shot); r.put(raw, shot.id); });
export const putShots = (shots) => tx('shots', 'readwrite', (s) => shots.forEach((x) => s.put(x)));
export const allShots = () => tx('shots', 'readonly', (s) => s.getAll());
export const getRaw = (id) => tx('raws', 'readonly', (r) => r.get(id));
export const deleteShots = (ids) =>
  tx(['shots', 'raws'], 'readwrite', (s, r) => ids.forEach((id) => { s.delete(id); r.delete(id); }));

export const putRoll = (roll) => tx('rolls', 'readwrite', (s) => s.put(roll));
export const allRolls = () => tx('rolls', 'readonly', (s) => s.getAll());
export const deleteRolls = (ids) => tx('rolls', 'readwrite', (s) => ids.forEach((id) => s.delete(id)));

export const clearAll = () =>
  tx(['shots', 'raws', 'rolls'], 'readwrite', (...stores) => stores.forEach((s) => s.clear()));

let seq = 0;
export const newId = () => Date.now().toString(36) + '-' + (seq++ % 1296).toString(36).padStart(2, '0');
