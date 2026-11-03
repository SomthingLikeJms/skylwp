import { GLYPHS } from './glyphs';
export function drawBox(
  x: CanvasRenderingContext2D,
  c: string,
  gx: number,
  gy: number,
  cw: number,
  ch: number,
  u: number,
) {
  const R = (a: number, b: number, w: number, h: number) => x.fillRect(gx + a, gy + b, w, h);
  const cx = Math.floor(cw / 2) - Math.floor(u / 2),
    cy = Math.floor(ch / 2) - Math.floor(u / 2);
  const seg: Record<string, () => void> = {
    U: () => R(cx, 0, u, cy + u),
    D: () => R(cx, cy, u, ch - cy),
    L: () => R(0, cy, cx + u, u),
    Rt: () => R(cx, cy, cw - cx, u),
  };
  const M: Record<string, string> = {
    '─': 'L Rt',
    '│': 'U D',
    '┌': 'Rt D',
    '┐': 'L D',
    '└': 'U Rt',
    '┘': 'U L',
    '├': 'U D Rt',
    '┤': 'U D L',
    '┬': 'L Rt D',
    '┴': 'L Rt U',
    '┼': 'U D L Rt',
  };
  if (M[c]) {
    M[c].split(' ').forEach((k) => seg[k]());
    return true;
  }
  const o = Math.max(u + 1, Math.round(cw * 0.22));
  if (c === '║') {
    R(cx - o, 0, u, ch);
    R(cx + o, 0, u, ch);
    return true;
  }
  if (c === '═') {
    R(0, cy - o, cw, u);
    R(0, cy + o, cw, u);
    return true;
  }
  if (c === '╬') {
    R(cx - o, 0, u, ch);
    R(cx + o, 0, u, ch);
    R(0, cy - o, cw, u);
    R(0, cy + o, cw, u);
    return true;
  }
  if (c === '█') {
    R(0, 0, cw, ch);
    return true;
  }
  if (c === '▀') {
    R(0, 0, cw, ch >> 1);
    return true;
  }
  if (c === '▄') {
    R(0, ch >> 1, cw, ch - (ch >> 1));
    return true;
  }
  if (c === '▪') {
    const w = Math.max(2, Math.round(cw * 0.56)),
      h = Math.max(2, Math.round(ch * 0.32));
    R(Math.round((cw - w) / 2), Math.round((ch - h) / 2), w, h);
    return true;
  }
  if (c === '░' || c === '▒' || c === '▓') {
    for (let py = 0; py < ch; py += u)
      for (let px = 0; px < cw; px += u) {
        const a = (px / u) | 0,
          b = (py / u) | 0;
        const on =
          c === '░'
            ? a % 2 === 0 && b % 2 === 0
            : c === '▒'
              ? (a + b) % 2 === 0
              : !(a % 2 === 1 && b % 2 === 1);
        if (on) R(px, py, u, u);
      }
    return true;
  }
  return false;
}
export function buildAtlas(cw: number, ch: number) {
  const AC = 32,
    AR = Math.ceil(GLYPHS.length / AC);
  const cv = document.createElement('canvas');
  cv.width = AC * cw;
  cv.height = AR * ch;
  const x = cv.getContext('2d')!;
  x.fillStyle = '#fff';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.font = `${Math.round(cw / 0.6)}px "JetBrains Mono", Consolas, "Courier New", monospace`;
  const u = Math.max(1, Math.round(cw / 9));
  for (let i = 1; i < GLYPHS.length; i++) {
    const c = GLYPHS[i],
      gx = (i % AC) * cw,
      gy = Math.floor(i / AC) * ch,
      code = c.charCodeAt(0);
    if (code >= 0x2800 && code <= 0x28ff) {
      const m = code - 0x2800,
        s = Math.max(1, Math.round(cw * 0.24));
      for (let bit = 0; bit < 8; bit++) {
        if (!(m & (1 << bit))) continue;
        const col = (bit >= 3 && bit <= 5) || bit === 7 ? 1 : 0;
        const row = bit < 3 ? bit : bit < 6 ? bit - 3 : 3;
        x.fillRect(
          Math.round(gx + cw * (col ? 0.7 : 0.3) - s / 2),
          Math.round(gy + ch * (0.14 + row * 0.24) - s / 2),
          s,
          s,
        );
      }
      continue;
    }
    if (drawBox(x, c, gx, gy, cw, ch, u)) continue;
    x.save();
    x.beginPath();
    x.rect(gx, gy, cw, ch);
    x.clip();
    x.fillText(c, gx + cw / 2, gy + ch * 0.54);
    x.restore();
  }
  return { cv, cols: AC };
}
