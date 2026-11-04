import { expect, test } from 'vitest';
import { NP, NV, vnoise2, fbm2 } from '../src/world/noise';
import { NoiseLayer, CloudLayer, cloudOcclusion } from '../src/compose/cache';
import { packCells } from '../src/compose/layers';
import { createWorld } from '../src/world/world';

test('the shared noise lattice preserves the original interpolation exactly', () => {
  function reference(x: number, y: number, s: number) {
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
  for (const seed of [0, 31, 81, 20261102, 0xffffffff])
    for (let i = -300; i <= 300; i++)
      expect(vnoise2(i * 0.713, i * 0.227, seed)).toBe(reference(i * 0.713, i * 0.227, seed));
});
test('moving layer phases preserve noise at negative offsets and lattice boundaries', () => {
  const cloud = new CloudLayer(427, 120, 39),
    fog = new NoiseLayer(427, 120, 0.05, 0.25, 89);
  for (const offset of [-1000, -0.001, 0, 0.035, 256, 2026.75]) {
    cloud.move(offset);
    fog.move(offset);
    fog.moveY(-offset);
    for (const y of [0, 1, 17, 89, 119])
      for (const x of [0, 1, 129, 255, 426]) {
        expect(cloud.at(x, y)).toBe(fbm2(x * 0.035 - offset, y * 0.16, 39));
        expect(fog.at(x, y)).toBe(vnoise2(x * 0.05 - offset, y * 0.25 + offset, 89));
      }
  }
});
test('color packing retains clamped ties-to-even bytes, including unlit cells', () => {
  const w = createWorld(40, 20, 19, 'bund');
  for (let i = 0; i < w.N; i++) {
    w.fr[i] = ((i % 8) - 2) / 255;
    w.fgc[i] = ((i % 3) + 0.5) / 255;
    w.fb[i] = 1.1;
    w.br[i] = -0.1;
    w.bgc[i] = 0.5;
    w.bb[i] = 0.99;
    w.glyph[i] = i % 512;
    if (i % 2) {
      w.lr[i] = 0.3;
      w.lgc[i] = 0.2;
      w.lb[i] = 0.1;
    }
  }
  const a = new Uint8ClampedArray(w.N * 4),
    b = new Uint8ClampedArray(w.N * 4);
  for (let i = 0; i < w.N; i++) {
    let r = w.lr[i],
      g = w.lgc[i],
      v = w.lb[i];
    if (r + g + v > 0) {
      r = r / (1 + 0.6 * r);
      g = g / (1 + 0.6 * g);
      v = v / (1 + 0.6 * v);
    }
    a.set(
      [
        (w.fr[i] + r * 0.35) * 255,
        (w.fgc[i] + g * 0.35) * 255,
        (w.fb[i] + v * 0.35) * 255,
        w.glyph[i] & 255,
      ],
      i * 4,
    );
    b.set(
      [
        (w.br[i] + r * 0.26) * 255,
        (w.bgc[i] + g * 0.26) * 255,
        (w.bb[i] + v * 0.26) * 255,
        w.glyph[i] >> 8,
      ],
      i * 4,
    );
  }
  packCells(w);
  expect(w.Ac).toEqual(a);
  expect(w.Bc).toEqual(b);
});
test('occlusion is rebuilt when a building stamp changes or jitter grows', () => {
  const w = createWorld(80, 40, 19, 'bund'),
    a = cloudOcclusion(w, 0).slice();
  const tower = w.drawOrder.find((t) => t.st.h > 2)!;
  tower.st = {
    ...tower.st,
    cls: new Uint16Array(tower.st.cls.length),
    mask: new Uint8Array(tower.st.mask.length),
  };
  const b = cloudOcclusion(w, 0).slice();
  expect(b).not.toEqual(a);
  expect(cloudOcclusion(w, 1).every((covered, i) => !covered || b[i] === 1)).toBe(true);
});
