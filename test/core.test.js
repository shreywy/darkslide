import { test } from 'node:test';
import assert from 'node:assert/strict';
import { totalShots, newRun, step } from '../js/interval.js';
import { plan } from '../js/render.js';
import { newRecipe } from '../js/looks.js';

test('total shots from duration, count, or neither', () => {
  assert.equal(totalShots({ everyMs: 500, durationMs: 60000 }), 120);
  assert.equal(totalShots({ everyMs: 500, durationMs: 60000, count: 50 }), 50);
  assert.equal(totalShots({ everyMs: 1000 }), Infinity);
});

test('on-time ticks shoot every slot and finish', () => {
  const run = newRun({ everyMs: 500, total: 4 }, 0);
  const shots = [];
  let now = 0, r;
  do { r = step(run, now); if ('shoot' in r) shots.push(r.shoot); now += r.wait; } while (!r.done);
  assert.deepEqual(shots, [0, 1, 2, 3]);
  assert.equal(run.missed, 0);
});

test('late tick skips missed slots without drifting', () => {
  const run = newRun({ everyMs: 1000, total: 10 }, 0);
  step(run, 0);
  const r = step(run, 4200);
  assert.equal(r.shoot, 4);
  assert.equal(run.missed, 3);
  assert.equal(r.wait, 800);
});

test('busy capture counts as missed', () => {
  const run = newRun({ everyMs: 250, total: Infinity }, 0);
  const r = step(run, 0, true);
  assert.equal(r.shoot, undefined);
  assert.equal(run.missed, 1);
  assert.equal(r.done, false);
});

test('start delay waits before slot 0', () => {
  const run = newRun({ everyMs: 1000, total: 5, delayMs: 3000 }, 100);
  assert.equal(step(run, 100).wait, 3000);
  assert.equal(step(run, 3100).shoot, 0);
});

test('plan crops to aspect, rotates and straightens inside the source', () => {
  const r = newRecipe('digital');
  assert.deepEqual([plan(4000, 3000, { ...r, crop: 1 }).cw, plan(4000, 3000, { ...r, crop: 1 }).ch], [3000, 3000]);
  const rot = plan(4000, 3000, { ...r, rotate: 90 });
  assert.deepEqual([rot.ow, rot.oh], [3000, 4000]);
  const st = plan(4000, 3000, { ...r, straighten: 10 });
  const t = (10 * Math.PI) / 180;
  assert.ok(st.cw * Math.cos(t) + st.ch * Math.sin(t) <= 4000 + 1e-6);
  assert.ok(st.cw * Math.sin(t) + st.ch * Math.cos(t) <= 3000 + 1e-6);
  assert.equal(plan(4000, 3000, newRecipe('gbcam')).ow, 1024);
  assert.equal(plan(3000, 4000, r, { maxLong: 400 }).oh, 400);
});
