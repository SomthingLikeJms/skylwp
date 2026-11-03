import type { Color } from './types';
export const clamp = (v: number, a: number, b: number) => (v < a ? a : v > b ? b : v);
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
export const smooth = (a: number, b: number, v: number) => {
  const t = clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
};
export const mix3 = (a: Color, b: Color, t: number) => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];
export const add3 = (a: Color, b: Color) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const mul3 = (a: Color, k: number) => [a[0] * k, a[1] * k, a[2] * k];
export const lum3 = (c: Color) => c[0] * 0.3 + c[1] * 0.59 + c[2] * 0.11;

export const pick = <T>(R: () => number, a: readonly T[]): T => a[Math.floor(R() * a.length)];
export const odd = (n: number) => n | 1;
