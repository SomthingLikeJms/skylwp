import type { Grid } from '../world/types';

export function createGrid(cols: number, rows: number): Grid {
  const n = cols * rows;
  const f = () => new Float32Array(n);
  const A = new Uint8Array(n * 4),
    B = new Uint8Array(n * 4);
  return {
    glyph: new Uint16Array(n),
    fr: f(),
    fgc: f(),
    fb: f(),
    br: f(),
    bgc: f(),
    bb: f(),
    lr: f(),
    lgc: f(),
    lb: f(),
    emR: f(),
    emG: f(),
    emB: f(),
    solid: new Uint8Array(n),
    ent: new Int16Array(n),
    bm: new Uint8Array(n),
    bcr: f(),
    bcg: f(),
    bcb: f(),
    cloudN: f(),
    fogN: f(),
    A,
    B,
    Ac: new Uint8ClampedArray(A.buffer),
    Bc: new Uint8ClampedArray(B.buffer),
    skyR: new Float32Array(rows),
    skyG: new Float32Array(rows),
    skyB: new Float32Array(rows),
  };
}
