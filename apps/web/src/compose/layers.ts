import type { World, Color, Settings } from '../world/types';
import { lerp, mix3, clamp } from '../world/math';
import { hash2, vnoise2 } from '../world/noise';
import { staticLayers, cloudOcclusion } from './cache';
import { fogParams } from '../world/light';
import { gi, G_DOT, G_DASH, G_TIL, G_APX, G_MID, G_EQ } from '../engine/glyphs';

/** Keep the cell loops small enough for the JS engine to optimize independently. */
export function drawClouds(
  W: World,
  id: number,
  clBase: Color,
  glowK: number,
  threshold: number,
): void {
  const { cols, wy, skyR, skyG, skyB, glyph, fr, fgc, fb, br, bgc, bb, solid, ent, emR, emG, emB } =
    W;
  const layers = staticLayers(W).clouds,
    first = W.frame < 3,
    odd = W.frame & 1;
  const covered = cloudOcclusion(W, W.env.heat);
  layers[0].move(W.cloudOff);
  layers[1].move(W.previousCloudOff);
  for (let y = 1; y < wy - 2; y++) {
    const sr = skyR[y],
      sg = skyG[y],
      sb = skyB[y],
      ug = glowK * 1.6 * Math.pow(y / wy, 1.5);
    const cr = clBase[0] + W.sc.glow[0] * ug,
      cg = clBase[1] + W.sc.glow[1] * ug,
      cb = clBase[2] + W.sc.glow[2] * ug;
    const noise = layers[first || (y & 1) === odd ? 0 : 1];
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      if (covered[i]) continue;
      const n = noise.at(x, y);
      W.cloudN[i] = n;
      if (n < threshold) continue;
      const d = Math.min(1, ((n - threshold) / (1 - threshold)) * 1.6);
      if (solid[i] === 1 && d < 0.35) continue;
      const m = 0.32 + 0.6 * d,
        mb = 0.04 + 0.14 * d;
      glyph[i] = d < 0.18 ? G_DOT : d < 0.4 ? G_DASH : d < 0.7 ? G_TIL : G_APX;
      fr[i] = sr + (cr - sr) * m;
      fgc[i] = sg + (cg - sg) * m;
      fb[i] = sb + (cb - sb) * m;
      br[i] += (cr - br[i]) * mb;
      bgc[i] += (cg - bgc[i]) * mb;
      bb[i] += (cb - bb[i]) * mb;
      ent[i] = id;
      solid[i] = 0;
      emR[i] = emG[i] = emB[i] = 0;
    }
  }
}

