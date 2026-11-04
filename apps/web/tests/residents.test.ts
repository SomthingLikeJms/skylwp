import { expect, test } from 'vitest';
import { CityEngine, DEFAULT_SETTINGS, RULE_VERSION } from '../src/events/replay';
import { makeEvent, parseEvent } from '../src/events/protocol';
import { parseRecording, serializeRecording } from '../src/events/log';
import { ferryPose, lifeLayout, MAX_RESIDENTS } from '../src/systems/residents';
import type { SceneKey } from '../src/world/types';

function engine(scene: SceneKey = 'bund') {
  return new CityEngine(
    {
      seed: 20261102,
      epoch: 100000,
      cols: 214,
      rows: 60,
      settings: { ...DEFAULT_SETTINGS, scene, flow: 'stop', music: false, cpu: 0.1, mem: 0.2 },
    },
    [],
    { windowMs: 3000, maxEvents: 100, checkpointMs: 1000, audioFrames: false },
  );
}
const now = (e: CityEngine) => e.config.epoch + e.elapsedMs;
function start(e: CityEngine, session = 'real') {
  e.append(makeEvent('agent.session', { state: 'start', name: 'Codex' }, now(e), 'codex', session));
}

test('residents buy, sit, queue and board without double booking facilities', () => {
  for (const scene of ['bund', 'nyc', 'hk'] as const) {
    const e = engine(scene),
      activities = new Set<string>();
    for (let i = 1; i <= 5400; i++) {
      e.advanceTo((i * 1000) / 30);
      const people = e.world.residents;
      for (const r of people) activities.add(r.activity);
      expect(people.filter((r) => r.activity === 'buy').length).toBeLessThanOrEqual(1);
      const seats = people.filter((r) => r.goal === 'bench' && r.slot >= 0).map((r) => r.slot);
      expect(new Set(seats).size).toBe(seats.length);
      expect(seats.length).toBeLessThanOrEqual(2);
      const passengers = people.filter((r) => r.activity === 'board' || r.activity === 'ride');
      expect(new Set(passengers.map((r) => r.slot)).size).toBe(passengers.length);
      expect(passengers.length).toBeLessThanOrEqual(6);
    }
    for (const state of ['buy', 'sit', 'wait', 'board', 'ride'])
      expect(activities.has(state)).toBe(true);
  }
});

test('actual agent events drive a persistent person; silence is not task completion', () => {
  const e = engine();
  start(e);
  e.append(makeEvent('agent.activity', { phase: 'thinking' }, now(e), 'codex', 'real'));
  e.advanceTo(1000);
  const r = e.world.residents.find((r) => r.agent === 0)!;
  expect(r.goal).toBe('shop');
  e.append(makeEvent('agent.await', { on: true, reason: 'input' }, now(e), 'codex', 'real'));
  e.advanceTo(30000);
  expect(r.activity).toBe('sit');
  e.advanceTo(60000);
  expect(r.activity).toBe('sit');
  e.append(makeEvent('agent.tool', { kind: 'edit' }, now(e), 'codex', 'real'));
  e.advanceTo(80000);
  expect(r.activity).toBe('work');
  e.advanceTo(110000);
  expect(r.signal).toBe('idle');
  expect(r.goal).toBe('shop');
  expect(r.signal).not.toBe('done');
  e.append(makeEvent('agent.session', { state: 'end', name: 'Codex' }, now(e), 'codex', 'real'));
  e.advanceTo(300000);
  expect(r.signal).toBe('done');
  expect(r.activity).toBe('gone');
});

test('a resumed plan waits until a passenger finishes the crossing', () => {
  const e = engine();
  start(e);
  e.append(makeEvent('agent.todo', { done: 1, total: 1, current: '' }, now(e), 'codex', 'real'));
  e.advanceTo(40000);
  const r = e.world.residents.find((r) => r.agent === 0)!;
  expect(r.activity).toBe('ride');
  const trip = ferryPose(e.world).trip;
  e.append(
    makeEvent('agent.todo', { done: 1, total: 2, current: 'Next' }, now(e), 'codex', 'real'),
  );
  e.append(makeEvent('agent.tool', { kind: 'edit' }, now(e), 'codex', 'real'));
  e.advanceTo(41000);
  expect(r.activity).toBe('ride');
  expect(r.signal).toBe('working');
  while (ferryPose(e.world).trip === trip) e.advanceTo(e.elapsedMs + 1000);
  expect(r.activity).toBe('walk');
  expect(r.goal).toBe('work');
});

