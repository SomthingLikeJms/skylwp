import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
const browser = await chromium.launch({ executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  await page.goto(process.env.CITY_URL || 'http://127.0.0.1:4173/?qa=1');
  await page.waitForFunction(() => Boolean(window.__city));
  const report = await page.evaluate(async () => {
    window.__city.freeze();
    const { CityEngine, DEFAULT_SETTINGS } = await import('/src/events/replay.ts');
    const { demoEvents } = await import('/src/events/sim/demo.ts');
    const { compose } = await import('/src/compose/index.ts');
    const measurements = [];
    for (const scene of ['bund', 'nyc', 'hk']) for (const fps of [12, 30]) {
      const engine = new CityEngine({ seed: 20261102, epoch: 100000, cols: 214, rows: 60, settings: { ...DEFAULT_SETTINGS, scene, flow: 'stop' } }, demoEvents(100000));
      for (let i = 1; i <= 90; i++) { engine.advanceTo(i * 1000 / fps); compose(engine.world, engine.settings); }
      const samples = [];
      for (let i = 91; i <= 390; i++) {
        const start = performance.now(); engine.advanceTo(i * 1000 / fps); compose(engine.world, engine.settings); samples.push(performance.now() - start);
      }
      samples.sort((a, b) => a - b);
      measurements.push({ scene, fps, sampleFrames: samples.length, meanMs: samples.reduce((a, b) => a + b, 0) / samples.length, p95Ms: samples[Math.floor(samples.length * 0.95)] });
    }
    const gl = document.getElementById('world').getContext('webgl2');
    const info = gl.getExtension('WEBGL_debug_renderer_info');
    return { resolution: '1920x1080', grid: '214x60', scope: 'fixed-step simulation + CPU composition; excludes GPU and OS process overhead', renderer: info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : 'unavailable', measurements };
  });
  await fs.mkdir('artifacts/qa', { recursive: true });
  await fs.writeFile('artifacts/qa/performance-report.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally { await browser.close(); }
