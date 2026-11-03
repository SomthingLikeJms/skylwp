import { expect, test } from 'vitest';
import { weatherFromCode } from '../src/systems/weather';
import { CityEngine, DEFAULT_SETTINGS } from '../src/events/replay';
import { makeEvent } from '../src/events/protocol';
import { compose } from '../src/compose';
import { moonWeather } from '../src/compose/weather-moon';
import { DEFAULT_THRESHOLDS, validThresholds } from '../src/systems/climate-config';

test('custom CPU thresholds work with real weather present while moon stays independent', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    cpu: 0,
    mem: 0.3,
    weatherThresholds: {
      ...DEFAULT_THRESHOLDS,
      cloud: 0.1,
      rain: 0.3,
      storm: 0.6,
      responseSeconds: 1,
      holdSeconds: 2,
    },
  };
  const e = new CityEngine({ seed: 42, epoch: 1000, cols: 80, rows: 40, settings });
  e.append(makeEvent('weather.real', { code: 73, tempC: -3, precip: 1 }, 1000, 'weather'));
  e.append(makeEvent('sys.sample', { cpu: 0.4, mem: 0.3, net: 0 }, 1000, 'system'));
  e.advanceTo(10000);
  expect(e.world.weather.state).toBe('rain');
  expect(e.world.weather.rain).toBeGreaterThan(0.3);
  expect(moonWeather(e.world)).toBe('snow');
  expect(e.world.weather.usesReal).toBe(false);
  e.append(
    makeEvent(
      'weather.configure',
      { mode: 'load', thresholds: { ...settings.weatherThresholds, storm: 0.35 } },
      11000,
    ),
  );
  e.advanceTo(13000);
  expect(e.world.weather.state).toBe('storm');
  expect(moonWeather(e.world)).toBe('snow');
});

test('low percentage thresholds have a release band and recover when CPU falls', () => {
  const settings = {
    ...DEFAULT_SETTINGS,
    cpu: 0.06,
    mem: 0.1,
    weatherThresholds: {
      ...DEFAULT_THRESHOLDS,
      cloud: 0.02,
      rain: 0.05,
      storm: 0.1,
      responseSeconds: 1,
      holdSeconds: 0,
    },
  };
  const e = new CityEngine({ seed: 42, epoch: 0, cols: 80, rows: 40, settings });
  e.advanceTo(1000);
  expect(e.world.weather.state).toBe('rain');
  e.append(makeEvent('sys.sample', { cpu: 0.045, mem: 0.1, net: 0 }, 1000, 'system'));
  e.advanceTo(16000);
  expect(e.world.weather.state).toBe('rain');
  e.append(makeEvent('sys.sample', { cpu: 0, mem: 0.1, net: 0 }, 16000, 'system'));
  e.advanceTo(30000);
  expect(e.world.weather.state).toBe('clear');
});

test('rejects inverted, extra, nonfinite or out of range climate thresholds', () => {
  for (const thresholds of [
    { ...DEFAULT_THRESHOLDS, rain: 0.1 },
    { ...DEFAULT_THRESHOLDS, cloud: NaN },
    { ...DEFAULT_THRESHOLDS, responseSeconds: 0 },
    { ...DEFAULT_THRESHOLDS, holdSeconds: 121 },
    { ...DEFAULT_THRESHOLDS, hidden: true },
  ]) {
    expect(validThresholds(thresholds)).toBe(false);
    expect(() => makeEvent('weather.configure', { mode: 'load', thresholds }, 0)).toThrow();
  }
});

test('WMO snow and fog do not turn into rain', () => {
  for (const code of [71, 73, 75, 77, 85, 86]) expect(weatherFromCode(code, 1)).toBe('snow');
  for (const code of [45, 48]) expect(weatherFromCode(code)).toBe('haze');
  expect(weatherFromCode(95)).toBe('storm');
  expect(weatherFromCode(61)).toBe('rain');
});

test('online weather takes effect promptly and rain, snow and lightning replay exactly', () => {
  const config = {
    seed: 42,
    epoch: 100000,
    cols: 120,
    rows: 50,
    settings: { ...DEFAULT_SETTINGS, weatherMode: 'real' as const, cpu: 0, mem: 0 },
  };
  const live = new CityEngine(config);
  live.append(
    makeEvent(
      'weather.real',
      {
        code: 73,
        tempC: -3,
        precip: 0.5,
        windKph: 20,
        windDeg: 270,
        city: '上海',
        localHour: 20,
        cloud: 0.9,
      },
      100000,
      'weather',
    ),
  );
  live.advanceTo(15000);
  expect(live.world.weather.state).toBe('snow');
  expect(live.world.particles.some((p) => p.kind === 'snow')).toBe(true);
  live.append(makeEvent('weather.real', { code: 95, tempC: 14, precip: 3 }, 115000, 'weather'));
  live.advanceTo(25000);
  expect(live.world.weather.state).toBe('storm');
  const replay = new CityEngine(config, live.events);
  replay.advanceTo(25000);
  compose(live.world, live.settings);
  compose(replay.world, replay.settings);
  expect(live.world.A).toEqual(replay.world.A);
  expect(live.world.B).toEqual(replay.world.B);
  live.append(makeEvent('weather.mode', { live: false }, 125000, 'weather'));
  expect(live.world.weather.real).toBeNull();
});
