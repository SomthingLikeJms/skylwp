import { createRequire } from 'node:module';
import fs from 'node:fs/promises';
import path from 'node:path';
import assert from 'node:assert/strict';
const root = process.cwd(),
  { chromium } = createRequire(path.join(root, 'package.json'))('playwright-core'),
  out = path.join(root, 'artifacts/optimization');
const runtime = JSON.parse(
  await fs.readFile(path.join(root, 'outputs/AsciiCity-Wallpaper/data/runtime.json'), 'utf8'),
);
const base = 'http://127.0.0.1:' + runtime.port,
  headers = { Authorization: 'Bearer ' + runtime.token, 'Content-Type': 'application/json' };
const request = async (route, body) => {
  const r = await fetch(base + route, {
    headers,
    ...(body ? { method: 'POST', body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(8000),
  });
  assert.ok(r.ok, route + ': ' + r.status);
  return r.json();
};
const status = () => request('/status'),
  command = (c) => request('/command', { command: c }),
  sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const browser = await chromium.connectOverCDP(process.env.CITY_CDP_URL || 'http://127.0.0.1:9223');
const page = browser
  .contexts()
  .flatMap((c) => c.pages())
  .find((p) => p.url().includes('tauri.localhost'));
assert.ok(page);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const original = await status();
const phase = process.argv[2] || 'check';
const setMode = async (mode) => {
  await command(mode);
  await page.waitForFunction(
    (mode) => document.body.classList.contains(mode === 'interactive' ? 'live' : 'wallpaper'),
    mode,
  );
};
const readRecord = () =>
  page.evaluate(() => {
    const rows = window.asciiCity
      .export()
      .trim()
      .split('\n')
      .map((v) => JSON.parse(v));
    const counts = {};
    for (const e of rows.slice(1)) counts[e.type] = (counts[e.type] || 0) + 1;
    return { header: { rules: rows[0].rules, audio: rows[0].audio }, counts };
  });
try {
  await page.waitForFunction(() => window.asciiCity);
  if (phase === 'check') {
    assert.ok(original.version);
    assert.ok(original.parent > 0);
    assert.equal(original.metrics.rejectedEvents, 0);
    const origin = await page.evaluate(() => performance.timeOrigin),
      modes = [];
    for (let i = 0; i < 30; i++) {
      await setMode('interactive');
      await sleep(70);
      await setMode('wallpaper');
      await sleep(130);
      const s = await status();
      assert.equal(s.mode, 'wallpaper');
      modes.push(s.mode);
    }
    await page.evaluate(() => {
      const raf = window.requestAnimationFrame;
      window.__rafCounter = 0;
      window.requestAnimationFrame = (cb) =>
        raf.call(window, (t) => {
          window.__rafCounter++;
          cb(t);
        });
    });
    const loops = [];
    const config = { ...(await status()).config, pauseWhenCovered: false };
    await request('/config', config);
    for (const [mode, pause, seconds] of [
      ['wallpaper', false, 5],
      ['interactive', false, 5],
      ['wallpaper', true, 4],
    ]) {
      await setMode(mode);
      await command(pause ? 'pause' : 'resume');
      await sleep(700);
      const a = await page.evaluate(() => ({
        count: window.__rafCounter,
        time: performance.now(),
      }));
      await sleep(seconds * 1000);
      const b = await page.evaluate(() => ({
        count: window.__rafCounter,
        time: performance.now(),
      }));
      const rate = ((b.count - a.count) * 1000) / (b.time - a.time),
        s = await status();
      loops.push({
        mode,
        paused: pause,
        seconds: (b.time - a.time) / 1000,
        animationCallbacks: b.count - a.count,
        callbacksPerSecond: rate,
        fps: s.metrics.fps,
      });
      if (pause) assert.equal(b.count - a.count, 0);
      else
        assert.ok(
          rate > (mode === 'interactive' ? 25 : 10) && rate < (mode === 'interactive' ? 34 : 14),
          JSON.stringify(loops.at(-1)),
        );
    }
    await command('resume');
    await setMode('wallpaper');
    const before = await status();
    await sleep(6500);
    const after = await status(),
      record = await readRecord();
    assert.equal(record.counts['audio.frame'] || 0, 0);
    assert.equal(record.header.audio, 'live-only');
    assert.equal(after.metrics.rejectedEvents, 0);
    assert.ok(
      after.counters['audio.frame'] - before.counters['audio.frame'] <= 7,
      'Silence is still emitted at high rate',
    );
    assert.ok(
      after.counters.presence - before.counters.presence <= 1,
      'Presence heartbeats were not deduplicated',
    );
    assert.match(after.sources.desktop, /原始鼠标输入/);
    assert.equal(await page.evaluate(() => performance.timeOrigin), origin);
    const result = {
      version: after.version,
      modesTested: modes.length,
      worldReloaded: false,
      loops,
      silentAudioFrames: after.counters['audio.frame'] - before.counters['audio.frame'],
      observationSeconds: 6.5,
      retainedEventCounts: record.counts,
      nativeSources: after.sources,
      metrics: after.metrics,
      errors,
    };
    assert.deepEqual(errors, []);
    await fs.writeFile(path.join(out, 'native-functional.json'), JSON.stringify(result, null, 2));
    console.log(JSON.stringify(result, null, 2));
  } else if (phase === 'browser') {
    const current = await status();
    await request('/config', { ...current.config, pauseWhenCovered: false });
    await setMode('wallpaper');
    await command('resume');
    const groups = () =>
      page.evaluate(() => {
        const row = window.asciiCity
          .export()
          .trim()
          .split('\n')
          .map((v) => JSON.parse(v))
          .filter((e) => e.type === 'browser.tabs')
          .at(-1);
        return (row?.data.tabs || []).reduce((out, t) => {
          const key = t.id.split('-')[0];
          out[key] = (out[key] || 0) + 1;
          return out;
        }, {});
      });
    const initial = await groups(),
      fixture = await chromium.launchPersistentContext(
        path.join(
          root,
          `artifacts/browser-test-${process.env.CITY_BROWSER_PATH ? 'chrome' : 'edge'}-profile`,
        ),
        {
          executablePath:
            process.env.CITY_BROWSER_PATH ||
            'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
          headless: false,
          viewport: { width: 800, height: 600 },
          args: ['--no-first-run', '--force-renderer-accessibility'],
        },
      );
    let fixtureKey;
    const waitOwn = async (expected, timeout = 12000) => {
      const start = Date.now();
      while (Date.now() - start < timeout) {
        const current = await groups();
        fixtureKey ??= Object.keys(current).find((key) => !(key in initial));
        if (fixtureKey && (current[fixtureKey] || 0) === expected) return Date.now() - start;
        await sleep(250);
      }
      throw new Error(
        'Fixture tab count did not reach ' +
          expected +
          '; groups ' +
          JSON.stringify(await groups()),
      );
    };
    try {
      await waitOwn(1);
      const added = await fixture.newPage();
      await added.goto('about:blank');
      const addDelayMs = await waitOwn(2);
      await added.close();
      const closeDelayMs = await waitOwn(1);
      const report = {
        windowGroup: fixtureKey,
        fixtureWindowAdded: true,
        tabAddedAndClosed: true,
        addDelayMs,
        closeDelayMs,
        errors,
      };
      await fs.writeFile(path.join(out, 'browser-events.json'), JSON.stringify(report, null, 2));
      console.log(JSON.stringify(report, null, 2));
    } finally {
      await fixture.close();
      if (fixtureKey) await waitOwn(0);
    }
  } else if (phase === 'capture') {
    await setMode('wallpaper');
    await command('resume');
    await sleep(700);
    await page.screenshot({ path: path.join(out, 'wallpaper.png') });
    console.log(
      JSON.stringify(
        {
          version: original.version,
          config: original.config,
          metrics: (await status()).metrics,
          errors,
        },
        null,
        2,
      ),
    );
  }
} finally {
  const current = await status();
  await request('/config', {
    ...current.config,
    pauseWhenCovered: original.config.pauseWhenCovered,
  });
  await command(original.manualPause ? 'pause' : 'resume');
  await setMode(original.mode);
  await browser.close();
}
