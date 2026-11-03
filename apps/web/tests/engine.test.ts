import { describe, expect, test } from 'vitest';
import { createHash } from 'node:crypto';
import { CityEngine, DEFAULT_SETTINGS, TICK_MS } from '../src/events/replay';
import { scenarioEvents } from '../src/events/sim/demo';
import { makeEvent } from '../src/events/protocol';
import { compose } from '../src/compose';
import type { SceneKey } from '../src/world/types';

const config = (scene: SceneKey = 'bund') => ({
  seed: 20261102,
  epoch: 100000,
  cols: 214,
  rows: 60,
  settings: { ...DEFAULT_SETTINGS, scene, flow: 'stop' as const },
});
const frame = (engine: CityEngine) => {
  compose(engine.world, engine.settings);
  return createHash('sha256').update(engine.world.A).update(engine.world.B).digest('hex');
};

describe('deterministic city', () => {
  for (const scene of ['bund', 'nyc', 'hk'] as const)
    test(`${scene}: identical frames at 12 and 30 fps`, () => {
      const slow = new CityEngine(config(scene), scenarioEvents(100000));
      const fast = new CityEngine(config(scene), scenarioEvents(100000));
      for (let i = 1; i <= 150; i++) {
        slow.advanceTo((i * 1000) / 12);
        frame(slow);
      }
      for (let i = 1; i <= 375; i++) {
        fast.advanceTo((i * 1000) / 30);
        frame(fast);
      }
      expect(slow.world.rng.state).toBe(fast.world.rng.state);
      expect(frame(slow)).toBe(frame(fast));
      expect(frame(fast)).toMatchSnapshot(`${scene} at 12.5 seconds`);
    });

  test('live boundary events replay after the same simulation tick', () => {
    const live = new CityEngine(config(), scenarioEvents(100000).slice(0, 6));
    live.advanceTo(1000);
    live.append(
      makeEvent('agent.tool', { kind: 'test', ok: false }, 101000, 'codex', 'demo-codex'),
    );
    live.append(makeEvent('world.firework', { x: 0.5, y: 0.3, color: '#ffcc88' }, 101000));
    live.advanceTo(2500);
    const replay = new CityEngine(config(), live.events);
    replay.advanceTo(2500);
    expect(live.snapshot()).toEqual(replay.snapshot());
    expect(frame(live)).toBe(frame(replay));
  });

  test('late events retain their effective delivery time', () => {
    const live = new CityEngine(config(), scenarioEvents(100000).slice(0, 6));
    live.advanceTo(3000);
    const event = live.append(makeEvent('agent.error', {}, 95000, 'codex', 'demo-codex'));
    expect(event.at).toBe(103000);
    live.advanceTo(4000);
    const replay = new CityEngine(config(), live.events);
    replay.advanceTo(4000);
    expect(live.snapshot()).toEqual(replay.snapshot());
  });

  test('checkpoint restore and repeated seek reproduce particles and RNG', () => {
    const engine = new CityEngine(config('hk'), scenarioEvents(100000));
    engine.advanceTo(18000);
    const snapshot = engine.snapshot();
    engine.advanceTo(32000);
    const expected = frame(engine);
    engine.restore(snapshot);
    engine.advanceTo(32000);
    expect(frame(engine)).toBe(expected);
    engine.seek(7000);
    engine.seek(32000);
    expect(frame(engine)).toBe(expected);
  });

  test('scene changes keep sessions, task progress and the clock', () => {
    const engine = new CityEngine(config(), scenarioEvents(100000).slice(0, 6));
    engine.advanceTo(1000);
    engine.append(makeEvent('world.scene', { scene: 'nyc' }, 101000));
    expect(engine.world.sceneKey).toBe('nyc');
    expect(engine.world.agents[0].done).toBe(2);
    expect(engine.world.agents[0].site).toBeGreaterThanOrEqual(0);
    engine.advanceTo(2000);
    const replay = new CityEngine(config(), engine.events);
    replay.advanceTo(2000);
    expect(frame(engine)).toBe(frame(replay));
  });

  test('rendering twice does not change a frame', () => {
    const engine = new CityEngine(config('hk'), scenarioEvents(100000));
    engine.advanceTo(10200);
    expect(frame(engine)).toBe(frame(engine));
  });

  test('fractional-time stepping does not accumulate clock drift', () => {
    const engine = new CityEngine(config());
    engine.advanceTo(TICK_MS * 100);
    expect(engine.world.tick).toBe(100);
    expect(engine.world.t).toBe(100 / 30);
  });
});
