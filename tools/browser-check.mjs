import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';

const root = process.cwd();
const directory = path.join(root, 'artifacts', 'qa');
await fs.mkdir(directory, { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
  args: ['--no-first-run', '--disable-background-networking'],
});
const errors = [];
const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1, colorScheme: 'dark' });
await context.route('https://**', route => route.abort());
const page = await context.newPage();
page.on('pageerror', error => errors.push(error.message));
page.on('console', message => { if (message.type() === 'error') console.log('Browser console:', message.text()); });
try {
  await page.goto(process.env.CITY_URL || 'http://127.0.0.1:4173/?qa=1', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => Boolean(window.__city), null, { timeout: 10000 }).catch(async error => {
    console.log('Startup failure:', await page.locator('body').innerText(), errors);
    await page.screenshot({ path: path.join(directory, 'startup-error.png') });
    throw error;
  });
  await page.waitForTimeout(1500);
  const initial = await page.evaluate(() => {
    const engine = window.__city.engine();
    return { cols: engine.world.cols, rows: engine.world.rows, agents: engine.world.agents.length, ...window.__city.metrics(), error: document.getElementById('nogl').hidden ? null : document.getElementById('nogl').textContent };
  });
  assert.equal(initial.error, null);
  assert.equal(initial.agents, 2);
  await page.screenshot({ path: path.join(directory, '01-bund.png') });
  for (const scene of ['nyc', 'hk']) {
    await page.locator(`[data-group=scene] [data-v=${scene}]`).click();
    await page.waitForTimeout(350);
    assert.equal(await page.evaluate(() => window.__city.engine().world.sceneKey), scene);
    await page.screenshot({ path: path.join(directory, `02-${scene}.png`) });
  }
  await page.locator('[data-ev=await]').click();
  await page.waitForTimeout(500);
  assert.equal(await page.evaluate(() => window.__city.engine().world.agents[0].state), 'awaiting');
  assert.match(await page.locator('#statusline').textContent(), /等你确认/);
  await page.screenshot({ path: path.join(directory, '03-awaiting.png') });
  await page.locator('#privacyChk').check();
  await page.waitForTimeout(150);
  assert.doesNotMatch(await page.locator('#statusline').textContent(), /修复登录测试|构建城市渲染器/);
  assert.doesNotMatch(await page.locator('#agentFeed').textContent(), /修复登录测试|构建城市渲染器/);
  const exported = await page.evaluate(() => window.asciiCity.export());
  assert.doesNotMatch(exported, /修复登录测试|构建城市渲染器|城市电台/);
  await fs.writeFile(path.join(directory, 'sanitized-recording.jsonl'), exported);
  await page.locator('#timeCursor').evaluate(element => {
    element.value = String(Number(element.max) / 2); element.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => document.getElementById('panel').classList.contains('replaying'));
  await page.screenshot({ path: path.join(directory, '04-replay.png') });
  await page.locator('#liveBtn').click();
  await page.locator('#hideBtn').click();
  await page.waitForTimeout(1500);
  assert.equal(await page.locator('body').evaluate(element => element.classList.contains('wallpaper')), true);
  const wallpaper = await page.evaluate(() => window.__city.metrics());
  await page.screenshot({ path: path.join(directory, '05-wallpaper.png') });
  await page.keyboard.press('h');
  assert.equal(await page.locator('body').evaluate(element => element.classList.contains('live')), true);
  await page.locator('[data-group=theme] [data-v=ink]').click();
  await page.waitForTimeout(150);
  await page.screenshot({ path: path.join(directory, '06-ink.png') });
  await page.locator('[data-group=density] [data-v="7"]').click();
  await page.waitForTimeout(450);
  assert.ok(await page.evaluate(() => window.__city.engine().world.cols > 214));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: path.join(directory, '07-small-window.png') });
  assert.deepEqual(errors, []);
  await page.locator('#importFile').setInputFiles(path.join(directory, 'sanitized-recording.jsonl'));
  await page.waitForFunction(() => document.getElementById('panel').classList.contains('replaying'));
  await page.locator('#playBtn').click();
  await page.waitForTimeout(400);
  assert.ok(await page.evaluate(() => window.__city.engine().world.tick > 0));
  await page.locator('#liveBtn').click();
  assert.deepEqual(errors, []);
  await fs.writeFile(path.join(directory, 'browser-report.json'), JSON.stringify({ initial, wallpaper, errors }, null, 2));
  console.log(JSON.stringify({ initial, wallpaper, errors }, null, 2));
} finally {
  await context.close(); await browser.close();
}
