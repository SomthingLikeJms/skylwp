import { expect, test } from 'vitest';
import { LoopScheduler, type LoopDriver } from '../src/engine/scheduler';

test('12 fps wallpaper does not wake at display rate; paused/hidden scheduling is bounded', () => {
  let now = 0,
    id = 0,
    frames = 0,
    callbacks = 0;
  const tasks = new Map<number, { due: number; run: () => void }>();
  const driver: LoopDriver = {
    now: () => now,
    timer: (run, delay) => {
      tasks.set(++id, { due: now + delay, run });
      return id;
    },
    cancelTimer: (n) => {
      tasks.delete(n);
    },
    frame: (run) => {
      frames++;
      tasks.set(++id, { due: now, run: () => run(now) });
      return id;
    },
    cancelFrame: (n) => {
      tasks.delete(n);
    },
  };
  const loop = new LoopScheduler(() => {
    callbacks++;
  }, driver);
  const advance = (to: number) => {
    while (true) {
      const entry = [...tasks].sort((a, b) => a[1].due - b[1].due)[0];
      if (!entry || entry[1].due >= to) break;
      now = entry[1].due;
      tasks.delete(entry[0]);
      entry[1].run();
    }
    now = to;
  };
  loop.setRate(12);
  advance(1000);
  expect(callbacks).toBeGreaterThanOrEqual(12);
  expect(callbacks).toBeLessThanOrEqual(13);
  expect(frames).toBe(callbacks);
  const before = callbacks;
  loop.setRate(1);
  advance(6000);
  expect(callbacks - before).toBe(5);
  expect(frames).toBe(before);
  loop.setRate(0);
  expect(tasks.size).toBe(0);
  advance(16000);
  expect(callbacks - before).toBe(5);
});
