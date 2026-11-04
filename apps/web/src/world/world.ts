import type { World, Tower, SceneKey } from './types';
import { createGrid } from '../engine/grid';
import { Random, mulberry32 } from './rng';
import { pick, odd } from './math';
import { fbm1 } from './noise';
import { SCENES, LM } from '../scenes';
import { bGen, BUILD } from '../scenes/stamp';
import { createResidents } from '../systems/residents';
import { promenadeY } from '../scenes/waterfront';
export const TONES = [
  [0.35, 0.45, 0.56],
  [0.5, 0.48, 0.42],
  [0.3, 0.33, 0.38],
  [0.42, 0.5, 0.55],
  [0.55, 0.52, 0.48],
];

export function mkTower(
  W: World,
  R: () => number,
  o: Pick<Tower, 'layer' | 'x' | 'w' | 'h' | 'st' | 'win' | 'kind'> & Partial<Tower>,
): Tower {
  return Object.assign(
    {
      idx: -1,
      key: '',
      wave: false,
      roof: 'flat' as const,
      spectrum: -1,
      seed: Math.floor(R() * 1e6),
      litK: 0.6 + R() * 0.5,
      wc: pick(R, W.sc.wins),
      tone: pick(R, TONES),
      shim: o.layer === 0 ? 1 : o.layer === 1 ? 0.6 : 0.45,
      owner: -1,
      err: 0,
      flash: 0,
      target: o.h,
      site: false,
    },
    o,
  );
}
export function buildCity(W: World, R: () => number) {
  const sc = W.sc,
    cols = W.cols,
    Hm = W.Hmax;
  W.towers = [];
  W.laserSrc = [];
  W.wheel = null;
  const marks: {
    x0: number;
    x1: number;
    H: number;
    st: import('./types').Stamp;
    m: { k: string; x: number; h: number };
  }[] = [];
  for (const m of sc.marks) {
    if (m.k === 'wheel') {
      W.wheel = { x: Math.round(m.x * cols), R: Math.max(2, Math.round(Hm * 0.12)) };
      continue;
    }
    const H = Math.max(7, Math.round(Hm * m.h));
    const st = BUILD[m.k](H);
    const x = Math.round(m.x * cols - st.w / 2);
    marks.push({ x0: x, x1: x + st.w - 1, H, st, m });
  }
  const center = (sc.marks.reduce((a, m) => a + m.x, 0) / sc.marks.length) * cols;
  const bell = (x: number) => Math.exp(-Math.pow((x - center) / (cols * 0.3), 2));
  const lim = (x: number) => {
    let l = 1e9;
    for (const mk of marks) if (x >= mk.x0 - 2 && x <= mk.x1 + 2) l = Math.min(l, mk.H * 0.45);
    return l;
  };
  let x = -3;
  while (x < cols + 3) {
    const w = 3 + Math.floor(R() * 6);
    const h = Math.max(
      2,
      Math.round(Hm * (0.06 + 0.32 * bell(x + w / 2) * Math.pow(R(), 0.8) + 0.05 * R())),
    );
    W.towers.push(
      mkTower(W, R, { layer: 0, x, w, h, st: bGen(w, h, 'flat', R), win: 'dense', kind: 'far' }),
    );
    x += w - 1 + Math.floor(R() * 2);
  }
  const siteXs = sc.sites.map((f) => Math.round(f * cols));
  x = -2;
  while (x < cols + 2) {
    const w = 4 + Math.floor(R() * 6);
    const mid = x + w / 2;
    if (siteXs.some((s) => Math.abs(s - mid) < 4.5)) {
      x += 3;
      continue;
    }
    if (R() < 0.22 * (1.2 - sc.density)) {
      x += 2 + Math.floor(R() * 3);
      continue;
    }
    let h = Math.round(
      Hm * (0.1 + 0.46 * bell(mid) * Math.pow(R(), 0.9) * sc.density + 0.08 * R()),
    );
    h = Math.max(3, Math.min(h, Math.floor(lim(mid)), Math.round(Hm * 0.62)));
    const roof = pick(R, sc.roofs);
    W.towers.push(
      mkTower(W, R, {
        layer: 1,
        x,
        w,
        h,
        st: bGen(w, h, roof, R),
        win: pick(R, ['grid', 'strip', 'band', 'mesh', 'grid']),
        kind: 'gen',
        roof,
      }),
    );
    x += w + (R() < 0.35 ? 1 : 0);
  }
  siteXs.forEach((sx, k) => {
    const w = 5 + (k & 1),
      h = Math.max(3, Math.round(Hm * (0.1 + 0.06 * R())));
    W.towers.push(
      mkTower(W, R, {
        layer: 1,
        x: sx - (w >> 1),
        w,
        h,
        st: bGen(w, h, 'flat', R),
        win: 'grid',
        kind: 'site',
        site: true,
      }),
    );
  });
  for (const mk of marks) {
    const L = LM[mk.m.k];
    const T = mkTower(W, R, {
      layer: 2,
      x: mk.x0,
      w: mk.st.w,
      h: mk.H,
      st: mk.st,
      win: L.win,
      kind: 'mark',
      key: mk.m.k,
      wave: !!L.wave,
    });
    T.tone = L.tone;
    if (L.wc) T.wc = L.wc;
    W.towers.push(T);
    W.laserSrc.push([mk.x0 + (mk.st.w >> 1), W.baseY - mk.st.h]);
  }
  if (sc.music === 'laser') {
    const gens = W.towers
      .filter((T) => T.kind === 'gen')
      .sort((a, b) => b.h - a.h)
      .slice(0, 2);
    for (const T of gens) W.laserSrc.push([T.x + (T.w >> 1), W.baseY - T.st.h]);
  }
  W.towers.forEach((T, i) => (T.idx = i));
  W.sites = W.towers.filter((T) => T.site);
  W.drawOrder = W.towers.slice().sort((a, b) => a.layer - b.layer);
  const spectrumTowers = W.towers
    .filter((t) => t.kind === 'gen' && t.x > W.cols * 0.22 && t.x < W.cols * 0.8)
    .sort((a, b) => a.x - b.x)
    .slice(0, 7);
  for (let i = 0; i < spectrumTowers.length; i++)
    spectrumTowers[i].spectrum = Math.min(6, Math.floor((i * 7) / spectrumTowers.length));
}

