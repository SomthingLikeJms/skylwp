import type { Color, World } from '../world/types';
import { gi } from '../engine/glyphs';
import { reg, addLight } from '../world/light';
import { LIFE_SCENES } from '../scenes/life';
import { lifeLayout, ferryPose } from '../systems/residents';
import { drawPlanting } from './planting';
import { drawQuayside } from './quayside';
import { drawVessel } from './vessels';
import { vesselArt } from '../scenes/vessels';

export interface LifeDetail {
  title: string;
  detail: string;
}
interface Sprite {
  cells: { x: number; y: number; g: number }[];
  width: number;
  height: number;
}
function sprite(lines: string[]): Sprite {
  const cells: Sprite['cells'] = [];
  lines.forEach((line, y) =>
    [...line].forEach((c, x) => {
      if (c !== ' ') cells.push({ x, y, g: gi(c) });
    }),
  );
  return { cells, width: Math.max(...lines.map((l) => l.length)), height: lines.length };
}
const BENCH = sprite([' ┌───────────┐ ', ' ├═┬═┬═┬═┬═┬═┤ ', ' └─┬───────┬─┘ ', '   ┴       ┴   ']);
const PLANTER = sprite(['  \\|/  ', ' \\|/|/ ', '  | |  ', '└─────┘']);
const BIKES = sprite(['  _   _   ', ' o^o o^o  ', '─┴───┴───']);
const CYCLE = [sprite(['  o   ', ' /|_  ', 'o^─^o ']), sprite(['  o   ', ' /|_  ', 'o─^─o '])];
const CAT = [sprite(['/\\_/\\ ', '( o.o)', ' /_~  ']), sprite(['/\\_/\\ ', '( -.-)', ' /_~  '])];
const WORK = sprite([
  ' ┌───────────────┐ ',
  ' │   WORKSHOP    │ ',
  ' ├───────────────┤ ',
  ' │  ┌───┐  ┌──┐  │ ',
  ' │  │ ▪ │  │[]│  │ ',
  ' ├──┴───┴──┴──┴──┤ ',
  ' ┴               ┴ ',
]);
const SHELTER = sprite([
  ' ┌───────────────┐ ',
  ' │     FERRY     │ ',
  ' └┬─────────────┬┘ ',
  '  │             │  ',
  '  │             │  ',
  '  │   ───────   │  ',
  '  ┴             ┴  ',
]);
const BIN = sprite(['┌─┐', '│▒│', '└─┘']);
const SIGN = sprite(['┌───┐', '│ i │', '└─┬─┘', '  │  ', '  ┴  ']);
const AMBER: Color = [0.92, 0.73, 0.43];
const GREEN: Color = [0.43, 0.61, 0.46];
const STEEL: Color = [0.52, 0.63, 0.68];
const CREAM: Color = [0.83, 0.79, 0.64];
const COATS: Color[] = [
  [0.77, 0.61, 0.44],
  [0.5, 0.69, 0.73],
  [0.75, 0.5, 0.45],
];
const DETAILS = {
  bench: { title: '临江长椅', detail: '有人坐下歇脚，看看对岸的灯。' },
  planter: { title: '步道花箱', detail: '沿着栏杆放着几盆绿植。' },
  bikes: { title: '单车停靠点', detail: '骑行道就在步道的外侧。' },
  cyclist: { title: '沿江骑行', detail: '场景居民沿着滨水步道骑行，下雨时暂停。' },
  angler: { title: '岸边钓鱼', detail: '浮标轻轻起伏，偶尔提竿收线。' },
  cat: { title: '摊边的猫', detail: '坐在小店旁打盹，偶尔睁开眼。' },
  gull: { title: '水岸飞鸟', detail: '晴天掠过水面，夜里和风雨中歇息。' },
  pier: { title: '渡轮码头', detail: '渡轮靠岸、停留，再慢慢驶离。' },
} satisfies Record<string, LifeDetail>;
const caches = new WeakMap<
  World,
  {
    scene: World['sceneKey'];
    props: { x: number; y: number; shape: Sprite; color: Color; detail: LifeDetail }[];
  }
>();
const positive = (n: number, span: number) => ((n % span) + span) % span;