test('resident count stays bounded after many completed sessions', () => {
  const e = engine();
  for (let i = 0; i < 12; i++) {
    start(e, `ended-${i}`);
    e.append(
      makeEvent('agent.session', { state: 'end', name: 'Codex' }, now(e), 'codex', `ended-${i}`),
    );
  }
  for (let i = 0; i < 5; i++) start(e, `active-${i}`);
  e.advanceTo(2000);
  expect(e.world.residents).toHaveLength(MAX_RESIDENTS);
  expect(new Set(e.world.residents.map((r) => r.id)).size).toBe(MAX_RESIDENTS);
});

test('resident trips survive checkpoint export, replay, resize and scene changes', () => {
  const e = engine();
  start(e);
  e.append(makeEvent('agent.await', { on: true, reason: 'input' }, now(e), 'codex', 'real'));
  e.advanceTo(60000);
  const recording = parseRecording(
    serializeRecording({ config: e.config, events: e.events, durationMs: e.elapsedMs }, true),
  );
  const copy = new CityEngine(recording.config, recording.events);
  copy.advanceTo(e.elapsedMs);
  expect(copy.world.residents).toEqual(e.world.residents);
  copy.advanceTo(70000);
  e.advanceTo(70000);
  expect(copy.world.residents).toEqual(e.world.residents);
  const resized = e.reconfigure(427, 120);
  resized.advanceTo(e.elapsedMs + 1000);
  for (const r of resized.world.residents) {
    expect(Number.isFinite(r.x) && Number.isFinite(r.y)).toBe(true);
    expect(r.x).toBeLessThan(447);
    expect(r.y).toBeLessThan(130);
  }
  e.append(makeEvent('world.scene', { scene: 'hk' }, now(e)));
  e.advanceTo(100000);
  const waiting = e.world.residents.find((r) => r.agent === 0)!;
  expect(waiting.activity).toBe('sit');
  expect(waiting.x).toBe(lifeLayout(e.world).benchX + waiting.slot * 4 - 2);
});

test('old checkpoints migrate residents while current malformed state is rejected', () => {
  const e = engine();
  e.advanceTo(10000);
  const lines = serializeRecording({ config: e.config, events: e.events, durationMs: e.elapsedMs })
    .trim()
    .split('\n');
  const header = JSON.parse(lines[0]);
  expect(header.rules).toBe(RULE_VERSION);
  delete header.initial.state.residents;
  lines[0] = JSON.stringify(header);
  expect(() => parseRecording(lines.join('\n'))).toThrow();
  header.rules = 'city-v6';
  lines[0] = JSON.stringify(header);
  const old = parseRecording(lines.join('\n')),
    copy = new CityEngine(old.config, old.events);
  copy.advanceTo(11000);
  expect(copy.world.residents).toHaveLength(4);
  header.rules = RULE_VERSION;
  header.initial.state.residents = e.world.residents;
  header.initial.state.residents[0].agent = 999;
  lines[0] = JSON.stringify(header);
  expect(() => parseRecording(lines.join('\n'))).toThrow();
});

test('collector expiry and disabled collection do not celebrate task completion', () => {
  const e = engine();
  start(e);
  e.advanceTo(1000);
  const before = e.world.particles.length;
  e.append(
    makeEvent(
      'agent.session',
      { state: 'end', name: 'Codex', reason: 'inactive' },
      now(e),
      'codex',
      'real',
    ),
  );
  e.advanceTo(1034);
  expect(e.world.agents[0].inactive).toBe(true);
  expect(e.world.residents.find((r) => r.agent === 0)?.signal).toBe('idle');
  expect(e.world.particles.length).toBeLessThanOrEqual(before);
  expect(() =>
    parseEvent({
      v: 1,
      ts: now(e),
      src: 'codex',
      session: 'real',
      type: 'agent.session',
      data: { state: 'start', name: 'Codex', reason: 'inactive' },
    }),
  ).toThrow();
});
