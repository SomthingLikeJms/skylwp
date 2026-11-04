import { chromium } from 'playwright-core';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await chromium.launch({
  executablePath:
    process.env.EDGE_PATH || 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  headless: true,
});
try {
  const page = await browser.newPage();
  await page.goto(process.env.CITY_URL || 'http://127.0.0.1:5173/?qa=1');
  await page.waitForFunction(() => window.__city);
  const cdp = await page.context().newCDPSession(page);
  await page.evaluate(async () => {
    window.__city.freeze();
    const { CityEngine, DEFAULT_SETTINGS, NATIVE_HISTORY } = await import('/src/events/replay.ts');
    window.__stress = {
      engine: new CityEngine(
        {
          seed: 19,
          epoch: 100000,
          cols: 40,
          rows: 20,
          settings: {
            ...DEFAULT_SETTINGS,
            flow: 'stop',
            music: false,
            cpu: 0.1,
            mem: 0.2,
            net: 0,
            agentAct: 0,
          },
        },
        [],
        NATIVE_HISTORY,
      ),
      peakEvents: 0,
      received: 0,
    };
  });
  const samples = [];
  for (let hour = 0; hour < 24; hour++) {
    const sample = await page.evaluate((hour) => {
      const state = window.__stress,
        e = state.engine;
      for (let s = hour * 3600 + 1; s <= (hour + 1) * 3600; s++) {
        e.advanceTo(s * 1000);
        e.append({
          v: 1,
          ts: 100000 + s * 1000,
          src: 'system',
          type: 'sys.sample',
          data: { cpu: 0.1, mem: 0.2, net: 0 },
        });
        for (let frame = 0; frame < 30; frame++)
          e.append({
            v: 1,
            ts: 100000 + s * 1000,
            src: 'audio',
            type: 'audio.frame',
            data: {
              bass: 0,
              mid: 0,
              high: 0,
              onset: false,
              energy8s: 0,
              spectrum: [0, 0, 0, 0, 0, 0, 0],
            },
          });
        state.received += 31;
        state.peakEvents = Math.max(state.peakEvents, e.events.length);
      }
      return {
        hour: hour + 1,
        received: state.received,
        events: e.events.length,
        peakEvents: state.peakEvents,
        audioEvents: e.events.filter((v) => v.type === 'audio.frame').length,
        pendingAudioFrames: e.pendingAudioFrames,
        historyStartMs: e.historyStartMs,
      };
    }, hour);
    await cdp.send('HeapProfiler.collectGarbage');
    const heap = await cdp.send('Runtime.getHeapUsage');
    samples.push({ ...sample, usedHeapMiB: heap.usedSize / 1048576 });
    assert.equal(sample.audioEvents, 0);
    assert.ok(sample.events <= 10000);
    assert.ok(sample.pendingAudioFrames <= 90);
    assert.ok(
      sample.historyStartMs <= (hour + 1) * 3600000 - 15 * 60000 + 30001,
      'Frequent events discarded checkpoint intervals',
    );
  }
  const exported = await page.evaluate(async () => {
    const e = window.__stress.engine,
      { serializeRecording, parseRecording } = await import('/src/events/log.ts');
    const text = serializeRecording({
      config: e.config,
      events: e.events,
      durationMs: e.elapsedMs,
    });
    const copy = parseRecording(text);
    return {
      bytes: new TextEncoder().encode(text).length,
      startMs: (copy.config.initial.tick * 1000) / 30,
      durationMs: copy.durationMs,
      audioMode: copy.config.audio,
    };
  });
  assert.ok(exported.startMs >= 24 * 3600000 - 15 * 60000);
  const report = {
    scope:
      'Accelerated 24-hour synthetic event-history stress test; 1 Hz system + 30 Hz audio; small grid; forced GC after each simulated hour; no claim of overnight native uptime',
    samples,
    exported,
  };
  await fs.mkdir('artifacts/optimization', { recursive: true });
  await fs.writeFile('artifacts/optimization/history-stress.json', JSON.stringify(report, null, 2));
  console.log(
    JSON.stringify(
      {
        received: samples.at(-1).received,
        peakEvents: samples.at(-1).peakEvents,
        last: samples.at(-1),
        exported,
      },
      null,
      2,
    ),
  );
} finally {
  await browser.close();
}
