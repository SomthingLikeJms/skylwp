import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
const repo = process.cwd();
const require = createRequire(path.join(repo, 'package.json'));
const { chromium } = require('playwright-core');
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(process.env.CITY_URL || 'http://127.0.0.1:5173/?qa=1');
  await page.waitForFunction(() => Boolean(window.__city));
  const report = await page.evaluate(
    async ({ baselinePath, frames }) => {
      window.__city.freeze();
      const { CityEngine, DEFAULT_SETTINGS } = await import('/src/events/replay.ts');
      const { demoEvents } = await import('/src/events/sim/demo.ts');
      const { compose } = await import('/src/compose/index.ts');
      const { compose: original } = await import(baselinePath);
      const results = [];
      const summarize = (xs) => {
        const sorted = xs.slice().sort((a, b) => a - b);
        return {
          meanMs: xs.reduce((a, b) => a + b, 0) / xs.length,
          p95Ms: sorted[Math.floor(sorted.length * 0.95)],
        };
      };
      for (const [cols, rows] of [
        [214, 60],
        [427, 120],
      ]) {
        for (const scene of ['bund', 'nyc', 'hk']) {
          const config = {
            seed: 20261102,
            epoch: 100000,
            cols,
            rows,
            settings: { ...DEFAULT_SETTINGS, scene, flow: 'stop' },
          };
          const engines = [
            new CityEngine(config, demoEvents(100000)),
            new CityEngine(config, demoEvents(100000)),
          ];
          const times = [[], []],
            steps = [[], []];
          let different = 0,
            compared = 0;
          for (let frame = 1; frame <= frames + 90; frame++) {
            for (const index of frame % 2 ? [0, 1] : [1, 0]) {
              const engine = engines[index],
                start = performance.now();
              engine.advanceTo((frame * 1000) / 12);
              const advanced = performance.now();
              (index ? compose : original)(engine.world, engine.settings);
              if (frame > 90) {
                steps[index].push(advanced - start);
                times[index].push(performance.now() - advanced);
              }
            }
            if (frame % 7 === 0) {
              for (const key of ['Ac', 'Bc', 'glyph', 'ent', 'solid']) {
                const a = engines[0].world[key],
                  b = engines[1].world[key];
                compared += a.length;
                for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) different++;
              }
            }
          }
          results.push({
            scene,
            cols,
            rows,
            frames,
            baseline: summarize(times[0]),
            optimized: summarize(times[1]),
            step: summarize(steps[1]),
            different,
            compared,
          });
        }
      }
      return {
        scope:
          'CPU compose; simulation timed separately; alternating baseline and optimized; exact cell-buffer comparisons every seventh frame',
        results,
      };
    },
    {
      baselinePath:
        '/@fs/' +
        path
          .join(
            process.env.CITY_BASELINE_SRC || path.join(repo, 'artifacts/baseline/apps/web/src'),
            'compose/index.ts',
          )
          .replaceAll('\\', '/'),
      frames: Number(process.argv[2] || 300),
    },
  );
  await fs.mkdir(path.join(repo, 'artifacts/optimization'), { recursive: true });
  const out = path.join(
    repo,
    'artifacts/optimization',
    process.argv[3] || 'performance-comparison.json',
  );
  await fs.writeFile(out, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (report.results.some((r) => r.different))
    throw new Error('Composition differs from the prepared baseline');
} finally {
  await browser.close();
}
