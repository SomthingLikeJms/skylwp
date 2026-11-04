import { expect, test } from 'vitest';
import { CityEngine, DEFAULT_SETTINGS } from '../src/events/replay';
import { makeEvent } from '../src/events/protocol';
import { fleetRequests } from '../src/systems/fleet';
import { parseRecording, serializeRecording } from '../src/events/log';
import { compose } from '../src/compose';

function engine() {
  return new CityEngine({
    seed: 20261102,
    epoch: 0,
    cols: 366,
    rows: 115,
    settings: { ...DEFAULT_SETTINGS, cpu: 0.1, mem: 0.55, net: 0.6, music: true, flow: 'stop' },
  });
}
test('bounded fleet represents existing signals and leaves when their sources stop', () => {
  const e = engine();
  e.world.browserTabs = Array.from({ length: 500 }, (_, n) => ({ id: String(n), cat: 5 }));
  e.append(makeEvent('agent.session', { state: 'start', name: 'Codex' }, 0, 'codex', 'fleet'));
  e.advanceTo(60000);
  const sources = new Set(e.world.ships.filter((s) => !s.leaving).map((s) => s.source));
  expect(sources).toEqual(new Set(['memory', 'agent', 'media', 'network', 'browser']));
  expect(e.world.ships.length).toBeLessThanOrEqual(14);
  expect(e.world.ships.filter((s) => s.source === 'browser' && !s.leaving)).toHaveLength(4);
  expect(new Set(e.world.ships.map((s) => s.kind)).size).toBeGreaterThanOrEqual(5);
  e.world.browserTabs = [];
  e.settings.music = false;
  e.settings.net = 0;
  e.append(makeEvent('agent.session', { state: 'end', name: 'Codex' }, 60000, 'codex', 'fleet'));
  e.advanceTo(180000);
  expect(e.world.ships.every((s) => s.source === 'memory')).toBe(true);
});
test('network fleet has hysteresis and browser grouping is bounded', () => {
  const e = engine(),
    W = e.world;
  W.sig.net = 0.06;
  expect(fleetRequests(W, e.settings).some((r) => r.source === 'network')).toBe(false);
  W.sig.net = 0.08;
  expect(fleetRequests(W, e.settings).filter((r) => r.source === 'network')).toHaveLength(1);
  e.advanceTo(20000);
  W.sig.net = 0.03;
  expect(fleetRequests(W, e.settings).filter((r) => r.source === 'network')).toHaveLength(1);
  W.sig.net = 0.02;
  expect(fleetRequests(W, e.settings).some((r) => r.source === 'network')).toBe(false);
});
test('unknown browser categories and new vessel sources round-trip through checkpoints', () => {
  const e = engine();
  e.world.browserTabs = [{ id: 'other', cat: 5 }];
  e.append(makeEvent('agent.session', { state: 'start', name: 'Codex' }, 0, 'codex', 'fleet'));
  e.advanceTo(18000);
  const recording = {
    config: { ...e.config, initial: e.snapshot() },
    events: [],
    durationMs: e.elapsedMs,
  };
  const parsed = parseRecording(serializeRecording(recording));
  const restored = new CityEngine(parsed.config);
  e.advanceTo(24000);
  restored.advanceTo(24000);
  compose(e.world, e.settings);
  compose(restored.world, restored.settings);
  expect(restored.world.ships).toEqual(e.world.ships);
  expect(restored.world.A).toEqual(e.world.A);
  const invalid = serializeRecording(recording).replace('"source":"memory"', '"source":"unknown"');
  expect(() => parseRecording(invalid)).toThrow('检查点船只无效');
});
