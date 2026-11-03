import type { Random } from './rng';
import type {
  WaterMode,
  WaterSource,
  WeatherMode,
  WeatherThresholds,
} from '../systems/climate-config';

export type Color = readonly number[];
export type SceneKey = 'bund' | 'nyc' | 'hk';
export type Theme = 'harbor' | 'phosphor' | 'ink';
export type Roof = 'flat' | 'crown' | 'spire' | 'setback' | 'slant' | 'water' | 'pyramid';
export type BoatKind = 'cruise' | 'ferry' | 'hk' | 'junk';
export interface SceneConfig {
  name: string;
  water: string;
  shore: string;
  far: string;
  glow: Color;
  density: number;
  wins: Color[];
  roofs: Roof[];
  mpal: Color[];
  boat: BoatKind;
  music: 'pearl' | 'crown' | 'laser';
  marks: { k: string; x: number; h: number }[];
  sites: number[];
  bridge?: boolean;
  ridge?: boolean;
}
export interface Landmark {
  name: string;
  desc: string;
  win: string;
  tone: Color;
  wave?: boolean;
  wc?: Color;
}
export interface Stamp {
  w: number;
  h: number;
  mask: Uint8Array;
  cls: Uint16Array;
  ov: { dx: number; dy: number; k: number; g: number; key: string }[];
}
export interface Tower {
  idx: number;
  seed: number;
  litK: number;
  wc: Color;
  tone: Color;
  shim: number;
  owner: number;
  err: number;
  flash: number;
  target: number;
  site: boolean;
  layer: number;
  x: number;
  w: number;
  h: number;
  st: Stamp;
  win: string;
  kind: string;
  key: string;
  wave: boolean;
  roof: Roof;
  spectrum: number;
}
export interface Agent {
  id: number;
  session: string;
  src: string;
  name: string;
  col: Color;
  site: number;
  state: 'working' | 'awaiting' | 'idle' | 'ended';
  done: number;
  total: number;
  current: string;
  tool: 'read' | 'edit' | 'run' | 'test' | 'subtask' | null;
  toolUntil: number;
  calls: number;
  baseHeight: number;
  toolProgress: number;
  lastActive: number;
  phase: 'thinking' | 'responding' | 'working';
}
export interface Walker {
  agent: number;
  x: number;
  tx: number;
  state: 'walk' | 'stand';
  timer: number;
  speed: number;
  run: number;
  dir: number;
}
export interface Ship {
  tabId: string;
  x: number;
  tx: number;
  minX: number;
  maxX: number;
  y: number;
  far: boolean;
  kind: BoatKind;
  cat: number;
  ph: number;
  arriving: boolean;
  leaving: boolean;
}
export interface Particle {
  kind: 'rocket' | 'fw' | 'rain' | 'snow' | 'spark' | 'splash' | 'meteor';
  x: number;
  y: number;
  vx: number;
  vy: number;
  g: number;
  life: number;
  max: number;
  col?: Color;
}
export interface Plane {
  x: number;
  y: number;
  vx: number;
  ph: number;
}
export interface Star {
  x: number;
  y: number;
  b: number;
  ph: number;
  rate: number;
}
export type StaticEntity =
  | 'sky'
  | 'cloud'
  | 'ridge'
  | 'water'
  | 'shore'
  | 'prom'
  | 'rail'
  | 'lamp'
  | 'bridge'
  | 'laser'
  | 'plane'
  | 'wheel'
  | 'fog'
  | 'moon'
  | 'sun';
export type Entity =
  | { kind: StaticEntity }
  | { kind: 'tower'; ref: Tower }
  | { kind: 'ship'; ref: Ship }
  | { kind: 'walker'; ref: Walker };
