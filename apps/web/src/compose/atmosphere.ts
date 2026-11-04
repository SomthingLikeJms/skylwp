import type { World, Settings } from '../world/types';
import { hash2 } from '../world/noise';
import { gi } from '../engine/glyphs';
import { addLight } from '../world/light';
import { staticLayers } from './cache';

const BOLT = [0.68, 0.79, 1] as const;
const RAINBOW = [
  [1, 0.32, 0.3],
  [1, 0.68, 0.25],
  [0.95, 0.9, 0.42],
  [0.3, 0.88, 0.65],
  [0.35, 0.65, 1],
  [0.7, 0.45, 1],
] as const;

/** Effects use only the seeded world clock; drawing never consumes RNG. */
export function skyEffects(W: World, S: Settings, night: number): void {
  const fx = S.effects;
  if (fx <= 0) return;
  const cols = W.cols,
    top = Math.max(3, W.baseY - W.Hmax),
    t = W.t,
    wet = Math.max(W.weather.rain, W.weather.snow);
  if (night > 0.1) {
    // Harbor rays are discrete character traces, not a soft photographic glow.
    for (let beam = 0; beam < 2; beam++) {
      const origin = cols * (beam ? 0.79 : 0.3),
        angle = Math.sin(t * 0.075 + beam * 2.8) * 0.55;
      for (let y = top; y < W.baseY; y++) {
        const h = W.baseY - y,
          cx = origin + h * angle,
          width = 1 + h * 0.095;
        const power =
          fx * night * (1 - wet * 0.35) * Math.sin((Math.PI * h) / (W.baseY - top)) * 0.055;
        for (
          let x = Math.max(0, Math.floor(cx - width * 2));
          x <= Math.min(cols - 1, Math.ceil(cx + width * 2));
          x++
        ) {
          const d = (x - cx) / width,
            v = power * Math.max(0, 1 - Math.abs(d)),
            i = y * cols + x;
          if (v > 0.008 && !W.solid[i] && !W.glyph[i] && (x + y + Math.floor(t * 0.4)) % 3 === 0) {
            W.glyph[i] = gi(beam ? ':' : '.');
            W.fr[i] = 0.1 + v;
            W.fgc[i] = 0.17 + v * 2;
            W.fb[i] = 0.22 + v * 2;
          }
        }
      }
    }
    const cycle = Math.floor((t + 17) / 57),
      age = (t + 17) % 57;
    if (age < 2.3 && wet < 0.2) {
      const start = cols * (0.18 + hash2(cycle, 3, W.seed) * 0.5);
      for (let tail = 0; tail < 15; tail++) {
        const q = age - tail * 0.035;
        if (q < 0) continue;
        const x = Math.round(start + q * cols * 0.09),
          y = Math.round(1 + q * top * 0.45);
        if (x < 0 || x >= cols || y >= W.wy) continue;
        const i = y * cols + x,
          v = fx * night * (1 - tail / 15) * Math.min(1, age * 3, (2.3 - age) * 3);
        W.glyph[i] = gi(tail < 2 ? '*' : '.');
        W.fr[i] = v * 0.72;
        W.fgc[i] = v * 0.87;
        W.fb[i] = v;
        if (tail === 0) addLight(W, x, y, 1.8, BOLT, v * 0.25);
      }
    }
  }
  if (W.weather.lightning > 0) {
    const flash = W.weather.lightning * fx,
      strike = Math.floor(W.weather.nextLightning * 7);
    const x0 = Math.floor(cols * (0.15 + hash2(strike, 2, W.seed) * 0.7));
    let x = x0;
    for (let y = 1; y < Math.min(W.baseY, top + W.Hmax * 0.5); y++) {
      const next = x + (hash2(strike, y, W.seed) > 0.5 ? 1 : -1),
        i = y * cols + Math.max(0, Math.min(cols - 1, x));
      W.glyph[i] = gi(next > x ? '\\' : '/');
      W.fr[i] = flash * 0.75;
      W.fgc[i] = flash * 0.85;
      W.fb[i] = flash;
      x = next;
    }
    addLight(W, x0, top, Math.max(8, W.rows * 0.3), BOLT, flash * 0.65);
  }
  if (W.weather.rainbowUntil > t && night < 0.3) {
    const fade = Math.min(1, (W.weather.rainbowUntil - t) / 15) * fx * 0.45,
      cx = cols * 0.64,
      cy = W.baseY + W.rows * 0.05,
      rx = cols * 0.28,
      ry = W.rows * 0.6;
    for (let band = 0; band < RAINBOW.length; band++) {
      const color = RAINBOW[band];
      for (let a = Math.PI * 1.08; a < Math.PI * 1.92; a += 0.008) {
        const x = Math.round(cx + Math.cos(a) * (rx - band * 1.1)),
          y = Math.round(cy + Math.sin(a) * (ry - band * 0.5));
        if (x < 0 || x >= cols || y < 0 || y >= W.wy) continue;
        const i = y * cols + x;
        W.glyph[i] = gi('.');
        W.fr[i] = color[0] * fade;
        W.fgc[i] = color[1] * fade;
        W.fb[i] = color[2] * fade;
      }
    }
  }
}

