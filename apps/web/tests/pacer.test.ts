import { expect, test } from 'vitest';
import { FramePacer } from '../src/engine/pacer';

for (const displayRate of [60, 120, 144])
  test(`render caps hold on a ${displayRate} Hz display`, () => {
    for (const fps of [12, 30]) {
      const pacer = new FramePacer();
      let frames = 0;
      for (let i = 0; i < displayRate * 10; i++)
        if (pacer.shouldPaint((i * 1000) / displayRate, fps)) frames++;
      expect(frames).toBeGreaterThanOrEqual(fps * 10 - 1);
      expect(frames).toBeLessThanOrEqual(fps * 10 + 1);
    }
  });

test('a long stall paints once instead of bursting missed frames', () => {
  const pacer = new FramePacer();
  expect(pacer.shouldPaint(0, 30)).toBe(true);
  expect(pacer.shouldPaint(100000, 30)).toBe(true);
  expect(pacer.shouldPaint(100000, 30)).toBe(false);
});
