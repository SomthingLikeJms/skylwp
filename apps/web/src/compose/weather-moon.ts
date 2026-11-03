import type { World, Color, WeatherState } from '../world/types';
import { BR0 } from '../engine/glyphs';
import { DOTX, DOTY } from '../world/palette';
import { weatherFromCode } from '../systems/weather';

export function moonWeather(W: World): WeatherState | null {
  return W.weather.real ? weatherFromCode(W.weather.real.code, W.weather.real.precip) : null;
}
export function weatherMoonColor(state: WeatherState): Color {
  return state === 'clear'
    ? [0.92, 0.85, 0.54]
    : state === 'snow'
      ? [0.68, 0.88, 0.98]
      : state === 'rain'
        ? [0.34, 0.73, 0.88]
        : state === 'storm'
          ? [0.79, 0.65, 0.87]
          : state === 'haze'
            ? [0.44, 0.62, 0.66]
            : [0.52, 0.76, 0.79];
}

/** A dark circular LED panel: dot patterns form the face, never text pasted onto a disc. */
export function drawWeatherMoon(
  W: World,
  cx: number,
  cy: number,
  radius: number,
  entity: number,
): void {
  const state = moonWeather(W);
  if (!state) return;
  const color = weatherMoonColor(state),
    r = Math.max(3.1, radius);
  const wet = state === 'rain' || state === 'storm',
    sleepy = state === 'haze' || state === 'low';
  const blink = W.t % 6.7 < 0.13,
    stroke = Math.max(0.035, 0.25 / r);
  for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r); y++) {
    if (y < 0 || y >= W.wy) continue;
    for (let x = Math.floor(cx - r * 2 - 1); x <= Math.ceil(cx + r * 2); x++) {
      if (x < 0 || x >= W.cols) continue;
      let body = 0,
        border = 0,
        face = 0,
        tears = 0;
      for (let b = 0; b < 8; b++) {
        const dx = ((x + DOTX[b] - cx) * 0.5) / r,
          dy = (y + DOTY[b] - cy) / r;
        const distance = dx * dx + dy * dy;
        if (distance > 1) continue;
        body |= 1 << b;
        if (distance > 0.84) {
          border |= 1 << b;
          continue;
        }
        const eye = Math.abs(dx) - 0.34;
        let lit = false;
        if (Math.abs(eye) < 0.16) {
          const arch = 1 - (eye / 0.16) ** 2;
          const ey =
            blink || sleepy || state === 'cloudy'
              ? -0.24
              : wet
                ? -0.27 + arch * 0.1
                : -0.17 - arch * 0.13;
          lit = Math.abs(dy - ey) < stroke;
        }
        if (Math.abs(dx) < (wet ? 0.28 : 0.36)) {
          const mouth = wet
            ? 0.36 - 0.16 * (1 - (dx / 0.28) ** 2)
            : sleepy
              ? 0.3
              : state === 'cloudy'
                ? 0.26 + 0.08 * (1 - (dx / 0.36) ** 2)
                : 0.19 + 0.22 * (1 - (dx / 0.36) ** 2);
          lit ||= Math.abs(dy - mouth) < stroke;
        }
        if (
          wet &&
          Math.abs(eye) < Math.max(0.035, stroke * 0.65) &&
          dy > -0.08 &&
          dy < 0.71 &&
          ((Math.floor((dy + 1) * r * 4 - W.t * 4) % 5) + 5) % 5 < 3
        )
          tears |= 1 << b;
        if (state === 'snow') {
          const yy = dy + 0.65;
          lit ||=
            (Math.abs(dx) < stroke && Math.abs(yy) < 0.13) ||
            (Math.abs(yy) < stroke && Math.abs(dx) < 0.13);
        }
        if (state === 'storm' && W.t % 4 < 1.4 && dy > -0.15 && dy < 0.45) {
          const boltX = dy < 0.12 ? 0.68 - (dy + 0.15) * 0.38 : 0.7 - (dy - 0.12) * 0.45;
          lit ||= Math.abs(dx - boltX) < stroke;
        }
        if (state === 'haze' && dx > -0.6 && dx < 0.6 && Math.abs(dy - 0.62) < stroke * 0.65)
          lit = Math.sin(dx * 19 + W.t * 0.5) > -0.1;
        if (lit) face |= 1 << b;
      }
      if (!body) continue;
      const i = y * W.cols + x;
      const lit = face | tears;
      const level = lit ? (face ? 0.92 : 0.78) : border ? 0.2 : 0.045;
      W.glyph[i] = BR0 + (lit || border || body);
      W.fr[i] = color[0] * level;
      W.fgc[i] = color[1] * level;
      W.fb[i] = color[2] * level;
      W.br[i] = 0.004;
      W.bgc[i] = 0.009;
      W.bb[i] = 0.015;
      W.emR[i] = lit ? color[0] * 0.28 : 0;
      W.emG[i] = lit ? color[1] * 0.28 : 0;
      W.emB[i] = lit ? color[2] * 0.28 : 0;
      W.ent[i] = entity;
    }
  }
}
