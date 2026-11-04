import type { SceneKey, RealWeather } from '../world/types';
import {
  validThresholds,
  type WeatherMode,
  type WeatherThresholds,
  type WaterMode,
  type WaterSource,
} from '../systems/climate-config';

export const SOURCES = [
  'system',
  'audio',
  'media',
  'claude-code',
  'codex',
  'browser',
  'presence',
  'weather',
  'sim',
] as const;
export type Source = (typeof SOURCES)[number];
export type ToolKind = 'read' | 'edit' | 'run' | 'test' | 'subtask';
export interface EventData {
  'sys.sample': { cpu: number; mem: number; net: number };
  'audio.frame': {
    bass: number;
    mid: number;
    high: number;
    onset: boolean;
    energy8s: number;
    spectrum?: number[];
  };
  'audio.beat': { bpm: number; phase: number };
  'media.track': { title: string; artist: string; palette: string[] };
  'media.state': { playing: boolean };
  'agent.session': { state: 'start' | 'end'; name: string; reason?: 'inactive' };
  'agent.todo': { done: number; total: number; current: string };
  'agent.tool': { kind: ToolKind; ok?: boolean };
  'agent.activity': { phase: 'thinking' | 'responding' };
  'agent.await': { on: boolean; reason: 'permission' | 'input' };
  'agent.error': { summary?: string };
  'browser.tabs': { tabs: { id: string; cat: string }[] };
  presence: { idleSec: number; fullscreen: boolean };
  'weather.real': RealWeather;
  'weather.mode': { live: boolean };
  'world.effects': { value: number };
  'water.configure': { mode: WaterMode; source: WaterSource; strength: number };
  'weather.configure': { mode: WeatherMode; thresholds: WeatherThresholds };
  'desktop.click': { x: number; y: number };
  'sim.activity': { value: number };
  'music.intensity': { value: number };
  'clock.set': { hour: number; flow: 'stop' | 'real' | 'fast' };
  'world.scene': { scene: SceneKey };
  'world.firework': { x: number; y: number; color: string };
}
export type EventType = keyof EventData;
export type EventOf<K extends EventType> = {
  v: 1;
  ts: number;
  at?: number;
  src: Source;
  session?: string;
  type: K;
  data: EventData[K];
};
export type CityEvent = { [K in EventType]: EventOf<K> }[EventType];

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === 'object' && !Array.isArray(value);
const finite = (value: unknown, min: number, max: number): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max;
const unit = (value: unknown) => finite(value, 0, 1);
const text = (value: unknown, max = 256): value is string =>
  typeof value === 'string' && value.length <= max && !/[\x00-\x08\x0b\x0c\x0e-\x1f]/.test(value);
const bool = (value: unknown) => typeof value === 'boolean';
const color = (value: unknown): value is string =>
  typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value);
