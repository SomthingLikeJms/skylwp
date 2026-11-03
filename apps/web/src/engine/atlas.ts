import { GLYPHS, GI, gi } from './glyphs';
import { buildAtlas } from './static-atlas';
import { characterWidth } from './text';

interface Glyph {
  left: number;
  right: number | null;
  used: number;
  char: string;
}

export class GlyphAtlas {
  readonly canvas = document.createElement('canvas');
  readonly columns: number;
  readonly capacity: number;
  private context: CanvasRenderingContext2D;
  private entries = new Map<string, Glyph>();
  private slots: (Glyph | undefined)[];
  private frame = 0;
  dirty = true;

  constructor(
    readonly cellWidth: number,
    readonly cellHeight: number,
  ) {
    this.canvas.width = this.canvas.height = 2048;
    this.columns = Math.floor(2048 / cellWidth);
    this.capacity = Math.min(65536, this.columns * Math.floor(2048 / cellHeight));
    this.slots = new Array(this.capacity);
    const context = this.canvas.getContext('2d');
    if (!context) throw new Error('无法创建字形图集');
    this.context = context;
    const original = buildAtlas(cellWidth, cellHeight);
    for (let i = 0; i < GLYPHS.length; i++) {
      context.drawImage(
        original.cv,
        (i % original.cols) * cellWidth,
        Math.floor(i / original.cols) * cellHeight,
        cellWidth,
        cellHeight,
        (i % this.columns) * cellWidth,
        Math.floor(i / this.columns) * cellHeight,
        cellWidth,
        cellHeight,
      );
    }
  }

  beginFrame(): void {
    this.frame++;
  }

  glyph(char: string): Glyph {
    const existing = this.entries.get(char);
    if (existing) {
      existing.used = this.frame;
      return existing;
    }
    const fixed = GI.get(char);
    if (fixed !== undefined) {
      const value = { left: fixed, right: null, used: this.frame, char };
      this.entries.set(char, value);
      return value;
    }
    const width = characterWidth(char) === 2 ? 2 : 1;
    let slot = this.findSlot(width);
    while (slot < 0) {
      let oldest: Glyph | undefined;
      for (const value of this.entries.values()) {
        if (value.left < GLYPHS.length || value.used >= this.frame) continue;
        if (!oldest || value.used < oldest.used) oldest = value;
      }
      if (!oldest) return this.glyph('?');
      this.entries.delete(oldest.char);
      this.slots[oldest.left] = undefined;
      if (oldest.right !== null) this.slots[oldest.right] = undefined;
      slot = this.findSlot(width);
    }
    const value: Glyph = {
      left: slot,
      right: width === 2 ? slot + 1 : null,
      used: this.frame,
      char,
    };
    this.slots[slot] = value;
    if (value.right !== null) this.slots[value.right] = value;
    this.entries.set(char, value);
    const x = (slot % this.columns) * this.cellWidth,
      y = Math.floor(slot / this.columns) * this.cellHeight;
    const c = this.context;
    c.clearRect(x, y, this.cellWidth * width, this.cellHeight);
    c.save();
    c.beginPath();
    c.rect(x, y, this.cellWidth * width, this.cellHeight);
    c.clip();
    c.fillStyle = '#fff';
    c.textAlign = 'center';
    c.textBaseline = 'middle';
    c.font = `${Math.round(this.cellWidth / 0.6)}px "Sarasa Mono SC", "Microsoft YaHei", "Noto Sans SC", Consolas, monospace`;
    c.fillText(char, x + (this.cellWidth * width) / 2, y + this.cellHeight * 0.54);
    c.restore();
    this.dirty = true;
    return value;
  }

  private findSlot(width: number): number {
    for (let i = GLYPHS.length; i < this.capacity - width + 1; i++) {
      if (width === 2 && i % this.columns === this.columns - 1) continue;
      if (!this.slots[i] && (width === 1 || !this.slots[i + 1])) return i;
    }
    return -1;
  }
}

export { gi };
