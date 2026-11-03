import type { World, Entity, Color } from './types';
import { smooth } from './math';
import { vnoise2 } from './noise';
export function reg(W: World, info: Entity) {
  W.entities.push(info);
  return W.entities.length - 1;
}
export function addLight(W: World, cx: number, cy: number, rad: number, c: Color, k: number) {
  if (k <= 0.002) return;
  const cols = W.cols,
    rows = W.rows;
  const x0 = Math.max(0, Math.floor(cx - 2 * rad)),
    x1 = Math.min(cols - 1, Math.ceil(cx + 2 * rad)),
    y0 = Math.max(0, Math.floor(cy - rad)),
    y1 = Math.min(rows - 1, Math.ceil(cy + rad));
  const r2 = rad * rad;
  for (let y = y0; y <= y1; y++) {
    const dy = y - cy;
    for (let x = x0; x <= x1; x++) {
      const dx = (x - cx) * 0.5;
      const d = (dx * dx + dy * dy) / r2;
      if (d >= 1) continue;
      const f = k * (1 - d) * (1 - d);
      const i = y * cols + x;
      W.lr[i] += c[0] * f;
      W.lgc[i] += c[1] * f;
      W.lb[i] += c[2] * f;
    }
  }
}
export function fogParams(W: World) {
  const real = W.weather.usesReal ? W.weather.real : null;
  const m =
      W.weather.state === 'haze'
        ? 0.94
        : W.weather.state === 'low'
          ? 0.76
          : real
            ? 0.3 + (real.cloud ?? 0) * 0.24
            : W.sig.mem,
    Hm = W.Hmax;
  return {
    deckY: W.baseY - Hm * (0.98 - 0.38 * smooth(0.4, 1, m)),
    deckW: Hm * 0.11,
    deck: smooth(0.45, 0.95, m) * 0.9,
    mist: smooth(0.3, 0.9, m) * 0.5 + smooth(0.72, 0.95, m) * 0.2,
  };
}
export function fogAt(W: World, x: number, y: number) {
  if (y >= W.promY) return 0;
  const f = fogParams(W);
  const prof =
    f.deck * Math.exp(-Math.pow((y - f.deckY) / f.deckW, 2)) +
    f.mist * Math.exp(-Math.pow((y - W.wy) / (W.rows * 0.06), 2));
  const n = vnoise2(x * 0.05 - W.t * (0.05 + W.sig.net * 0.2), y * 0.25, W.seed + 81);
  return Math.min(0.88, prof * (0.55 + 0.7 * n));
}
