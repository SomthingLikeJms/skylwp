import { expect, test } from 'vitest';
import { CityEngine, DEFAULT_SETTINGS } from '../src/events/replay';
import { makeEvent } from '../src/events/protocol';
import { waterData } from '../src/compose/data-water';
import { serializeRecording, parseRecording } from '../src/events/log';
import { compose } from '../src/compose';
import { GLYPHS } from '../src/engine/glyphs';

const config = {
  seed: 42,
  epoch: 1000,
  cols: 100,
  rows: 50,
  settings: { ...DEFAULT_SETTINGS, cpu: 0.12, mem: 0.5, effects: 0 },
};
test('water readouts show measured CPU and actual Agent progress without leaking task text', () => {
  const e = new CityEngine(config);
  e.append(
    makeEvent('agent.session', { state: 'start', name: 'Codex' }, 1000, 'codex', 'real-session'),
  );
  e.append(
    makeEvent(
      'agent.todo',
      { done: 2, total: 5, current: 'private-task' },
      1000,
      'codex',
      'real-session',
    ),
  );
  const data = waterData(e.world, e.settings);
  const read = (stream: ReturnType<typeof waterData>) =>
    stream.readouts.map((row) => Array.from(row, (g) => GLYPHS[g]).join('')).join(' | ');
  expect(read(data)).toMatch(/CPU 12%  MEM 50%.*CODEX.*2\/5/);
  expect(read(data)).not.toContain('private-task');
  e.settings.privacy = true;
  expect(read(waterData(e.world, e.settings))).not.toContain('private-task');
  e.world.sig.cpu = 0.63;
  expect(read(waterData(e.world, e.settings))).toContain('CPU 63%');
  e.settings.waterMode = 'binary';
  expect(read(waterData(e.world, e.settings))).toContain('00111111');
  e.settings.waterSource = 'agent';
  expect(read(waterData(e.world, e.settings))).not.toContain('CPU ');
});
test('desktop clicks and water/climate settings survive an exported replay', () => {
  const e = new CityEngine(config);
  e.append(makeEvent('water.configure', { mode: 'ascii', source: 'cpu', strength: 0.8 }, 1000));
  e.append(
    makeEvent(
      'weather.configure',
      {
        mode: 'load',
        thresholds: {
          ...DEFAULT_SETTINGS.weatherThresholds,
          cloud: 0.01,
          rain: 0.04,
          storm: 0.1,
          responseSeconds: 1,
          holdSeconds: 0,
        },
      },
      1000,
    ),
  );
  e.append(makeEvent('desktop.click', { x: 0.6, y: 0.4 }, 1000, 'presence'));
  e.advanceTo(4000);
  const recording = parseRecording(
    serializeRecording({ config, events: e.events, durationMs: 4000 }),
  );
  const replay = new CityEngine(recording.config, recording.events);
  replay.advanceTo(4000);
  compose(e.world, e.settings);
  compose(replay.world, replay.settings);
  expect(e.world.A).toEqual(replay.world.A);
  expect(e.world.B).toEqual(replay.world.B);
  expect(replay.settings.waterMode).toBe('ascii');
  expect(replay.world.weather.state).toBe('storm');
});
