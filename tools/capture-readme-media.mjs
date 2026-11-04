import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const out = path.join(root, 'artifacts/readme-media');
const media = path.join(root, 'docs/media');
await fs.mkdir(media, { recursive: true });
const browser = await chromium.launch({
  executablePath:
    process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-first-run', '--disable-background-networking'],
});
const errors = [];
const report = {
  scope:
    'Screens and sequential rendered frames from Skylwp 0.9.3. Simulated inputs only, no native collectors.',
  seed: 20261102,
  screenshots: [],
  clips: [],
};
async function open(viewport, scene, hour, music) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1 });
  await context.route('https://**', (r) => r.abort());
  await context.addInitScript(() => {
    localStorage.setItem(
      'ascii-city.widgets',
      JSON.stringify({
        weather: { x: 0.77, y: 0.025 },
        agents: { x: 0.77, y: 0.22 },
      }),
    );
  });
  const page = await context.newPage();
  page.on('pageerror', (e) => errors.push(e.message));
  await page.goto(process.env.CITY_URL || 'http://127.0.0.1:5173/?qa=1');
  await page.waitForFunction(() => window.__city);
  await page.evaluate(() => window.__city.freeze());
  await page.locator('[data-group="density"] [data-v="7"]').click();
  await page.evaluate(
    async ({ scene, hour, music }) => {
      const { makeEvent } = await import('/src/events/protocol.ts');
      const e = window.__city.engine();
      e.append(makeEvent('world.scene', { scene }, e.config.epoch + e.elapsedMs));
      Object.assign(e.settings, {
        hour,
        flow: 'stop',
        cpu: 0.12,
        mem: 0.62,
        net: 0.19,
        music,
      });
      const add = (type, data, src = 'sim', session) =>
        e.append(makeEvent(type, data, e.config.epoch + e.elapsedMs, src, session));
      add('weather.real', {
        city: { bund: '上海 · 演示', nyc: '纽约 · 演示', hk: '香港 · 演示' }[scene],
        tempC: 22,
        code: 1,
        precip: 0,
        cloud: 0.2,
        humidity: 0.6,
        windKph: 6,
        localHour: hour,
      });
      add('agent.todo', { done: 2, total: 5, current: '构建城市渲染器' }, 'codex', 'demo-codex');
      add(
        'agent.todo',
        { done: 2, total: 7, current: '等待你确认下一步' },
        'claude-code',
        'demo-claude',
      );
      add('agent.await', { on: true, reason: 'input' }, 'claude-code', 'demo-claude');
      add('browser.tabs', {
        tabs: Array.from({ length: 9 }, (_, i) => ({
          id: `public-demo-${i}`,
          cat: ['文档', '代码', '视频'][i % 3],
        })),
      });
      window.__readmeEvent = (type, data, src = 'codex', session = 'demo-codex') => {
        add(type, data, src, session);
      };
      window.__city.setMode(false);
    },
    { scene, hour, music },
  );
  await page.evaluate(() => document.fonts.ready);
  // Finish the console's exit transition before the first exported frame.
  await page.waitForFunction(
    () => Number(getComputedStyle(document.getElementById('panel')).opacity) === 0,
  );
  return { context, page };
}
async function frame(page, seconds) {
  return page.evaluate((seconds) => {
    const e = window.__city.engine();
    e.advanceTo(seconds * 1000);
    window.__city.setMode(false);
    window.__city.paint();
    const W = e.world;
    return {
      seconds: W.t,
      cols: W.cols,
      rows: W.rows,
      promenade: W.promY,
      finite: [W.br, W.bgc, W.bb, W.fr, W.fgc, W.fb].every((a) => a.every(Number.isFinite)),
      residents: W.residents.map((r) => ({ signal: r.signal, activity: r.activity })),
      fleet: W.ships.length,
    };
  }, seconds);
}
try {
  for (const [scene, hour, file] of [
    ['bund', 18.2, 'bund-dusk.png'],
    ['nyc', 20.5, 'manhattan-night.png'],
    ['hk', 12, 'victoria-harbour-day.png'],
  ]) {
    const { context, page } = await open({ width: 1920, height: 1200 }, scene, hour, false);
    const state = await frame(page, 32);
    await page.evaluate(() => window.__readmeEvent('agent.tool', { kind: 'edit' }));
    await frame(page, 32.2);
    await page.screenshot({ path: path.join(media, file) });
    assert.ok(state.finite && state.fleet <= 14);
    report.screenshots.push({ scene, hour, file, ...state });
    await context.close();
  }
  for (const clip of [
    {
      name: 'city-live',
      hour: 18.2,
      viewport: { width: 1280, height: 800 },
      start: 32,
      speed: 2,
      frames: 80,
    },
    {
      name: 'residents-life',
      hour: 12,
      viewport: { width: 1280, height: 800 },
      start: 6,
      speed: 8,
      frames: 100,
    },
  ]) {
    const { context, page } = await open(
      clip.viewport,
      'bund',
      clip.hour,
      clip.name === 'city-live',
    );
    const directory = path.join(out, clip.name);
    await fs.mkdir(directory, { recursive: true });
    const initial = await frame(page, clip.start);
    const crop =
      clip.name === 'residents-life'
        ? {
            x: 165,
            y: Math.max(0, (initial.promenade - 12) * 14),
            width: 1060,
            height: 800 - Math.max(0, (initial.promenade - 12) * 14),
          }
        : undefined;
    const states = [];
    const sent = new Set();
    for (let index = 0; index < clip.frames; index++) {
      const seconds = clip.start + (index * clip.speed) / 10;
      const schedule =
        clip.name === 'city-live'
          ? [
              [32, 'agent.tool', { kind: 'edit' }],
              [36, 'agent.todo', { done: 3, total: 5, current: '连接统一事件流' }],
              [39, 'agent.tool', { kind: 'test', ok: true }],
              [42, 'agent.todo', { done: 5, total: 5, current: '完成验收' }],
              [45, 'agent.session', { state: 'end', name: 'Codex' }],
            ]
          : [
              [6, 'agent.tool', { kind: 'edit' }],
              [14, 'agent.todo', { done: 5, total: 5, current: '完成验收' }],
              [14, 'agent.session', { state: 'end', name: 'Codex' }],
            ];
      for (const [eventIndex, [when, type, data]] of schedule.entries()) {
        if (seconds < when || sent.has(eventIndex)) continue;
        await frame(page, when);
        await page.evaluate(({ type, data }) => window.__readmeEvent(type, data), { type, data });
        sent.add(eventIndex);
      }
      const state = await frame(page, seconds);
      assert.ok(state.finite && state.fleet <= 14);
      states.push(state);
      await page.screenshot({
        path: path.join(directory, `${String(index).padStart(3, '0')}.png`),
        ...(crop ? { clip: crop } : {}),
      });
    }
    if (clip.name === 'residents-life') {
      for (const [signal, activity] of [
        ['awaiting', 'sit'],
        ['done', 'board'],
        ['done', 'ride'],
        ['done', 'gone'],
      ])
        assert.ok(
          states.some((s) =>
            s.residents.some((r) => r.signal === signal && r.activity === activity),
          ),
          `${signal}/${activity} occurs`,
        );
      assert.ok(states.some((s) => s.residents.some((r) => r.activity === 'buy')));
    }
    report.clips.push({ ...clip, crop, fps: 10, states });
    console.log(JSON.stringify({ clip: clip.name, frames: states.length, crop }));
    await context.close();
  }
  assert.deepEqual(errors, []);
  await fs.writeFile(
    path.join(out, 'capture.json'),
    JSON.stringify({ ...report, errors }, null, 2),
  );
  console.log(
    JSON.stringify({ screenshots: report.screenshots.length, clips: report.clips.length, errors }),
  );
} finally {
  await browser.close();
}
