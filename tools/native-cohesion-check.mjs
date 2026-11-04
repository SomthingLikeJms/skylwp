import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd(),
  out = path.join(root, 'artifacts/cohesion');
const runtime = JSON.parse(
  await fs.readFile(path.join(root, 'outputs/AsciiCity-Wallpaper/data/runtime.json'), 'utf8'),
);
async function request(route, body) {
  const r = await fetch(`http://127.0.0.1:${runtime.port}${route}`, {
    headers: { Authorization: `Bearer ${runtime.token}`, 'Content-Type': 'application/json' },
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(8000),
  });
  assert.ok(r.ok);
  return r.json();
}
const original = JSON.parse(
  (await fs.readFile(path.join(out, 'config-before-upgrade.json'), 'utf8')).replace(/^\uFEFF/, ''),
);
const initial = await request('/status');
assert.equal(initial.version, '0.9.1');
assert.deepEqual(initial.config, original);
const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => p.url().includes('tauri.localhost'));
assert.ok(page);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
try {
  await request('/config', { ...original, pauseWhenCovered: false });
  await request('/command', { command: 'resume' });
  const url = new URL(page.url());
  url.searchParams.set('qa', '1');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__city);
  await request('/command', { command: 'wallpaper' });
  await page.waitForTimeout(15000);
  const actual = await page.evaluate(() => {
    const e = window.__city.live(),
      W = e.world;
    return {
      cols: W.cols,
      rows: W.rows,
      scene: W.sceneKey,
      retainedEvents: e.events.length,
      agents: W.agents.filter((a) => a.state !== 'ended').length,
      residents: W.residents.length,
      fleet: W.ships.map((s) => ({ kind: s.kind, source: s.source })),
      finite: [W.br, W.bgc, W.bb, W.fr, W.fgc, W.fb].every((a) => a.every(Number.isFinite)),
      webglError: document.getElementById('nogl').hidden
        ? null
        : document.getElementById('nogl').textContent,
    };
  });
  assert.deepEqual([actual.cols, actual.rows], [366, 115]);
  assert.ok(actual.retainedEvents > 0 && actual.finite && actual.residents <= 14);
  assert.ok(actual.fleet.some((s) => s.source === 'memory'));
  assert.equal(actual.webglError, null);
  await page.screenshot({ path: path.join(out, 'native-wallpaper.png') });
  const current = await request('/status');
  assert.equal(current.metrics.rejectedEvents, 0);
  assert.deepEqual(errors, []);
  const report = {
    version: current.version,
    scope: 'Actual native wallpaper and live signals. No synthetic events injected.',
    actual,
    errors,
  };
  await fs.writeFile(path.join(out, 'native-checks.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await request('/config', original);
  await request('/command', { command: initial.manualPause ? 'pause' : 'resume' });
  await request('/command', { command: 'wallpaper' });
  assert.deepEqual((await request('/status')).config, original);
  await browser.close();
}
