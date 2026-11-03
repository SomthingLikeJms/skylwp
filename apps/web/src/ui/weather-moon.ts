import type { World, WeatherState } from '../world/types';
import { moonWeather } from '../compose/weather-moon';

const EXPRESSIONS: Record<WeatherState, string> = {
  clear: '😊',
  cloudy: '😌',
  low: '😪',
  rain: '😢',
  storm: '😨',
  snow: '🥶',
  haze: '😶‍🌫️',
};

/** Emoji supply the facial pixels; the original moon's round dot matrix remains the display. */
export class WeatherMoon {
  private readonly context: CanvasRenderingContext2D;
  private readonly faces = new Map<WeatherState, ImageData>();
  private key = '';
  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建天气月亮');
    this.context = context;
  }
  hide(): void {
    this.canvas.hidden = true;
  }
  private face(state: WeatherState): ImageData {
    const cached = this.faces.get(state);
    if (cached) return cached;
    const source = document.createElement('canvas');
    source.width = source.height = 240;
    const c = source.getContext('2d', { willReadFrequently: true })!;
    c.font = '210px "Segoe UI Emoji", "Noto Color Emoji", sans-serif';
    c.textAlign = 'center';
    c.textBaseline = 'alphabetic';
    const text = EXPRESSIONS[state],
      metrics = c.measureText(text);
    c.fillText(
      text,
      120,
      120 + (metrics.actualBoundingBoxAscent - metrics.actualBoundingBoxDescent) / 2,
    );
    const data = c.getImageData(0, 0, 240, 240);
    this.faces.set(state, data);
    return data;
  }
  draw(W: World, x: number, y: number, radius: number): void {
    const state = moonWeather(W);
    if (!state) {
      this.hide();
      return;
    }
    const size = Math.max(76, Math.min(132, (radius * 2 * innerHeight) / W.rows));
    this.canvas.hidden = false;
    this.canvas.style.width = this.canvas.style.height = `${size}px`;
    this.canvas.style.left = `${(x / W.cols) * innerWidth - size / 2}px`;
    this.canvas.style.top = `${(y / W.rows) * innerHeight - size / 2}px`;
    const dpr = Math.min(devicePixelRatio || 1, 2.5),
      pixels = Math.round(size * dpr);
    const frame = Math.floor(W.t * 8),
      key = `${state}/${frame}/${pixels}`;
    if (this.key === key) return;
    this.key = key;
    this.canvas.width = this.canvas.height = pixels;
    const c = this.context,
      center = pixels / 2,
      r = center - dpr;
    c.clearRect(0, 0, pixels, pixels);
    // No bezel or outline: the moon itself is the screen.
    c.beginPath();
    c.arc(center, center, r, 0, Math.PI * 2);
    c.fillStyle = 'rgba(190, 191, 162, .055)';
    c.fill();
    c.save();
    c.clip();
    const source = this.face(state).data,
      pitch = r / 20,
      dotRadius = pitch * 0.34;
    const breathe = 0.96 + 0.04 * Math.sin((frame / 8) * 1.2);
    for (let iy = -20; iy <= 20; iy++) {
      for (let ix = -20; ix <= 20; ix++) {
        const dx = ix / 20,
          dy = iy / 20;
        if (dx * dx + dy * dy > 0.975) continue;
        const sx = Math.max(0, Math.min(239, Math.round((dx + 1) * 119.5)));
        const sy = Math.max(0, Math.min(239, Math.round((dy + 1) * 119.5)));
        const p = (sy * 240 + sx) * 4,
          alpha = source[p + 3] / 255;
        let red = source[p] / 255,
          green = source[p + 1] / 255,
          blue = source[p + 2] / 255;
        // Warm emoji skin becomes the moon's ivory surface, retaining shaded cheeks and dark features.
        if (red > 0.38 && green > 0.25 && red >= green * 0.94 && green > blue * 1.22) {
          const shade = (red + green) * 0.5;
          red = 0.78 + shade * 0.17;
          green = 0.75 + shade * 0.18;
          blue = 0.6 + shade * 0.2;
        }
        const crater = 0.66 + 0.16 * Math.sin(ix * 0.7 + iy * 1.3) * Math.sin(iy * 0.4 - ix * 0.2);
        red = red * alpha + 0.88 * crater * (1 - alpha);
        green = green * alpha + 0.86 * crater * (1 - alpha);
        blue = blue * alpha + 0.72 * crater * (1 - alpha);
        const tear = state === 'rain' && blue > red * 1.25;
        let level = breathe;
        if (tear) level *= 0.8 + 0.2 * Math.sin(iy * 0.6 - frame * 0.6);
        if (state === 'storm' && W.t % 4 < 0.12) level *= 1.25;
        c.beginPath();
        c.arc(center + ix * pitch, center + iy * pitch, dotRadius, 0, Math.PI * 2);
        c.fillStyle = `rgb(${Math.round(red * 255 * level)} ${Math.round(green * 255 * level)} ${Math.round(blue * 255 * level)})`;
        c.fill();
      }
    }
    c.restore();
  }
}
