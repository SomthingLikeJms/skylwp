import type { World, Tower, Color } from '../world/types';
import { gi } from '../engine/glyphs';
import { HARBOR, surfaceColor } from './material';

/** Rooftop and street-level details stay inside the tower's existing draw order. */
export function drawArchitecture(W: World, T: Tower, id: number, night: number) {
  if (T.kind !== 'gen' || T.layer === 0 || T.w < 5 || T.st.h < 5 || T.owner >= 0) return;
  const top = W.baseY - T.st.h + 1,
    center = T.x + Math.floor(T.w / 2),
    style = T.seed % 4,
    steel = surfaceColor(W, HARBOR.steel, 1.2),
    green = surfaceColor(W, HARBOR.leaf, 1.2),
    warm: Color = [0.42 + night * 0.3, 0.35 + night * 0.15, 0.22 + night * 0.1];
  const put = (x: number, y: number, ch: string, c: Color, emission = 0) => {
    if (x < 0 || x >= W.cols || y < 1 || y >= W.rows) return;
    const i = y * W.cols + x;
    if (y >= top && W.ent[i] !== id) return;
    W.glyph[i] = gi(ch);
    W.fr[i] = c[0];
    W.fgc[i] = c[1];
    W.fb[i] = c[2];
    W.ent[i] = id;
    W.solid[i] = 2;
    W.emR[i] = c[0] * emission;
    W.emG[i] = c[1] * emission;
    W.emB[i] = c[2] * emission;
  };
  if (T.roof === 'flat' || T.roof === 'setback') {
    if (style === 0) {
      put(center - 1, top - 1, '[', steel);
      put(center, top - 1, '=', steel);
      put(center + 1, top - 1, ']', steel);
      put(center, top - 2, '┬', steel);
    } else if (style === 1) {
      for (const dx of [-1, 1]) {
        put(center + dx, top - 1, '|', green);
        put(center + dx, top - 2, '*', green);
      }
    } else if (style === 2) {
      put(center, top - 1, '│', steel);
      put(center, top - 2, '┼', steel);
      put(center, top - 3, '·', warm, night * 0.1);
    }
  }
  if (T.w >= 7) {
    for (let dx = 1; dx < T.w - 1; dx++) put(T.x + dx, W.baseY - 2, '─', steel);
  }
  if (style === 1 && T.st.h > 10) {
    for (let dy = 4; dy < T.st.h - 3; dy += 5) {
      const y = W.baseY - dy;
      for (let dx = 1; dx < T.w - 1; dx++) put(T.x + dx, y, dx % 3 === 0 ? '┴' : '─', steel);
    }
  }
}

/** A sign is shown only when its whole frontage is visible after the skyline is drawn. */
export function drawShopfront(W: World, T: Tower, night: number) {
  if (T.kind !== 'gen' || T.layer === 0 || T.w < 7 || T.st.h < 5 || T.owner >= 0) return;
  const label = ['CAFE', 'BOOK', '24H', 'SHOP'][T.seed % 4],
    start = T.x + 1,
    y = W.baseY - 1;
  if (start < 0 || start + label.length >= W.cols) return;
  for (let n = 0; n < label.length; n++) {
    const entity = W.entities[W.ent[y * W.cols + start + n]];
    if (entity?.kind !== 'tower' || entity.ref !== T) return;
  }
  for (let n = 0; n < label.length; n++) {
    const i = y * W.cols + start + n;
    W.glyph[i] = gi(label[n]);
    W.fr[i] = 0.42 + night * 0.3;
    W.fgc[i] = 0.35 + night * 0.15;
    W.fb[i] = 0.22 + night * 0.1;
    W.emR[i] = W.fr[i] * night * 0.1;
    W.emG[i] = W.fgc[i] * night * 0.1;
    W.emB[i] = W.fb[i] * night * 0.1;
  }
}
