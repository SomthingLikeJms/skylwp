import type { World } from '../world/types';
import { mulberry32 } from '../world/rng';
import { gi } from '../engine/glyphs';
import { reg } from '../world/light';
import { cloudOcclusion } from './cache';
import { hash2 } from '../world/noise';

interface DepthLayer {
  cells: Uint32Array;
  glyphs: Uint16Array;
  materials: Uint8Array;
}
const cache = new WeakMap<World, DepthLayer[]>();
const horizons = new WeakMap<World, Int16Array[]>();
function drawHorizon(W: World) {
  let bands = horizons.get(W);
  if (!bands) {
    bands = [0, 1, 2].map((layer) => {
      const edge = new Int16Array(W.cols);
      for (let x = 0; x < W.cols; x++) {
        const f = x / W.cols,
          swell =
            0.5 + 0.28 * Math.sin(f * 11 + layer * 2.1) + 0.19 * Math.sin(f * 25 + (W.seed % 19)),
          height = W.sceneKey === 'hk' ? 0.6 : W.sceneKey === 'nyc' ? 0.36 : 0.43;
        edge[x] = Math.round(W.baseY - W.Hmax * (height - layer * 0.06 + swell * 0.22));
      }
      return edge;
    });
    horizons.set(W, bands);
  }
  if (W.ridge) return;
  const id = reg(W, { kind: 'district', layer: 0 }),
    day = W.env.day,
    covered = cloudOcclusion(W, W.env.heat);
  for (let layer = 0; layer < bands.length; layer++) {
    const edge = bands[layer],
      contrast = 0.13 + layer * 0.08;
    // One color per row; cells hidden by the city never need a terrain pass.
    for (let y = Math.max(1, Math.min(...edge)); y <= W.baseY; y++) {
      const r = W.skyR[y] * (1 - contrast) + (0.08 + day * 0.13) * contrast,
        g = W.skyG[y] * (1 - contrast) + (0.15 + day * 0.17) * contrast,
        b = W.skyB[y] * (1 - contrast) + (0.2 + day * 0.19) * contrast;
      for (let x = 0; x < W.cols; x++) {
        const i = y * W.cols + x;
        if (y < edge[x] || covered[i] || W.solid[i] === 1) continue;
        const rim = layer === 2 && y === edge[x] && x % 2 === 0;
        W.br[i] = r;
        W.bgc[i] = g;
        W.bb[i] = b;
        W.glyph[i] = rim ? gi(hash2(x, layer, W.seed) > 0.5 ? '▒' : '^') : 0;
        W.fr[i] = r + (rim ? 0.015 : 0);
        W.fgc[i] = g + (rim ? 0.025 : 0);
        W.fb[i] = b + (rim ? 0.018 : 0);
        W.ent[i] = id;
      }
    }
  }
}
function build(W: World): DepthLayer[] {
  const random = mulberry32(
    W.seed ^ (W.sceneKey === 'bund' ? 191 : W.sceneKey === 'nyc' ? 727 : 359),
  );
  return [0, 1].map((layer) => {
    const cells: number[] = [],
      glyphs: number[] = [],
      materials: number[] = [],
      baseline = W.baseY - Math.round(W.Hmax * (layer ? 0.03 : 0.12));
    let x = -3;
    while (x < W.cols) {
      const width = 3 + Math.floor(random() * (layer ? 7 : 5)),
        height = Math.max(
          3,
          Math.round(W.Hmax * (layer ? 0.12 + random() * 0.28 : 0.22 + random() * 0.38)),
        ),
        step = random() > 0.65,
        roof = random() > 0.7,
        warmth = random() > 0.45;
      for (let dx = 0; dx < width; dx++) {
        if (x + dx < 0 || x + dx >= W.cols) continue;
        const h = height - (step && (dx < 2 || dx > width - 3) ? 2 : 0);
        for (let dy = 0; dy < h; dy++) {
          const y = baseline - dy;
          if (y < 1) continue;
          const edge = dy === h - 1 || dx === 0 || dx === width - 1,
            lit = !edge && dx % 2 === 1 && dy % 3 === 1 && random() < 0.46;
          cells.push(y * W.cols + x + dx);
          glyphs.push(gi(lit ? (layer ? '▪' : '·') : edge ? (dy === h - 1 ? '─' : '│') : ' '));
          materials.push(lit ? (warmth ? 3 : 4) : edge ? 2 : dx > width * 0.65 ? 1 : 0);
        }
      }
      if (roof && width > 5 && x >= 0 && x + width < W.cols) {
        const px = x + Math.floor(width / 2);
        for (let dy = 0; dy < 3; dy++) {
          const y = baseline - height - dy;
          if (y < 1) continue;
          cells.push(y * W.cols + px);
          glyphs.push(gi(dy === 2 ? '·' : '│'));
          materials.push(dy === 2 ? 3 : 2);
        }
      }
      x += width + Math.floor(random() * 4);
    }
    return {
      cells: new Uint32Array(cells),
      glyphs: new Uint16Array(glyphs),
      materials: new Uint8Array(materials),
    };
  });
}

