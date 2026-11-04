import type { SceneKey, Color } from '../world/types';
export const WATERFRONTS: Record<
  SceneKey,
  {
    stone: Color;
    trim: Color;
    foliage: Color;
    gardens: readonly number[];
    tree: 'plane' | 'elm' | 'palm';
  }
> = {
  bund: {
    stone: [0.28, 0.29, 0.28],
    trim: [0.57, 0.48, 0.34],
    foliage: [0.33, 0.49, 0.35],
    gardens: [0.06, 0.34, 0.7],
    tree: 'plane',
  },
  nyc: {
    stone: [0.32, 0.27, 0.24],
    trim: [0.52, 0.4, 0.3],
    foliage: [0.43, 0.49, 0.32],
    gardens: [0.06, 0.15, 0.88],
    tree: 'elm',
  },
  hk: {
    stone: [0.22, 0.29, 0.29],
    trim: [0.4, 0.58, 0.52],
    foliage: [0.29, 0.52, 0.39],
    gardens: [0.08, 0.36, 0.9],
    tree: 'palm',
  },
};
export function promenadeY(rows: number) {
  const water = Math.max(9, Math.round(rows * 0.62));
  return Math.min(rows - 2, Math.max(water + 5, rows - Math.max(4, Math.round(rows * 0.18))));
}
