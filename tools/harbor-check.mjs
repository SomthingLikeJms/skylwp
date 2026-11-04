import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd(),
  out = path.join(root, 'artifacts/harbor');
await fs.mkdir(out, { recursive: true });
const browser = await chromium.launch({
  executablePath: 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
const context = await browser.newContext({
  viewport: { width: 1920, height: 1080 },
  deviceScaleFactor: 1,
});
await context.route('https://**', (r) => r.abort());
const page = await context.newPage(),
  errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const cases = [];
try {
  for (const scene of ['bund', 'nyc', 'hk'])
    for (const hour of [20.5, 12]) {
      await page.goto('http://127.0.0.1:5173/?qa=1');
      await page.waitForFunction(() => window.__city);
      await page.evaluate(
        async ({ scene, hour }) => {
          window.__city.freeze();
          const { makeEvent } = await import('/src/events/protocol.ts');
          const e = window.__city.engine();
          e.append(makeEvent('world.scene', { scene }, e.config.epoch + e.elapsedMs));
          Object.assign(e.settings, { hour, flow: 'stop', music: false, cpu: 0.1, mem: 0.25 });
          e.advanceTo(40000);
          e.settings.hour = hour;
          e.world.weather.real = {
            city: scene === 'bund' ? '上海' : scene === 'nyc' ? '纽约' : '香港',
            tempC: 19,
            code: 1,
            precip: 0,
            localHour: hour,
          };
          e.world.weather.realAt = e.world.t;
          window.__city.setMode(false);
          window.__city.paint();
        },
        { scene, hour },
      );
      await page.waitForTimeout(1100);
      const state = await page.evaluate(() => {
        const W = window.__city.engine().world;
        return {
          seed: W.seed,
          cols: W.cols,
          rows: W.rows,
          t: W.t,
          residents: W.residents,
          districtCells: Array.from(W.ent).filter((i) => W.entities[i]?.kind === 'district').length,
        };
      });
      assert.ok(state.districtCells > 0, scene + ' has visible distant districts');
      cases.push({ scene, hour, ...state });
      await page.screenshot({
        path: path.join(out, `${scene}-${hour === 12 ? 'day' : 'night'}.png`),
      });
      await page.screenshot({
        path: path.join(out, `${scene}-${hour === 12 ? 'day' : 'night'}-detail.png`),
        clip: { x: 0, y: 660, width: 1920, height: 420 },
      });
    }
  await page.goto('http://127.0.0.1:5173/?qa=1');
  await page.waitForFunction(() => window.__city);
  await page.evaluate(async () => {
    window.__city.freeze();
    const { makeEvent } = await import('/src/events/protocol.ts');
    const e = window.__city.engine();
    Object.assign(e.settings, { hour: 20.5, flow: 'stop', music: false, cpu: 0.1, mem: 0.25 });
    const event = (type, data, session) =>
      e.append(makeEvent(type, data, e.config.epoch + e.elapsedMs, 'codex', session));
    for (const session of ['fixture-work', 'fixture-wait', 'fixture-done'])
      event('agent.session', { state: 'start', name: '演示 ' + session.slice(8) }, session);
    event('agent.tool', { kind: 'edit' }, 'fixture-work');
    event('agent.await', { on: true, reason: 'input' }, 'fixture-wait');
    event('agent.session', { state: 'end', name: '演示 done' }, 'fixture-done');
    e.advanceTo(22000);
    window.__city.setMode(false);
    window.__city.paint();
  });
  await page.waitForTimeout(1100);
  const initial = await page.evaluate(() => window.__city.engine().world.residents);
  assert.ok(initial.some((r) => r.signal === 'awaiting' && r.activity === 'sit'));
  assert.ok(initial.some((r) => r.signal === 'working' && r.activity === 'work'));
  const frames = [];
  for (const seconds of [22, 32, 42, 54, 72, 100]) {
    await page.evaluate((seconds) => {
      window.__city.engine().advanceTo(seconds * 1000);
      window.__city.paint();
    }, seconds);
    await page.waitForTimeout(100);
    frames.push({
      seconds,
      residents: await page.evaluate(() => window.__city.engine().world.residents),
    });
    await page.screenshot({ path: path.join(out, `fixture-${seconds}s.png`) });
  }
  assert.ok(
    frames.some((f) => f.residents.some((r) => r.signal === 'done' && r.activity === 'ride')),
  );
  assert.ok(frames.at(-1).residents.some((r) => r.signal === 'done' && r.activity === 'gone'));
  // Match the physical native grid on this 2560 × 1600 screen at density 7.
  await page.setViewportSize({ width: 2560, height: 1600 });
  await page.evaluate(() =>
    localStorage.setItem('ascii-city.preferences', JSON.stringify({ density: 7 })),
  );
  await page.goto('http://127.0.0.1:5173/?qa=1');
  await page.waitForFunction(() => window.__city);
  await page.locator('[data-group="density"] [data-v="7"]').click();
  await page.waitForFunction(() => window.__city.engine().world.cols === 366);
  await page.evaluate(() => {
    window.__city.freeze();
    const e = window.__city.engine();
    Object.assign(e.settings, { hour: 20.5, flow: 'stop', music: false });
    e.advanceTo(40000);
    e.settings.hour = 20.5;
    window.__city.setMode(false);
    window.__city.paint();
  });
  await page.waitForTimeout(400);
  const highDensity = await page.evaluate(() => {
    const W = window.__city.engine().world;
    return { cols: W.cols, rows: W.rows, promenade: W.promY };
  });
  assert.deepEqual([highDensity.cols, highDensity.rows], [366, 115]);
  await page.screenshot({ path: path.join(out, 'density7-2560x1600.png') });
  await page.screenshot({
    path: path.join(out, 'density7-detail.png'),
    clip: { x: 0, y: 1000, width: 2560, height: 600 },
  });
  // Explicitly labelled visual fixture: all signals, frozen world time, no native events.
  for (const hour of [12, 18.2, 20.5]) {
    await page.evaluate((hour) => {
      const e = window.__city.engine();
      Object.assign(e.settings, { hour, music: true, cpu: 0.12, mem: 0.72, net: 0.48, flow: 'stop' });
      e.advanceTo(e.elapsedMs + 70000);
      e.world.weather.real = { city: '上海', tempC: 19, code: 1, precip: 0, localHour: hour };
      e.world.weather.realAt = e.world.t;
      window.__city.paint();
    }, hour);
    await page.screenshot({ path: path.join(out, `showcase-${hour}.png`) });
    await page.screenshot({ path: path.join(out, `showcase-${hour}-detail.png`), clip: { x: 0, y: 990, width: 2560, height: 610 } });
  }
  assert.deepEqual(errors, []);
  const report = {
    scope: 'Fixed-seed frontend fixtures. Agent events are simulated, not a live collector test.',
    cases,
    frames,
    highDensity,
    errors,
  };
  await fs.writeFile(path.join(out, 'checks.json'), JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        cases: cases.map(({ scene, hour, cols, rows, districtCells }) => ({
          scene,
          hour,
          cols,
          rows,
          districtCells,
        })),
        agentLifecycle: true,
        errors,
      },
      null,
      2,
    ),
  );
} finally {
  await context.close();
  await browser.close();
}
