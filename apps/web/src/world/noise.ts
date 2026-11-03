import { mulberry32 } from './rng';
export function hash2(x: number, y: number, s: number) {
  let h =
    (Math.imul(x | 0, 0x27d4eb2d) + Math.imul(y | 0, 0x165667b1) + Math.imul(s | 0, 0x61c88647)) |
    0;
  h = Math.imul(h ^ (h >>> 15), 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}
export const NP = new Uint8Array(512),
  NV = new Float32Array(256);
(() => {
  const r = mulberry32(9157),
    a: number[] = [];
  for (let i = 0; i < 256; i++) a.push(i);
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(r() * (i + 1)),
      t = a[i];
    a[i] = a[j];
    a[j] = t;
  }
  for (let i = 0; i < 512; i++) NP[i] = a[i & 255];
  for (let i = 0; i < 256; i++) NV[i] = r();
})();
export function vnoise1(x: number, s: number) {
  const ix = Math.floor(x),
    f = x - ix,
    u = f * f * (3 - 2 * f),
    xa = (ix + s * 37) & 255;
  const a = NV[NP[xa]],
    b = NV[NP[(xa + 1) & 255]];
  return a + (b - a) * u;
}
export function vnoise2(x: number, y: number, s: number) {
  const ix = Math.floor(x),
    iy = Math.floor(y),
    fx = x - ix,
    fy = y - iy,
    ux = fx * fx * (3 - 2 * fx),
    uy = fy * fy * (3 - 2 * fy);
  const xa = (ix + s * 37) & 255,
    xb = (xa + 1) & 255,
    ya = (iy + s * 61) & 255,
    yb = (ya + 1) & 255;
  const a = NV[NP[NP[xa] + ya]],
    b = NV[NP[NP[xb] + ya]],
    c = NV[NP[NP[xa] + yb]],
    d = NV[NP[NP[xb] + yb]];
  return a + (b - a) * ux + (c - a) * uy + (a - b - c + d) * ux * uy;
}
export function fbm1(x: number, s: number) {
  return vnoise1(x, s) * 0.55 + vnoise1(x * 2.1, s + 7) * 0.3 + vnoise1(x * 4.3, s + 13) * 0.15;
}
export function fbm2(x: number, y: number, s: number) {
  return (
    vnoise2(x, y, s) * 0.55 +
    vnoise2(x * 2.03, y * 2.03, s + 5) * 0.3 +
    vnoise2(x * 4.1, y * 4.1, s + 11) * 0.15
  );
}