export function createWorld(cols: number, rows: number, seed: number, sceneKey: SceneKey): World {
  const N = cols * rows;
  const W: World = {
    ...createGrid(cols, rows),
    cols,
    rows,
    N,
    seed,
    sceneKey,
    sc: SCENES[sceneKey],
    rng: new Random(seed ^ 0x1234abcd),
    tick: 0,
    t: 0,
    previousCloudOff: 0,
    beatPh: 0,
    beatEnv: 0,
    musicLvl: 0,
    away: 0,
    cloudOff: 0,
    act: 0,
    wind: 1,
    shipCool: 0,
    frame: 0,
    wy: 0,
    baseY: 0,
    promY: 0,
    Hmax: 0,
    lampGap: 0,
    lampOff: 0,
    ridge: null,
    bridge: null,
    wheel: null,
    entities: [],
    particles: [],
    agents: [],
    walkers: [],
    residents: [],
    ships: [],
    planes: [],
    stars: [],
    towers: [],
    sites: [],
    drawOrder: [],
    laserSrc: [],
    log: [],
    logVer: 0,
    sig: { cpu: 0.35, mem: 0.55, net: 0.4 },
    env: {
      day: 0,
      night: 1,
      dusk: 0,
      heat: 0,
      rain: 0,
      net: 0.4,
      amb: 0.34,
      top: [0, 0, 0],
      hor: [0, 0, 0],
    },
    hourNow: 20.5,
    browserTabs: [],
    audio: {
      bass: 0,
      mid: 0,
      high: 0,
      onset: false,
      energy8s: 0,
      lastFrame: -100,
      lastAudible: -100,
      spectrum: new Float32Array(7),
      levels: new Float32Array(7),
    },
    track: { title: '', artist: '', palette: [], previousPalette: [], changedAt: -100 },
    weather: {
      realAt: 0,
      state: 'clear',
      usesReal: false,
      changedAt: 0,
      rain: 0,
      snow: 0,
      lightning: 0,
      nextLightning: 8,
      previousRain: false,
      rainbowUntil: 0,
      cpuAverage: 0.35,
      memAverage: 0.55,
      highMemorySec: 0,
      highCpuSec: 0,
      real: null,
      cpuHistory: new Float32Array(5400),
      memHistory: new Float32Array(5400),
      historyHead: 0,
      historyCount: 0,
      cpuSum: 0,
      memSum: 0,
    },
  };
  W.wy = Math.max(9, Math.round(rows * 0.62));
  W.baseY = W.wy - 2;
  W.promY = promenadeY(rows);
  W.Hmax = Math.max(7, Math.min(W.baseY - 3, Math.round(rows * 0.46)));
  const R = mulberry32(seed * 3 + 5);
  const ns = Math.floor(cols * W.wy * 0.02);
  for (let i = 0; i < ns; i++)
    W.stars.push({
      x: Math.floor(R() * cols),
      y: Math.floor(R() * Math.max(2, W.baseY - W.Hmax * 0.4)),
      b: Math.pow(R(), 2),
      ph: R() * 6.28,
      rate: 0.5 + R() * 2,
    });
  if (W.sc.ridge) {
    W.ridge = [new Float32Array(cols), new Float32Array(cols)];
    for (let x = 0; x < cols; x++) {
      const xf = x / cols;
      W.ridge[0][x] =
        W.baseY -
        W.Hmax * (0.3 + 0.55 * fbm1(x * 0.02, seed + 11)) * (0.7 + 0.4 * Math.sin(xf * Math.PI));
      W.ridge[1][x] = W.baseY - W.Hmax * (0.12 + 0.3 * fbm1(x * 0.035, seed + 23));
    }
  }
  buildCity(W, R);
  if (W.sc.bridge) {
    const deckY = W.wy + Math.max(2, Math.round((W.promY - W.wy) * 0.3));
    W.bridge = {
      deckY,
      tx: Math.round(cols * 0.15),
      x1: Math.round(cols * 0.33),
      tw: Math.max(7, odd(Math.round(rows * 0.15))),
      th: Math.max(6, Math.round(W.Hmax * 0.42)),
    };
  }
  W.lampGap = Math.max(14, Math.round(cols * 0.12));
  W.lampOff = Math.round(W.lampGap * 0.45);
  W.residents = createResidents(W);
  return W;
}
