import type { World, Color } from '../world/types';
import { gi } from '../engine/glyphs';
import { reg, addLight } from '../world/light';
import { lifeLayout } from '../systems/residents';

const WOOD: Color = [0.58, 0.43, 0.29],
  GREEN: Color = [0.39, 0.57, 0.38],
  CREAM: Color = [0.84, 0.74, 0.53],
  STEEL: Color = [0.39, 0.53, 0.55];
/** Small groups tied to existing destinations. No extra simulation or event producers. */
export function drawQuayside(W: World) {
  if (W.cols < 200 || W.rows - W.promY < 9) return;
  const l = lifeLayout(W),
    level = 0.5 + W.env.amb * 0.5,
    id = reg(W, {
      kind: 'life',
      ref: {
        title: '滨水街角',
        detail: '咖啡露台、藤架长椅、路边花钵和下水台阶围成小小的生活街区。',
      },
    });
  const put = (x: number, y: number, ch: string, c: Color, k = 1, fill = false) => {
    if (x < 0 || x >= W.cols || y < 0 || y >= W.rows - 2) return;
    const i = y * W.cols + x;
    W.glyph[i] = gi(ch);
    W.fr[i] = c[0] * level * k;
    W.fgc[i] = c[1] * level * k;
    W.fb[i] = c[2] * level * k;
    W.ent[i] = id;
    W.solid[i] = 2;
    if (fill) {
      W.br[i] = c[0] * level * 0.24;
      W.bgc[i] = c[1] * level * 0.24;
      W.bb[i] = c[2] * level * 0.24;
    }
  };
  // Vine pergola gives the bench a place to belong, while keeping its seats clear.
  if (W.cols >= 280) {
    const roof = l.foot - 9;
    for (let dx = -12; dx <= 12; dx++) {
      put(l.benchX + dx, roof, dx % 4 === 0 ? '┬' : '─', WOOD, 0.8);
      if (dx < -3 || dx > 6)
        put(l.benchX + dx, roof - 1, dx % 3 === 0 ? '*' : '▒', GREEN, 0.8, true);
    }
    for (let dy = roof + 1; dy <= l.foot; dy++) {
      put(l.benchX - 11, dy, '│', WOOD, 0.7);
      put(l.benchX + 11, dy, '│', WOOD, 0.7);
      if (dy < roof + 4) put(l.benchX + 10, dy, dy % 2 ? '%' : 'v', GREEN, 0.9);
    }
    for (const dx of [-7, 0, 7]) {
      put(l.benchX + dx, roof + 1, '·', CREAM, 1);
      if (W.env.night > 0.2) addLight(W, l.benchX + dx, roof + 1, 3, CREAM, W.env.night * 0.09);
    }
  }
  // Café terrace: a parasol and a table with a cup, clear of the service queue.
  if (W.cols >= 300) {
    const x = l.shopX + 23,
      y = l.foot - 1;
    for (let dx = -6; dx <= 6; dx++) {
      const h = Math.abs(dx) < 3 ? 0 : 1;
      put(
        x + dx,
        y - 7 + h,
        dx === -6 ? '/' : dx === 6 ? '\\' : '▄',
        Math.floor((dx + 6) / 3) % 2 ? CREAM : WOOD,
        0.9,
        true,
      );
    }
    for (let dy = y - 6; dy < y; dy++) put(x, dy, '│', WOOD, 0.9);
    for (let dx = -4; dx <= 4; dx++) put(x + dx, y - 1, '─', CREAM, 0.8);
    put(x + 2, y - 2, 'u', CREAM);
    put(x, y, '┴', WOOD);
    put(x - 6, y - 1, '└', WOOD);
    put(x - 6, y, '┬', WOOD);
    put(x + 6, y - 1, '┘', WOOD);
    put(x + 6, y, '┬', WOOD);
  }
  // A short flight of riverside steps breaks up the unbroken paving strip.
  const sx = Math.round(W.cols * (W.sceneKey === 'bund' ? 0.94 : 0.08));
  for (let row = 0; row < 4; row++)
    for (let dx = -5 + row; dx <= 5 - row; dx++)
      put(
        sx + dx,
        W.promY + row + 2,
        dx === -5 + row ? '/' : dx === 5 - row ? '\\' : '─',
        STEEL,
        0.6 + row * 0.08,
      );
  // Small curb grasses, drainage grilles and occasional inset paving make the path less uniform.
  for (let x = 6; x < W.cols; x += 31) {
    put(x, W.rows - 4, '┬', STEEL, 0.3);
    put(x + 1, W.rows - 4, '┬', STEEL, 0.3);
    if (x % 2) {
      put(x + 3, W.promY + 2, ',', GREEN, 0.6);
      put(x + 4, W.promY + 2, 'v', GREEN, 0.6);
    }
  }
}
