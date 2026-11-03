import { pathToFileURL } from 'node:url';
import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const out = `${process.cwd()}/artifacts/climate-water`;
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-first-run', '--disable-background-networking'],
});
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  colorScheme: 'dark',
});
await context.addInitScript(() => {
  window.requestAnimationFrame = () => 0;
});
const page = await context.newPage(),
  errors = [],
  report = { seed: 20261102, fixtureWeather: true, moods: {}, checks: {} };
page.on('pageerror', (e) => errors.push(e.message));
const url =
  process.env.CITY_URL ||
  pathToFileURL(`${process.cwd()}/outputs/ASCII城市预览.html`).href + '?qa=1';
try {
  for (const [name, code] of [
    ['clear', 0],
    ['cloudy', 2],
    ['rain', 63],
    ['storm', 95],
    ['snow', 73],
    ['fog', 45],
  ]) {
    await page.goto(url);
    await page.waitForFunction(() => Boolean(window.__city));
    report.moods[name] = await page.evaluate(
      ({ code }) => {
        const e = window.__city.engine();
        e.settings.effects = 0;
        window.asciiCity.dispatch({
          v: 1,
          ts: e.config.epoch,
          src: 'weather',
          type: 'weather.real',
          data: {
            code,
            tempC: code === 73 ? -3 : 15,
            precip: code === 63 ? 2 : code === 95 ? 5 : 0,
            cloud: code ? 0.9 : 0.1,
            localHour: 21,
            city: '天气效果预览',
          },
        });
        e.settings.cpu = 0.05;
        e.settings.mem = 0.3;
        e.world.sig.cpu = 0.05;
        e.world.sig.mem = 0.3;
        e.advanceTo(18000);
        window.__city.setMode(false);
        window.__city.paint();
        const times = [];
        for (let i = 0; i < 15; i++) {
          const t = performance.now();
          window.__city.paint();
          times.push(performance.now() - t);
        }
        times.sort((a, b) => a - b);
        return {
          cityClimate: e.world.weather.state,
          actualWeatherCode: e.world.weather.real.code,
          effects: e.settings.effects,
          water: e.settings.waterMode,
          medianPaintMs: times[7],
          p95PaintMs: times[13],
        };
      },
      { code },
    );
    assert.equal(
      report.moods[name].cityClimate,
      'clear',
      'Actual moon weather must not override CPU climate',
    );
    await page.waitForTimeout(550);
    const geometry = await page.locator('#weatherMoon').evaluate((canvas) => {
      const { width, height } = canvas,
        rgba = canvas.getContext('2d').getImageData(0, 0, width, height).data;
      const radii = [];
      for (let j = 0; j < 32; j++) {
        const a = (j * Math.PI) / 16;
        let edge = 0;
        for (let r = 0; r < width / 2; r += 0.5) {
          const x = Math.max(0, Math.min(width - 1, Math.floor(width / 2 + Math.cos(a) * r))),
            y = Math.max(0, Math.min(height - 1, Math.floor(height / 2 + Math.sin(a) * r)));
          if (rgba[(y * width + x) * 4 + 3] > 2) edge = r;
        }
        radii.push(edge);
      }
      return {
        width,
        height,
        cornerAlpha: rgba[3],
        radialSpread: Math.max(...radii) - Math.min(...radii),
      };
    });
    assert.equal(geometry.width, geometry.height);
    assert.equal(geometry.cornerAlpha, 0);
    assert.ok(geometry.radialSpread <= 2.5);
    report.moods[name].moonGeometry = geometry;
    await page.locator('#weatherMoon').screenshot({ path: `${out}/led-${name}.png` });
    await page.screenshot({ path: `${out}/moon-${name}.png` });
  }
  // Show actual text mode and exercise the same form handlers used in production.
  await page.evaluate(() => window.__city.setMode(true));
  await page.locator('#waterMode').selectOption('ascii');
  await page.locator('#waterSource').selectOption('cpu');
  assert.equal(await page.evaluate(() => window.__city.engine().settings.waterMode), 'ascii');
  for (const [id, value] of Object.entries({
    cloudThreshold: '1',
    rainThreshold: '3',
    stormThreshold: '8',
    fogThreshold: '95',
    weatherResponse: '1',
    weatherHold: '0',
  }))
    await page.locator(`#${id}`).fill(value);
  await page.locator('#weatherApply').click();
  report.checks.thresholds = await page.evaluate(() => {
    const e = window.__city.engine();
    e.advanceTo(30000);
    window.__city.paint();
    return {
      state: e.world.weather.state,
      limits: e.settings.weatherThresholds,
      saved: JSON.parse(localStorage.getItem('ascii-city.preferences')),
    };
  });
  assert.equal(report.checks.thresholds.state, 'rain');
  assert.equal(report.checks.thresholds.saved.weatherThresholds.rain, 0.03);
  await page.screenshot({ path: `${out}/controls.png` });
  await page.evaluate(() => {
    window.__city.setMode(false);
    window.__city.paint();
  });
  await page.waitForTimeout(550);
  await page.screenshot({ path: `${out}/ascii-water.png` });
  // A daytime moon is still a visible actual-weather indicator.
  report.checks.daytime = await page.evaluate(() => {
    const e = window.__city.engine();
    e.world.weather.real.localHour = 12;
    window.__city.paint();
    return {
      moonCells: Array.from(e.world.ent).filter((id) => e.world.entities[id]?.kind === 'moon')
        .length,
    };
  });
  assert.ok(report.checks.daytime.moonCells > 20);
  await page.screenshot({ path: `${out}/daytime.png` });
  assert.deepEqual(errors, []);
  report.errors = errors;
  await fs.writeFile(`${out}/report.json`, JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await browser.close();
}
