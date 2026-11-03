import type { Stamp, Roof } from '../world/types';
import { odd, lerp } from '../world/math';
import { gi, BR0 } from '../engine/glyphs';
import { DOTX, DOTY } from '../world/palette';
export function mkS(w: number, h: number): Stamp {
  return { w, h, mask: new Uint8Array(w * h), ov: [], cls: new Uint16Array(w * h) };
}
export function span(S: Stamp, dy: number, l: number, r: number) {
  if (dy < 0 || dy >= S.h) return;
  for (let x = Math.max(0, l); x <= Math.min(S.w - 1, r); x++) S.mask[dy * S.w + x] = 1;
}
export function ov(S: Stamp, dx: number, dy: number, k: number, ch: number | string, key: string) {
  S.ov.push({ dx, dy, k, g: typeof ch === 'number' ? ch : gi(ch), key });
}
export function finalize(S: Stamp) {
  const w = S.w,
    h = S.h,
    mask = S.mask,
    cls = new Uint16Array(w * h);
  const M = (x: number, y: number) => x >= 0 && x < w && y >= 0 && y < h && mask[y * w + x] === 1;
  const gS = gi('/'),
    gB = gi('\\'),
    gH = gi('─'),
    gV = gi('│');
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      if (!M(x, y)) continue;
      const up = M(x, y + 1),
        L = M(x - 1, y),
        R = M(x + 1, y);
      let g = 1;
      if (!up) {
        if (!L && M(x + 1, y + 1)) g = gS + 2;
        else if (!R && M(x - 1, y + 1)) g = gB + 2;
        else g = gH + 2;
      } else if (!L || !R) g = gV + 2;
      cls[y * w + x] = g;
    }
  S.cls = cls;
  return S;
}
export function ovDisc(S: Stamp, cxF: number, cyF: number, ry: number, key: string) {
  const rx = ry * 2;
  for (let dy = Math.floor(cyF - ry - 1); dy <= Math.ceil(cyF + ry + 1); dy++) {
    if (dy < 0 || dy >= S.h) continue;
    for (let dx = Math.floor(cxF - rx - 1); dx <= Math.ceil(cxF + rx + 1); dx++) {
      if (dx < 0 || dx >= S.w) continue;
      let m = 0;
      for (let b = 0; b < 8; b++) {
        const px = (dx + DOTX[b] - cxF) * 0.5,
          py = dy + 1 - DOTY[b] - cyF;
        if (px * px + py * py < ry * ry) m |= 1 << b;
      }
      if (m) {
        S.mask[dy * S.w + dx] = 1;
        ov(S, dx, dy, 2, BR0 + m, key);
      }
    }
  }
}

