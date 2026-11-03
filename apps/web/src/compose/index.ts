import type { World, Settings, Color, Tower, StaticEntity, BoatKind } from '../world/types';
import { clamp, smooth, lerp, mix3, mul3, add3, lum3 } from '../world/math';
import { hash2, vnoise2, fbm2 } from '../world/noise';
import { skyColors, DOTX, DOTY } from '../world/palette';
import {
  gi,
  BR0,
  G_DOT,
  G_DASH,
  G_TIL,
  G_APX,
  G_EQ,
  G_SQ,
  G_BRK,
  G_MID,
  G_US,
  CODEG,
  GLITCHG,
} from '../engine/glyphs';
import { CATS } from '../scenes';
import { reg, addLight, fogParams } from '../world/light';
import { skyEffects, waterEffects, atmosphereFinish } from './atmosphere';
import { SIGNAL_COLORS } from './digital';
import { drawDataRipples } from './data-water';
import { moonWeather, weatherMoonColor, drawWeatherMoon } from './weather-moon';
export function compose(
  W: World,
  S: Settings,
  overlay?: () => void,
  moonPass?: (x: number, y: number, r: number) => void,
) {
  const cols = W.cols,
    rows = W.rows,
    N = W.N,
    glyph = W.glyph,
    fr = W.fr,
    fgc = W.fgc,
    fb = W.fb,
    br = W.br,
    bgc = W.bgc,
    bb = W.bb,
    solid = W.solid,
    ent = W.ent,
    emR = W.emR,
    emG = W.emG,
    emB = W.emB;
  glyph.fill(0);
  fr.fill(0);
  fgc.fill(0);
  fb.fill(0);
  br.fill(0);
  bgc.fill(0);
  bb.fill(0);
  W.lr.fill(0);
  W.lgc.fill(0);
  W.lb.fill(0);
  emR.fill(0);
  emG.fill(0);
  emB.fill(0);
  solid.fill(0);
  ent.fill(-1);
  W.bm.fill(0);
  W.bcr.fill(0);
  W.bcg.fill(0);
  W.bcb.fill(0);
  W.entities.length = 0;
  const odd_ = W.frame & 1,
    first = W.frame < 3;
  const sc = W.sc,
    t = W.t,
    hour =
      W.weather.real?.localHour === undefined
        ? S.hour
        : (W.weather.real.localHour + (W.t - W.weather.realAt) / 3600) % 24,
    wy = W.wy,
    baseY = W.baseY,
    promY = W.promY,
    sig = W.sig,
    seed = W.seed,
    Hm = W.Hmax;
  const sunE = Math.sin(((hour - 6) / 12) * Math.PI);
  const day = smooth(-0.1, 0.35, sunE),
    night = 1 - day,
    dusk = Math.exp(-Math.pow(sunE / 0.22, 2));
  const heat = smooth(0.5, 1, sig.cpu),
    rain = W.weather.rain,
    net = sig.net;
  const sk = skyColors(hour);
  let top = sk.top,
    hor = sk.hor;
  const glowK = night * (1 - rain * 0.3) * (0.45 + 0.55 * (1 - W.away));
  hor = add3(hor, add3(mul3(sc.glow, glowK), [0.16 * heat, 0.04 * heat, -0.02 * heat]));
  top = add3(top, mul3(sc.glow, glowK * 0.25));
  if (rain > 0) {
    const lt = lum3(top),
      lh = lum3(hor);
    top = mix3(top, [lt * 0.8, lt * 0.85, lt * 0.95], rain * 0.65);
    hor = mix3(hor, [lh * 0.85, lh * 0.88, lh * 0.95], rain * 0.65);
  }
  const amb = lerp(0.34, 1, day) * (1 - rain * 0.22);
  let ambC = mix3([0.5, 0.58, 0.92], [1, 0.97, 0.92], day);
  ambC = add3(ambC, [0.25 * dusk, 0.06 * dusk, -0.05 * dusk]);
  ambC = mul3(ambC, amb);
  W.env = { day, night, dusk, heat, rain, net, amb, top, hor };
  const lightOn = (0.3 + 0.7 * night) * (1 - W.away * (S.effects > 0 ? 0.26 : 0.7));
  const musicLevel = W.musicLvl * S.intensity;
  const beatEnvelope = W.beatEnv * S.intensity;
  const nb = Math.floor(W.beatPh),
    mp = sc.mpal;
  const paletteOld = W.track.previousPalette.length ? W.track.previousPalette : mp;
  const paletteNew = W.track.palette.length ? W.track.palette : mp;
  const paletteMix = W.track.palette.length ? smooth(0, 8, t - W.track.changedAt) : 0;
  const songColor = mix3(
    mix3(
      paletteOld[nb % paletteOld.length],
      paletteOld[(nb + 1) % paletteOld.length],
      smooth(0.6, 1, W.beatPh % 1),
    ),
    mix3(
      paletteNew[nb % paletteNew.length],
      paletteNew[(nb + 1) % paletteNew.length],
      smooth(0.6, 1, W.beatPh % 1),
    ),
    paletteMix,
  );
  const musicCol = mix3([1, 0.92, 0.78], songColor, musicLevel);
  const ID: Record<string, number> = {};
  [
    'sky',
    'cloud',
    'ridge',
    'water',
    'shore',
    'prom',
    'rail',
    'lamp',
    'bridge',
    'laser',
    'plane',
    'wheel',
    'fog',
  ].forEach((k) => (ID[k] = reg(W, { kind: k as StaticEntity })));
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

  // ── sky
  const skyR = W.skyR,
    skyG = W.skyG,
    skyB = W.skyB;
  for (let y = 0; y < rows; y++) {
    const tt = Math.pow(Math.min(1, y / wy), 1.35);
    skyR[y] = lerp(top[0], hor[0], tt);
    skyG[y] = lerp(top[1], hor[1], tt);
    skyB[y] = lerp(top[2], hor[2], tt);
  }
  for (let y = 0; y < wy; y++)
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      br[i] = skyR[y];
      bgc[i] = skyG[y];
      bb[i] = skyB[y];
      ent[i] = ID.sky;
    }
  if (night > 0.03) {
    const sv = night * night * (1 - rain * 0.9) * 0.75;
    for (const s of W.stars) {
      if (s.b < 0.25) continue;
      let tw = 0.5 + 0.5 * Math.sin(t * s.rate + s.ph);
      const v = s.b * sv * (0.35 + 0.65 * tw);
      if (v < 0.08) continue;
      P(s.x, s.y, v > 0.6 ? '*' : v > 0.38 ? '+' : '·', [
        0.72 * v + 0.06,
        0.78 * v + 0.06,
        v + 0.08,
      ]);
    }
  }
  const rad = Math.max(1.7, rows * 0.038);
  const disc = (cx: number, cy: number, r: number, col: Color, kind: string, id: number) => {
    const rx = r * 2;
    for (let y = Math.floor(cy - r - 1); y <= Math.ceil(cy + r + 1); y++) {
      if (y < 0 || y >= wy) continue;
      for (let x = Math.floor(cx - rx - 1); x <= Math.ceil(cx + rx + 1); x++) {
        if (x < 0 || x >= cols) continue;
        let m = 0;
        for (let b = 0; b < 8; b++) {
          const dx = (x + DOTX[b] - cx) * 0.5,
            dy = y + DOTY[b] - cy;
          let rr = r;
          if (kind === 'sun') rr *= 1 + heat * 0.12 * Math.sin(Math.atan2(dy, dx) * 7 + t * 5);
          if (dx * dx + dy * dy < rr * rr) m |= 1 << b;
        }
        if (kind === 'moon') {
          for (let b = 0; b < 8; b++)
            if (m & (1 << b) && vnoise2((x + DOTX[b]) * 0.9, (y + DOTY[b]) * 1.6, seed + 91) > 0.82)
              m &= ~(1 << b);
        }
        if (!m) continue;
        const c = kind === 'moon' ? mul3(col, 1.15) : col;
        const i = P(x, y, BR0 + m, c, id, 1);
        EM(i, c, 0.9);
      }
    }
  };
  const moonH = (hour + 12) % 24,
    mE = Math.sin(((moonH - 6) / 12) * Math.PI);
  const actualMoon = moonWeather(W);
  const moonCol = actualMoon
    ? weatherMoonColor(actualMoon)
    : mul3([0.93, 0.91, 0.82], 1 - rain * 0.6);
  let moonX = -99,
    moonY = -99,
    sunX = -99;
  const skyTop = Math.max(2, baseY - Hm - 2);
  if (mE > -0.08 || actualMoon) {
    moonX = Math.round(cols * (mE > -0.08 ? 0.12 + 0.76 * ((moonH - 6) / 12) : 0.18));
    moonY = Math.round(skyTop + 2 - mE * (skyTop - 1) * 0.9);
    if (actualMoon) moonY = Math.round(Math.max(rad + 2, Math.min(moonY, skyTop - 1)));
    else disc(moonX + 0.5, moonY + 0.5, rad, moonCol, 'moon', reg(W, { kind: 'moon' }));
    L(
      moonX,
      moonY,
      rad * 4,
      actualMoon ? moonCol : [0.6, 0.66, 0.85],
      actualMoon ? 0.045 + night * 0.055 : 0.35 * night * (1 - rain * 0.7),
    );
  }
  const sunCol = mix3([1, 0.86, 0.6], [1, 0.42, 0.22], Math.min(1, heat * 0.8 + dusk * 0.6));
  if (sunE > -0.08) {
    sunX = Math.round(cols * (0.12 + 0.76 * ((hour - 6) / 12)));
    const sy = Math.round(skyTop + 2 - sunE * (skyTop - 1) * 0.9);
    disc(
      sunX + 0.5,
      sy + 0.5,
      rad * 1.15,
      mul3(sunCol, 1 - rain * 0.5),
      'sun',
      reg(W, { kind: 'sun' }),
    );
    L(sunX, sy, rad * 6, sunCol, 0.5 * (1 - rain * 0.6));
  }
  // clouds, lit from below by the city at night
  const cover =
      W.weather.usesReal && W.weather.real?.cloud !== undefined
        ? 0.05 + W.weather.real.cloud * 0.83
        : 0.15 + sig.mem * 0.3 + rain * 0.4 + (W.weather.state === 'cloudy' ? 0.25 : 0),
    thr = 0.7 - cover * 0.42;
  const clBase = add3(
    mul3(mix3(hor, [0.9, 0.9, 0.95], 0.3), 0.25 + 0.75 * day),
    add3(mul3([0.5, 0.26, 0.2], dusk), mul3([0.1, 0.11, 0.16], night)),
  );
  for (let y = 1; y < wy - 2; y++) {
    const sr = skyR[y],
      sg = skyG[y],
      sbb = skyB[y];
    const ug = glowK * 1.6 * Math.pow(y / wy, 1.5);
    const cl = add3(clBase, mul3(sc.glow, ug));
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      let n;
      n = fbm2(
        x * 0.035 - (first || (y & 1) === odd_ ? W.cloudOff : W.previousCloudOff),
        y * 0.16,
        seed + 31,
      );
      W.cloudN[i] = n;
      if (n < thr) continue;
      const d = Math.min(1, ((n - thr) / (1 - thr)) * 1.6);
      if (solid[i] === 1 && d < 0.35) continue;
      const m = 0.32 + 0.6 * d,
        mb = 0.04 + 0.14 * d;
      PS(
        i,
        d < 0.18 ? G_DOT : d < 0.4 ? G_DASH : d < 0.7 ? G_TIL : G_APX,
        sr + (cl[0] - sr) * m,
        sg + (cl[1] - sg) * m,
        sbb + (cl[2] - sbb) * m,
      );
      ent[i] = ID.cloud;
      br[i] += (cl[0] - br[i]) * mb;
      bgc[i] += (cl[1] - bgc[i]) * mb;
      bb[i] += (cl[2] - bb[i]) * mb;
      solid[i] = 0;
      emR[i] = emG[i] = emB[i] = 0;
    }
  }
  // ridge behind the city (Victoria Peak)
  if (W.ridge) {
    for (let k = 0; k < 2; k++) {
      const arr = W.ridge[k],
        mk = k ? 0.82 : 0.62;
      const dkc = mix3([0.012, 0.02, 0.024], [0.12, 0.18, 0.15], day * 0.6);
      for (let x = 0; x < cols; x++) {
        const tp = Math.floor(arr[x]);
        for (let y = Math.max(0, tp); y <= baseY; y++) {
          const i = y * cols + x;
          const bgK = mix3([skyR[y], skyG[y], skyB[y]], dkc, mk);
          br[i] = bgK[0];
          bgc[i] = bgK[1];
          bb[i] = bgK[2];
          glyph[i] = 0;
          solid[i] = 0;
          ent[i] = ID.ridge;
          emR[i] = emG[i] = emB[i] = 0;
          if (y === tp) {
            const sl = arr[Math.min(cols - 1, x + 1)] - arr[Math.max(0, x - 1)];
            PS(
              i,
              sl < -0.55 ? gi('/') : sl > 0.55 ? gi('\\') : G_DASH,
              bgK[0] + hor[0] * 0.25,
              bgK[1] + hor[1] * 0.25,
              bgK[2] + hor[2] * 0.25,
            );
            continue;
          }
          const dep = (y - tp) / Math.max(1, baseY - tp),
            hh = hash2(x, y, seed + 29 + k);
          if (hh < 0.06 + 0.2 * dep + 0.1 * k * dep) {
            const on = hash2(x, y, Math.floor(t * 0.03) + 7) < lightOn * 0.85;
            if (on) {
              const c = mul3(sc.wins[(x + y) % 3], 0.55 + 0.3 * hh * 4);
              PS(i, G_MID, c[0], c[1], c[2]);
              EM(i, c, 0.7);
            }
          } else if (hh < 0.12) PS(i, G_DOT, bgK[0] * 1.6, bgK[1] * 1.7, bgK[2] * 1.6);
        }
      }
    }
  }
  skyEffects(W, S, night);
  if (actualMoon) {
    const id = reg(W, { kind: 'moon' });
    if (moonPass) {
      moonPass(moonX + 0.5, moonY + 0.5, rad);
      for (
        let y = Math.max(0, Math.floor(moonY - rad));
        y < Math.min(wy, Math.ceil(moonY + rad));
        y++
      )
        for (
          let x = Math.max(0, Math.floor(moonX - rad * 2));
          x < Math.min(cols, Math.ceil(moonX + rad * 2));
          x++
        )
          if (((x - moonX) * 0.5) ** 2 + (y - moonY) ** 2 < rad * rad) ent[y * cols + x] = id;
    } else drawWeatherMoon(W, moonX + 0.5, moonY + 0.5, rad, id);
  }
  // ── towers
  const act = W.act || 0,
    KC: Record<string, Color> = {
      steel: mul3([0.55, 0.57, 0.62], 0.3 + 0.6 * amb),
      pearlS: mul3([0.78, 0.5, 0.62], 0.3 + 0.6 * amb),
      tank: mul3([0.3, 0.23, 0.18], 0.35 + 0.6 * amb),
      fin: mul3([0.6, 0.66, 0.74], 0.35 + 0.6 * amb),
      seam: mul3([0.55, 0.7, 0.85], 0.25 + 0.4 * amb),
      facet: mul3([0.6, 0.75, 0.9], 0.25 + 0.35 * night + 0.2 * day),
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
    const own = T.owner >= 0 ? W.agents[T.owner] : null;
    let bgT = mix3(
      add3([0.026, 0.03, 0.045], mul3(T.tone, 0.035)),
      mul3(mul3(T.tone, 0.62), amb * 1.05),
      day,
    );
    if (T.layer === 0) bgT = mix3(bgT, hor, 0.32 + 0.2 * day);
    const edgeC = add3(mix3(bgT, hor, 0.28), mul3([0.05, 0.055, 0.07], 0.5 + 0.6 * day));
    const litP =
      clamp((0.1 + 0.72 * night) * T.litK * (1 - W.away * (S.effects > 0 ? 0.28 : 0.85)), 0, 0.97) *
      (T.err > 0 ? 0.1 : 1);
    const wc = T.layer === 0 ? mul3(T.wc, 0.75) : T.wc,
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
      win = T.win,
      jitK = heat > 0.02 ? heat * T.shim : 0;
    const wave = waveOn && T.wave,
      wavePos = (W.beatPh * 3) % (h + 4);
    const digitalFacade =
      S.effects > 0 &&
      T.kind === 'gen' &&
      T.w >= 5 &&
      T.seed % 4 !== 0 &&
      !(T.spectrum >= 0 && musicLevel > 0.01 && W.t - W.audio.lastFrame < 1);
    for (let dy = 0; dy < h; dy++) {
      const y = baseY - dy;
      if (y < 0) break;
      const jx = jitK ? Math.round(jitK * Math.sin(y * 0.9 + t * 6 + T.seed)) : 0;
      const scanRow = ((t * (0.8 + sig.cpu * 2) + T.seed) % (h + 8)) - 4;
      const signalColor = SIGNAL_COLORS[T.seed % SIGNAL_COLORS.length];
      for (let dx = 0; dx < w; dx++) {
        const c = cls[dy * w + dx];
        if (!c) continue;
        const x = T.x + dx + jx;
        if (x < 0 || x >= cols) continue;
        const i = y * cols + x;
        br[i] = bgT[0];
        bgc[i] = bgT[1];
        bb[i] = bgT[2];
        solid[i] = 2;
        ent[i] = id;
        glyph[i] = 0;
        emR[i] = emG[i] = emB[i] = 0;
        if (c >= 2) {
          PS(i, c - 2, edgeC[0], edgeC[1], edgeC[2]);
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
        let isW = false,
          g = G_SQ;
        if (win === 'grid') isW = (dx & 1) === 1;
        else if (win === 'strip') {
          isW = (dx & 1) === 1;
          g = G_BRK;
        } else if (win === 'dense') {
          isW = true;
          g = G_MID;
        } else if (win === 'band') {
          isW = (dy & 1) === 0;
          g = G_DASH;
        } else if (win === 'mesh') {
          isW = dx % 3 === 1 && (dy & 1) === 0;
        }
        const scan = digitalFacade && Math.abs(dy - scanRow) < 0.75;
        if (!isW) {
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
        if (T.spectrum >= 0 && night > 0.2 && musicLevel > 0.01 && W.t - W.audio.lastFrame < 1) {
          const level = W.audio.levels[T.spectrum] * S.intensity;
          const lit = dy < h * level;
          const color = lit ? musicCol : offC;
          const k = lit ? lightOn * (0.6 + 0.4 * level) : 0.5;
          PS(i, g, color[0] * k, color[1] * k, color[2] * k);
          if (lit) EM(i, color, k * 0.75);
          continue;
        }
        const on =
          scan ||
          hash2(T.seed + dx * 13, dy, Math.floor(t * 0.05 + hash2(dx, dy, T.seed) * 9)) < litP;
        if (on) {
          const k =
            (0.7 + 0.45 * hash2(dx, dy, T.seed + 3)) *
            (1 + beatEnvelope * 0.12) *
            (scan ? 1.15 : 1);
          const color = digitalFacade ? signalColor : wc;
          if (digitalFacade && T.seed % 3 === 0 && dy % 5 === 0) g = G_DASH;
          if (digitalFacade && heat > 0.15 && hash2(dx, dy, Math.floor(t * 3) + T.seed) > 0.99)
            g = GLITCHG[(dx + dy) % GLITCHG.length];
          PS(i, g, color[0] * k, color[1] * k, color[2] * k);
          EM(i, color, k * 0.75);
          if (T.layer > 0 && hash2(dx, dy, T.seed + 5) < 0.12) L(x, y, 1.2, wc, 0.1);
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
  // Ferris wheel (Victoria Harbour)
  if (W.wheel) {
    const wh = W.wheel,
      R = wh.R,
      cx = wh.x + 0.5,
      cy = baseY - R - 0.5,
      id = ID.wheel,
      map = new Map<number, { m: number; c: Color }>();
    const wcol = mul3(
      mix3([0.95, 0.95, 1], musicCol, musicLevel),
      lightOn * (0.85 + 0.3 * beatEnvelope),
    );
    const dot = (px: number, py: number, c: Color) => {
      const bx = Math.floor(px * 2),
        by = Math.floor(py * 4);
      if (bx < 0 || by < 0) return;
      const x = bx >> 1,
        y = by >> 2;
      if (x >= cols || y >= rows) return;
      const i = y * cols + x,
        sub = by & 3,
        rc = bx & 1;
      let e = map.get(i);
      if (!e) {
        e = { m: 0, c };
        map.set(i, e);
      }
      e.m |= sub < 3 ? (rc ? 8 << sub : 1 << sub) : rc ? 128 : 64;
    };
    const n = Math.round(R * 28);
    for (let k = 0; k < n; k++) {
      const a = (k / n) * Math.PI * 2;
      dot(cx + Math.cos(a) * R * 2, cy + Math.sin(a) * R, wcol);
    }
    const rot = t * (0.12 + 0.25 * musicLevel);
    for (let s = 0; s < 8; s++) {
      const a = rot + (s * Math.PI) / 4;
      for (let r = 0.5; r < R; r += 0.25)
        dot(cx + Math.cos(a) * r * 2, cy + Math.sin(a) * r, mul3(wcol, 0.5));
    }
    for (const [i, e] of map) {
      glyph[i] = BR0 + e.m;
      fr[i] = e.c[0];
      fgc[i] = e.c[1];
      fb[i] = e.c[2];
      ent[i] = id;
      solid[i] = 2;
      emR[i] = e.c[0] * 0.8;
      emG[i] = e.c[1] * 0.8;
      emB[i] = e.c[2] * 0.8;
    }
    const lg = mul3([0.6, 0.62, 0.68], 0.3 + 0.6 * amb);
    for (let j = 1; j <= R + 1; j++) {
      const y = Math.round(cy) + j;
      if (y > baseY) break;
      P(Math.round(cx - 0.5 - j * 0.8), y, '/', lg, id, 2);
      P(Math.round(cx - 0.5 + j * 0.8), y, '\\', lg, id, 2);
    }
    L(Math.round(cx), Math.round(cy), R * 2.4, wcol, 0.25 * lightOn);
  }
  // far embankment with a string of street lights
  {
    const y = wy - 1,
      ec = mix3([0.02, 0.025, 0.03], mul3(hor, 0.3), 0.4 + 0.3 * day),
      lc = [1, 0.8, 0.5];
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      br[i] = ec[0];
      bgc[i] = ec[1];
      bb[i] = ec[2];
      ent[i] = ID.shore;
      glyph[i] = 0;
      emR[i] = emG[i] = emB[i] = 0;
      if (x % 3 === 0 && lightOn > 0.35) {
        const q = mul3(lc, lightOn * 0.8);
        PS(i, G_MID, q[0], q[1], q[2]);
        EM(i, q, 0.9);
      } else PS(i, G_US, ec[0] * 2.2 + 0.03, ec[1] * 2.2 + 0.03, ec[2] * 2.2 + 0.03);
    }
  }
  // laser show over the harbour
  if (sc.music === 'laser' && musicLevel > 0.03 && night > 0.2) {
    const I0 = musicLevel * night * (0.55 + 0.45 * beatEnvelope) * (1 - W.away),
      n = W.laserSrc.length;
    W.laserSrc.forEach((s, k) => {
      const th = clamp(
        (k - (n - 1) / 2) * 0.22 +
          0.38 * Math.sin(t * 0.35 + k * 1.7) +
          beatEnvelope * 0.14 * (k % 2 ? 1 : -1),
        -0.62,
        0.62,
      );
      const c = mp[(k + nb) % mp.length];
      let x = s[0] + 0.5,
        y = s[1] - 0.5;
      const sx = Math.sin(th) * 2 * 0.5,
        sy = -Math.cos(th) * 0.5,
        Lmax = rows * 1.6;
      const g = Math.abs(th) < 0.22 ? gi('│') : th > 0 ? gi('/') : gi('\\');
      for (let st_ = 0; st_ < Lmax; st_++) {
        x += sx;
        y += sy;
        const xi = Math.floor(x),
          yi = Math.floor(y);
        if (yi < 0 || xi < 0 || xi >= cols) break;
        const i = yi * cols + xi;
        if (solid[i] === 2) continue;
        const I = I0 * Math.pow(1 - st_ / Lmax, 1.2);
        if (I < 0.05) break;
        fr[i] = c[0] * I * 1.4;
        fgc[i] = c[1] * I * 1.4;
        fb[i] = c[2] * I * 1.4;
        glyph[i] = g;
        br[i] += c[0] * I * 0.1;
        bgc[i] += c[1] * I * 0.1;
        bb[i] += c[2] * I * 0.1;
        ent[i] = ID.laser;
        EM(i, c, I * 0.5);
      }
    });
  }
  // planes
  for (const p of W.planes) {
    const x = Math.round(p.x),
      y = p.y;
    if (x < 0 || x >= cols) continue;
    const i = y * cols + x;
    if (solid[i] === 2) continue;
    P(x, y, '·', [0.9, 0.92, 1], ID.plane);
    const tx = x - Math.sign(p.vx);
    if (Math.sin(t * 6 + p.ph) > 0.4 && tx >= 0 && tx < cols && !solid[y * cols + tx]) {
      P(tx, y, '•', [1, 0.25, 0.2], ID.plane);
      L(tx, y, 1.2, [1, 0.2, 0.15], 0.2);
    }
  }
  overlay?.();
  // ── water: mirrored sky, silhouettes and lights
  const wr = Math.max(1, promY - wy),
    deep = mix3([0.01, 0.022, 0.04], [0.07, 0.18, 0.28], day);
  for (let y = wy; y < promY; y++) {
    const d = y - wy,
      f = d / wr,
      ys = wy - 1 - Math.floor(d * 1.15),
      rip = (0.4 + net * 1.2) * Math.min(2.2, 0.25 + d * 0.2),
      mixK = 0.55 * (1 - f * 0.8);
    for (let x = 0; x < cols; x++) {
      const i = y * cols + x;
      ent[i] = ID.water;
      let r0 = deep[0],
        g0 = deep[1],
        b0 = deep[2];
      if (ys >= 0) {
        const j0 = ys * cols + x,
          mk = mixK * (0.8 + 0.25 * vnoise2(x * 0.3, y * 1.2 - t * 0.8, seed + 57));
        r0 = lerp(deep[0], br[j0] * 0.6, mk);
        g0 = lerp(deep[1], bgc[j0] * 0.6, mk);
        b0 = lerp(deep[2], bb[j0] * 0.6, mk);
        const xs = clamp(x + Math.round(Math.sin(y * 1.9 + t * 2.1 + x * 0.07) * rip), 0, cols - 1),
          j = ys * cols + xs;
        if (emR[j] + emG[j] + emB[j] > 0.04) {
          const sh = vnoise2(x * 0.9, y * 1.7 - t * 2.4, seed + 51);
          const k = (sh > 0.5 ? 1 : 0.14) * (0.66 + S.effects * 0.18) * (1 - f * 0.55);
          if (k > 0.08) {
            br[i] = r0 + emR[j] * k * 0.12;
            bgc[i] = g0 + emG[j] * k * 0.12;
            bb[i] = b0 + emB[j] * k * 0.12;
            PS(
              i,
              sh > 0.72 ? G_EQ : G_DASH,
              emR[j] * k * 1.25,
              emG[j] * k * 1.25,
              emB[j] * k * 1.25,
            );
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
        PS(
          i,
          n > 0.78 ? G_APX : n > 0.69 ? G_TIL : G_DASH,
          lerp(r0, hor[0], 0.4) * k + 0.01,
          lerp(g0, hor[1], 0.4) * k + 0.015,
          lerp(b0, hor[2], 0.4) * k + 0.02,
        );
      }
    }
  }
  const refl = [];
  if (mE > 0 || actualMoon)
    refl.push({
      x: moonX,
      c: moonCol,
      k: actualMoon ? 0.12 + night * 0.08 : 0.7 * night * (1 - rain * 0.6),
      w: 1.3,
    });
  if (sunE > 0) refl.push({ x: sunX, c: sunCol, k: 0.8 * (1 - rain * 0.6), w: 2 });
  for (const r of refl) {
    if (r.k < 0.05) continue;
    for (let y = wy; y < promY; y++) {
      const f = (y - wy) / wr,
        ww = r.w * (0.6 + f * 2.4);
      for (let x = Math.round(r.x - ww); x <= Math.round(r.x + ww); x++) {
        if (x < 0 || x >= cols) continue;
        const sh = vnoise2(x * 0.8, y * 1.4 - t * 2.2, seed + 53);
        const v =
          r.k * (1 - Math.abs(x - r.x) / (ww + 0.6)) * (sh > 0.5 ? 1 : 0.22) * (1 - f * 0.45);
        if (v < 0.1) continue;
        const i = y * cols + x;
        P(x, y, v > 0.42 ? '=' : '-', mul3(r.c, 0.3 + v));
        br[i] += r.c[0] * v * 0.1;
        bgc[i] += r.c[1] * v * 0.1;
        bb[i] += r.c[2] * v * 0.1;
      }
    }
  }
  waterEffects(W, S, night);
  drawDataRipples(W, S);
  // boats
  const SPR: Record<BoatKind, { far: string[]; near: string[]; hull: Color; sail?: Color }> = {
    cruise: {
      far: ['▪▪▪', '\\_/'],
      near: [' ┌───┐ ', '▪▪▪▪▪▪▪', '\\_____/'],
      hull: [0.82, 0.82, 0.86],
    },
    ferry: {
      far: [' ▪ ', '\\_/'],
      near: ['  ▄▄▄  ', '|▪▪▪▪▪|', '\\_____/'],
      hull: [0.95, 0.5, 0.18],
    },
    hk: { far: [' ▪ ', '\\_/'], near: [' ┌───┐ ', '▪▪▪▪▪▪▪', '\\_____/'], hull: [0.2, 0.52, 0.36] },
    junk: {
      far: ['▓ ▓', '\\_/'],
      near: [' ▓  ▓  ', ' ▓▓ ▓▓ ', '\\_____/'],
      hull: [0.42, 0.26, 0.16],
      sail: [0.72, 0.18, 0.12],
    },
  };
  const warm = [1, 0.85, 0.6];
  for (const s of W.ships) {
    const id = reg(W, { kind: 'ship', ref: s }),
      sp = SPR[s.kind],
      spr = s.far ? sp.far : sp.near,
      sx = Math.round(s.x),
      cc = CATS[s.cat].col;
    const hull = mul3(sp.hull, 0.3 + 0.65 * amb),
      winc = mix3(warm, cc, 0.55),
      sail = sp.sail ? mul3(sp.sail, 0.4 + 0.6 * amb) : null;
    for (let r = 0; r < spr.length; r++) {
      const row = spr[r],
        y = s.y + r;
      if (y < 0 || y >= rows) continue;
      for (let j = 0; j < row.length; j++) {
        const ch = row[j];
        if (ch === ' ') continue;
        const x = sx + j;
        if (x < 0 || x >= cols) continue;
        if (ch === '▪') {
          const k =
            lightOn * (0.75 + 0.25 * hash2(x, y, Math.floor(t * 0.5))) * (1 + 0.2 * beatEnvelope);
          const i = P(x, y, ch, mul3(winc, k), id, 2);
          EM(i, winc, k * 0.8);
        } else if (ch === '▓') P(x, y, ch, sail!, id, 2);
        else P(x, y, ch, r === spr.length - 1 ? hull : mul3(hull, 0.85), id, 2);
      }
    }
    if (s.arriving || s.leaving) {
      const wx = s.leaving ? sx - 1 : sx + spr[0].length,
        wyy = s.y + spr.length - 1;
      for (let k = 0; k < 3; k++) {
        const x = wx + (s.leaving ? -k : k);
        if (x >= 0 && x < cols && wyy < rows) P(x, wyy, '~', mul3(hor, 0.6 + 0.3 * amb));
      }
    }
    L(sx + (spr[0].length >> 1), s.y + 1, 2.4, winc, 0.22 * lightOn);
  }
  // Brooklyn Bridge
  if (W.bridge) {
    const B = W.bridge,
      id = ID.bridge,
      dy0 = B.deckY,
      tx = B.tx,
      tw = B.tw,
      tTop = dy0 - B.th,
      c0 = tx - (tw >> 1),
      c1 = tx + (tw >> 1);
    const stone = mix3(mul3([0.5, 0.42, 0.32], 0.35 + 0.6 * amb), [0.6, 0.48, 0.32], 0.4 * night),
      stoneE = mul3(stone, 0.7),
      cableC = mul3([0.7, 0.72, 0.78], 0.35 + 0.55 * amb);
    const neck = [0.95, 0.92, 0.82];
    const cab = (x: number, side: number) => {
      const span_ = side < 0 ? Math.max(1, tx) : Math.max(1, B.x1 - tx);
      const u = Math.abs(x - tx) / span_;
      return tTop + (dy0 - 1 - tTop) * Math.pow(u, 0.75);
    };
    for (let x = 0; x <= B.x1; x++) {
      if (x >= c0 && x <= c1) continue;
      const cy = cab(x, x < tx ? -1 : 1),
        yi = Math.round(cy);
      if (yi < dy0) {
        const i = P(x, yi, x < tx ? '\\' : '/', cableC, id, 2);
        if (x % 3 === 0 && lightOn > 0.3) {
          const q = mul3(neck, lightOn * 0.9);
          P(x, yi, '·', q, id, 2);
          EM(i, q, 0.8);
        }
      }
      if (x % 3 === 0)
        for (let y = yi + 1; y < dy0; y++) {
          const i = y * cols + x;
          if (!solid[i]) {
            P(x, y, '¦', mul3(cableC, 0.3), id);
          }
        }
    }
    for (let y = tTop; y <= dy0 + 1; y++)
      for (let x = c0; x <= c1; x++) {
        if (x < 0 || x >= cols) continue;
        const i = y * cols + x;
        br[i] = stone[0] * 0.55;
        bgc[i] = stone[1] * 0.55;
        bb[i] = stone[2] * 0.55;
        const rel = y - tTop,
          archTop = Math.round(B.th * 0.42),
          o = x - c0,
          isOpen = o === 1 || o === 2 || o === tw - 3 || o === tw - 2,
          inArch = rel >= archTop && y < dy0 && isOpen;
        const archPeak =
          rel === archTop - 1 && (o === 1 || o === tw - 3)
            ? '/'
            : rel === archTop - 1 && (o === 2 || o === tw - 2)
              ? '\\'
              : null;
        if (inArch) {
          glyph[i] = 0;
          br[i] = mix3(hor, deep, 0.5)[0];
          bgc[i] = mix3(hor, deep, 0.5)[1];
          bb[i] = mix3(hor, deep, 0.5)[2];
          solid[i] = 2;
          ent[i] = id;
          continue;
        }
        P(
          x,
          y,
          archPeak || (rel === 0 ? '▀' : x === c0 || x === c1 ? '│' : '▒'),
          archPeak ? stoneE : mul3(stone, rel === 0 ? 1.2 : 0.9),
          id,
          2,
        );
        EM(i, mul3(stone, 0.35 * night), 1);
      }
    const deckC = mul3([0.3, 0.3, 0.34], 0.35 + 0.6 * amb);
    for (let x = 0; x <= B.x1; x++) {
      if (x >= c0 && x <= c1) continue;
      P(x, dy0, '═', deckC, id, 2);
    }
    const nCars = Math.round(3 + net * 12);
    for (let k = 0; k < nCars; k++) {
      const dir = k % 2 ? 1 : -1,
        sp = 4 + hash2(k, 1, seed) * 4,
        ph = hash2(k, 2, seed) * B.x1;
      const x = Math.floor((((dir > 0 ? t * sp + ph : -t * sp + ph) % B.x1) + B.x1) % B.x1);
      if (x >= c0 && x <= c1) continue;
      const c = dir > 0 ? [1, 0.95, 0.8] : [1, 0.2, 0.15];
      const i = P(x, dy0, '·', c, id, 2);
      EM(i, c, 0.6);
    }
  }
  // ── promenade
  {
    const ry = promY,
      railC = mul3([0.42, 0.44, 0.5], 0.3 + 0.6 * amb),
      lampC = [1, 0.82, 0.5];
    for (let y = ry + 1; y < rows; y++) {
      const f = (y - ry) / Math.max(1, rows - ry);
      const pc = mix3(
        mul3([0.2, 0.21, 0.24], 0.35 + 0.65 * amb),
        [0.012, 0.013, 0.018],
        0.3 + 0.55 * f,
      );
      for (let x = 0; x < cols; x++) {
        const i = y * cols + x;
        br[i] = pc[0];
        bgc[i] = pc[1];
        bb[i] = pc[2];
        ent[i] = ID.prom;
        glyph[i] = 0;
        emR[i] = emG[i] = emB[i] = 0;
        const hh = hash2(x, y, seed + 97);
        if (hh < 0.05) PS(i, G_DOT, pc[0] * 1.8 + 0.02, pc[1] * 1.8 + 0.02, pc[2] * 1.8 + 0.02);
        else if ((y - ry) % 3 === 0 && hh < 0.5)
          PS(i, G_US, pc[0] * 1.4 + 0.01, pc[1] * 1.4 + 0.01, pc[2] * 1.4 + 0.01);
      }
    }
    for (let x = 0; x < cols; x++) {
      const post = x % 4 === 0;
      P(x, ry, post ? '┬' : '─', railC, ID.rail, 2);
      if (post && ry + 1 < rows) P(x, ry + 1, '│', mul3(railC, 0.8), ID.rail, 2);
    }
    for (let lx = W.lampOff; lx < cols; lx += W.lampGap) {
      for (let k = 1; k <= 4; k++) P(lx, ry - k, '│', railC, ID.lamp, 2);
      const on = lightOn > 0.35,
        q = on ? mul3(lampC, lightOn) : mul3(railC, 1.1);
      const i = P(lx, ry - 5, '•', q, ID.lamp, 2);
      P(lx, ry - 6, '▄', railC, ID.lamp, 2);
      if (on) {
        EM(i, q, 0.6);
        L(lx, ry - 5, 4.5, lampC, 0.55 * lightOn);
        L(lx, ry + 3, 6, lampC, 0.3 * lightOn);
      }
    }
  }
  // walkers on the promenade
  if (W.away < 0.5) {
    const hy = promY + 2,
      by = promY + 3;
    for (const w of W.walkers) {
      const a = W.agents[w.agent];
      if (!a) continue;
      const x = Math.round(w.x),
        id = reg(W, { kind: 'walker', ref: w });
      const col = mul3(a.col, 0.6 + 0.4 * Math.max(amb, 0.55));
      const walking = w.state === 'walk' && w.run <= 0;
      const body =
        w.run > 0
          ? 'λ'
          : walking
            ? Math.floor(t * (musicLevel > 0.5 ? S.bpm / 60 : 3) + w.x) & 1
              ? 'Λ'
              : 'λ'
            : 'Λ';
      if (by < rows) {
        P(x, hy, w.run > 0 ? '!' : 'o', col, id);
        P(x, by, body, col, id);
      } else if (hy < rows) P(x, hy, body, col, id);
    }
  }
  // particles
  const rainC = mul3(mix3(hor, [0.7, 0.75, 0.85], 0.5), 0.35 + 0.5 * amb);
  const bput = (px: number, py: number, col: Color, isRain: boolean) => {
    const bx = Math.floor(px * 2),
      by = Math.floor(py * 4);
    if (bx < 0 || by < 0) return;
    const cx = bx >> 1,
      cy = by >> 2;
    if (cx >= cols || cy >= rows) return;
    const i = cy * cols + cx;
    if (isRain && solid[i]) return;
    const sub = by & 3,
      rc = bx & 1;
    W.bm[i] |= sub < 3 ? (rc ? 8 << sub : 1 << sub) : rc ? 128 : 64;
    if (col[0] > W.bcr[i]) W.bcr[i] = col[0];
    if (col[1] > W.bcg[i]) W.bcg[i] = col[1];
    if (col[2] > W.bcb[i]) W.bcb[i] = col[2];
  };
  for (const p of W.particles) {
    const fade = Math.max(0, p.life / (p.max || 1));
    if (p.kind === 'rain') {
      bput(p.x, p.y, rainC, true);
      bput(p.x - p.vx * 0.012, p.y - 0.28, rainC, true);
      continue;
    }
    if (p.kind === 'fw') {
      const col = mul3(p.col ?? [1, 1, 1], 0.25 + 0.95 * fade);
      bput(p.x, p.y, col, false);
      if (p.y < wy) {
        const my = wy + (wy - p.y) * 0.87;
        if (my < promY) bput(p.x + Math.sin(my * 2 + t * 3) * 0.4, my, mul3(col, 0.4), false);
      }
      if (fade > 0.3) L(Math.round(p.x), Math.floor(p.y), 1.3, p.col ?? [1, 1, 1], 0.12 * fade);
      continue;
    }
    const x = Math.round(p.x),
      y = Math.floor(p.y);
    if (x < 0 || y < 0 || x >= cols || y >= rows) continue;
    const i = y * cols + x;
    if (p.kind === 'spark') {
      P(x, y, fade > 0.5 ? '*' : '·', [1, 0.85, 0.45]);
      L(x, y, 1.1, [1, 0.7, 0.3], 0.18 * fade);
    } else if (p.kind === 'rocket') {
      P(x, y, '|', [1, 0.9, 0.7]);
      L(x, y, 1.6, [1, 0.85, 0.6], 0.4);
    } else if (p.kind === 'splash' && !solid[i]) P(x, y, S.effects > 0 ? '-' : '.', rainC);
    else if (p.kind === 'snow' && !solid[i]) {
      const v = (0.65 + 0.35 * Math.sin(p.x + p.life)) * Math.min(1, fade * 4);
      P(x, y, p.max < 22 ? '*' : '·', [0.78 * v, 0.86 * v, v]);
    }
  }
  for (let i = 0; i < N; i++) {
    const m = W.bm[i];
    if (!m) continue;
    glyph[i] = BR0 + m;
    fr[i] = W.bcr[i];
    fgc[i] = W.bcg[i];
    fb[i] = W.bcb[i];
  }
  if (S.cursor) L(S.cursor.x, S.cursor.y, 3.4, [1, 0.95, 0.85], 0.3);
  // low cloud deck and river mist (memory)
  const fp = fogParams(W);
  if (fp.deck > 0.01 || fp.mist > 0.01) {
    const fc = add3(
        mul3(mix3(hor, [0.62, 0.64, 0.68], 0.35), 0.35 + 0.65 * amb),
        mul3(sc.glow, glowK * 1.4),
      ),
      tilde = G_TIL;
    for (let y = 0; y < promY; y++) {
      const prof =
        fp.deck * Math.exp(-Math.pow((y - fp.deckY) / fp.deckW, 2)) +
        fp.mist * Math.exp(-Math.pow((y - wy) / (rows * 0.06), 2));
      if (prof < 0.02) continue;
      const fresh = first || (y & 1) === odd_,
        row = y * cols,
        fo = t * (0.05 + net * 0.2);
      for (let x = 0; x < cols; x++) {
        const i = row + x;
        let n;
        n = vnoise2(
          x * 0.05 - (fresh ? fo : Math.max(0, t - 1 / 30) * (0.05 + net * 0.2)),
          y * 0.25,
          seed + 81,
        );
        W.fogN[i] = n;
        const Fv = Math.min(0.88, prof * (0.55 + 0.7 * n));
        if (Fv < 0.02) continue;
        fr[i] += (fc[0] - fr[i]) * Fv * 0.9;
        fgc[i] += (fc[1] - fgc[i]) * Fv * 0.9;
        fb[i] += (fc[2] - fb[i]) * Fv * 0.9;
        br[i] += (fc[0] * 0.8 - br[i]) * Fv * 0.75;
        bgc[i] += (fc[1] * 0.8 - bgc[i]) * Fv * 0.75;
        bb[i] += (fc[2] * 0.8 - bb[i]) * Fv * 0.75;
        if (glyph[i] === 0 && Fv > 0.4 && hash2(x, y, Math.floor(t * 0.5)) < 0.06) {
          glyph[i] = tilde;
          fr[i] = fc[0] * 1.1;
          fgc[i] = fc[1] * 1.1;
          fb[i] = fc[2] * 1.1;
        }
      }
    }
  }
  overlay?.();
  // light + pack
  atmosphereFinish(W, S);
  const A = W.Ac,
    B = W.Bc,
    lr = W.lr,
    lg = W.lgc,
    lb = W.lb;
  for (let i = 0, j = 0; i < N; i++, j += 4) {
    let a = lr[i],
      b2 = lg[i],
      c = lb[i];
    const gl_ = glyph[i];
    if (a + b2 + c > 0) {
      a = a / (1 + 0.6 * a);
      b2 = b2 / (1 + 0.6 * b2);
      c = c / (1 + 0.6 * c);
    }
    A[j] = S.effects > 0 ? Math.min(255, (fr[i] + a * 0.35) * 255) : (fr[i] + a * 0.35) * 255;
    A[j + 1] =
      S.effects > 0 ? Math.min(255, (fgc[i] + b2 * 0.35) * 255) : (fgc[i] + b2 * 0.35) * 255;
    A[j + 2] = S.effects > 0 ? Math.min(255, (fb[i] + c * 0.35) * 255) : (fb[i] + c * 0.35) * 255;
    A[j + 3] = gl_ & 255;
    B[j] = S.effects > 0 ? Math.min(255, (br[i] + a * 0.26) * 255) : (br[i] + a * 0.26) * 255;
    B[j + 1] =
      S.effects > 0 ? Math.min(255, (bgc[i] + b2 * 0.26) * 255) : (bgc[i] + b2 * 0.26) * 255;
    B[j + 2] = S.effects > 0 ? Math.min(255, (bb[i] + c * 0.26) * 255) : (bb[i] + c * 0.26) * 255;
    B[j + 3] = gl_ >> 8;
  }
}
