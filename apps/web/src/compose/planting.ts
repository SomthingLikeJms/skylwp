import type { Color, World } from '../world/types';
import { WATERFRONTS } from '../scenes/waterfront';
import { lifeLayout } from '../systems/residents';
import { hash2 } from '../world/noise';
import { gi } from '../engine/glyphs';
import { reg } from '../world/light';
import { HARBOR, PLANE, surfaceColor } from './material';

interface PlantCell {
  x: number;
  y: number;
  glyph: number;
  material: number;
  shade: number;
}
interface Garden {
  x: number;
  foot: number;
  spread: number;
  cells: PlantCell[];
}
const gardens = new WeakMap<World, Garden[]>();
// Cool shaded leaves, warm upper foliage and bark share the waterfront palette.
const LEAF: Color[] = [[0.22, 0.34, 0.35], HARBOR.leaf, [0.44, 0.59, 0.49], [0.56, 0.7, 0.53]];
const BARK = HARBOR.wood;
const FLOWER = HARBOR.amber;
const MATERIALS = [...LEAF, BARK, FLOWER];

function makeGardens(W: World): Garden[] {
  const foot = lifeLayout(W).foot,
    profile = WATERFRONTS[W.sceneKey];
  return profile.gardens.map((position, index) => {
    const x = Math.round(position * W.cols),
      height = Math.min(17, Math.max(10, W.rows - W.promY - 3)) - index,
      spread =
        Math.min(17, Math.max(10, Math.round(W.cols * 0.042))) +
        (index === 2 ? 2 : index === 1 ? -2 : 0),
      cells: PlantCell[] = [],
      localFoot = foot - (index === 1 ? 1 : 0),
      top = localFoot - height;
    const put = (dx: number, y: number, ch: string, material: number, shade = 1) =>
      cells.push({ x: x + dx, y, glyph: gi(ch), material, shade });
    // Forking trunks, with exposed branches below the leaf masses.
    for (let y = top + 3; y < localFoot; y++) {
      const bend =
        profile.tree === 'palm'
          ? Math.round((localFoot - y) * 0.23)
          : y < top + height / 2
            ? -1
            : 0;
      put(bend, y, y % 3 === 0 ? '├' : '│', 4, PLANE.rim);
      put(bend + 1, y, y % 4 === 0 ? ':' : '¦', 4, PLANE.shadow);
    }
    for (let d = 1; d < 5; d++) {
      put(-d, top + 8 - Math.floor(d / 2), '\\', 4, 0.8);
      put(d + 1, top + 9 - d, '/', 4, 0.95);
    }
    if (profile.tree === 'palm') {
      // Two crowns with swept fronds, not a star on a straight pole.
      for (const [cx, cy, scale] of [
        [3, top + 2, 1],
        [-6, top + 6, 0.72],
      ]) {
        for (let side = -1; side <= 1; side += 2)
          for (let ray = 0; ray < 3; ray++)
            for (let d = 1; d <= Math.floor(spread * scale); d++) {
              const y =
                cy - ray + Math.round((d * d) / (spread * 5)) + (ray === 2 ? Math.floor(d / 5) : 0);
              put(
                cx + side * d,
                y,
                d < 3
                  ? side < 0
                    ? '\\'
                    : '/'
                  : d > spread * scale - 3
                    ? side < 0
                      ? '/'
                      : '\\'
                    : '─',
                1 + (ray % 3),
                0.85,
              );
            }
        for (let y = cy + 1; y < localFoot; y++)
          put(cx - Math.floor((y - cy) / 5), y, '/', 4, 0.72);
      }
    } else {
      // Overlapping irregular lobes yield an asymmetrical canopy; geometry is cached.
      const crownHeight = height * (profile.tree === 'elm' ? 0.7 : 0.59);
      const lobes =
        index === 2
          ? [
              [-0.52, 0.47, 0.55, 0.46],
              [-0.1, 0.27, 0.63, 0.41],
              [0.52, 0.54, 0.51, 0.5],
              [0.14, 0.69, 0.65, 0.28],
            ]
          : index === 1
            ? [
                [-0.4, 0.34, 0.56, 0.41],
                [0.22, 0.25, 0.45, 0.49],
                [0.53, 0.61, 0.48, 0.43],
                [-0.12, 0.69, 0.61, 0.35],
              ]
            : [
                [-0.43, 0.44, 0.6, 0.48],
                [0.15, 0.27, 0.57, 0.5],
                [0.57, 0.56, 0.47, 0.41],
                [-0.02, 0.74, 0.7, 0.33],
              ];
      for (let dy = 0; dy <= Math.ceil(crownHeight); dy++)
        for (let dx = -spread; dx <= spread; dx++) {
          const nx = dx / spread,
            ny = dy / crownHeight,
            h = hash2(dx + index * 51, dy, W.seed + 771);
          let distance = Infinity,
            nearest = 0;
          for (let l = 0; l < lobes.length; l++) {
            const [cx, cy, rx, ry] = lobes[l],
              d = ((nx - cx) / rx) ** 2 + ((ny - cy) / ry) ** 2;
            if (d < distance) {
              distance = d;
              nearest = l;
            }
          }
          if (distance >= 1 + (h - 0.5) * 0.2 || (h < 0.035 && ny > 0.6)) continue;
          // Light each leaf mass as a whole. Sparse marks describe the surface,
          // instead of unrelated high-contrast glyph noise in every cell.
          const [cx, cy, rx, ry] = lobes[nearest],
            grain = hash2(Math.floor(dx / 4), Math.floor(dy / 2), W.seed + index),
            light = 0.54 - ((nx - cx) / rx) * 0.22 - ((ny - cy) / ry) * 0.27 + grain * 0.05,
            material = light > 0.77 ? 3 : light > 0.54 ? 2 : light > 0.3 ? 1 : 0,
            rim = distance > 0.65 && light > 0.57,
            mark = rim
              ? dx % 3 === 0
                ? '`'
                : '─'
              : h > 0.9
                ? '░'
                : h > 0.68
                  ? ':'
                  : h > 0.38
                    ? '·'
                    : ' ';
          put(dx, top + dy, mark, material, 0.94 + grain * 0.06);
        }
    }
    // Low planting is a loose group of shrubs, grasses and a few warm flowers.
    for (let dx = -spread - 1; dx <= spread; dx++) {
      const h = hash2(dx, index, W.seed + 531),
        mound = Math.round(1 + 1.4 * Math.sin((dx + spread) * 0.4) ** 2);
      if (h < 0.21 && Math.abs(dx) > 2) continue;
      for (let dy = 0; dy < mound; dy++)
        put(
          dx,
          localFoot - dy,
          h > 0.92 && dy === mound - 1 ? '·' : dy === mound - 1 ? ',' : h > 0.6 ? ':' : '░',
          h > 0.92 && dy === mound - 1 ? 5 : dy === 0 ? 0 : 2,
          0.67 + h * 0.25,
        );
      if (h > 0.63) put(dx, localFoot + 1, h > 0.8 ? ',' : '`', 1, 0.65);
    }
    return { x, foot: localFoot, spread, cells };
  });
}

