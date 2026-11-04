import { expect, test } from 'vitest';
import { CityEngine, DEFAULT_SETTINGS } from '../src/events/replay';
import { makeEvent, parseEvent } from '../src/events/protocol';
import { compose } from '../src/compose';

const config = () => ({
  seed: 20261102,
  epoch: 100000,
  cols: 214,
  rows: 60,
  settings: { ...DEFAULT_SETTINGS, music: true },
});

test('real spectrum frames animate only ordinary buildings and remain replayable', () => {
  const live = new CityEngine(config());
  live.append(
    makeEvent(
      'audio.frame',
      {
        bass: 0.6,
        mid: 0.8,
        high: 0.3,
        onset: true,
        energy8s: 0.5,
        spectrum: [1, 0.8, 0.6, 0.4, 0.2, 0.1, 0],
      },
      100000,
      'audio',
    ),
  );
  live.advanceTo(500);
  expect(live.world.audio.levels[0]).toBeGreaterThan(0.9);
  expect(live.world.towers.filter((t) => t.spectrum >= 0).length).toBeGreaterThan(3);
  expect(live.world.towers.filter((t) => t.spectrum >= 0).every((t) => t.kind === 'gen')).toBe(
    true,
  );
  const replay = new CityEngine(config(), live.events);
  replay.advanceTo(500);
  compose(live.world, live.settings);
  compose(replay.world, replay.settings);
  expect(live.world.A).toEqual(replay.world.A);
});

test('consecutive real turns can reuse completed plots after five sessions', () => {
  const live = new CityEngine(config());
  for (let i = 0; i < 12; i++) {
    live.append(
      makeEvent('agent.session', { state: 'start', name: 'Codex' }, 100000, 'codex', `turn-${i}`),
    );
    const agent = live.world.agents.at(-1)!;
    expect(agent.session).toBe(`turn-${i}`);
    expect(agent.site).toBeGreaterThanOrEqual(0);
    live.append(
      makeEvent('agent.session', { state: 'end', name: 'Codex' }, 100000, 'codex', `turn-${i}`),
    );
  }
  expect(live.world.agents).toHaveLength(12);
  expect(live.world.walkers.length).toBeLessThanOrEqual(2);
});

test('malformed optional spectrum data is rejected at the boundary', () => {
  expect(() =>
    parseEvent({
      v: 1,
      ts: 1,
      src: 'audio',
      type: 'audio.frame',
      data: { bass: 0, mid: 0, high: 0, onset: false, energy8s: 0, spectrum: [2] },
    }),
  ).toThrow();
});

test('real Agent activity is visible without a plan and can resume after waiting', () => {
  const live = new CityEngine(config());
  live.append(
    makeEvent('agent.session', { state: 'start', name: 'Codex' }, 100000, 'codex', 'real'),
  );
  live.append(makeEvent('agent.activity', { phase: 'thinking' }, 100000, 'codex', 'real'));
  const a = live.world.agents[0],
    tower = live.world.towers[a.site];
  expect(a.total).toBe(0);
  expect(a.phase).toBe('thinking');
  expect(tower.target).toBeGreaterThanOrEqual(4);
  live.append(makeEvent('agent.await', { on: true, reason: 'input' }, 100000, 'codex', 'real'));
  live.append(makeEvent('agent.tool', { kind: 'edit' }, 100000, 'codex', 'real'));
  expect(a.state).toBe('working');
  expect(a.calls).toBe(1);
  expect(a.tool).toBe('edit');
});

test('a real working Agent keeps construction active while the user is idle', () => {
  const c = config();
  c.settings = { ...c.settings, away: true };
  const live = new CityEngine(c);
  live.append(
    makeEvent('agent.session', { state: 'start', name: 'Codex' }, 100000, 'codex', 'idle-work'),
  );
  live.append(makeEvent('agent.tool', { kind: 'edit' }, 100000, 'codex', 'idle-work'));
  live.advanceTo(10000);
  expect(live.world.away).toBeGreaterThan(0.95);
  expect(live.world.act).toBeGreaterThan(0.45);
  // Sparks have a finite lifetime; inspect a time window rather than one random frame.
  let emitted = false;
  for (let ms = 10000; ms <= 12000; ms += 100) {
    live.advanceTo(ms);
    emitted ||= live.world.particles.some((p) => p.kind === 'spark');
  }
  expect(emitted).toBe(true);
});