/** Two atmospheric city distances. Geometry and window masks are generated only once. */
export function drawCityDepth(W: World): void {
  if (W.cols < 60) return;
  drawHorizon(W);
  let layers = cache.get(W);
  if (!layers) {
    layers = build(W);
    cache.set(W, layers);
  }
  const covered = cloudOcclusion(W, W.env.heat),
    day = W.env.day,
    night = W.env.night;
  for (let layer = 0; layer < layers.length; layer++) {
    const data = layers[layer],
      id = reg(W, { kind: 'district', layer }),
      contrast = layer ? 0.48 : 0.25,
      red = 0.06 + day * 0.12,
      green = 0.11 + day * 0.15,
      blue = 0.19 + day * 0.16;
    for (let n = 0; n < data.cells.length; n++) {
      const i = data.cells[n];
      if (covered[i]) continue;
      const y = Math.floor(i / W.cols),
        material = data.materials[n],
        shade = material === 1 ? 0.84 : 1,
        r = W.skyR[y] * (1 - contrast) + red * contrast * shade,
        g = W.skyG[y] * (1 - contrast) + green * contrast * shade,
        b = W.skyB[y] * (1 - contrast) + blue * contrast * shade;
      W.br[i] = r;
      W.bgc[i] = g;
      W.bb[i] = b;
      W.glyph[i] = data.glyphs[n];
      W.ent[i] = id;
      W.solid[i] = 0;
      W.emR[i] = W.emG[i] = W.emB[i] = 0;
      if (material >= 3) {
        const light = (layer ? 0.34 : 0.17) * (0.25 + night * 0.75) * (1 - W.away * 0.3);
        W.fr[i] = r * 0.5 + light * (material === 3 ? 1 : 0.53);
        W.fgc[i] = g * 0.5 + light * (material === 3 ? 0.72 : 0.75);
        W.fb[i] = b * 0.5 + light * (material === 3 ? 0.42 : 1);
      } else {
        const edge = material === 2 ? 0.035 : 0.005;
        W.fr[i] = r + edge;
        W.fgc[i] = g + edge;
        W.fb[i] = b + edge * 1.4;
      }
    }
  }
  // Distant quay cranes and navigation lights add a different scale to each harbour.
  const id = reg(W, { kind: 'district', layer: 1 }),
    positions =
      W.sceneKey === 'nyc' ? [0.08, 0.88] : W.sceneKey === 'hk' ? [0.08, 0.91] : [0.1, 0.86, 0.94];
  for (const f of positions) {
    const cx = Math.round(W.cols * f),
      base = W.baseY - 1,
      height = Math.max(4, Math.round(W.Hmax * 0.21));
    for (let dy = 0; dy < height; dy++) dot(cx, base - dy, '│');
    for (let dx = -5; dx <= 6; dx++) dot(cx + dx, base - height, '─');
    for (let dy = 1; dy < 4; dy++) dot(cx + 5, base - height + dy, dy === 3 ? '▪' : '│');
  }
  function dot(x: number, y: number, ch: string) {
    if (x < 0 || x >= W.cols || y < 1) return;
    const i = y * W.cols + x;
    if (covered[i]) return;
    W.glyph[i] = gi(ch);
    W.fr[i] = 0.18 + day * 0.1;
    W.fgc[i] = 0.25 + day * 0.12;
    W.fb[i] = 0.32 + day * 0.14;
    W.ent[i] = id;
  }
}