function put(
  W: World,
  x: number,
  y: number,
  glyph: number,
  col: Color,
  level: number,
  id: number,
  solid = false,
) {
  if (x < 0 || y < 0 || x >= W.cols || y >= W.rows) return;
  const i = y * W.cols + x;
  W.glyph[i] = glyph;
  W.fr[i] = col[0] * level;
  W.fgc[i] = col[1] * level;
  W.fb[i] = col[2] * level;
  W.ent[i] = id;
  if (solid) W.solid[i] = 2;
}
function stamp(
  W: World,
  shape: Sprite,
  x: number,
  y: number,
  color: Color,
  level: number,
  id: number,
  solid = false,
  building = false,
) {
  if (building)
    for (let dy = 3; dy < shape.height - 1; dy++)
      for (let dx = 2; dx < shape.width - 2; dx++) {
        const px = x + dx,
          py = y + dy;
        if (px < 0 || px >= W.cols || py < 0 || py >= W.rows) continue;
        const i = py * W.cols + px;
        W.br[i] = color[0] * level * 0.3;
        W.bgc[i] = color[1] * level * 0.27;
        W.bb[i] = color[2] * level * 0.25;
        W.glyph[i] = 0;
        W.ent[i] = id;
        W.solid[i] = 2;
      }
  for (const c of shape.cells) put(W, x + c.x, y + c.y, c.g, color, level, id, solid);
}
function entity(W: World, detail: LifeDetail) {
  return reg(W, { kind: 'life', ref: detail });
}

/** Constant-sized sprites, no new timers or simulation state. Replays use the world clock. */
export function drawWaterfrontLife(W: World): void {
  if (W.cols < 80 || W.rows - W.promY < 5) return;
  const scene = LIFE_SCENES[W.sceneKey],
    t = W.t,
    night = W.env.night,
    brightness = 0.55 + W.env.amb * 0.45,
    x = Math.round(W.cols * scene.pier),
    y = W.promY - 3,
    pier = entity(W, DETAILS.pier);
  // A short jetty leaves the main water surface open.
  for (let dx = -4; dx <= 4; dx++) {
    put(W, x + dx, y, gi('─'), STEEL, brightness, pier, true);
    if (dx % 4 === 0)
      for (let dy = 1; dy <= 2; dy++)
        put(W, x + dx, y + dy, gi('│'), STEEL, brightness * 0.65, pier, true);
  }
  put(W, x + 4, y - 1, gi('•'), AMBER, brightness + night * 0.25, pier);
  const ferry = entity(W, {
      title: scene.ferryName,
      detail: '靠岸时居民排队登船，已完成任务的 Agent 居民也会搭船离开。',
    }),
    pose = ferryPose(W),
    art = vesselArt(W.sceneKey === 'hk' ? 'hk' : W.sceneKey === 'nyc' ? 'ferry' : 'cruise', false);
  drawVessel(W, art, pose.x - art.width / 2, y, ferry, AMBER, true, !pose.docked);
  if (W.env.day > 0.2 && W.weather.rain < 0.25 && W.weather.snow < 0.25) {
    const id = entity(W, DETAILS.gull);
    for (let i = 0; i < 3; i++) {
      const gx = Math.floor(positive(t * 1.6 + (W.seed % W.cols) + i * 6, W.cols + 16)) - 8,
        gy = W.wy + 1 + (i % 2);
      put(W, gx, gy, gi(Math.floor(t * 2 + i) % 3 ? '~' : 'v'), STEEL, 0.75, id);
    }
  }
}

