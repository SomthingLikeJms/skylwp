import { expect, test } from 'vitest';
import { CityEngine, DEFAULT_SETTINGS } from '../src/events/replay';
import { compose } from '../src/compose';
import { LIFE_SCENES } from '../src/scenes/life';

test('weather moon owns the sky in daylight and at night, with one fallback when offline', () => {
  const e = new CityEngine({
    seed: 20261102,
    epoch: 0,
    cols: 214,
    rows: 60,
    settings: DEFAULT_SETTINGS,
  });
  for (const hour of [0, 6, 12, 18, 23]) {
    e.world.weather.real = { tempC: 19, code: 1, precip: 0, localHour: hour };
    let calls = 0;
    compose(e.world, e.settings, undefined, () => calls++);
    expect(calls).toBe(1);
    expect(e.world.entities.filter((e) => e.kind === 'moon')).toHaveLength(1);
    expect(e.world.entities.some((e) => e.kind === 'sun')).toBe(false);
  }
  e.world.weather.real = null;
  e.settings.hour = 12;
  compose(e.world, e.settings);
  expect(e.world.entities.some((e) => e.kind === 'sun')).toBe(true);
  expect(e.world.entities.some((e) => e.kind === 'moon')).toBe(false);
});

test('street life is deterministic, bounded and independent of signal agents and browser tabs', () => {
  for (const scene of ['bund', 'nyc', 'hk'] as const) {
    const e = new CityEngine({
      seed: 20261102,
      epoch: 0,
      cols: 214,
      rows: 60,
      settings: { ...DEFAULT_SETTINGS, scene, hour: 12, flow: 'stop' },
    });
    e.world.t = 60;
    const state = e.world.rng.state;
    compose(e.world, e.settings);
    const first = e.world.A.slice(),
      entities = e.world.entities.filter((e) => e.kind === 'life');
    expect(entities.length).toBeLessThanOrEqual(15);
    expect(entities.some((e) => e.ref.title === LIFE_SCENES[scene].shopName)).toBe(true);
    expect(entities.some((e) => e.ref.title === LIFE_SCENES[scene].ferryName)).toBe(true);
    expect(e.world.agents).toHaveLength(0);
    expect(e.world.browserTabs).toHaveLength(0);
    compose(e.world, e.settings);
    expect(e.world.rng.state).toBe(state);
    expect(e.world.A).toEqual(first);
    e.world.weather.rain = 0.8;
    compose(e.world, e.settings);
    expect(e.world.entities.some((e) => e.kind === 'life' && e.ref.title === '沿江骑行')).toBe(
      false,
    );
  }
});