const integer = (value: unknown, max: number) => finite(value, 0, max) && Number.isInteger(value);
const fields: Record<EventType, readonly string[]> = {
  'sys.sample': ['cpu', 'mem', 'net'],
  'audio.frame': ['bass', 'mid', 'high', 'onset', 'energy8s', 'spectrum'],
  'audio.beat': ['bpm', 'phase'],
  'media.track': ['title', 'artist', 'palette'],
  'media.state': ['playing'],
  'agent.session': ['state', 'name', 'reason'],
  'agent.todo': ['done', 'total', 'current'],
  'agent.tool': ['kind', 'ok'],
  'agent.activity': ['phase'],
  'agent.await': ['on', 'reason'],
  'agent.error': ['summary'],
  'browser.tabs': ['tabs'],
  presence: ['idleSec', 'fullscreen'],
  'weather.real': [
    'code',
    'tempC',
    'precip',
    'windKph',
    'windDeg',
    'cloud',
    'humidity',
    'city',
    'observedAt',
    'localHour',
  ],
  'weather.mode': ['live'],
  'world.effects': ['value'],
  'water.configure': ['mode', 'source', 'strength'],
  'weather.configure': ['mode', 'thresholds'],
  'desktop.click': ['x', 'y'],
  'sim.activity': ['value'],
  'music.intensity': ['value'],
  'clock.set': ['hour', 'flow'],
  'world.scene': ['scene'],
  'world.firework': ['x', 'y', 'color'],
};
const validators: { [K in EventType]: (d: Record<string, unknown>) => boolean } = {
  'sys.sample': (d) => unit(d.cpu) && unit(d.mem) && unit(d.net),
  'audio.frame': (d) =>
    unit(d.bass) &&
    unit(d.mid) &&
    unit(d.high) &&
    bool(d.onset) &&
    unit(d.energy8s) &&
    (d.spectrum === undefined ||
      (Array.isArray(d.spectrum) && d.spectrum.length === 7 && d.spectrum.every(unit))),
  'audio.beat': (d) => finite(d.bpm, 20, 300) && unit(d.phase),
  'media.track': (d) =>
    text(d.title) &&
    text(d.artist) &&
    Array.isArray(d.palette) &&
    d.palette.length >= 2 &&
    d.palette.length <= 4 &&
    d.palette.every(color),
  'media.state': (d) => bool(d.playing),
  'agent.session': (d) =>
    ['start', 'end'].includes(String(d.state)) &&
    text(d.name, 64) &&
    (d.reason === undefined || (d.state === 'end' && d.reason === 'inactive')),
  'agent.activity': (d) => ['thinking', 'responding'].includes(String(d.phase)),
  'agent.todo': (d) =>
    integer(d.done, 10000) &&
    integer(d.total, 10000) &&
    (d.done as number) <= (d.total as number) &&
    text(d.current),
  'agent.tool': (d) =>
    ['read', 'edit', 'run', 'test', 'subtask'].includes(String(d.kind)) &&
    (d.ok === undefined || bool(d.ok)),
  'agent.await': (d) => bool(d.on) && ['permission', 'input'].includes(String(d.reason)),
  'agent.error': (d) => d.summary === undefined || text(d.summary),
  'browser.tabs': (d) =>
    Array.isArray(d.tabs) &&
    d.tabs.length <= 500 &&
    d.tabs.every(
      (t) =>
        record(t) &&
        text(t.id, 128) &&
        typeof t.cat === 'string' &&
        ['文档', '视频', '社交', '代码', '搜索', '其他'].includes(t.cat),
    ) &&
    new Set(d.tabs.map((t) => (t as Record<string, unknown>).id)).size === d.tabs.length,
  presence: (d) => finite(d.idleSec, 0, 8640000) && bool(d.fullscreen),
  'weather.real': (d) =>
    integer(d.code, 99) &&
    finite(d.tempC, -100, 70) &&
    finite(d.precip, 0, 2000) &&
    (d.windKph === undefined || finite(d.windKph, 0, 500)) &&
    (d.windDeg === undefined || finite(d.windDeg, 0, 360)) &&
    (d.cloud === undefined || unit(d.cloud)) &&
    (d.humidity === undefined || unit(d.humidity)) &&
    (d.city === undefined || text(d.city, 64)) &&
    (d.observedAt === undefined || finite(d.observedAt, 0, 4102444800000)) &&
    (d.localHour === undefined || finite(d.localHour, 0, 24)),
  'weather.mode': (d) => bool(d.live),
  'world.effects': (d) => unit(d.value),
  'water.configure': (d) =>
    ['binary', 'ascii', 'mirror'].includes(String(d.mode)) &&
    ['combined', 'cpu', 'agent'].includes(String(d.source)) &&
    unit(d.strength),
  'weather.configure': (d) =>
    ['load', 'real'].includes(String(d.mode)) && validThresholds(d.thresholds),
  'desktop.click': (d) => unit(d.x) && unit(d.y),
  'sim.activity': (d) => unit(d.value),
  'music.intensity': (d) => unit(d.value),
  'clock.set': (d) => finite(d.hour, 0, 24) && ['stop', 'real', 'fast'].includes(String(d.flow)),
  'world.scene': (d) => ['bund', 'nyc', 'hk'].includes(String(d.scene)),
  'world.firework': (d) => unit(d.x) && unit(d.y) && color(d.color),
};

export function parseEvent(input: unknown): CityEvent {
  if (
    !record(input) ||
    input.v !== 1 ||
    !finite(input.ts, 0, Number.MAX_SAFE_INTEGER) ||
    !(SOURCES as readonly unknown[]).includes(input.src)
  )
    throw new Error('事件信封无效');
  if (
    typeof input.type !== 'string' ||
    !Object.hasOwn(validators, input.type) ||
    !record(input.data)
  )
    throw new Error('事件类型或数据无效');
  const type = input.type as EventType;
  if (!Object.keys(input.data).every((key) => fields[type].includes(key)))
    throw new Error(`事件包含未声明字段：${type}`);
  if (
    type === 'browser.tabs' &&
    Array.isArray(input.data.tabs) &&
    input.data.tabs.some(
      (tab) => record(tab) && Object.keys(tab).some((key) => key !== 'id' && key !== 'cat'),
    )
  )
    throw new Error('浏览器事件仅接受标签标识和类别');
  if (!validators[type](input.data)) throw new Error(`事件数据无效：${type}`);
  if (
    type.startsWith('agent.') &&
    (!text(input.session, 128) ||
      input.session.length === 0 ||
      !['claude-code', 'codex', 'sim'].includes(String(input.src)))
  )
    throw new Error('Agent 事件需要有效的会话和来源');
  if (input.session !== undefined && !text(input.session, 128)) throw new Error('会话标识无效');
  if (input.at !== undefined && !finite(input.at, 0, Number.MAX_SAFE_INTEGER))
    throw new Error('事件应用时间无效');
  // Round-trip strips prototypes and prevents later mutation of caller-owned data.
  const { v, ts, at, src, session, data } = input;
  return JSON.parse(
    JSON.stringify({
      v,
      ts,
      ...(at !== undefined ? { at } : {}),
      src,
      ...(session !== undefined ? { session } : {}),
      type,
      data,
    }),
  ) as CityEvent;
}

export function hexColor(hex: string): number[] {
  return [
    parseInt(hex.slice(1, 3), 16) / 255,
    parseInt(hex.slice(3, 5), 16) / 255,
    parseInt(hex.slice(5, 7), 16) / 255,
  ];
}

export function makeEvent<K extends EventType>(
  type: K,
  data: EventData[K],
  ts: number,
  src: Source = 'sim',
  session?: string,
): EventOf<K> {
  return parseEvent({ v: 1, ts, src, ...(session ? { session } : {}), type, data }) as EventOf<K>;
}
