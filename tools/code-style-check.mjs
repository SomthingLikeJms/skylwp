import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';
const root = process.cwd(),
  out = `${root}/artifacts/code-style`;
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-first-run', '--disable-background-networking'],
});
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
  colorScheme: 'dark',
});
const page = await context.newPage(),
  errors = [],
  report = { seed: 20261102, weatherFixture: true, scenes: {} };
page.on('pageerror', (e) => errors.push(e.message));
const url =
  process.env.CITY_URL ||
  pathToFileURL(`${process.cwd()}/outputs/ASCII城市预览.html`).href + '?qa=1';
try {
  for (const scene of ['bund', 'nyc', 'hk']) {
    await page.goto(url);
    await page.waitForFunction(() => Boolean(window.__city));
    const result = await page.evaluate((scene) => {
      const e = window.__city.engine();
      window.asciiCity.dispatch({
        v: 1,
        ts: e.config.epoch + e.elapsedMs,
        src: 'sim',
        type: 'world.scene',
        data: { scene },
      });
      window.asciiCity.dispatch({
        v: 1,
        ts: e.config.epoch + e.elapsedMs,
        src: 'weather',
        type: 'weather.real',
        data: {
          code: 0,
          tempC: 16,
          precip: 0,
          windKph: 12,
          humidity: 0.62,
          cloud: 0.15,
          localHour: 21,
          city: '上海（效果预览）',
        },
      });
      e.advanceTo(18000);
      window.__city.freeze();
      window.__city.setMode(false);
      window.__city.paint();
      const samples = [];
      for (let i = 0; i < 12; i++) {
        const t = performance.now();
        window.__city.paint();
        samples.push(performance.now() - t);
      }
      samples.sort((a, b) => a - b);
      return {
        cols: e.world.cols,
        rows: e.world.rows,
        medianPaintMs: samples[6],
        density: e.settings.density,
      };
    }, scene);
    await page.waitForTimeout(550);
    await page.screenshot({ path: `${out}/${scene}.png` });
    report.scenes[scene] = result;
  }
  await page.evaluate(() => window.__city.setMode(true));
  const weather = page.locator('[data-widget=weather]'),
    agents = page.locator('[data-widget=agents]');
  const oldWeather = await weather.boundingBox(),
    oldAgents = await agents.boundingBox();
  await page.locator('#layoutBtn').click();
  async function drag(el, dx, dy) {
    const handle = await el.locator('.widget-handle').boundingBox();
    await page.mouse.move(handle.x + 70, handle.y + 14);
    await page.mouse.down();
    await page.mouse.move(handle.x + 70 + dx, handle.y + 14 + dy, { steps: 12 });
    await page.mouse.up();
  }
  await drag(weather, 430, 170);
  const newWeather = await weather.boundingBox();
  assert.ok(Math.abs(newWeather.x - oldWeather.x - 430) < 2);
  assert.ok(Math.abs(newWeather.y - oldWeather.y - 170) < 2);
  assert.ok(
    Math.abs((await agents.boundingBox()).x - oldAgents.x) < 2,
    'Moving weather moved Agent widget',
  );
  await drag(agents, 720, 200);
  const newAgents = await agents.boundingBox();
  await page.locator('#layoutDone').click();
  const saved = await page.evaluate(() => JSON.parse(localStorage.getItem('ascii-city.widgets')));
  assert.ok(saved.weather.x > 0.2 && saved.agents.x > 0.4);
  await page.reload();
  await page.waitForFunction(() => Boolean(window.__city));
  await page.waitForTimeout(300);
  const restoredWeather = await weather.boundingBox(),
    restoredAgents = await agents.boundingBox();
  assert.ok(
    Math.abs(restoredWeather.x - newWeather.x) < 2 &&
      Math.abs(restoredWeather.y - newWeather.y) < 2,
  );
  assert.ok(
    Math.abs(restoredAgents.x - newAgents.x) < 2 && Math.abs(restoredAgents.y - newAgents.y) < 2,
  );
  await page.screenshot({ path: `${out}/custom-layout.png` });
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(500);
  for (const widget of [weather, agents]) {
    const b = await widget.boundingBox();
    assert.ok(b.x >= 11 && b.y >= 11 && b.x + b.width <= 379 && b.y + b.height <= 833);
  }
  await page.screenshot({ path: `${out}/narrow-layout.png` });
  assert.deepEqual(errors, []);
  report.layout = {
    independentDragging: true,
    persistsAfterReload: true,
    clampedOnSmallScreens: true,
  };
  report.errors = errors;
  await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