export function drawStreetLife(W: World): void {
  const depth = W.rows - W.promY;
  if (W.cols < 80 || depth < 5) return;
  const scene = LIFE_SCENES[W.sceneKey],
    t = W.t,
    amb = 0.6 + W.env.amb * 0.4,
    wet = Math.max(W.weather.rain, W.weather.snow) > 0.25,
    foot = lifeLayout(W).foot;
  const layout = lifeLayout(W),
    pier = entity(W, DETAILS.pier);
  for (let y = layout.ferryY + 1; y <= layout.laneY; y++) {
    for (let dx = -2; dx <= 2; dx++) {
      put(
        W,
        layout.pierX + dx,
        y,
        gi(Math.abs(dx) === 2 ? '│' : '─'),
        Math.abs(dx) === 2 ? STEEL : AMBER,
        amb * 0.55,
        pier,
        true,
      );
      const i = y * W.cols + layout.pierX + dx;
      if (i >= 0 && i < W.N) {
        W.br[i] = 0.09 * amb;
        W.bgc[i] = 0.08 * amb;
        W.bb[i] = 0.065 * amb;
      }
    }
  }
  drawResidents(W, amb, wet, true);
  drawPlanting(W);
  drawQuayside(W);
  let cached = caches.get(W);
  if (!cached || cached.scene !== W.sceneKey) {
    const kiosk = sprite([
      '   ┌───────────┐   ',
      `   │   ${scene.shop.padEnd(4)}    │   `,
      ' ┌─┴───────────┴─┐ ',
      ' │ / / / / / / / │ ',
      ' ├─────┬─────────┤ ',
      ' │  o  │  ▪ ▪ ▪  │ ',
      ' ├─┬───┴─────┬───┤ ',
      ' └─┴─────────┴───┘ ',
    ]);
    cached = {
      scene: W.sceneKey,
      props: scene.props
        .filter((p) => W.cols >= 160 || p.kind === 'kiosk' || p.kind === 'bench')
        .map((p) => {
          const shape =
            p.kind === 'kiosk'
              ? kiosk
              : p.kind === 'bench'
                ? BENCH
                : p.kind === 'bikes'
                  ? BIKES
                  : PLANTER;
          return {
            shape,
            x: Math.round(W.cols * p.x - shape.width / 2),
            y: foot - shape.height + 1,
            color:
              p.kind === 'kiosk'
                ? scene.shopColor
                : p.kind === 'planter'
                  ? GREEN
                  : p.kind === 'bench'
                    ? AMBER
                    : STEEL,
            detail:
              p.kind === 'kiosk'
                ? { title: scene.shopName, detail: '小店亮着暖灯，门口有人停下歇脚。' }
                : DETAILS[p.kind],
          };
        }),
    };
    caches.set(W, cached);
  }
  for (const prop of cached.props) {
    const id = entity(W, prop.detail);
    stamp(W, prop.shape, prop.x, prop.y, prop.color, amb, id, true, prop.shape.height >= 6);
  }
  const shop = cached.props.find((p) => p.detail.title === scene.shopName)!;
  const shopId = W.ent[(shop.y + 5) * W.cols + shop.x + 4];
  for (let dx = 2; dx < shop.shape.width - 2; dx++) {
    const col = Math.floor(dx / 2) % 2 ? scene.shopColor : CREAM;
    put(W, shop.x + dx, shop.y + 3, gi('▄'), col, amb, shopId, true);
    const i = (shop.y + 3) * W.cols + shop.x + dx;
    if (i >= 0 && i < W.N) {
      W.br[i] = col[0] * amb * 0.3;
      W.bgc[i] = col[1] * amb * 0.3;
      W.bb[i] = col[2] * amb * 0.3;
    }
  }
  if (W.env.night > 0.1) addLight(W, shop.x + 6, shop.y + 3, 5, AMBER, W.env.night * 0.2);
  if (depth > 7 && W.cols >= 160) {
    stamp(
      W,
      CAT[Math.floor(t / 4) % 5 === 0 ? 0 : 1],
      shop.x - CAT[0].width - 2,
      foot - 2,
      AMBER,
      amb * 0.8,
      entity(W, DETAILS.cat),
    );
  }
  if (!wet) {
    const ax = Math.round(W.cols * 0.1),
      ay = W.promY,
      id = entity(W, DETAILS.angler),
      lifted = positive(t + 8, 29) < 3;
    put(W, ax, ay - 1, gi('o'), AMBER, amb, id);
    put(W, ax, ay, gi('λ'), AMBER, amb, id);
    for (let n = 1; n <= 3; n++)
      put(W, ax + n, ay - 1 - Math.min(n, lifted ? 3 : 1), gi('/'), STEEL, amb, id);
    put(W, ax + 4, ay - 3, gi(lifted ? '|' : '·'), STEEL, 0.6, id);
  }
  const work = entity(W, {
    title: '滨水工作坊',
    detail: '忙碌的 Agent 居民带着任务回到这里。屏幕亮度跟随系统负载。',
  });
  stamp(W, WORK, layout.workX - 9, foot - WORK.height + 1, STEEL, amb, work, true, true);
  put(
    W,
    layout.workX - 3,
    foot - 2,
    gi(W.sig.cpu > 0.7 ? '#' : W.sig.cpu > 0.3 ? '=' : '·'),
    [0.48, 0.85, 0.8],
    0.7,
    work,
  );
  const shelter = entity(W, {
      title: '候船廊',
      detail: '在廊下等船，沿栈桥登船。靠岸时指示灯变绿。',
    }),
    amenities = entity(W, { title: '滨水设施', detail: '导览牌、分类垃圾箱和系船柱沿步道布置。' }),
    pose = ferryPose(W);
  stamp(W, SHELTER, layout.pierX - 20, foot - SHELTER.height + 1, STEEL, amb * 0.85, shelter, true);
  put(
    W,
    layout.pierX - 4,
    foot - SHELTER.height + 2,
    gi('▪'),
    pose.docked ? GREEN : AMBER,
    amb,
    shelter,
  );
  stamp(W, BIN, layout.benchX + 10, foot - 2, STEEL, amb * 0.7, amenities, true);
  stamp(W, SIGN, layout.pierX + 7, foot - 4, STEEL, amb * 0.8, amenities, true);
  for (const dx of [-4, 4]) {
    put(W, layout.pierX + dx, W.promY + 2, gi('▄'), AMBER, amb * 0.65, amenities, true);
    put(W, layout.pierX + dx, W.promY + 3, gi('│'), STEEL, amb, amenities, true);
  }
  drawResidents(W, amb, wet, false);
  if (!wet && depth > 6) {
    const x = Math.floor(positive(t * 3.2 + (W.seed % W.cols), W.cols + 12)) - 6;
    stamp(W, CYCLE[Math.floor(t * 3) % 2], x, W.rows - 4, STEEL, amb, entity(W, DETAILS.cyclist));
  }
}

