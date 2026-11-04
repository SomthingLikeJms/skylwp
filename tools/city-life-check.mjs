import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd(),
  out = path.join(root, 'artifacts/city-life');
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
  assert.deepEqual(errors, []);
  const report = {
    scope: 'Fixed-seed frontend fixtures. Agent events are simulated, not a live collector test.',
    cases,
    frames,
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
