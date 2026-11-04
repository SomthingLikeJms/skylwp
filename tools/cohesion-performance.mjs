import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd(),
  out = path.join(root, 'artifacts/cohesion');
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
      const { CityEngine: OldEngine } = await import(baseline + '/events/replay.ts');
      const { compose: oldCompose } = await import(baseline + '/compose/index.ts');
      const summary = (xs) => ({
        meanMs: xs.reduce((a, b) => a + b, 0) / xs.length,
        p95Ms: [...xs].sort((a, b) => a - b)[Math.floor(xs.length * 0.95)],
      });
      const results = [];
      for (const [cols, rows] of [
        [214, 60],
        [427, 120],
      ])
        for (const scene of ['bund', 'nyc', 'hk']) {
          const config = {
            seed: 20261102,
            epoch: 0,
            cols,
            rows,
            settings: { ...DEFAULT_SETTINGS, scene, flow: 'stop', music: false },
          };
          const engines = [new OldEngine(config), new CityEngine(config)],
            draw = [oldCompose, compose],
            times = [[], []];
          for (let frame = 0; frame < 690; frame++) {
            for (const e of engines) e.advanceTo((frame * 1000) / 12);
            for (const n of frame % 2 ? [0, 1] : [1, 0]) {
              const start = performance.now();
              draw[n](engines[n].world, engines[n].settings);
              if (frame >= 90) times[n].push(performance.now() - start);
            }
          }
          results.push({
            scene,
            cols,
            rows,
            oldPromenade: engines[0].world.promY,
            newPromenade: engines[1].world.promY,
            before: summary(times[0]),
            after: summary(times[1]),
          });
        }
      return {
        scope:
          'CPU compose only, not GPU or full native frame. 600 measured frames after 90 warm-up. Alternating 0.9.0 / 0.9.1 with separate worlds and each version’s own geometry. Seed 20261102.',
        results,
      };
    },
    '/@fs/' + path.join(root, 'artifacts/cohesion-before/src').replaceAll('\\', '/'),
  );
  await fs.writeFile(path.join(out, 'performance.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
