import type { World, Settings, Color, Tower } from '../world/types';
import { clamp, mix3, mul3, add3 } from '../world/math';
import { hash2 } from '../world/noise';
import { gi, G_MID, G_DASH, CODEG, GLITCHG } from '../engine/glyphs';
import { reg, addLight } from '../world/light';
import { SIGNAL_COLORS } from './digital';
import { towerLayer } from './cache';
import { audioIsFresh } from '../systems/audio';
import { drawArchitecture, drawShopfront } from './architecture';
import { HARBOR, surfaceColor, windowColor } from './material';

const FACADE_LIGHTS = SIGNAL_COLORS.map(windowColor);
export interface TowerEnvironment {
  day: number;
  night: number;
  amb: number;
  hor: Color;
  heat: number;
  lightOn: number;
  musicLevel: number;
  beatEnvelope: number;
  musicCol: Color;
  hour: number;
}
export function drawTowers(W: World, S: Settings, env: TowerEnvironment): void {
  const { cols, rows, baseY, sc, sig, t } = W;
  const { glyph, fr, fgc, fb, br, bgc, bb, solid, ent, emR, emG, emB } = W;
  const { day, night, amb, hor, heat, lightOn, musicLevel, beatEnvelope, musicCol, hour } = env;
  const audioFresh = audioIsFresh(W);
  const P = (x: number, y: number, c: string | number, col: Color, id?: number, sol?: number) => {
    if (x < 0 || y < 0 || x >= cols || y >= rows) return -1;
    const i = y * cols + x;
    glyph[i] = typeof c === 'number' ? c : gi(c);
    fr[i] = col[0];
    fgc[i] = col[1];
    fb[i] = col[2];
    if (id !== undefined && id >= 0) ent[i] = id;
    if (sol && solid[i] < sol) solid[i] = sol;
    return i;
  };
  const PS = (i: number, g: number, r: number, gg: number, b: number) => {
    glyph[i] = g;
    fr[i] = r;
    fgc[i] = gg;
    fb[i] = b;
  };
  const EM = (i: number, c: Color, k: number) => {
    if (i < 0) return;
    emR[i] = c[0] * k;
    emG[i] = c[1] * k;
    emB[i] = c[2] * k;
  };
  const L = (x: number, y: number, r: number, c: Color, k: number) => addLight(W, x, y, r, c, k);
  // ── towers
  const act = W.act || 0,
    KC: Record<string, Color> = {
      steel: surfaceColor(W, HARBOR.steel, 1.1),
      pearlS: surfaceColor(W, [0.68, 0.49, 0.53], 1.1),
      tank: surfaceColor(W, HARBOR.wood, 0.9),
      fin: surfaceColor(W, HARBOR.stone, 1.1),
      seam: surfaceColor(W, HARBOR.steel, 1.05),
      facet: surfaceColor(W, HARBOR.steel, 1.2),
    };
  const pearlCol = mix3([1, 0.38, 0.66], musicCol, sc.music === 'pearl' ? musicLevel : 0);
  const neonPal = [
      [1, 0.25, 0.3],
      [0.95, 0.95, 1],
      [0.75, 0.4, 1],
      [1, 0.85, 0.3],
    ],
    neonCol = neonPal[Math.floor(hour * 4) % 4];
  const LK: Record<string, Color> = {
    pearl: mul3(pearlCol, 1.1 * (0.8 + 0.3 * beatEnvelope)),
    pearlDim: mul3(pearlCol, 0.55),
    gold: [1, 0.74, 0.34],
    crownW: [0.88, 0.93, 1],
    crownC: mul3(musicCol, 0.85 + 0.3 * beatEnvelope),
    brace: [0.82, 0.9, 1],
    neon: neonCol,
  };
  const waveOn = sc.music === 'pearl' && musicLevel > 0.05 && night > 0.3;
  const drawTower = (T: Tower) => {
    const st = T.st,
      w = st.w,
      h = st.h,
      cls = st.cls,
      id = reg(W, { kind: 'tower', ref: T });
    const material = towerLayer(T);
    const own = T.owner >= 0 ? W.agents[T.owner] : null;
    let bgT = surfaceColor(W, T.tone, 0.72);
    if (T.layer === 0) bgT = mix3(bgT, hor, 0.32 + 0.2 * day);
    const edgeC = add3(mix3(bgT, hor, 0.16), mul3([0.05, 0.055, 0.07], 0.5 + 0.6 * day)),
      textureC = mul3(bgT, 1.24);
    const litP =
      clamp((0.1 + 0.72 * night) * T.litK * (1 - W.away * (S.effects > 0 ? 0.28 : 0.85)), 0, 0.97) *
      (T.err > 0 ? 0.1 : 1);
    const lamp = windowColor(T.wc),
      wc = T.layer === 0 ? mul3(lamp, 0.75) : lamp,
      offC = mix3(mul3(bgT, 1.5), mul3(hor, 0.55), day * 0.6 + 0.1);
    const led =
      own &&
      own.state !== 'ended' &&
      h >= 2 &&
      (act > 0.05 || W.t - own.lastActive < 15 || T.err > 0 || T.flash > 0);
    const constr =
      own &&
      own.state === 'working' &&
      own.site === T.idx &&
      (own.total ? own.done < own.total : W.t - own.lastActive < 20);
    const ledC =
      T.err > 0
        ? [1, 0.18, 0.14]
        : T.flash > 0
          ? mix3(own ? own.col : [1, 1, 1], [0.5, 1, 0.6], Math.min(1, T.flash))
          : own
            ? own.col
            : [1, 1, 1];
    const ledK = (0.35 + 0.65 * act) * (0.45 + 0.55 * night),
      jitK = heat > 0.02 ? heat * T.shim : 0;
    const wave = waveOn && T.wave,
      wavePos = (W.beatPh * 3) % (h + 4);
    const digitalFacade =
      S.effects > 0 &&
      T.kind === 'gen' &&
      T.w >= 5 &&
      T.seed % 4 !== 0 &&
      !(T.spectrum >= 0 && musicLevel > 0.01 && audioFresh);
    for (let dy = 0; dy < h; dy++) {
      const y = baseY - dy;
      if (y < 0) break;
      const jx = jitK ? Math.round(jitK * Math.sin(y * 0.9 + t * 6 + T.seed)) : 0;
      const scanRow = ((t * (0.8 + sig.cpu * 2) + T.seed) % (h + 8)) - 4;
      const signalColor = SIGNAL_COLORS[T.seed % SIGNAL_COLORS.length];
      for (let dx = 0; dx < w; dx++) {
        const local = dy * w + dx,
          c = cls[local];
        if (!c) continue;
        const x = T.x + dx + jx;
        if (x < 0 || x >= cols) continue;
        const i = y * cols + x;
        const facadeShade = T.layer > 0 ? material.shade[local] : 1;
        br[i] = bgT[0] * facadeShade;
        bgc[i] = bgT[1] * facadeShade;
        bb[i] = bgT[2] * facadeShade;
        solid[i] = 2;
        ent[i] = id;
        glyph[i] = 0;
        emR[i] = emG[i] = emB[i] = 0;
        if (c >= 2) {
          PS(i, c - 2, edgeC[0] * facadeShade, edgeC[1] * facadeShade, edgeC[2] * facadeShade);
          continue;
        }
        if (wave && Math.abs(dy - (h - 1 - wavePos)) < 0.6) {
          const q = mul3(musicCol, 0.9 * lightOn);
          PS(i, gi('─'), q[0], q[1], q[2]);
          EM(i, q, 0.8);
          continue;
        }
        if (led && dy < h - (constr ? 2 : 0)) {
          const spd = 0.7 + hash2(dx, 7, T.seed) * 1.3,
            len = h + 8,
            ph = (t * 5 * spd + hash2(dx, 9, T.seed) * len) % len,
            head = h - 1 - ph,
            dist = dy - head;
          let I = dist >= 0 && dist < 7 ? 1 - dist / 7 : S.effects > 0 ? 0.19 : 0.07;
          let g;
          if (T.err > 0) {
            I =
              (hash2(dx, dy, Math.floor(t * 12)) < 0.5 ? 1 : 0.25) * (0.6 + 0.4 * Math.sin(t * 20));
            g = GLITCHG[Math.floor(hash2(dx, dy, Math.floor(t * 9)) * GLITCHG.length)];
          } else
            g =
              CODEG[
                Math.floor(hash2(dx * 31 + dy, Math.floor(t * 4 + dx * 0.7), T.seed) * CODEG.length)
              ];
          const q = mul3(ledC, I * ledK);
          PS(i, g, q[0], q[1], q[2]);
          EM(i, q, 0.7);
          continue;
        }
        let g = material.windows[local];
        const scan = digitalFacade && Math.abs(dy - scanRow) < 0.75;
        if (!g) {
          if (T.layer > 0 && material.surface[local])
            PS(
              i,
              material.surface[local],
              textureC[0] * facadeShade,
              textureC[1] * facadeShade,
              textureC[2] * facadeShade,
            );
          if (
            digitalFacade &&
            dx === 1 + (T.seed % Math.max(1, w - 2)) &&
            dy < h - 2 &&
            dy % 6 !== 0
          ) {
            const k = (scan ? 0.7 : 0.11) * (0.4 + 0.6 * night) * S.effects;
            PS(
              i,
              scan ? G_MID : gi('¦'),
              signalColor[0] * k,
              signalColor[1] * k,
              signalColor[2] * k,
            );
            if (scan) EM(i, signalColor, k * 0.4);
          }
          continue;
        }
        // The recessed window plane is already baked into the static material cache.
        if (T.spectrum >= 0 && night > 0.2 && musicLevel > 0.01 && audioFresh) {
          const level = W.audio.levels[T.spectrum] * S.intensity;
          const lit = dy < h * level;
          const color = lit ? musicCol : offC;
          const k = lit ? lightOn * (0.6 + 0.4 * level) : 0.5;
          PS(i, g, color[0] * k, color[1] * k, color[2] * k);
          if (lit) EM(i, color, k * 0.75);
          continue;
        }
        const phase = Math.floor(t * 0.05 + material.phase[local]);
        if (material.litPhase[local] !== phase) {
          material.litHash[local] = hash2(T.seed + dx * 13, dy, phase);
          material.litPhase[local] = phase;
        }
        const on = scan || material.litHash[local] < litP;
        if (on) {
          const k = material.brightness[local] * (1 + beatEnvelope * 0.12) * (scan ? 1.15 : 1);
          const color = scan
            ? signalColor
            : digitalFacade
              ? FACADE_LIGHTS[T.seed % FACADE_LIGHTS.length]
              : wc;
          if (digitalFacade && T.seed % 3 === 0 && dy % 5 === 0) g = G_DASH;
          if (digitalFacade && heat > 0.15 && hash2(dx, dy, Math.floor(t * 3) + T.seed) > 0.99)
            g = GLITCHG[(dx + dy) % GLITCHG.length];
          PS(i, g, color[0] * k, color[1] * k, color[2] * k);
          EM(i, color, k * 0.75);
          if (T.layer > 0 && material.lamp[local]) L(x, y, 1.2, wc, 0.1);
        } else PS(i, g, offC[0], offC[1], offC[2]);
      }
    }
    for (const o of st.ov) {
      const y = baseY - o.dy;
      if (y < 0 || y >= rows) continue;
      const jx = jitK ? Math.round(jitK * Math.sin(y * 0.9 + t * 6 + T.seed)) : 0;
      const x = T.x + o.dx + jx;
      if (x < 0 || x >= cols) continue;
      if (o.k === 1) {
        const c = KC[o.key] || edgeC;
        const i = P(x, y, o.g, c, id, 2);
        emR[i] = emG[i] = emB[i] = 0;
        continue;
      }
      let c,
        k = lightOn;
      if (o.key === 'beacon') {
        const on = Math.sin(t * 2.6 + T.seed) > 0.35;
        c = on ? [1, 0.2, 0.15] : [0.3, 0.06, 0.05];
        k = on ? 1 : 1;
        if (on) L(x, y, 1.4, c, 0.35 * night + 0.05);
      } else if (o.key === 'strobe') {
        const on = Math.sin(t * 4 + T.seed) > 0.85;
        c = on ? [1, 1, 1] : [0.35, 0.36, 0.4];
        k = 1;
        if (on) L(x, y, 2, c, 0.4);
      } else {
        c = LK[o.key] || [1, 1, 1];
        if (o.key === 'pearl' || o.key === 'crownC' || o.key === 'neon')
          L(x, y, 1.6, c, 0.2 * lightOn);
      }
      const q = mul3(c, k);
      const i = P(x, y, o.g, q, id, 2);
      EM(i, q, 0.85);
    }
    drawArchitecture(W, T, id, night);
    if (constr) {
      const tp = baseY - h + 1,
        scf = mul3(own.col, 0.5 + 0.5 * amb);
      for (let y = tp; y < Math.min(tp + 2, baseY); y++)
        for (let dx = 0; dx < w; dx++) {
          const x = T.x + dx;
          if (x >= 0 && x < cols && y >= 0) P(x, y, (x + y) & 1 ? '┼' : '─', scf, id, 2);
        }
      const mx = T.x + w - 1,
        cc = mul3(own.col, 0.65 + 0.35 * amb);
      for (let k = 1; k <= 4; k++) P(mx, tp - k, k === 4 ? '┬' : '│', cc, id, 2);
      for (let x = T.x - 2; x <= T.x + w; x++) if (x !== mx) P(x, tp - 4, '─', cc, id, 2);
      const hx = Math.round(T.x - 1 + (Math.sin(t * 0.45 + T.seed) * 0.5 + 0.5) * w);
      P(hx, tp - 3, '│', mul3(cc, 0.7), id, 2);
      P(hx, tp - 2, '▪', mul3([0.75, 0.7, 0.6], 0.4 + 0.6 * amb), id, 2);
      if (Math.sin(t * 3.2 + T.seed) > 0.3) {
        const i = P(mx, tp - 5, '•', [1, 0.22, 0.16], id, 2);
        EM(i, [1, 0.22, 0.16], 0.6);
        L(mx, tp - 5, 1.4, [1, 0.2, 0.15], 0.1 + 0.35 * night);
      }
    }
  };
  for (const T of W.drawOrder) drawTower(T);
  for (const T of W.drawOrder) drawShopfront(W, T, night);
}