export interface Settings {
  scene: SceneKey;
  hour: number;
  flow: 'stop' | 'real' | 'fast';
  cpu: number;
  mem: number;
  net: number;
  music: boolean;
  bpm: number;
  agentAct: number;
  tabs: number;
  away: boolean;
  theme: Theme;
  density: 7 | 9 | 12;
  cursor: { x: number; y: number } | null;
  privacy: boolean;
  intensity: number;
  effects: number;
  waterMode: WaterMode;
  waterSource: WaterSource;
  waterStrength: number;
  weatherMode: WeatherMode;
  weatherThresholds: WeatherThresholds;
}
export interface Environment {
  day: number;
  night: number;
  dusk: number;
  heat: number;
  rain: number;
  net: number;
  amb: number;
  top: Color;
  hor: Color;
}
export interface Grid {
  glyph: Uint16Array;
  fr: Float32Array;
  fgc: Float32Array;
  fb: Float32Array;
  br: Float32Array;
  bgc: Float32Array;
  bb: Float32Array;
  lr: Float32Array;
  lgc: Float32Array;
  lb: Float32Array;
  emR: Float32Array;
  emG: Float32Array;
  emB: Float32Array;
  solid: Uint8Array;
  ent: Int16Array;
  bm: Uint8Array;
  bcr: Float32Array;
  bcg: Float32Array;
  bcb: Float32Array;
  cloudN: Float32Array;
  fogN: Float32Array;
  A: Uint8Array;
  B: Uint8Array;
  Ac: Uint8ClampedArray;
  Bc: Uint8ClampedArray;
  skyR: Float32Array;
  skyG: Float32Array;
  skyB: Float32Array;
}
export interface World extends Grid {
  cols: number;
  rows: number;
  N: number;
  seed: number;
  sceneKey: SceneKey;
  sc: SceneConfig;
  rng: Random;
  tick: number;
  t: number;
  previousCloudOff: number;
  beatPh: number;
  beatEnv: number;
  musicLvl: number;
  away: number;
  cloudOff: number;
  act: number;
  wind: number;
  shipCool: number;
  frame: number;
  hourNow: number;
  wy: number;
  baseY: number;
  promY: number;
  Hmax: number;
  lampGap: number;
  lampOff: number;
  ridge: Float32Array[] | null;
  wheel: { x: number; R: number } | null;
  bridge: { deckY: number; tx: number; x1: number; tw: number; th: number } | null;
  entities: Entity[];
  particles: Particle[];
  agents: Agent[];
  walkers: Walker[];
  ships: Ship[];
  planes: Plane[];
  stars: Star[];
  towers: Tower[];
  sites: Tower[];
  drawOrder: Tower[];
  laserSrc: number[][];
  log: { h: number; txt: string }[];
  logVer: number;
  sig: { cpu: number; mem: number; net: number };
  env: Environment;
  browserTabs: { id: string; cat: number }[];
  audio: {
    bass: number;
    mid: number;
    high: number;
    onset: boolean;
    energy8s: number;
    lastFrame: number;
    lastAudible: number;
    spectrum: Float32Array;
    levels: Float32Array;
  };
  track: {
    title: string;
    artist: string;
    palette: Color[];
    previousPalette: Color[];
    changedAt: number;
  };
  weather: {
    state: WeatherState;
    usesReal: boolean;
    changedAt: number;
    rain: number;
    snow: number;
    lightning: number;
    nextLightning: number;
    previousRain: boolean;
    rainbowUntil: number;
    cpuAverage: number;
    memAverage: number;
    highMemorySec: number;
    highCpuSec: number;
    real: RealWeather | null;
    realAt: number;
    cpuHistory: Float32Array;
    memHistory: Float32Array;
    historyHead: number;
    historyCount: number;
    cpuSum: number;
    memSum: number;
  };
}
export interface RealWeather {
  code: number;
  tempC: number;
  precip: number;
  windKph?: number;
  windDeg?: number;
  cloud?: number;
  humidity?: number;
  city?: string;
  observedAt?: number;
  localHour?: number;
}
export type WeatherState = 'clear' | 'cloudy' | 'low' | 'rain' | 'storm' | 'haze' | 'snow';
