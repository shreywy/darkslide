// Interval timing. Shot i is due at firstAt + i * everyMs. Ticks that arrive late
// or while the previous shot is still saving count the skipped slots as missed
// instead of shifting the rest of the run, so a 60 s run always ends at 60 s.

export function totalShots({ everyMs, count = Infinity, durationMs = Infinity }) {
  return Math.min(count, Math.ceil(durationMs / everyMs));
}

export function newRun({ everyMs, total, delayMs = 0 }, now) {
  return { firstAt: now + delayMs, everyMs, total, next: 0, missed: 0 };
}

// Advances `run` to `now`. Returns { shoot?: slot, wait: ms until next slot, done }.
export function step(run, now, busy = false) {
  if (run.next >= run.total) return { done: true, wait: 0 };
  const t = now - run.firstAt;
  if (t < 0) return { done: false, wait: -t };
  const due = Math.min(Math.floor(t / run.everyMs), run.total - 1);
  if (due < run.next) return { done: false, wait: run.firstAt + run.next * run.everyMs - now };
  run.missed += due - run.next + (busy ? 1 : 0);
  run.next = due + 1;
  const out = { done: run.next >= run.total, wait: run.firstAt + run.next * run.everyMs - now };
  if (!busy) out.shoot = due;
  return out;
}

export const everyLabel = (ms) =>
  ms < 1000 ? `${Math.round(1000 / ms)} per second` : ms < 60000 ? `every ${ms / 1000} s` : `every ${ms / 60000} min`;
