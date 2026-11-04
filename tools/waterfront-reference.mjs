import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
const root = process.cwd(),
  out = path.join(root, 'artifacts/waterfront');
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
try {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  await context.route('https://**', (r) => r.abort());
  const baseline = await fs.readFile(path.join(root, 'artifacts/waterfront-before/index.html'), 'utf8');
  await context.route('**/__baseline*', (r) =>
    r.fulfill({
      contentType: 'text/html',
      body: baseline.replace(
        'src="/src/main.ts"',
        'src="/@fs/' +
          path.join(root, 'artifacts/waterfront-before/src/main.ts').replaceAll('\\', '/') +
          '"',
      ),
    }),
  );
  const page = await context.newPage();
  await page.goto('http://127.0.0.1:5173/__baseline?qa=1');
  await page.waitForFunction(() => window.__city);
  for (const hour of [20.5, 12]) {
    await page.evaluate((hour) => {
      window.__city.freeze();
      const e = window.__city.engine();
      Object.assign(e.settings, { hour, flow: 'stop', music: false, cpu: 0.1, mem: 0.25 });
      e.advanceTo(40000);
      e.settings.hour = hour;
      e.world.weather.real = {
        city: '上海',
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
    }, hour);
    await page.waitForTimeout(1100);
    await page.screenshot({
      path: path.join(out, hour === 12 ? 'before-day.png' : 'before-night.png'),
    });
  }
  await context.close();
  const prototype = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    deviceScaleFactor: 1,
  });
  await prototype.route('https://**', (r) => r.abort());
  await prototype.addInitScript(() => {
    let seed = 20261102;
    Math.random = () => {
      seed = (Math.imul(1664525, seed) + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    window.__frames = [];
    window.requestAnimationFrame = (callback) => window.__frames.push(callback);
  });
  const original = await prototype.newPage();
  await original.goto(
    'http://127.0.0.1:5173/@fs/' +
      path.join(root, 'reference/ascii-city.html').replaceAll('\\', '/'),
  );
  await original.waitForFunction(() => window.__frames.length > 0);
  await original.evaluate(() => {
    const base = performance.now();
    for (let frame = 1; frame <= 1800; frame++) {
      const callbacks = window.__frames.splice(0);
      callbacks.forEach((cb) => cb(base + (frame * 1000) / 30));
    }
  });
  await original.locator('#hideBtn').click();
  await original.waitForTimeout(400);
  await original.screenshot({ path: path.join(out, 'prototype-seed-20261102.png') });
  await prototype.close();
  console.log('Saved unchanged prototype and 0.7.0 baseline screenshots.');
} finally {
  await browser.close();
}
