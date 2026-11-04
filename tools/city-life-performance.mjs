import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd(),
  out = path.join(root, 'artifacts/city-life');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto('http://127.0.0.1:5173/?qa=1');
  await page.waitForFunction(() => window.__city);
  const report = await page.evaluate(
    async (baseline) => {
      window.__city.freeze();
      const { CityEngine, DEFAULT_SETTINGS } = await import('/src/events/replay.ts');
      const { compose } = await import('/src/compose/index.ts');
      const { compose: original } = await import(baseline);
      const { drawStreetLife, drawWaterfrontLife } = await import('/src/compose/life.ts');
      const results = [];
      const summary = (xs) => {
        const sorted = [...xs].sort((a, b) => a - b);
        return {
          meanMs: xs.reduce((a, b) => a + b, 0) / xs.length,
          p95Ms: sorted[Math.floor(sorted.length * 0.95)],
        };
      };
      for (const [cols, rows] of [
        [214, 60],
        [427, 120],
      ])
        for (const scene of ['bund', 'nyc', 'hk']) {
          const e = new CityEngine({
            seed: 20261102,
            epoch: 0,
            cols,
            rows,
            settings: { ...DEFAULT_SETTINGS, scene, flow: 'stop', music: false },
          });
          const times = [[], []],
            life = [];
          for (let frame = 0; frame < 690; frame++) {
            e.advanceTo((frame * 1000) / 12);
            for (const n of frame % 2 ? [0, 1] : [1, 0]) {
              const begin = performance.now();
              (n ? compose : original)(e.world, e.settings);
              if (frame >= 90) times[n].push(performance.now() - begin);
            }
            const begin = performance.now();
            // Separate layer cost only; reset the ephemeral hit-test registry each sample.
            e.world.entities.length = 0;
            drawWaterfrontLife(e.world);
            drawStreetLife(e.world);
            if (frame >= 90) life.push(performance.now() - begin);
          }
          results.push({
            scene,
            cols,
            rows,
            before: summary(times[0]),
            after: summary(times[1]),
            lifeLayers: summary(life),
          });
        }
      return {
        scope:
          'CPU compose only; not GPU/full native frame. 600 frames after 90 warm-up, alternating 0.6.0 / 0.7.0. Seed 20261102.',
        results,
      };
    },
    '/@fs/' + path.join(root, 'artifacts/life-before/src/compose/index.ts').replaceAll('\\', '/'),
  );
  await fs.writeFile(path.join(out, 'performance.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
