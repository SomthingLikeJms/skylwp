import { NOISE_LATTICE, hash2 } from '../world/noise';
import type { World, Tower, Stamp } from '../world/types';
import { gi, G_SQ, G_BRK, G_MID, G_DASH } from '../engine/glyphs';
import { PLANE } from './material';

// A shared, immutable noise lattice. Moving clouds/mist only update the small
// column phases; the permutation and row work is independent of animation time.
const [a, ba, ca, abcd] = NOISE_LATTICE;
export class NoiseLayer {
  private xBase: Uint32Array;
  private ux: Float64Array;
  private yBase: Uint16Array;
  private uy: Float64Array;
  private offset = NaN;
  private yOffset = NaN;
  constructor(
    private cols: number,
    private rows: number,
    private scaleX: number,
    private scaleY: number,
    private seed: number,
    private frequency = 1,
  ) {
    this.xBase = new Uint32Array(cols);
    this.ux = new Float64Array(cols);
    this.yBase = new Uint16Array(rows);
    this.uy = new Float64Array(rows);
    this.moveY(0);
  }
  moveY(offset: number): void {
    if (offset === this.yOffset) return;
    this.yOffset = offset;
    for (let y = 0; y < this.rows; y++) {
      const pos = (y * this.scaleY - offset) * this.frequency,
        iy = Math.floor(pos),
        fy = pos - iy;
      this.yBase[y] = (iy + this.seed * 61) & 255;
      this.uy[y] = fy * fy * (3 - 2 * fy);
    }
  }
  move(offset: number): void {
    if (offset === this.offset) return;
    this.offset = offset;
    for (let x = 0; x < this.cols; x++) {
      const pos = (x * this.scaleX - offset) * this.frequency,
        ix = Math.floor(pos),
        fx = pos - ix;
      this.xBase[x] = ((ix + this.seed * 37) & 255) * 256;
      this.ux[x] = fx * fx * (3 - 2 * fx);
    }
  }
  at(x: number, y: number): number {
    const i = this.xBase[x] + this.yBase[y],
      u = this.ux[x],
      v = this.uy[y];
    return a[i] + ba[i] * u + ca[i] * v + abcd[i] * u * v;
  }
}
export class CloudLayer {
  private layers: [NoiseLayer, NoiseLayer, NoiseLayer];
  constructor(cols: number, rows: number, seed: number) {
    this.layers = [
      new NoiseLayer(cols, rows, 0.035, 0.16, seed),
      new NoiseLayer(cols, rows, 0.035, 0.16, seed + 5, 2.03),
      new NoiseLayer(cols, rows, 0.035, 0.16, seed + 11, 4.1),
    ];
  }
  move(offset: number): void {
    for (const layer of this.layers) layer.move(offset);
  }
  at(x: number, y: number): number {
    return (
      this.layers[0].at(x, y) * 0.55 +
      this.layers[1].at(x, y) * 0.3 +
      this.layers[2].at(x, y) * 0.15
    );
  }
}
export class SineAxis {
  private sin: Float64Array;
  private cos: Float64Array;
  constructor(cols: number, scale: number) {
    this.sin = Float64Array.from({ length: cols }, (_, x) => Math.sin(x * scale));
    this.cos = Float64Array.from({ length: cols }, (_, x) => Math.cos(x * scale));
  }
  at(x: number, sinPhase: number, cosPhase: number): number {
    return this.sin[x] * cosPhase + this.cos[x] * sinPhase;
  }
}
interface StaticLayers {
  clouds: [CloudLayer, CloudLayer];
  fog: [NoiseLayer, NoiseLayer];
  waterMix: NoiseLayer;
  waterShine: NoiseLayer;
  covered: Uint8Array;
  coverKeys: { stamp: Stamp; radius: number; x: number; win: string }[];
  reflection: SineAxis;
  crests: SineAxis;
}
const scenes = new WeakMap<World, StaticLayers>();
export function staticLayers(world: World): StaticLayers {
  let cache = scenes.get(world);
  if (!cache) {
    const { cols, rows, seed } = world;
    cache = {
      clouds: [new CloudLayer(cols, rows, seed + 31), new CloudLayer(cols, rows, seed + 31)],
      fog: [
        new NoiseLayer(cols, rows, 0.05, 0.25, seed + 81),
        new NoiseLayer(cols, rows, 0.05, 0.25, seed + 81),
      ],
      waterMix: new NoiseLayer(cols, rows, 0.3, 1.2, seed + 57),
      waterShine: new NoiseLayer(cols, rows, 0.9, 1.7, seed + 51),
      covered: new Uint8Array(world.N),
      coverKeys: [],
      reflection: new SineAxis(cols, 0.07),
      crests: new SineAxis(cols, 0.075),
    };
    scenes.set(world, cache);
  }
  return cache;
}