export function drawPlanting(W: World) {
  if (W.cols < 140) return;
  let data = gardens.get(W);
  if (!data) {
    data = makeGardens(W);
    gardens.set(W, data);
  }
  const palette = MATERIALS.map((c) => surfaceColor(W, c, 1.2)),
    id = reg(W, {
      kind: 'life',
      ref: {
        title: W.sceneKey === 'hk' ? '海滨棕榈庭院' : '临江树荫花园',
        detail: '分层树冠、分叉树干与自然生长的灌木。树下留出散步和休憩的空间。',
      },
    });
  for (const garden of data) {
    for (let dy = 0; dy < 3; dy++)
      for (let dx = -garden.spread; dx <= garden.spread + 4; dx++) {
        const x = garden.x + dx,
          y = garden.foot + dy;
        if (x < 0 || x >= W.cols || y >= W.rows - 3) continue;
        const i = y * W.cols + x,
          k = 0.72 + dy * 0.07;
        W.br[i] *= k;
        W.bgc[i] *= k;
        W.bb[i] *= k;
      }
    for (const cell of garden.cells) {
      if (cell.x < 0 || cell.x >= W.cols || cell.y < 0 || cell.y >= W.rows - 3) continue;
      const i = cell.y * W.cols + cell.x,
        c = palette[cell.material],
        k = cell.shade,
        foliage = cell.material < 4;
      W.glyph[i] = cell.glyph;
      W.fr[i] = c[0] * k;
      W.fgc[i] = c[1] * k;
      W.fb[i] = c[2] * k;
      W.br[i] = c[0] * k * (foliage ? 0.76 : 0.3);
      W.bgc[i] = c[1] * k * (foliage ? 0.76 : 0.3);
      W.bb[i] = c[2] * k * (foliage ? 0.76 : 0.3);
      W.ent[i] = id;
      W.solid[i] = 2;
      W.emR[i] = W.emG[i] = W.emB[i] = 0;
    }
  }
}
