import { expect, test } from 'vitest';
import { CityEngine, DEFAULT_SETTINGS } from '../src/events/replay';
import { spawnShip } from '../src/systems/actions';
import { vesselArt } from '../src/scenes/vessels';
import { LIFE_SCENES } from '../src/scenes/life';
import { lifeLayout } from '../src/systems/residents';
import { parseRecording, serializeRecording } from '../src/events/log';

test('larger vessels have separate berths, fit the river and leave the passenger landing clear', () => {
  for (const scene of ['bund', 'nyc', 'hk'] as const)
    for (const [cols, rows] of [
      [214, 60],
      [366, 115],
      [427, 120],
    ]) {
      const e = new CityEngine({
        seed: 20261102,
        epoch: 0,
        cols,
        rows,
        settings: { ...DEFAULT_SETTINGS, scene },
      });
      const W = e.world;
      W.browserTabs = Array.from({ length: 16 }, (_, id) => ({ id: String(id), cat: 0 }));
      for (let i = 0; i < 32; i++) spawnShip(W, true);
      expect(W.ships.length, `${scene} ${cols}×${rows}`).toBeGreaterThan(0);
      const landing = Math.round(LIFE_SCENES[scene].pier * cols);
      const half = vesselArt(W.sc.boat, false).width / 2 + 4;
      for (const [index, ship] of W.ships.entries()) {
        const art = vesselArt(ship.kind, ship.far);
        expect(ship.x).toBeGreaterThanOrEqual(2);
        expect(ship.x + art.width).toBeLessThanOrEqual(cols - 2);
        expect(ship.y).toBeGreaterThan(W.wy);
        expect(ship.y + art.height).toBeLessThanOrEqual(W.promY - 1);
        expect(
          ship.y + art.height < W.promY - 9 ||
            ship.x >= landing + half ||
            ship.x + art.width <= landing - half,
        ).toBe(true);
        for (const other of W.ships.slice(index + 1)) {
          const shape = vesselArt(other.kind, other.far);
          expect(
            ship.x + art.width + 4 <= other.x ||
              other.x + shape.width + 4 <= ship.x ||
              ship.y + art.height + 1 <= other.y ||
              other.y + shape.height + 1 <= ship.y,
          ).toBe(true);
        }
      }
    }
});

test('v7 seated residents walk to the new promenade layout when importing a checkpoint', () => {
  const e = new CityEngine({
    seed: 20261102,
    epoch: 0,
    cols: 214,
    rows: 60,
    settings: DEFAULT_SETTINGS,
  });
  e.advanceTo(1000);
  const initial = e.snapshot();
  const resident = initial.state.residents[1];
  resident.activity = 'sit';
  resident.slot = 0;
  resident.y = 56;
  const recording = { config: { ...e.config, initial }, events: [], durationMs: 1000 };
  const current = serializeRecording(recording);
  expect(parseRecording(current).config.initial!.state.residents[1].activity).toBe('sit');
  const migrated = parseRecording(current.replace('city-v9', 'city-v7'));
  const next = new CityEngine(migrated.config, []);
  expect(next.world.residents[1].activity).toBe('walk');
  expect(next.world.residents[1].slot).toBe(-1);
  expect(next.world.residents[1].y).toBeLessThanOrEqual(lifeLayout(next.world).foot - 1);
});
