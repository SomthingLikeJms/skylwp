import type { Color, World } from '../world/types';

// One restrained material palette, shared across the skyline and the waterfront.
export const HARBOR = {
  slate: [0.36, 0.46, 0.49],
  steel: [0.53, 0.61, 0.62],
  stone: [0.69, 0.71, 0.63],
  leaf: [0.34, 0.49, 0.43],
  wood: [0.51, 0.43, 0.33],
  amber: [0.93, 0.76, 0.49],
} satisfies Record<string, Color>;
export const PLANE = { shadow: 0.66, body: 1, rim: 1.12, recess: 0.82 } as const;

const lamps = new WeakMap<Color, Color>();
/** Ordinary windows share amber light; actual agent/music signals keep their own color. */
export function windowColor(tint: Color): Color {
  let color = lamps.get(tint);
  if (!color) {
    color = [
      HARBOR.amber[0] * 0.78 + tint[0] * 0.22,
      HARBOR.amber[1] * 0.78 + tint[1] * 0.22,
      HARBOR.amber[2] * 0.78 + tint[2] * 0.22,
    ];
    lamps.set(tint, color);
  }
  return color;
}

/** Non-emissive surfaces share the sky's light. Evaluate per material, never per cell. */
export function surfaceColor(W: World, albedo: Color, exposure = 1): Color {
  const { day, dusk, rain, hor } = W.env,
    light = (0.32 + day * 0.48 + dusk * 0.17) * (1 - rain * 0.18) * exposure;
  return [
    (albedo[0] * 0.86 + HARBOR.slate[0] * 0.14) * light * (0.74 + hor[0] * 0.34) + hor[0] * 0.025,
    (albedo[1] * 0.86 + HARBOR.slate[1] * 0.14) * light * (0.84 + hor[1] * 0.22) + hor[1] * 0.025,
    (albedo[2] * 0.86 + HARBOR.slate[2] * 0.14) * light * (0.98 + hor[2] * 0.16) + hor[2] * 0.025,
  ];
}
