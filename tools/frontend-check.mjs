import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd(),
  out = path.join(root, 'artifacts/frontend');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
await context.route('https://**', (route) => route.abort());
const page = await context.newPage(),
  errors = [];
page.on('pageerror', (error) => errors.push(error.message));
const url = process.env.CITY_URL || 'http://127.0.0.1:5173/?qa=1';
async function fixture(scene = 'bund', hour = 20.5) {
  await page.goto(url);
  await page.waitForFunction(() => window.__city);
  await page.evaluate(
    async ({ scene, hour }) => {
      window.__city.freeze();
      const { makeEvent } = await import('/src/events/protocol.ts');
      const e = window.__city.engine();
      e.append(makeEvent('world.scene', { scene }, e.config.epoch + e.elapsedMs));
      Object.assign(e.settings, { hour, flow: 'stop', music: false, cpu: 0.1, mem: 0.25 });
      e.advanceTo(60000);
      e.settings.hour = hour;
      e.world.weather.real = {
        city: scene === 'bund' ? '上海' : scene === 'hk' ? '香港' : '纽约',
        tempC: 19,
        code: 1,
        precip: 0,
        windKph: 8,
        humidity: 0.64,
        cloud: 0.25,
        localHour: hour,
      };
      e.world.weather.realAt = e.world.t;
      window.__city.setMode(false);
      window.__city.paint();
    },
    { scene, hour },
  );
  await page.waitForTimeout(350);
  assert.equal(await page.evaluate(() => window.__city.engine().world.sceneKey), scene);
}
try {
  await page.goto(url);
  await page.waitForFunction(() => window.__city);
  await fixture();
  await page.screenshot({ path: path.join(out, 'bund-night.png') });
  await fixture('bund', 12);
  const celestial = await page.evaluate(() => ({
    moon: window.__city.engine().world.entities.filter((e) => e.kind === 'moon').length,
    sun: window.__city.engine().world.entities.filter((e) => e.kind === 'sun').length,
    overlayVisible: !document.getElementById('weatherMoon').hidden,
    background: getComputedStyle(document.querySelector('[data-widget=weather]')).backgroundColor,
  }));
  assert.equal(celestial.moon, 1);
  assert.equal(celestial.sun, 0);
  assert.ok(celestial.overlayVisible);
  await page.screenshot({ path: path.join(out, 'bund-day.png') });
  await page.evaluate(() => window.__city.setMode(true));
  await page.locator('#layoutBtn').click();
  await page.locator('[data-widget-remove=weather]').click();
  await page.locator('[data-widget-remove=agents]').click();
  assert.equal(await page.locator('[data-widget=weather]').isVisible(), false);
  assert.equal(await page.locator('[data-widget=agents]').isVisible(), false);
  assert.equal(
    await page.locator('[data-widget-toggle=weather]').getAttribute('aria-pressed'),
    'false',
  );
  await page.reload();
  await page.waitForFunction(() => window.__city);
  assert.equal(await page.locator('[data-widget=weather]').isVisible(), false);
  assert.equal(await page.locator('[data-widget=agents]').isVisible(), false);
  await page.locator('#layoutBtn').click();
  await page.locator('[data-widget-toggle=weather]').click();
  await page.locator('[data-widget-toggle=agents]').click();
  await page.locator('#widgetOpacity').fill('95');
  await page.locator('#widgetOpacity').dispatchEvent('change');
  assert.equal(await page.locator('#widgetOpacityValue').textContent(), '95%');
  const weather = page.locator('[data-widget=weather]'),
    agents = page.locator('[data-widget=agents]');
  const agentBefore = await agents.boundingBox(),
    box = await weather.locator('.widget-handle').boundingBox();
  await page.mouse.move(box.x + 40, box.y + 16);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 116, { steps: 12 });
  await page.mouse.up();
  assert.equal((await agents.boundingBox()).x, agentBefore.x);
  await weather.locator('.widget-handle').focus();
  const beforeKey = (await weather.boundingBox()).x;
  await page.keyboard.press('Shift+ArrowRight');
  assert.equal((await weather.boundingBox()).x, beforeKey + 10);
  await page.screenshot({ path: path.join(out, 'widget-editor.png') });
  await page.locator('#layoutDone').click();
  await page.reload();
  await page.waitForFunction(() => window.__city);
  assert.equal(await page.locator('#widgetOpacityValue').textContent(), '95%');
  assert.ok(await weather.isVisible());
  await page.locator('#layoutBtn').click();
  await page.locator('#layoutReset').click();
  await page.locator('#layoutDone').click();
  for (const scene of ['nyc', 'hk']) {
    await fixture(scene);
    await page.screenshot({ path: path.join(out, `${scene}-night.png`) });
  }
  await fixture();
  await page.evaluate(() => {
    const e = window.__city.engine();
    e.world.weather.rain = 0.7;
    e.world.weather.real.code = 63;
    window.__city.setMode(false);
    window.__city.paint();
  });
  await page.screenshot({ path: path.join(out, 'rain.png') });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.waitForTimeout(600);
  await page.evaluate(() => window.__city.setMode(true));
  await page.locator('#layoutBtn').click();
  const bounds = await page.locator('#layoutTools').boundingBox();
  assert.ok(bounds.x >= 0 && bounds.x + bounds.width <= 375 && bounds.y >= 0);
  await page.screenshot({ path: path.join(out, 'small-editor.png') });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.setViewportSize({ width: 812, height: 375 });
  await page.waitForTimeout(600);
  await page.screenshot({ path: path.join(out, 'landscape-editor.png') });
  assert.deepEqual(errors, []);
  const report = {
    seed: 20261102,
    simulatedTimeSeconds: 60,
    celestial,
    deletion: true,
    restore: true,
    persistsAfterReload: true,
    independentDrag: true,
    keyboardNudge: true,
    opacity: true,
    smallEditorFits: true,
    errors,
  };
  await fs.writeFile(path.join(out, 'checks.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await context.close();
  await browser.close();
}
