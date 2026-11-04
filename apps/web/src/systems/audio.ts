import type { World } from '../world/types';

export function audioIsFresh(world: World): boolean {
  // Silence arrives once a second; allow delivery jitter without momentarily
  // falling back to simulated beats between two zero-valued heartbeats.
  const quiet = Math.max(world.audio.bass, world.audio.mid, world.audio.high) <= 0.001;
  return world.t - world.audio.lastFrame < (quiet ? 2 : 1);
}
