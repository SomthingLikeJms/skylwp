import { expect, test } from 'vitest';
import { CityEngine, DEFAULT_SETTINGS } from '../src/events/replay';
import { makeEvent } from '../src/events/protocol';

test('presence heartbeats do not displace real events; only transitions are announced', () => {
  const engine = new CityEngine({
    seed: 9,
    epoch: 1000,
    cols: 80,
    rows: 40,
    settings: { ...DEFAULT_SETTINGS },
  });
  const log = () => engine.world.log.map((e) => e.txt);
  for (let i = 0; i < 20; i++)
    engine.append(makeEvent('presence', { idleSec: i, fullscreen: false }, 1000));
  expect(log()).toEqual([]);
  engine.append(makeEvent('presence', { idleSec: 300, fullscreen: false }, 1000));
  for (let i = 0; i < 20; i++)
    engine.append(makeEvent('presence', { idleSec: 301 + i, fullscreen: false }, 1000));
  expect(log()).toEqual(['你离开了电脑，城市逐渐熄灯']);
  engine.append(makeEvent('presence', { idleSec: 0, fullscreen: false }, 1000));
  expect(log()).toHaveLength(2);
  expect(log().filter((s) => s === '你回来了，城市亮起来')).toHaveLength(1);
});
