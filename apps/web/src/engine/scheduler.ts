export interface LoopDriver {
  now(): number;
  frame(callback: (now: number) => void): number;
  cancelFrame(id: number): void;
  timer(callback: () => void, delay: number): number;
  cancelTimer(id: number): void;
}
/** One timer/animation callback per due frame, instead of an idle display-rate loop. */
export class LoopScheduler {
  private rate = 0;
  private deadline = 0;
  private timer: number | null = null;
  private frame: number | null = null;
  constructor(
    private callback: (now: number) => void,
    private driver: LoopDriver,
  ) {}
  setRate(rate: number): void {
    if (rate === this.rate) return;
    if (this.timer !== null) this.driver.cancelTimer(this.timer);
    if (this.frame !== null) this.driver.cancelFrame(this.frame);
    this.timer = this.frame = null;
    this.rate = rate;
    this.deadline = this.driver.now();
    if (rate > 0) this.schedule();
  }
  private schedule(): void {
    const delay = Math.max(0, this.deadline - this.driver.now());
    this.timer = this.driver.timer(() => {
      this.timer = null;
      if (this.rate <= 1) this.tick(this.driver.now());
      else
        this.frame = this.driver.frame((now) => {
          this.frame = null;
          this.tick(now);
        });
    }, delay);
  }
  private tick(now: number): void {
    if (this.rate <= 0) return;
    const rate = this.rate;
    this.callback(now);
    if (rate !== this.rate || this.rate <= 0) return;
    const interval = 1000 / this.rate;
    this.deadline += (Math.floor(Math.max(0, now - this.deadline) / interval) + 1) * interval;
    this.schedule();
  }
}
