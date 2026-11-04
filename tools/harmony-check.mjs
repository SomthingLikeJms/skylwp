import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd(),
  out = path.join(root, 'artifacts/harmony');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const errors = [],
  results = [];
try {
  for (const version of ['before', 'after']) {
    const context = await browser.newContext({
      viewport: { width: 2560, height: 1600 },
      deviceScaleFactor: 1,
    });
    await context.route('https://**', (r) => r.abort());
    await context.addInitScript(() => {
      localStorage.setItem('ascii-city.preferences', JSON.stringify({ density: 7 }));
    });
    if (version === 'before') {
      const html = await fs.readFile(
        path.join(root, 'artifacts/harmony-before/index.html'),
        'utf8',
      );
      const main =
        '/@fs/' + path.join(root, 'artifacts/harmony-before/src/main.ts').replaceAll('\\', '/');
      await context.route('**/__baseline*', (r) =>
        r.fulfill({
          contentType: 'text/html',
          body: html.replace('src="/src/main.ts"', `src="${main}"`),
        }),
      );
    }
    const page = await context.newPage();
    page.on('pageerror', (e) => errors.push(e.message));
    const source =
      version === 'before'
        ? '/@fs/' + path.join(root, 'artifacts/harmony-before/src').replaceAll('\\', '/')
        : '/src';
    for (const scene of ['bund', 'nyc', 'hk']) {
      for (const hour of [12, 18.2, 20.5]) {
        await page.goto(`http://127.0.0.1:5173/${version === 'before' ? '__baseline' : ''}?qa=1`);
        await page.waitForFunction(() => window.__city);
        await page.locator('[data-group="density"] [data-v="7"]').click();
        await page.waitForFunction(() => window.__city.engine().world.cols === 366);
        const state = await page.evaluate(
          async ({ source, scene, hour }) => {
            window.__city.freeze();
            const { makeEvent } = await import(source + '/events/protocol.ts');
            const e = window.__city.engine();
            e.append(makeEvent('world.scene', { scene }, e.config.epoch + e.elapsedMs));
            Object.assign(e.settings, {
              hour,
              flow: 'stop',
              music: false,
              cpu: 0.12,
              mem: 0.72,
              net: 0.48,
            });
            e.advanceTo(110000);
            e.world.weather.real = { city: scene, tempC: 19, code: 1, precip: 0, localHour: hour };
            e.world.weather.realAt = e.world.t;
            window.__city.setMode(false);
            window.__city.paint();
            const W = e.world;
            return {
              seed: W.seed,
              cols: W.cols,
              rows: W.rows,
              time: W.t,
              towers: W.towers.length,
              fleet: W.ships.length,
              distantCells: Array.from(W.ent).filter((i) => W.entities[i]?.kind === 'district')
                .length,
              finite: [W.br, W.bgc, W.bb, W.fr, W.fgc, W.fb].every((a) => a.every(Number.isFinite)),
            };
          },
          { source, scene, hour },
        );
        assert.deepEqual([state.cols, state.rows], [366, 115]);
        assert.ok(state.finite && state.distantCells > 0 && state.fleet <= 14);
        results.push({ version, scene, hour, ...state });
        await page.waitForTimeout(350);
        await page.screenshot({ path: path.join(out, `${version}-${scene}-${hour}.png`) });
      }
    }
    await context.close();
  }
  assert.deepEqual(errors, []);
  const report = {
    scope: 'Fixed-seed frontend visual fixtures; simulated inputs, not native collection.',
    results,
    errors,
  };
  await fs.writeFile(path.join(out, 'checks.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ cases: results.length, seed: results[0].seed, errors }, null, 2));
} finally {
  await browser.close();
}