export function bGen(w: number, h: number, roof: Roof, R: () => number) {
  const ext = roof === 'pyramid' ? w >> 1 : 0;
  const S = mkS(w, h + ext);
  const cx = w >> 1;
  const sb = roof === 'setback' ? Math.max(2, Math.round(h * (0.7 + R() * 0.15))) : h;
  for (let dy = 0; dy < h; dy++) {
    let l = 0,
      r = w - 1;
    if (dy >= sb && w >= 6) {
      l = w >= 8 ? 2 : 1;
      r = w - 1 - l;
    }
    if (roof === 'slant') {
      const k = dy - (h - Math.ceil(w / 2));
      if (k > 0) r = w - 1 - k * 2;
    }
    if (r >= l) span(S, dy, l, r);
  }
  if (ext) {
    let half = cx;
    for (let k = 0; k < ext; k++) {
      half--;
      if (half < 0) break;
      span(S, h + k, cx - half, cx + half);
    }
  }
  if (roof === 'spire') {
    for (let k = 0; k < 3; k++) ov(S, cx, h + k, 1, '│', 'steel');
    ov(S, cx, h + 3, 2, '•', 'beacon');
  }
  if (roof === 'crown') {
    for (let x = 1; x < w - 1; x++) ov(S, x, h - 1, 2, '▪', 'crownW');
  }
  if (roof === 'water' && w >= 5) {
    ov(S, 1, h, 1, '│', 'tank');
    ov(S, 3, h, 1, '│', 'tank');
    for (let x = 1; x <= 3; x++) ov(S, x, h + 1, 1, '█', 'tank');
    ov(S, 2, h + 2, 1, '^', 'tank');
  }
  return finalize(S);
}
export function bOPT(H: number) {
  const ry1 = Math.max(1.1, H * 0.06),
    ry2 = Math.max(0.85, H * 0.042);
  const w = Math.max(7, odd(Math.ceil(ry1 * 4) + 3)),
    cx = w >> 1,
    S = mkS(w, H);
  const top = Math.round(H * 0.82);
  for (let dy = 0; dy < top; dy++) S.mask[dy * w + cx] = 1;
  const legH = Math.max(2, Math.round(H * 0.2));
  for (let dy = 0; dy < legH; dy++) {
    const s = Math.round((cx - 1) * (1 - dy / legH));
    if (s >= 1) {
      ov(S, cx - s, dy, 1, '/', 'pearlS');
      ov(S, cx + s, dy, 1, '\\', 'pearlS');
    }
  }
  for (let dy = 0; dy < top; dy++) ov(S, cx, dy, 2, '║', 'pearlDim');
  ovDisc(S, cx + 0.5, H * 0.27, ry1, 'pearl');
  ovDisc(S, cx + 0.5, H * 0.64, ry2, 'pearl');
  [0.42, 0.48, 0.54].forEach((f) => ov(S, cx, Math.round(H * f), 2, '•', 'pearl'));
  ov(S, cx, Math.round(H * 0.79), 2, '•', 'pearl');
  for (let dy = top; dy < H; dy++) ov(S, cx, dy, 1, '│', 'steel');
  ov(S, cx, H - 1, 2, '•', 'beacon');
  return finalize(S);
}
export function bJM(H: number) {
  const w = Math.max(7, odd(Math.round(H * 0.27))),
    cx = w >> 1,
    S = mkS(w, H);
  const shaft = Math.round(H * 0.76),
    steps = 8;
  for (let dy = 0; dy < shaft; dy++) {
    const k = Math.floor((dy / shaft) * steps);
    const half = Math.max(1, cx - Math.floor(k * 0.6));
    span(S, dy, cx - half, cx + half);
  }
  let half = Math.max(1, cx - Math.floor((steps - 1) * 0.6));
  const crownTop = Math.round(H * 0.9);
  for (let dy = shaft; dy < crownTop; dy++) {
    if ((dy - shaft) % 2 === 1 && half > 0) half--;
    span(S, dy, cx - half, cx + half);
    ov(S, cx, dy, 2, '▪', 'gold');
  }
  for (let dy = crownTop; dy < H; dy++) ov(S, cx, dy, 1, '│', 'steel');
  ov(S, cx, H - 1, 2, '•', 'beacon');
  return finalize(S);
}
export function bSWFC(H: number) {
  const w = Math.max(7, odd(Math.round(H * 0.27))),
    cx = w >> 1,
    S = mkS(w, H);
  const halfT = Math.max(2, Math.round(cx * 0.48));
  const h0 = Math.round(H * 0.86),
    h1 = Math.round(H * 0.95);
  for (let dy = 0; dy < H; dy++) {
    const half = Math.round(lerp(cx, halfT, dy / (H - 1)));
    span(S, dy, cx - half, cx + half);
    if (dy >= h0 && dy < h1 && dy < H - 1)
      for (let x = cx - half + 1; x <= cx + half - 1; x++) S.mask[dy * w + x] = 0;
  }
  ov(S, cx, H - 1, 2, '•', 'beacon');
  return finalize(S);
}
export function bSHT(H: number) {
  const w = Math.max(9, odd(Math.round(H * 0.36))),
    cx = w >> 1,
    S = mkS(w, H);
  for (let dy = 0; dy < H; dy++) {
    const f = dy / (H - 1);
    const half = Math.round(cx * (1 - 0.5 * Math.pow(f, 0.85)));
    let l = cx - half,
      r = cx + half;
    if (f > 0.9) r -= Math.round(((f - 0.9) / 0.1) * (r - l) * 0.6);
    span(S, dy, l, r);
    const sp = r - l - 1;
    if (sp > 2 && dy < H - 1) ov(S, l + 1 + Math.floor((dy * 0.7) % sp), dy, 1, '/', 'seam');
  }
  for (let x = 0; x < w; x++) if (S.mask[(H - 1) * w + x]) ov(S, x, H - 1, 2, '▀', 'crownW');
  return finalize(S);
}
export function bESB(H: number) {
  const w = Math.max(9, odd(Math.round(H * 0.34))),
    cx = w >> 1,
    S = mkS(w, H);
  const roof = Math.round(H * 0.8);
  const tiers = [
    [0.16, cx],
    [0.82, Math.max(2, Math.round(cx * 0.62))],
    [0.9, Math.max(2, Math.round(cx * 0.44))],
    [0.96, Math.max(1, Math.round(cx * 0.28))],
    [1.01, Math.max(1, Math.round(cx * 0.16))],
  ];
  for (let dy = 0; dy < roof; dy++) {
    const f = dy / roof;
    let half = cx;
    for (const tr of tiers) {
      if (f < tr[0]) {
        half = tr[1];
        break;
      }
    }
    span(S, dy, cx - half, cx + half);
  }
  for (let dy = Math.round(roof * 0.88); dy < roof; dy++) ov(S, cx, dy, 2, '▪', 'crownC');
  for (let dy = roof; dy < H; dy++) {
    const lit = dy < roof + 2;
    ov(S, cx, dy, lit ? 2 : 1, lit ? '║' : '│', lit ? 'crownC' : 'steel');
  }
  ov(S, cx, H - 1, 2, '•', 'beacon');
  return finalize(S);
}
export function bCHR(H: number) {
  const w = Math.max(7, odd(Math.round(H * 0.28))),
    cx = w >> 1,
    S = mkS(w, H);
  const sTop = Math.round(H * 0.62),
    cTop = Math.round(H * 0.82);
  for (let dy = 0; dy < sTop; dy++) {
    const half = dy < H * 0.12 ? cx : Math.max(2, cx - 1);
    span(S, dy, cx - half, cx + half);
  }
  for (let dy = sTop; dy < cTop; dy++) {
    const f = (dy - sTop) / Math.max(1, cTop - sTop);
    const half = Math.max(1, Math.round(lerp(cx - 1, 1, f)));
    span(S, dy, cx - half, cx + half);
    for (let x = cx - half + 1; x <= cx + half - 1; x++)
      if (((x + dy) & 1) === 0) ov(S, x, dy, 2, '^', 'crownW');
  }
  for (let dy = cTop; dy < H; dy++) ov(S, cx, dy, 1, dy % 2 ? '¦' : '│', 'steel');
  return finalize(S);
}
export function bOWTC(H: number) {
  const roof = Math.round(H * 0.76),
    w = Math.max(9, odd(Math.round(H * 0.3))),
    cx = w >> 1,
    S = mkS(w, H);
  const base = Math.max(1, Math.round(roof * 0.08));
  for (let dy = 0; dy < roof; dy++) {
    const half =
      dy < base
        ? cx
        : Math.round(lerp(cx, Math.max(1, cx * 0.48), (dy - base) / Math.max(1, roof - base)));
    span(S, dy, cx - half, cx + half);
  }
  for (let dy = base; dy < roof; dy++) {
    const f = (dy - base) / Math.max(1, roof - base);
    const xl = Math.round(lerp(0, cx, f)),
      xr = Math.round(lerp(w - 1, cx, f));
    if (xl > 0 && S.mask[dy * w + xl] && S.mask[dy * w + xl - 1]) ov(S, xl, dy, 1, '/', 'facet');
    if (xr !== xl && xr < w - 1 && S.mask[dy * w + xr] && S.mask[dy * w + xr + 1])
      ov(S, xr, dy, 1, '\\', 'facet');
  }
  for (let dy = roof; dy < H; dy++) ov(S, cx, dy, 1, '│', 'steel');
  ov(S, cx, H - 1, 2, '•', 'strobe');
  return finalize(S);
}
export function bIFC(H: number) {
  const roof = Math.round(H * 0.88),
    w = Math.max(9, odd(Math.round(H * 0.28))),
    cx = w >> 1,
    S = mkS(w, H);
  for (let dy = 0; dy < roof; dy++) {
    const f = dy / roof;
    const half = f < 0.8 ? cx : f < 0.9 ? cx - 1 : Math.max(1, cx - 2);
    span(S, dy, cx - half, cx + half);
  }
  const tp = Math.max(1, cx - 2);
  for (let dy = roof; dy < H; dy++) {
    const k = dy - roof;
    ov(S, cx - tp, dy, 1, '│', 'fin');
    ov(S, cx + tp, dy, 1, '│', 'fin');
    if (k < (H - roof) * 0.6 && tp > 2) {
      ov(S, cx - 1, dy, 1, '¦', 'fin');
      ov(S, cx + 1, dy, 1, '¦', 'fin');
    }
  }
  for (let x = cx - tp; x <= cx + tp; x++) ov(S, x, roof - 1, 2, '▪', 'crownW');
  return finalize(S);
}
export function bBOC(H: number) {
  const roof = Math.round(H * 0.84),
    w = Math.max(8, Math.round(H * 0.28)),
    S = mkS(w, H);
  const q = w / 4;
  const tops = [roof, roof * 0.78, roof * 0.6, roof * 0.42];
  for (let x = 0; x < w; x++) {
    const seg = Math.min(3, Math.floor(x / q));
    const top = Math.round(tops[seg] - (x - seg * q) * 0.9);
    for (let dy = 0; dy < Math.max(1, top); dy++) S.mask[dy * w + x] = 1;
  }
  const M = (x: number, y: number) => x >= 0 && x < w && y >= 0 && y < H && S.mask[y * w + x] === 1;
  for (let dy = 0; dy < roof; dy++)
    for (let x = 1; x < w - 1; x++) {
      if (!M(x, dy) || !M(x - 1, dy) || !M(x + 1, dy) || !M(x, dy + 1)) continue;
      const u = (((x - 2 * dy) % 10) + 10) % 10,
        v = (((x + 2 * dy) % 10) + 10) % 10;
      if (u === 0) ov(S, x, dy, 2, '/', 'brace');
      else if (v === 0) ov(S, x, dy, 2, '\\', 'brace');
    }
  const m1 = 1,
    m2 = Math.min(w - 2, 3),
    t1 = Math.round(tops[0] - m1 * 0.9),
    t2 = Math.round(tops[0] - m2 * 0.9);
  for (let dy = t1; dy < H; dy++) ov(S, m1, dy, 1, '│', 'steel');
  for (let dy = t2; dy < Math.round(H * 0.95); dy++) ov(S, m2, dy, 1, '│', 'steel');
  ov(S, m1, H - 1, 2, '•', 'beacon');
  return finalize(S);
}
export function bCP(H: number) {
  const roof = Math.round(H * 0.76),
    w = Math.max(7, odd(Math.round(H * 0.24))),
    cx = w >> 1,
    S = mkS(w, H);
  for (let dy = 0; dy < roof; dy++) span(S, dy, 0, w - 1);
  let half = cx,
    dy = roof;
  while (half >= 0 && dy < H) {
    span(S, dy, cx - half, cx + half);
    half--;
    dy++;
  }
  for (let k = 0; k < 3; k++) {
    const yy = roof - 1 - k * 2;
    for (let x = 1; x < w - 1; x++) ov(S, x, yy, 2, '─', 'neon');
  }
  for (let d = dy; d < H; d++) ov(S, cx, d, 1, '│', 'steel');
  ov(S, cx, H - 1, 2, '•', 'beacon');
  return finalize(S);
}
export const BUILD: Record<string, (h: number) => Stamp> = {
  opt: bOPT,
  jinmao: bJM,
  swfc: bSWFC,
  sht: bSHT,
  esb: bESB,
  chrysler: bCHR,
  owtc: bOWTC,
  ifc: bIFC,
  boc: bBOC,
  cp: bCP,
};
