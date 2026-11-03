/** The state is explicit so checkpoints can resume the exact next random number. */
export class Random {
  constructor(public state: number) {
    this.state >>>= 0;
  }
  next = (): number => {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(this.state ^ (this.state >>> 15), 1 | this.state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function mulberry32(seed: number): () => number {
  return new Random(seed).next;
}
