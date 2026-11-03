import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const root = process.cwd(),
  out = `${root}/artifacts/atmosphere`;
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-first-run', '--disable-background-networking'],
});
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  colorScheme: 'dark',
  deviceScaleFactor: 1,
});
await context.addInitScript(() => {
  window.requestAnimationFrame = () => 0;
});
const page = await context.newPage(),
  errors = [],
  report = { fixtureData: true, seed: 20261102, cases: {} };
page.on('pageerror', (error) => errors.push(error.message));
try {
  for (const [name, code, fx] of [
    ['before', 0, 0],
    ['after', 0, 0.85],
    ['rain', 63, 0.85],
    ['storm', 95, 0.85],
    ['snow', 73, 0.85],
    ['fog', 45, 0.85],
  ]) {
    await page.goto(
      process.env.CITY_URL ||
        pathToFileURL(`${process.cwd()}/outputs/ASCII城市预览.html`).href + '?qa=1',
    );
    await page.waitForFunction(() => Boolean(window.__city));
    const result = await page.evaluate(
      ({ code, fx }) => {
        const e = window.__city.engine();
        e.settings.effects = fx;
        e.settings.weatherMode = 'real';
        e.advanceTo(15000);
        window.asciiCity.dispatch({
          v: 1,
          ts: e.config.epoch + e.elapsedMs,
          src: 'weather',
          type: 'weather.real',
          data: {
            code,
            tempC: code === 73 ? -3 : 15,
            precip: code === 63 ? 2 : code === 95 ? 5 : 0,
            windKph: 18,
            windDeg: 250,
            cloud: code === 0 ? 0.1 : 0.9,
            humidity: 0.8,
            city: '上海（效果预览）',
            localHour: 20.5,
          },
        });
        e.advanceTo(26000);
        if (code === 95)
          for (let i = 0; i < 900 && e.world.weather.lightning < 0.8; i++)
            e.advanceTo(e.elapsedMs + 34);
        window.__city.setMode(false);
        window.__city.paint();
        const samples = [];
        for (let i = 0; i < 20; i++) {
          const s = performance.now();
          window.__city.paint();
          samples.push(performance.now() - s);
        }
        samples.sort((a, b) => a - b);
        return {
          state: e.world.weather.state,
          lightning: e.world.weather.lightning,
          particles: e.world.particles.length,
          cols: e.world.cols,
          rows: e.world.rows,
          medianPaintMs: samples[10],
          p95PaintMs: samples[18],
        };
      },
      { code, fx },
    );
    assert.equal(await page.locator('#nogl').isVisible(), false);
    assert.equal(await page.locator('#liveHud').isVisible(), true);
    await page.waitForTimeout(500);
    await page.screenshot({ path: `${out}/${name}.png` });
    report.cases[name] = result;
  }
  assert.equal(report.cases.snow.state, 'snow');
  assert.equal(report.cases.fog.state, 'haze');
  assert.equal(report.cases.storm.state, 'storm');
  assert.ok(report.cases.storm.lightning > 0.8);
  assert.deepEqual(errors, []);
  report.errors = errors;
  await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
