import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd(),
  out = path.join(root, 'artifacts/waterfront');
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
const command = (command) => request('/command', { command });
const original = JSON.parse(
  (await fs.readFile(path.join(out, 'config-before-upgrade.json'), 'utf8')).replace(/^\uFEFF/, ''),
);
const initial = await request('/status');
assert.equal(initial.version, '0.8.0');
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
  await command('resume');
  const url = new URL(page.url());
  url.searchParams.set('qa', '1');
  await page.goto(url.href);
  await page.waitForFunction(() => window.__city);
  await command('wallpaper');
  await page.waitForTimeout(8000);
  const actual = await page.evaluate(() => {
    const W = window.__city.live().world;
    return {
      cols: W.cols,
      rows: W.rows,
      t: W.t,
      activeAgentCount: W.agents.filter((a) => a.state !== 'ended').length,
      residentCount: W.residents.length,
      agentResidents: W.residents
        .filter((r) => r.agent >= 0)
        .map((r) => ({
          agentId: r.agent,
          source: W.agents[r.agent]?.src,
          agentState: W.agents[r.agent]?.state,
          toolCalls: W.agents[r.agent]?.calls,
          signal: r.signal,
          activity: r.activity,
          goal: r.goal,
        })),
      distantCells: Array.from(W.ent).filter((i) => W.entities[i]?.kind === 'district').length,
      retainedEventCount: window.__city.live().events.length,
    };
  });
  console.log(
    JSON.stringify({ collectorStatus: (await request('/status')).sources, actual }, null, 2),
  );
  assert.ok(
    actual.agentResidents.length > 0,
    'Actual collector sessions have corresponding residents',
  );
  assert.ok(actual.agentResidents.every((r) => r.source && Number.isInteger(r.toolCalls)));
  assert.ok(actual.residentCount <= 14);
  assert.ok(actual.distantCells > 0);
  await page.screenshot({ path: path.join(out, 'native-wallpaper.png') });
  const screen = await page.evaluate(() => ({ width: innerWidth, height: innerHeight }));
  await page.screenshot({
    path: path.join(out, 'native-waterfront.png'),
    clip: { x: 0, y: Math.floor(screen.height * 0.62), width: screen.width, height: screen.height - Math.floor(screen.height * 0.62) },
  });
  await command('interactive');
  await page.waitForFunction(() => document.body.classList.contains('live'));
  await page.waitForTimeout(600);
  const point = await page.evaluate(() => {
    const W = window.__city.engine().world;
    const box = document.getElementById('world').getBoundingClientRect();
    for (let i = 0; i < W.N; i++)
      if (
        W.entities[W.ent[i]]?.kind === 'resident' &&
        ['buy', 'sit', 'work', 'wait'].includes(W.entities[W.ent[i]].ref.activity)
      ) {
        const point = {
          x: box.left + (((i % W.cols) + 0.5) * box.width) / W.cols,
          y: box.top + ((Math.floor(i / W.cols) + 0.5) * box.height) / W.rows,
        };
        if (document.elementFromPoint(point.x, point.y)?.id === 'world') return point;
      }
    return null;
  });
  assert.ok(point);
  await page.mouse.move(point.x, point.y);
  await page.waitForTimeout(200);
  const tip = await page.locator('#tip').textContent();
  console.log(
    JSON.stringify({
      point,
      tip,
      hit: await page.evaluate((p) => document.elementFromPoint(p.x, p.y)?.id, point),
    }),
  );
  assert.ok(tip.includes('居民'));
  await page.screenshot({ path: path.join(out, 'native-resident-tooltip.png') });
  const current = await request('/status');
  assert.equal(current.metrics.rejectedEvents, 0);
  assert.deepEqual(errors, []);
  const report = {
    version: current.version,
    scope: 'Actual native collector sessions. No synthetic Agent events were injected.',
    configurationPreserved: true,
    residentTooltip: true,
    actual,
    errors,
  };
  await fs.writeFile(path.join(out, 'native-checks.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await request('/config', original);
  await command(initial.manualPause ? 'pause' : 'resume');
  await command('wallpaper');
  await browser.close();
}