interface RidgeLayer {
  kinds: Uint8Array;
  edge: Uint16Array;
  shades: Float64Array;
  lights: Float64Array;
  phase: number;
}
const ridges = new WeakMap<World, RidgeLayer[]>();
export function drawRidge(W: World, id: number, day: number, lightOn: number, hor: Color): void {
  if (!W.ridge) return;
  const { cols, baseY, glyph, fr, fgc, fb, br, bgc, bb, solid, ent, emR, emG, emB } = W;
  let layers = ridges.get(W);
  if (!layers) {
    layers = W.ridge.map((arr, k) => {
      const kinds = new Uint8Array(W.N),
        edge = new Uint16Array(cols),
        shades = new Float64Array(W.N),
        lights = new Float64Array(W.N);
      for (let x = 0; x < cols; x++) {
        const tp = Math.floor(arr[x]),
          slope = arr[Math.min(cols - 1, x + 1)] - arr[Math.max(0, x - 1)];
        edge[x] = slope < -0.55 ? gi('/') : slope > 0.55 ? gi('\\') : G_DASH;
        for (let y = Math.max(0, tp); y <= baseY; y++) {
          if (y === tp) continue;
          const i = y * cols + x,
            dep = (y - tp) / Math.max(1, baseY - tp),
            h = hash2(x, y, W.seed + 29 + k);
          kinds[i] = h < 0.06 + 0.2 * dep + 0.1 * k * dep ? 1 : h < 0.12 ? 2 : 0;
          shades[i] = 0.55 + 0.3 * h * 4;
        }
      }
      return { kinds, edge, shades, lights, phase: NaN };
    });
    ridges.set(W, layers);
  }
  const phase = Math.floor(W.t * 0.03) + 7,
    dkc = mix3([0.012, 0.02, 0.024], [0.12, 0.18, 0.15], day * 0.6);
  for (let k = 0; k < 2; k++) {
    const arr = W.ridge[k],
      material = layers[k],
      mk = k ? 0.82 : 0.62;
    if (material.phase !== phase) {
      for (let y = 0; y <= baseY; y++)
        for (let x = 0; x < cols; x++) {
          const i = y * cols + x;
          if (material.kinds[i] === 1) material.lights[i] = hash2(x, y, phase);
        }
      material.phase = phase;
    }
    for (let y = 0; y <= baseY; y++) {
      const r = W.skyR[y] + (dkc[0] - W.skyR[y]) * mk,
        g = W.skyG[y] + (dkc[1] - W.skyG[y]) * mk,
        b = W.skyB[y] + (dkc[2] - W.skyB[y]) * mk;
      for (let x = 0; x < cols; x++) {
        const tp = Math.floor(arr[x]);
        if (y < Math.max(0, tp)) continue;
        const i = y * cols + x;
        br[i] = r;
        bgc[i] = g;
        bb[i] = b;
        glyph[i] = 0;
        solid[i] = 0;
        ent[i] = id;
        emR[i] = emG[i] = emB[i] = 0;
        if (y === tp) {
          glyph[i] = material.edge[x];
          fr[i] = r + hor[0] * 0.25;
          fgc[i] = g + hor[1] * 0.25;
          fb[i] = b + hor[2] * 0.25;
          continue;
        }
        if (material.kinds[i] === 1) {
          if (material.lights[i] < lightOn * 0.85) {
            const color = W.sc.wins[(x + y) % 3],
              shade = material.shades[i],
              cr = color[0] * shade,
              cg = color[1] * shade,
              cb = color[2] * shade;
            glyph[i] = G_MID;
            fr[i] = cr;
            fgc[i] = cg;
            fb[i] = cb;
            emR[i] = cr * 0.7;
            emG[i] = cg * 0.7;
            emB[i] = cb * 0.7;
          }
        } else if (material.kinds[i] === 2) {
          glyph[i] = G_DOT;
          fr[i] = r * 1.6;
          fgc[i] = g * 1.7;
          fb[i] = b * 1.6;
        }
      }
    }
  }
}

export function drawWaterBase(
  W: World,
  S: Settings,
  id: number,
  deep: Color,
  hor: Color,
  net: number,
): void {
  const { cols, wy, promY, t, seed, br, bgc, bb, fr, fgc, fb, glyph, ent, emR, emG, emB } = W;
  const wr = Math.max(1, promY - wy);
  const { waterMix, waterShine, reflection } = staticLayers(W);
  waterMix.move(0);
  waterMix.moveY(t * 0.8);
  waterShine.move(0);
  waterShine.moveY(t * 2.4);
  for (let y = wy; y < promY; y++) {
    const d = y - wy,
      f = d / wr,
      ys = wy - 1 - Math.floor(d * 1.15),
      rip = (0.4 + net * 1.2) * Math.min(2.2, 0.25 + d * 0.2),
      mixK = 0.55 * (1 - f * 0.8),
      phase = y * 1.9 + t * 2.1;
    const sinPhase = Math.sin(phase),
      cosPhase = Math.cos(phase);
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      ent[i] = id;
      let r0 = deep[0],
        g0 = deep[1],
        b0 = deep[2];
      if (ys >= 0) {
        const j0 = ys * cols + x,
          mk = mixK * (0.8 + 0.25 * waterMix.at(x, y));
        r0 = lerp(deep[0], br[j0] * 0.6, mk);
        g0 = lerp(deep[1], bgc[j0] * 0.6, mk);
        b0 = lerp(deep[2], bb[j0] * 0.6, mk);
        const xs = clamp(x + Math.round(reflection.at(x, sinPhase, cosPhase) * rip), 0, cols - 1),
          j = ys * cols + xs;
        if (emR[j] + emG[j] + emB[j] > 0.04) {
          const sh = waterShine.at(x, y),
            k = (sh > 0.5 ? 1 : 0.14) * (0.66 + S.effects * 0.18) * (1 - f * 0.55);
          if (k > 0.08) {
            br[i] = r0 + emR[j] * k * 0.12;
            bgc[i] = g0 + emG[j] * k * 0.12;
            bb[i] = b0 + emB[j] * k * 0.12;
            glyph[i] = sh > 0.72 ? G_EQ : G_DASH;
            fr[i] = emR[j] * k * 1.25;
            fgc[i] = emG[j] * k * 1.25;
            fb[i] = emB[j] * k * 1.25;
            continue;
          }
        }
      }
      br[i] = r0;
      bgc[i] = g0;
      bb[i] = b0;
      const n = vnoise2(
        x * (0.1 + (1 - f) * 0.3) - t * (0.25 + net * 0.9),
        y * 0.85 + t * 0.12,
        seed + 41,
      );
      if (n > 0.62) {
        const k = 0.5 + 0.6 * n;
        glyph[i] = n > 0.78 ? G_APX : n > 0.69 ? G_TIL : G_DASH;
        fr[i] = lerp(r0, hor[0], 0.4) * k + 0.01;
        fgc[i] = lerp(g0, hor[1], 0.4) * k + 0.015;
        fb[i] = lerp(b0, hor[2], 0.4) * k + 0.02;
      }
    }
  }
}