/** Only cull cells whose foreground, background and emission are overwritten.
 * The intersection over every possible jitter shift keeps animated edges safe. */
export function cloudOcclusion(world: World, heat: number): Uint8Array {
  const cache = staticLayers(world),
    radius = (t: Tower) => Math.floor((heat > 0.02 ? heat * t.shim : 0) + 0.5);
  if (
    cache.coverKeys.length !== world.drawOrder.length ||
    world.drawOrder.some((t, i) => {
      const key = cache.coverKeys[i];
      return (
        !key || key.stamp !== t.st || key.radius !== radius(t) || key.x !== t.x || key.win !== t.win
      );
    })
  ) {
    cache.covered.fill(0);
    cache.coverKeys = world.drawOrder.map((t) => ({
      stamp: t.st,
      radius: radius(t),
      x: t.x,
      win: t.win,
    }));
    for (const tower of world.drawOrder) {
      const r = radius(tower);
      if (r > 2) continue;
      const { w, h, cls } = tower.st,
        material = towerLayer(tower);
      for (let dy = 0; dy < h; dy++) {
        const y = world.baseY - dy;
        if (y < 0) break;
        for (let dx = 0; dx < w; dx++) {
          const x = tower.x + dx;
          if (x < 0 || x >= world.cols) continue;
          let opaque = true;
          for (let shift = -r; shift <= r; shift++) {
            const local = dy * w + dx - shift,
              c = cls[local];
            if (dx - shift < 0 || dx - shift >= w || !c || (c === 1 && !material.windows[local])) {
              opaque = false;
              break;
            }
          }
          if (opaque) cache.covered[y * world.cols + x] = 1;
        }
      }
    }
  }
  return cache.covered;
}
interface TowerLayer {
  stamp: Stamp;
  seed: number;
  win: string;
  windows: Uint16Array;
  surface: Uint16Array;
  shade: Float32Array;
  phase: Float64Array;
  brightness: Float64Array;
  lamp: Uint8Array;
  litHash: Float64Array;
  litPhase: Int32Array;
}
const towers = new WeakMap<Tower, TowerLayer>();
export function towerLayer(tower: Tower): TowerLayer {
  let cache = towers.get(tower);
  if (!cache || cache.stamp !== tower.st || cache.seed !== tower.seed || cache.win !== tower.win) {
    const { w, h } = tower.st,
      n = w * h,
      windows = new Uint16Array(n),
      surface = new Uint16Array(n),
      shade = new Float32Array(n),
      phase = new Float64Array(n),
      brightness = new Float64Array(n),
      lamp = new Uint8Array(n);
    for (let y = 0; y < h; y++)
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        windows[i] =
          tower.win === 'grid'
            ? (x & 1) === 1
              ? G_SQ
              : 0
            : tower.win === 'strip'
              ? (x & 1) === 1
                ? G_BRK
                : 0
              : tower.win === 'dense'
                ? G_MID
                : tower.win === 'band'
                  ? (y & 1) === 0
                    ? G_DASH
                    : 0
                  : tower.win === 'mesh' && x % 3 === 1 && (y & 1) === 0
                    ? G_SQ
                    : 0;
        phase[i] = hash2(x, y, tower.seed) * 9;
        brightness[i] = 0.7 + 0.45 * hash2(x, y, tower.seed + 3);
        lamp[i] = hash2(x, y, tower.seed + 5) < 0.12 ? 1 : 0;
        // Large face planes first; quiet masonry/glazing marks sit between windows.
        const side = x > w * 0.67,
          course = y > 1 && y % 5 === 0,
          grain = hash2(Math.floor(x / 2), Math.floor(y / 3), tower.seed + 113);
        shade[i] = (side ? PLANE.shadow : x <= 1 ? PLANE.rim : PLANE.body) * (course ? 0.94 : 1);
        if (windows[i] && tower.st.cls[i] === 1) shade[i] *= PLANE.recess;
        if (!windows[i] && x > 0 && x < w - 1)
          surface[i] = course ? gi('─') : grain > 0.84 ? gi('·') : 0;
      }
    cache = {
      stamp: tower.st,
      seed: tower.seed,
      win: tower.win,
      windows,
      surface,
      shade,
      phase,
      brightness,
      lamp,
      litHash: new Float64Array(n),
      litPhase: new Int32Array(n).fill(-1),
    };
    towers.set(tower, cache);
  }
  return cache;
}
