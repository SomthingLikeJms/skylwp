import { drawTowers } from './towers';
import { drawCityDepth } from './depth';
import { drawWaterfrontLife, drawStreetLife } from './life';
import { drawBrowserVessels } from './vessels';
import { drawPromenade } from './promenade';
import type { World, Settings, Color, StaticEntity } from '../world/types';
import { clamp, smooth, lerp, mix3, mul3, add3, lum3 } from '../world/math';
import { hash2, vnoise2 } from '../world/noise';
import { staticLayers } from './cache';
import { drawClouds, drawRidge, drawWaterBase, drawFog, packCells } from './layers';
import { skyColors, DOTX, DOTY } from '../world/palette';
import { gi, BR0, G_MID, G_US } from '../engine/glyphs';

import { reg, addLight } from '../world/light';
import { skyEffects, waterEffects, atmosphereFinish } from './atmosphere';
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
  const cached = staticLayers(W);
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
  ent.fill(ID.sky, 0, wy * cols);
  for (let y = 0; y < wy; y++) {
    const start = y * cols,
      end = start + cols;
    br.fill(skyR[y], start, end);
    bgc.fill(skyG[y], start, end);
    bb.fill(skyB[y], start, end);
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
  // The weather moon owns the celestial layer, including its water reflection.
  // Otherwise the daytime sun looks like a second moon beside the custom face.
  if (!actualMoon && sunE > -0.08) {
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
  drawClouds(W, ID.cloud, clBase, glowK, thr);
  drawRidge(W, ID.ridge, day, lightOn, hor);
  drawCityDepth(W);
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
  drawTowers(W, S, {
    day,
    night,
    amb,
    hor,
    heat,
    lightOn,
    musicLevel,
    beatEnvelope,
    musicCol,
    hour,
  });
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
  drawWaterBase(W, S, ID.water, deep, hor, net);
  const refl = [];
  if (mE > 0 || actualMoon)
    refl.push({
      x: moonX,
      c: moonCol,
      k: actualMoon ? 0.12 + night * 0.08 : 0.7 * night * (1 - rain * 0.6),
      w: 1.3,
    });
  if (!actualMoon && sunE > 0) refl.push({ x: sunX, c: sunCol, k: 0.8 * (1 - rain * 0.6), w: 2 });
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
  drawBrowserVessels(W);
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
  drawWaterfrontLife(W);
  drawPromenade(W, ID);
  drawStreetLife(W);
  // walkers on the promenade
  if (W.away < 0.5 && W.cols < 80) {
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
  drawFog(
    W,
    add3(mul3(mix3(hor, [0.62, 0.64, 0.68], 0.35), 0.35 + 0.65 * amb), mul3(sc.glow, glowK * 1.4)),
    net,
  );
  overlay?.();
  // light + pack
  atmosphereFinish(W, S);
  packCells(W);
}
