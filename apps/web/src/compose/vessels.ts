import type { World, Color } from '../world/types';
import type { VesselArt } from '../scenes/vessels';
import { vesselArt } from '../scenes/vessels';
import { CATS } from '../scenes';
import { gi } from '../engine/glyphs';
import { reg, addLight } from '../world/light';
import { HARBOR, PLANE, surfaceColor, windowColor } from './material';

interface BoatCell {
  x: number;
  y: number;
  glyph: number;
  mirror: number;
  kind: number;
  fill: boolean;
  shade: number;
  mirrorShade: number;
}
const cache = new WeakMap<VesselArt, BoatCell[]>();
const MIRROR: Record<string, string> = {
  '/': '\\',
  '\\': '/',
  '┌': '┐',
  '┐': '┌',
  '└': '┘',
  '┘': '└',
  '├': '┤',
  '┤': '├',
  '>': '<',
  '<': '>',
};
const CABIN = HARBOR.stone;
const FENDER: Color = [0.14, 0.18, 0.19];
const CARGO: Color[] = [
  [0.45, 0.57, 0.54],
  [0.64, 0.47, 0.33],
  [0.6, 0.61, 0.47],
];
function cells(art: VesselArt) {
  let result = cache.get(art);
  if (result) return result;
  result = [];
  art.rows.forEach((row, y) => {
    const start = row.search(/\S/),
      end = row.trimEnd().length;
    for (let x = Math.max(0, start); x < end; x++) {
      const ch = row[x],
        fill = y >= art.fillFrom || (art.sail === true && (ch === '░' || ch === '▒'));
      if (ch === ' ' && !fill) continue;
      const kind =
        ch === '▪'
          ? 1
          : art.sail && y < art.fillFrom && ch !== '│'
            ? 3
            : ch === '═'
              ? 4
              : ch === 'o'
                ? 5
                : y >= art.height - 2
                  ? 2
                  : 0;
      const ink =
          ch === '═'
            ? '─'
            : ch === '▒'
              ? '░'
              : ch === ' ' && fill && (x + y * 2) % 9 === 0
                ? '·'
                : ch,
        u = (x - start) / Math.max(1, end - start - 1),
        waterline = y === art.height - 1;
      result!.push({
        x,
        y,
        glyph: gi(ink),
        mirror: gi(MIRROR[ink] ?? ink),
        kind,
        fill,
        shade: waterline || u > 0.75 ? PLANE.shadow : u < 0.18 ? PLANE.rim : PLANE.body,
        mirrorShade: waterline || u < 0.25 ? PLANE.shadow : u > 0.82 ? PLANE.rim : PLANE.body,
      });
    }
  });
  cache.set(art, result);
  return result;
}

/** Painted hulls, lit cabins and open decks, with a separate waterline and trailing wake. */
export function drawVessel(
  W: World,
  art: VesselArt,
  x: number,
  waterline: number,
  id: number,
  window: Color,
  right: boolean,
  moving: boolean,
) {
  const sx = Math.round(x),
    top = Math.round(waterline) - art.height + 1,
    distant = art.height <= 3,
    level = distant ? 0.68 : 1,
    night = W.env.night,
    hull = surfaceColor(W, art.hull, 1.12),
    trim = surfaceColor(W, art.trim, 1.12),
    cabin = surfaceColor(W, CABIN, 1.12),
    fender = surfaceColor(W, FENDER, 1.12),
    lamps = windowColor(window);
  for (const cell of cells(art)) {
    const px = sx + (right ? cell.x : art.width - 1 - cell.x),
      py = top + cell.y;
    if (px < 0 || px >= W.cols || py < 0 || py >= W.promY) continue;
    const i = py * W.cols + px,
      isWindow = cell.kind === 1,
      material =
        cell.kind === 2
          ? hull
          : cell.kind === 3 || cell.kind === 4
            ? trim
            : cell.kind === 5
              ? fender
              : art.sail
                ? hull
                : cabin,
      shade = right ? cell.shade : cell.mirrorShade,
      ink = (cell.fill ? 0.94 : PLANE.rim) * shade;
    if (cell.fill) {
      W.br[i] = material[0] * level * (isWindow ? 0.16 : 0.72 * shade);
      W.bgc[i] = material[1] * level * (isWindow ? 0.16 : 0.72 * shade);
      W.bb[i] = material[2] * level * (isWindow ? 0.16 : 0.72 * shade);
    }
    W.glyph[i] = right ? cell.glyph : cell.mirror;
    W.ent[i] = id;
    W.solid[i] = 2;
    W.fr[i] = (isWindow ? lamps[0] * (0.35 + night * 0.65) : material[0] * ink) * level;
    W.fgc[i] = (isWindow ? lamps[1] * (0.35 + night * 0.65) : material[1] * ink) * level;
    W.fb[i] = (isWindow ? lamps[2] * (0.35 + night * 0.65) : material[2] * ink) * level;
    W.emR[i] = isWindow ? W.fr[i] * night * 0.25 : 0;
    W.emG[i] = isWindow ? W.fgc[i] * night * 0.25 : 0;
    W.emB[i] = isWindow ? W.fb[i] * night * 0.25 : 0;
  }
  // Wake and a short broken cabin reflection use the same direction as the vessel.
  const stern = right ? sx : sx + art.width - 1,
    direction = right ? -1 : 1;
  if (moving)
    for (let n = 1; n <= (distant ? 5 : 10); n++) {
      const px = stern + direction * n,
        py = Math.round(waterline) + (n % 3 === 0 ? 1 : 0);
      if (px < 0 || px >= W.cols || py >= W.promY) continue;
      const i = py * W.cols + px,
        k = (1 - n / 12) * 0.25;
      W.glyph[i] = gi((n + Math.floor(W.t * 2)) % 3 ? '─' : '~');
      W.fr[i] = 0.28 * k;
      W.fgc[i] = 0.55 * k;
      W.fb[i] = 0.65 * k;
    }
  for (let n = 3; n < art.width - 3; n += 3) {
    const px = sx + n,
      py = Math.round(waterline) + 1 + (n % 2);
    if (px < 0 || px >= W.cols || py >= W.promY) continue;
    const i = py * W.cols + px,
      k = (0.04 + night * 0.12) * (1 + Math.sin(W.t * 1.3 + n) * 0.2);
    W.glyph[i] = gi(n % 2 ? '─' : '·');
    W.fr[i] = lamps[0] * k;
    W.fgc[i] = lamps[1] * k;
    W.fb[i] = lamps[2] * k;
  }
  if (!distant && night > 0.1)
    addLight(W, sx + art.width * 0.5, waterline - 2, 3, lamps, night * 0.1);
}