export function drawFog(W: World, color: Color, net: number): void {
  const fp = fogParams(W);
  if (fp.deck <= 0.01 && fp.mist <= 0.01) return;
  const { cols, rows, promY, wy, t, glyph, fr, fgc, fb, br, bgc, bb } = W,
    fog = staticLayers(W).fog;
  fog[0].move(t * (0.05 + net * 0.2));
  fog[1].move(Math.max(0, t - 1 / 30) * (0.05 + net * 0.2));
  const odd = W.frame & 1,
    first = W.frame < 3;
  for (let y = 0; y < promY; y++) {
    const profile =
      fp.deck * Math.exp(-Math.pow((y - fp.deckY) / fp.deckW, 2)) +
      fp.mist * Math.exp(-Math.pow((y - wy) / (rows * 0.06), 2));
    if (profile < 0.02) continue;
    const noise = fog[first || (y & 1) === odd ? 0 : 1];
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x,
        n = noise.at(x, y);
      W.fogN[i] = n;
      const f = Math.min(0.88, profile * (0.55 + 0.7 * n));
      if (f < 0.02) continue;
      fr[i] += (color[0] - fr[i]) * f * 0.9;
      fgc[i] += (color[1] - fgc[i]) * f * 0.9;
      fb[i] += (color[2] - fb[i]) * f * 0.9;
      br[i] += (color[0] * 0.8 - br[i]) * f * 0.75;
      bgc[i] += (color[1] * 0.8 - bgc[i]) * f * 0.75;
      bb[i] += (color[2] * 0.8 - bb[i]) * f * 0.75;
      if (glyph[i] === 0 && f > 0.4 && hash2(x, y, Math.floor(t * 0.5)) < 0.06) {
        glyph[i] = G_TIL;
        fr[i] = color[0] * 1.1;
        fgc[i] = color[1] * 1.1;
        fb[i] = color[2] * 1.1;
      }
    }
  }
}

export function packCells(W: World): void {
  const { N, Ac: A, Bc: B, lr, lgc: lg, lb, glyph, fr, fgc, fb, br, bgc, bb } = W;
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    let a = lr[i],
      b = lg[i],
      c = lb[i];
    const g = glyph[i];
    if (a + b + c > 0) {
      a = a / (1 + 0.6 * a);
      b = b / (1 + 0.6 * b);
      c = c / (1 + 0.6 * c);
      A[j] = (fr[i] + a * 0.35) * 255;
      A[j + 1] = (fgc[i] + b * 0.35) * 255;
      A[j + 2] = (fb[i] + c * 0.35) * 255;
      B[j] = (br[i] + a * 0.26) * 255;
      B[j + 1] = (bgc[i] + b * 0.26) * 255;
      B[j + 2] = (bb[i] + c * 0.26) * 255;
    } else {
      A[j] = fr[i] * 255;
      A[j + 1] = fgc[i] * 255;
      A[j + 2] = fb[i] * 255;
      B[j] = br[i] * 255;
      B[j + 1] = bgc[i] * 255;
      B[j + 2] = bb[i] * 255;
    }
    // Uint8ClampedArray performs the exact clamping and ties-to-even rounding.
    A[j + 3] = g & 255;
    B[j + 3] = g >> 8;
  }
}
