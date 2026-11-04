import { expect, test } from 'vitest';
import { CityEngine, DEFAULT_SETTINGS, type HistoryPolicy } from '../src/events/replay';
import { makeEvent } from '../src/events/protocol';
import { parseRecording, serializeRecording } from '../src/events/log';
const config = () => ({
  seed: 19,
  epoch: 100000,
  cols: 80,
  rows: 40,
  settings: { ...DEFAULT_SETTINGS, flow: 'stop' as const },
});
const policy: HistoryPolicy = {
  windowMs: 2000,
  maxEvents: 100,
  checkpointMs: 500,
  audioFrames: false,
};

test('100,000 live audio frames update the signal without growing recording history', () => {
  const e = new CityEngine(config(), [], policy);
  for (let i = 0; i < 100000; i++)
    e.append(
      makeEvent(
        'audio.frame',
        { bass: (i % 10) / 10, mid: 0, high: 0, onset: false, energy8s: 0 },
        100000,
        'audio',
      ),
    );
  expect(e.world.audio.bass).toBe(0.9);
  expect(e.events.length).toBe(0);
  expect(e.pendingAudioFrames).toBe(0);
  for (let i = 0; i < 1000; i++)
    e.append(
      makeEvent(
        'audio.frame',
        { bass: 0, mid: 0, high: 0, onset: false, energy8s: 0 },
        101000,
        'audio',
      ),
    );
  expect(e.pendingAudioFrames).toBeLessThanOrEqual(90);
  e.advanceTo(1500);
  expect(e.pendingAudioFrames).toBe(0);
});
test('trimming retains a checkpoint and round-trips the retained world, including typed arrays', () => {
  const e = new CityEngine(config(), [], policy);
  for (let i = 0; i < 120; i++) {
    e.advanceTo(i * 100);
    e.append(
      makeEvent(
        'sys.sample',
        { cpu: 0.2 + (i % 3) / 10, mem: 0.5, net: 0.3 },
        100000 + i * 100,
        'system',
      ),
    );
    if (i === 80)
      e.append(
        makeEvent(
          'agent.session',
          { state: 'start', name: 'PRIVATE_TEST_TITLE' },
          108000,
          'codex',
          'session',
        ),
      );
  }
  e.advanceTo(12000);
  expect(e.historyStartMs).toBeGreaterThanOrEqual(10000);
  expect(e.historyStartMs).toBeLessThanOrEqual(10500);
  expect(e.events.length).toBeLessThanOrEqual(25);
  const text = serializeRecording(
    { config: e.config, events: e.events, durationMs: e.elapsedMs },
    true,
  );
  const recording = parseRecording(text),
    copy = new CityEngine(recording.config, recording.events);
  copy.advanceTo(12000);
  expect(copy.world.audio.spectrum).toBeInstanceOf(Float32Array);
  expect(copy.world.weather.cpuHistory).toBeInstanceOf(Float32Array);
  expect(copy.snapshot().state).toEqual(e.snapshot().state);
  expect(copy.world.rng.state).toBe(e.world.rng.state);
  copy.seek(0);
  expect(copy.elapsedMs).toBe(e.historyStartMs);
  const redacted = serializeRecording({
    config: e.config,
    events: e.events,
    durationMs: e.elapsedMs,
  });
  expect(redacted).not.toContain('PRIVATE_TEST_TITLE');
});
test('consumed bursts are compacted; unconsumed future floods cannot grow beyond the bound', () => {
  const e = new CityEngine(config(), [], { ...policy, maxEvents: 10 });
  for (let i = 0; i < 100; i++)
    e.append(makeEvent('sys.sample', { cpu: 0, mem: 0.5, net: 0 }, 100000, 'system'));
  expect(e.events.length).toBeLessThanOrEqual(10);
  const f = new CityEngine(config(), [], { ...policy, maxEvents: 10 });
  for (let i = 0; i < 10; i++)
    f.append(makeEvent('sys.sample', { cpu: 0, mem: 0.5, net: 0 }, 101000 + i, 'system'));
  expect(() =>
    f.append(makeEvent('sys.sample', { cpu: 0, mem: 0.5, net: 0 }, 102000, 'system')),
  ).toThrow();
  expect(f.events).toHaveLength(10);
});
test('malformed snapshots are rejected before they enter the renderer', () => {
  const e = new CityEngine(config(), [], policy);
  e.advanceTo(5000);
  const recording = { config: e.config, events: e.events, durationMs: e.elapsedMs };
  const text = serializeRecording(recording);
  const rows = text.trim().split('\n');
  const header = JSON.parse(rows[0]);
  header.initial.state.audio.spectrum.values = [];
  rows[0] = JSON.stringify(header);
  expect(() => parseRecording(rows.join('\n'))).toThrow();
});

test('checkpoint signals and geometry cannot request unbounded work', () => {
  const e = new CityEngine(config(), [], policy);
  e.advanceTo(5000);
  const text = serializeRecording({ config: e.config, events: e.events, durationMs: e.elapsedMs });
  const invalid: [string[], unknown][] = [
    [['weather', 'rain'], 1e8],
    [['sig', 'net'], 1e8],
    [['towers', '0', 'h'], 1e8],
    [['towers', '0', 'seed'], -1],
    [['audio', 'spectrum', '$typed'], 'Function'],
  ];
  for (const [path, value] of invalid) {
    const lines = text.trim().split('\n'),
      header = JSON.parse(lines[0]);
    let target = header.initial.state;
    for (const key of path.slice(0, -1)) target = target[key];
    target[path.at(-1)!] = value;
    lines[0] = JSON.stringify(header);
    expect(() => parseRecording(lines.join('\n'))).toThrow();
  }
});

test('existing city-v4 through city-v7 recordings can still be imported', () => {
  const e = new CityEngine(config());
  for (const version of ['city-v4', 'city-v5', 'city-v6', 'city-v7']) {
    const text = serializeRecording({ config: e.config, events: [], durationMs: 1000 }).replace(
      'city-v8',
      version,
    );
    expect(parseRecording(text).durationMs).toBe(1000);
  }
});

test('one-second silence heartbeats tolerate jitter without simulated music pulses', () => {
  const e = new CityEngine(config(), [], policy);
  for (let tick = 0; tick < 600; tick++) {
    if (tick % 33 === 0)
      e.append(
        makeEvent(
          'audio.frame',
          { bass: 0, mid: 0, high: 0, onset: false, energy8s: 0 },
          e.config.epoch + e.elapsedMs,
          'audio',
        ),
      );
    e.advanceTo(((tick + 1) * 1000) / 30);
    expect(e.world.musicLvl).toBe(0);
    expect(e.world.beatEnv).toBe(0);
  }
});
