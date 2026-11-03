import { expect, test } from 'vitest';
import { parseEvent, makeEvent } from '../src/events/protocol';
import { parseRecording, serializeRecording } from '../src/events/log';
import { CityEngine, DEFAULT_SETTINGS } from '../src/events/replay';
import { scenarioEvents } from '../src/events/sim/demo';

test('rejects malformed, out-of-range and ambiguous agent events', () => {
  expect(() =>
    parseEvent({
      v: 1,
      ts: 0,
      src: 'system',
      type: 'sys.sample',
      data: { cpu: NaN, mem: 0, net: 0 },
    }),
  ).toThrow();
  expect(() =>
    parseEvent({
      v: 1,
      ts: 0,
      src: 'codex',
      type: 'agent.todo',
      data: { done: 4, total: 2, current: 'x' },
    }),
  ).toThrow();
  expect(() => parseEvent({ v: 1, ts: 0, src: 'codex', type: 'agent.error', data: {} })).toThrow();
  expect(() =>
    parseEvent({
      v: 1,
      ts: 0,
      src: 'browser',
      type: 'browser.tabs',
      data: {
        tabs: [
          { id: 'a', cat: '文档' },
          { id: 'a', cat: '文档' },
        ],
      },
    }),
  ).toThrow();
  expect(() => parseEvent({ v: 1, ts: 0, src: 'sim', type: '__proto__', data: {} })).toThrow();
});

test('clones incoming data instead of retaining the caller object', () => {
  const input = {
    v: 1,
    ts: 0,
    src: 'system',
    type: 'sys.sample',
    data: { cpu: 0.1, mem: 0.2, net: 0.3 },
  };
  const event = parseEvent(input);
  input.data.cpu = 1;
  expect(event.data).toEqual({ cpu: 0.1, mem: 0.2, net: 0.3 });
});

test('browser URLs and titles cannot enter the event log', () => {
  expect(() =>
    parseEvent({
      v: 1,
      ts: 0,
      src: 'browser',
      type: 'browser.tabs',
      data: { tabs: [{ id: 'a', cat: '文档', url: 'https://private.example/' }] },
    }),
  ).toThrow();
  expect(() =>
    parseEvent({
      v: 1,
      ts: 0,
      src: 'system',
      type: 'sys.sample',
      data: { cpu: 0, mem: 0, net: 0, secret: 'x' },
    }),
  ).toThrow();
});

const recording = () => ({
  config: { seed: 20261102, epoch: 100000, cols: 80, rows: 40, settings: { ...DEFAULT_SETTINGS } },
  events: scenarioEvents(100000),
  durationMs: 32000,
});

test('default export removes private text and imports into the same semantic world', () => {
  const original = recording();
  const text = serializeRecording(original);
  expect(text).not.toContain('修复登录测试');
  expect(text).not.toContain('城市电台');
  const imported = parseRecording(text);
  const engine = new CityEngine(imported.config, imported.events);
  engine.advanceTo(imported.durationMs);
  expect(engine.world.agents[1].state).toBe('ended');
  expect(engine.world.agents[1].done).toBe(5);
});

test('explicit private export preserves the exact event replay', () => {
  const original = recording(),
    restored = parseRecording(serializeRecording(original, true));
  const before = new CityEngine(original.config, original.events),
    after = new CityEngine(restored.config, restored.events);
  before.advanceTo(32000);
  after.advanceTo(32000);
  expect(before.snapshot()).toEqual(after.snapshot());
});

test('rejects oversized grids and incompatible rules before allocating', () => {
  const lines = serializeRecording(recording()).split('\n');
  const header = JSON.parse(lines[0]);
  header.cols = 50000;
  lines[0] = JSON.stringify(header);
  expect(() => parseRecording(lines.join('\n'))).toThrow();
  header.cols = 80;
  header.rules = 'future-version';
  lines[0] = JSON.stringify(header);
  expect(() => parseRecording(lines.join('\n'))).toThrow();
});

test('late events from before launch can round-trip using their effective timestamp', () => {
  const original = recording();
  original.events.push({
    ...makeEvent('agent.error', {}, 95000, 'codex', 'demo-codex'),
    at: 101000,
  });
  expect(parseRecording(serializeRecording(original)).events.at(-1)?.at).toBe(101000);
});
