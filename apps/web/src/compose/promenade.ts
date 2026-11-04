import type { World, Color } from '../world/types';
import { WATERFRONTS } from '../scenes/waterfront';
import { lifeLayout } from '../systems/residents';
import { gi } from '../engine/glyphs';
import { hash2 } from '../world/noise';
import { addLight } from '../world/light';
import { surfaceColor } from './material';

const AMBER: Color = [0.95, 0.74, 0.43],
  METAL: Color = [0.46, 0.52, 0.53];
interface StreetCache {
  tiles: Uint8Array;
}
const cache = new WeakMap<World, StreetCache>();
function street(W: World) {
  let value = cache.get(W);
  if (value) return value;
  const tiles = new Uint8Array(W.N);
  for (let y = W.promY + 1; y < W.rows - 2; y++)
    for (let x = 0; x < W.cols; x++) {
      const row = y - W.promY,
        width = 6 + Math.floor(row / 4),
        seam = (x + (Math.floor(row / 3) % 2) * Math.floor(width / 2)) % width === 0;
      tiles[y * W.cols + x] =
        row % 3 === 0 ? 1 : seam ? 2 : hash2(x, y, W.seed + 318) > 0.97 ? 3 : 0;
    }
  value = { tiles };
  cache.set(W, value);
  return value;
}
function ink(
  W: World,
  x: number,
  y: number,
  ch: string,
  c: Color,
  k: number,
  id: number,
  fill = false,
) {
  if (x < 0 || x >= W.cols || y < 0 || y >= W.rows) return;
  const i = y * W.cols + x;
  W.glyph[i] = gi(ch);
  W.fr[i] = c[0] * k;
  W.fgc[i] = c[1] * k;
  W.fb[i] = c[2] * k;
  W.ent[i] = id;
  W.solid[i] = 2;
  if (fill) {
    W.br[i] = c[0] * k * 0.18;
    W.bgc[i] = c[1] * k * 0.18;
    W.bb[i] = c[2] * k * 0.18;
  }
}
export function drawPromenade(W: World, ids: Record<string, number>) {
  const profile = WATERFRONTS[W.sceneKey],
    data = street(W),
    level = 0.38 + W.env.amb * 0.62,
    stone = surfaceColor(W, profile.stone, 1.25),
    wet = Math.max(W.weather.rain, W.weather.snow);
  for (let y = W.promY + 1; y < W.rows; y++) {
    const f = (y - W.promY) / (W.rows - W.promY),
      cycle = y >= W.rows - 2,
      tone = cycle ? 0.32 : 0.72 - f * 0.2,
      r = stone[0] * tone,
      g = stone[1] * tone,
      b = stone[2] * tone;
    const begin = y * W.cols,
      end = begin + W.cols;
    W.br.fill(r, begin, end);
    W.bgc.fill(g, begin, end);
    W.bb.fill(b, begin, end);
    W.glyph.fill(0, begin, end);
    W.ent.fill(ids.prom, begin, end);
    W.solid.fill(0, begin, end);
    W.emR.fill(0, begin, end);
    W.emG.fill(0, begin, end);
    W.emB.fill(0, begin, end);
    for (let x = 0; x < W.cols; x++) {
      const i = begin + x,
        tile = data.tiles[i];
      if (tile) {
        W.glyph[i] = gi(tile === 1 ? '─' : tile === 2 ? '│' : '·');
        const scale = tile === 3 ? 1.28 : tile === 1 ? 0.42 : 0.55;
        W.fr[i] = r * scale;
        W.fgc[i] = g * scale;
        W.fb[i] = b * scale;
      }
      if (wet > 0.25 && x % 11 < 3 && y % 3 === 0) {
        W.glyph[i] = gi('─');
        W.fr[i] = r * 1.24;
        W.fgc[i] = g * 1.3;
        W.fb[i] = b * 1.4;
      }
    }
  }
  // Stone curb, iron panels and substantial posts; the gate is opened by the jetty pass.
  for (let x = 0; x < W.cols; x++) {
    const post = x % 10 === 0;
    ink(W, x, W.promY - 1, post ? '┬' : '─', METAL, level * 0.63, ids.rail);
    ink(W, x, W.promY + 1, post ? '┴' : '─', profile.trim, level * 0.44, ids.rail);
    if (post) {
      ink(W, x, W.promY, '║', METAL, level * 0.72, ids.rail);
      ink(W, x, W.promY - 2, '▄', profile.trim, level * 0.8, ids.rail);
    } else if (x % 5 === 0) ink(W, x, W.promY, '│', METAL, level * 0.48, ids.rail);
    if (x % 3 !== 0) ink(W, x, W.rows - 3, '─', profile.trim, level * 0.3, ids.prom);
    if (x % 24 < 7) ink(W, x, W.rows - 1, '─', METAL, level * 0.18, ids.prom);
  }
  for (let x = 18; x < W.cols; x += 54) {
    ink(W, x, W.rows - 2, '>', METAL, level * 0.38, ids.prom);
    ink(W, x + 1, W.rows - 2, '>', METAL, level * 0.38, ids.prom);
  }
  const layout = lifeLayout(W),
    gap = Math.max(28, Math.round(W.cols / 7));
  for (let x = 10; x < W.cols; x += gap) {
    if (Math.abs(x - layout.pierX) < 14) continue;
    for (let y = W.promY - 5; y <= W.promY + 2; y++)
      ink(W, x, y, '│', METAL, level * 0.72, ids.lamp);
    ink(W, x, W.promY + 2, '┴', METAL, level * 0.8, ids.lamp);
    ink(W, x + 1, W.promY - 6, '─', METAL, level * 0.72, ids.lamp);
    ink(W, x + 2, W.promY - 6, '┐', METAL, level * 0.72, ids.lamp);
    ink(W, x + 2, W.promY - 5, '▄', W.env.night > 0.2 ? AMBER : METAL, level * 0.9, ids.lamp);
    if (W.env.night > 0.1) {
      addLight(W, x + 2, W.promY - 5, 3, AMBER, W.env.night * 0.14);
      addLight(W, x + 2, W.promY + 3, 7, AMBER, W.env.night * 0.24);
    }
  }
}