function drawResidents(W: World, amb: number, wet: boolean, behind: boolean) {
  const foot = lifeLayout(W).foot;
  for (const r of W.residents) {
    if (r.activity === 'gone') continue;
    if (r.y < foot - 2 !== behind) continue;
    const a = r.agent >= 0 ? W.agents[r.agent] : undefined,
      color =
        r.signal === 'awaiting'
          ? AMBER
          : r.signal === 'error'
            ? [1, 0.42, 0.35]
            : (a?.col ?? COATS[r.id % 3]),
      id = reg(W, { kind: 'resident', ref: r }),
      x = Math.round(r.x),
      y = Math.round(r.y),
      leg =
        r.activity === 'walk' || r.activity === 'board'
          ? Math.floor(W.t * 3 + r.id) % 2
            ? 'λ'
            : 'Λ'
          : '│';
    if (r.activity === 'sit') {
      put(W, x, y - 2, gi('o'), color, amb, id);
      put(W, x, y - 1, gi('└'), color, amb, id);
      put(W, x + 1, y, gi('┐'), color, amb, id);
    } else {
      put(W, x, y - 2, gi('o'), color, amb, id);
      put(
        W,
        x,
        y - 1,
        gi(r.activity === 'work' && Math.floor(W.t * (2 + W.sig.cpu * 4)) % 2 ? '>' : '|'),
        color,
        amb,
        id,
      );
      put(W, x, y, gi(leg), color, amb, id);
    }
    if (r.cup > 0 || r.activity === 'buy') {
      put(W, x + 1, y - 1, gi('u'), AMBER, amb, id);
      if (Math.floor(W.t * 1.5 + r.id) % 3 === 0)
        put(W, x + 1, y - 2, gi('~'), AMBER, amb * 0.55, id);
    }
    if (r.signal === 'awaiting')
      put(W, x, y - 3, gi('?'), AMBER, 0.8 + Math.sin(W.t * 1.5) * 0.15, id);
    else if (r.signal === 'error') put(W, x, y - 3, gi('!'), color, amb, id);
    else if (r.activity === 'work') put(W, x + 1, y - 1, gi('#'), STEEL, amb * 0.7, id);
    if (wet && ['walk', 'queue', 'wait', 'watch'].includes(r.activity)) {
      for (let dx = -2; dx <= 2; dx++)
        put(W, x + dx, y - 3, gi(dx === -2 ? '/' : dx === 2 ? '\\' : '─'), color, amb, id);
    }
  }
}
