/** Keep one deadline per render mode; skipped display frames never cause duplicate draws. */
export class FramePacer {
  private deadline = 0;
  private fps = 0;
  shouldPaint(now: number, fps: number): boolean {
    if (fps !== this.fps) {
      this.fps = fps;
      this.deadline = now;
    }
    if (now < this.deadline) return false;
    const interval = 1000 / fps;
    this.deadline += (Math.floor((now - this.deadline) / interval) + 1) * interval;
    return true;
  }
}