export function waterEffects(W: World, S: Settings, night: number): void {
  if (S.effects <= 0) return;
  const { cols, wy, promY, t } = W;
  const crests = staticLayers(W).crests;
  for (let y = wy; y < promY; y++) {
    const depth = (y - wy) / Math.max(1, promY - wy);
    const swell = Math.sin(y * 0.65 - t * 0.9) * 1.3;
    const phase = t * 0.52 + swell,
      sinPhase = Math.sin(phase),
      cosPhase = Math.cos(phase);
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x,
        wave = crests.at(x, sinPhase, cosPhase);
      const crest =
        Math.max(0, wave - 0.88) * S.effects * (0.3 + night * 0.7) * (0.2 + depth) * 0.28;
      W.br[i] += crest * 0.25;
      W.bgc[i] += crest * 0.7;
      W.bb[i] += crest;
    }
  }
  const rain = W.weather.rain * S.effects;
  // Telemetry packets travel along the existing water grid, keeping its detail.
  if (W.sig.net > 0.05) {
    const payload = '·─··';
    for (let lane = 0; lane < 3; lane++) {
      const y = wy + 2 + Math.floor(((promY - wy - 4) * (lane + 1)) / 4);
      const x0 = Math.floor((t * (1 + W.sig.net * 4) + lane * cols * 0.31) % (cols + 8)) - 4;
      for (let k = 0; k < payload.length; k++) {
        const x = x0 + k;
        if (x < 0 || x >= cols || y >= promY) continue;
        const i = y * cols + x;
        W.glyph[i] = gi(payload[k]);
        W.fr[i] = 0.2;
        W.fgc[i] = 0.5;
        W.fb[i] = 0.46;
      }
    }
  }
  for (let drop = 0; drop < Math.floor(cols * rain * 0.13); drop++) {
    const cycle = Math.floor(t * 0.65 + drop * 0.618),
      age = (t * 0.65 + drop * 0.618) % 1;
    const cx = Math.floor(hash2(drop, cycle, W.seed + 731) * cols),
      cy = wy + 1 + Math.floor(hash2(drop + 23, cycle, W.seed + 732) * Math.max(1, promY - wy - 2));
    const rx = 1 + age * 4,
      ry = age * 0.7,
      v = (1 - age) * rain * 0.25;
    for (let a = 0; a < Math.PI * 2; a += 0.45) {
      const x = Math.round(cx + Math.cos(a) * rx),
        y = Math.round(cy + Math.sin(a) * ry);
      if (x < 0 || x >= cols || y < wy || y >= promY) continue;
      const i = y * cols + x;
      W.glyph[i] = gi('-');
      W.fr[i] = 0.18 + v;
      W.fgc[i] = 0.3 + v;
      W.fb[i] = 0.4 + v;
    }
  }
}

export function atmosphereFinish(W: World, S: Settings): void {
  const flash = W.weather.lightning * S.effects;
  if (flash <= 0) return;
  for (let i = 0; i < W.N; i++) {
    const v = flash * (i < W.wy * W.cols ? 0.075 : 0.035);
    W.br[i] += v * 0.65;
    W.bgc[i] += v * 0.8;
    W.bb[i] += v;
  }
}