export function drawBrowserVessels(W: World) {
  const cargoColors = CARGO.map((c) => surfaceColor(W, c, 1.12));
  let ordered = orders.get(W);
  if (!ordered) {
    ordered = [];
    orders.set(W, ordered);
  }
  ordered.length = 0;
  for (const ship of W.ships) ordered.push(ship);
  ordered.sort(byDepth);
  for (const ship of ordered) {
    const art = vesselArt(ship.kind, ship.far),
      id = reg(W, { kind: 'ship', ref: ship }),
      category =
        ship.source === 'agent'
          ? (W.agents[ship.agent ?? -1]?.col ?? CATS[3].col)
          : ship.source === 'media' && W.track.palette.length
            ? W.track.palette[0]
            : CATS[ship.cat].col;
    const windows = category;
    drawVessel(
      W,
      art,
      ship.x,
      ship.y + art.height - 1,
      id,
      windows,
      ship.leaving,
      ship.arriving || ship.leaving,
    );
    const right = ship.leaving,
      sx = Math.round(ship.x);
    const put = (dx: number, dy: number, ch: string, col: Color, level: number, filled = false) => {
      const x = sx + (right ? dx : art.width - 1 - dx),
        y = Math.round(ship.y) + dy;
      if (x < 0 || x >= W.cols || y < 0 || y >= W.promY) return;
      const i = y * W.cols + x;
      W.glyph[i] = gi(right ? ch : (MIRROR[ch] ?? ch));
      W.fr[i] = col[0] * level;
      W.fgc[i] = col[1] * level;
      W.fb[i] = col[2] * level;
      W.ent[i] = id;
      W.solid[i] = 2;
      if (filled) {
        W.br[i] = col[0] * level * 0.72;
        W.bgc[i] = col[1] * level * 0.72;
        W.bb[i] = col[2] * level * 0.72;
      }
    };
    if (ship.source === 'memory') {
      const level = ship.far ? 0.7 : 1,
        count = Math.max(1, Math.ceil(W.sig.mem * (ship.far ? 3 : 6)));
      for (let n = 0; n < count; n++) {
        const dx = ship.far ? 5 + n * 2 : 10 + (n % 3) * 6,
          dy = ship.far ? 1 : 3 - Math.floor(n / 3) * 2;
        for (let c = 0; c < (ship.far ? 2 : 5); c++) {
          put(dx + c, dy, ship.far ? '░' : '─', cargoColors[n % 3], level, true);
          if (!ship.far)
            put(dx + c, dy + 1, c % 2 ? '│' : '·', cargoColors[n % 3], level * PLANE.recess, true);
        }
      }
    }
    if (ship.kind === 'workboat') {
      const agent = W.agents[ship.agent ?? -1],
        busy = agent?.state === 'working' && W.t - agent.lastActive < 45,
        hook = ship.far
          ? 2
          : 2 + (busy ? Math.floor((Math.sin(W.t * (0.7 + W.sig.cpu)) + 1) * 0.5) : 1);
      put(ship.far ? 9 : 23, hook, agent?.state === 'awaiting' ? '?' : 'J', windows, 0.8);
    }
    if (ship.source === 'media') {
      for (let band = 0; band < 7; band++) {
        const col = W.track.palette.length
          ? W.track.palette[band % W.track.palette.length]
          : windows;
        put(
          ship.far ? 3 + band : 8 + band * 2,
          ship.far ? 0 : 1,
          '•',
          col,
          0.45 + W.audio.levels[band] * 0.55,
        );
      }
    }
  }
}
const orders = new WeakMap<World, World['ships']>();
const byDepth = (a: World['ships'][number], b: World['ships'][number]) => a.y - b.y;
