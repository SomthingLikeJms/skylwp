import type { Settings, World } from '../world/types';
import { createWorld } from '../world/world';
import { parseEvent } from './protocol';
import { BOAT_NAMES } from '../scenes/vessels';
import { CATS } from '../scenes';

export const STATE_KEYS = [
  'tick',
  't',
  'previousCloudOff',
  'beatPh',
  'beatEnv',
  'musicLvl',
  'away',
  'cloudOff',
  'act',
  'wind',
  'shipCool',
  'frame',
  'hourNow',
  'particles',
  'agents',
  'walkers',
  'residents',
  'ships',
  'planes',
  'log',
  'logVer',
  'sig',
  'audio',
  'track',
  'weather',
  'browserTabs',
  'towers',
] as const;
export interface Checkpoint {
  tick: number;
  cursor: number;
  settings: Settings;
  randomState: number;
  state: Pick<World, (typeof STATE_KEYS)[number]>;
}
const constructors = { Uint8Array, Uint16Array, Int16Array, Float32Array, Float64Array };
export function checkpointReplacer(_key: string, value: unknown): unknown {
  if (ArrayBuffer.isView(value) && !(value instanceof DataView))
    return {
      $typed: value.constructor.name,
      values: Array.from(value as unknown as ArrayLike<number>),
    };
  return value;
}
const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v);
const finite = (v: unknown): v is number =>
  typeof v === 'number' && Number.isFinite(v) && Math.abs(v) < 1e12;
function numbers(v: unknown, keys: string[]): boolean {
  return object(v) && keys.every((k) => finite(v[k]));
}
function strings(v: unknown, keys: string[]): boolean {
  return object(v) && keys.every((k) => typeof v[k] === 'string');
}
function list(v: unknown, max: number): v is unknown[] {
  return Array.isArray(v) && v.length <= max;
}

/** Decode data only. No constructors or property names are accepted from the file. */
export function parseCheckpoint(
  input: unknown,
  settings: Settings,
  geometry: { cols: number; rows: number; seed: number },
  legacyResidents = false,
): Checkpoint {
  let nodes = 0;
  function decode(v: unknown, depth = 0): unknown {
    if (++nodes > 600_000 || depth > 20) throw new Error('检查点过大');
    if (typeof v === 'number') {
      if (!finite(v)) throw new Error('检查点数字无效');
      return v;
    }
    if (typeof v === 'string') {
      if (v.length > 1024) throw new Error('检查点文字过长');
      return v;
    }
    if (v === null || typeof v === 'boolean') return v;
    if (Array.isArray(v)) {
      if (v.length > 80000) throw new Error('检查点数组过大');
      return v.map((x) => decode(x, depth + 1));
    }
    if (!object(v)) throw new Error('检查点数据无效');
    if (Object.keys(v).some((k) => ['__proto__', 'constructor', 'prototype'].includes(k)))
      throw new Error('检查点字段无效');
    if ('$typed' in v) {
      if (
        Object.keys(v).length !== 2 ||
        typeof v.$typed !== 'string' ||
        !Object.hasOwn(constructors, v.$typed) ||
        !Array.isArray(v.values) ||
        v.values.length > 80000 ||
        !v.values.every(finite)
      )
        throw new Error('检查点字格无效');
      const key = v.$typed as keyof typeof constructors;
      nodes += v.values.length;
      if (nodes > 600_000) throw new Error('检查点过大');
      if (
        (key === 'Uint8Array' || key === 'Uint16Array' || key === 'Int16Array') &&
        v.values.some(
          (n) =>
            !Number.isInteger(n) ||
            n < (key === 'Int16Array' ? -32768 : 0) ||
            n > (key === 'Uint8Array' ? 255 : key === 'Int16Array' ? 32767 : 65535),
        )
      )
        throw new Error('检查点字格越界');
      return new constructors[key](v.values);
    }
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, decode(x, depth + 1)]));
  }
  const v = decode(input);
  if (
    !object(v) ||
    !Number.isInteger(v.tick) ||
    !finite(v.tick) ||
    v.tick < 0 ||
    v.tick > 30 * 86400 * 365 ||
    v.cursor !== 0 ||
    !Number.isInteger(v.randomState) ||
    !finite(v.randomState) ||
    v.randomState < 0 ||
    v.randomState > 0xffffffff ||
    !object(v.state)
  )
    throw new Error('检查点时钟无效');
  const s = v.state;
  if (legacyResidents && !('residents' in s)) s.residents = [];
  if (Object.keys(s).length !== STATE_KEYS.length || STATE_KEYS.some((k) => !(k in s)))
    throw new Error('检查点状态不完整');
  const scalar = STATE_KEYS.filter(
    (k) =>
      ![
        'particles',
        'agents',
        'walkers',
        'residents',
        'ships',
        'planes',
        'log',
        'sig',
        'audio',
        'track',
        'weather',
        'browserTabs',
        'towers',
      ].includes(k),
  );
  if (!numbers(s, scalar) || s.tick !== v.tick || s.t !== v.tick / 30)
    throw new Error('检查点时钟不一致');
  if (
    !numbers(s.sig, ['cpu', 'mem', 'net']) ||
    !numbers(s.audio, ['bass', 'mid', 'high', 'energy8s', 'lastFrame', 'lastAudible']) ||
    !object(s.audio) ||
    typeof s.audio.onset !== 'boolean' ||
    !(s.audio.spectrum instanceof Float32Array) ||
    s.audio.spectrum.length !== 7 ||
    !(s.audio.levels instanceof Float32Array) ||
    s.audio.levels.length !== 7
  )
    throw new Error('检查点信号无效');
  if (
    !strings(s.track, ['title', 'artist']) ||
    !numbers(s.track, ['changedAt']) ||
    !object(s.track) ||
    !list(s.track.palette, 16) ||
    !list(s.track.previousPalette, 16) ||
    [...s.track.palette, ...s.track.previousPalette].some(
      (c) => !Array.isArray(c) || c.length !== 3 || !c.every(finite),
    )
  )
    throw new Error('检查点媒体无效');
  if (
    !object(s.weather) ||
    !numbers(s.weather, [
      'changedAt',
      'rain',
      'snow',
      'lightning',
      'nextLightning',
      'rainbowUntil',
      'cpuAverage',
      'memAverage',
      'highMemorySec',
      'highCpuSec',
      'realAt',
      'historyHead',
      'historyCount',
      'cpuSum',
      'memSum',
    ]) ||
    !['clear', 'cloudy', 'low', 'rain', 'storm', 'haze', 'snow'].includes(
      String(s.weather.state),
    ) ||
    typeof s.weather.usesReal !== 'boolean' ||
    typeof s.weather.previousRain !== 'boolean' ||
    !(s.weather.cpuHistory instanceof Float32Array) ||
    s.weather.cpuHistory.length !== 5400 ||
    !(s.weather.memHistory instanceof Float32Array) ||
    s.weather.memHistory.length !== 5400 ||
    !Number.isInteger(s.weather.historyHead) ||
    (s.weather.historyHead as number) < 0 ||
    (s.weather.historyHead as number) >= 5400
  )
    throw new Error('检查点气候无效');
  if (
    s.weather.real !== null &&
    (!object(s.weather.real) || !numbers(s.weather.real, ['code', 'tempC', 'precip']))
  )
    throw new Error('检查点实况无效');
  if (
    !Number.isInteger(s.weather.historyCount) ||
    (s.weather.historyCount as number) < 0 ||
    (s.weather.historyCount as number) > 5400
  )
    throw new Error('检查点气候计数无效');
  if (
    !list(s.agents, 10000) ||
    s.agents.some(
      (a) =>
        !numbers(a, [
          'id',
          'site',
          'done',
          'total',
          'toolUntil',
          'calls',
          'baseHeight',
          'toolProgress',
          'lastActive',
        ]) ||
        !strings(a, ['session', 'src', 'name', 'current', 'state', 'phase']) ||
        !object(a) ||
        !['working', 'awaiting', 'idle', 'ended'].includes(String(a.state)) ||
        (a.inactive !== undefined && typeof a.inactive !== 'boolean') ||
        !Array.isArray(a.col) ||
        a.col.length !== 3 ||
        !a.col.every(finite),
    )
  )
    throw new Error('检查点会话无效');
  if (
    !list(s.walkers, 64) ||
    s.walkers.some(
      (w) =>
        !numbers(w, ['agent', 'x', 'tx', 'timer', 'speed', 'run', 'dir']) ||
        !object(w) ||
        !['walk', 'stand'].includes(String(w.state)),
    )
  )
    throw new Error('检查点居民无效');
  if (
    !list(s.residents, 14) ||
    s.residents.some(
      (r) =>
        !numbers(r, ['id', 'agent', 'x', 'y', 'timer', 'cup', 'cycle', 'slot', 'trip']) ||
        !object(r) ||
        !['shop', 'bench', 'pier', 'work', 'view'].includes(String(r.goal)) ||
        !['walk', 'queue', 'buy', 'sit', 'wait', 'board', 'ride', 'work', 'watch', 'gone'].includes(
          String(r.activity),
        ) ||
        !['ambient', 'working', 'thinking', 'awaiting', 'idle', 'done', 'error'].includes(
          String(r.signal),
        ) ||
        !Number.isInteger(r.id) ||
        !Number.isInteger(r.agent) ||
        (r.id as number) < 0 ||
        (r.id as number) > 10004 ||
        (r.agent as number) < -1 ||
        (r.agent as number) >= (s.agents as unknown[]).length ||
        (r.agent === -1
          ? (r.id as number) > 3 || r.signal !== 'ambient'
          : r.id !== (r.agent as number) + 4 || r.signal === 'ambient') ||
        Math.abs(r.x as number) > geometry.cols + 32 ||
        Math.abs(r.y as number) > geometry.rows + 10 ||
        (r.timer as number) < 0 ||
        (r.timer as number) > 120 ||
        (r.cup as number) < 0 ||
        (r.cup as number) > 60 ||
        !Number.isInteger(r.cycle) ||
        (r.cycle as number) < 0 ||
        !Number.isInteger(r.trip) ||
        (r.trip as number) < -1 ||
        !Number.isInteger(r.slot) ||
        (r.slot as number) < -1 ||
        (r.slot as number) > 5,
    ) ||
    new Set((s.residents as World['residents']).map((r) => r.id)).size !== s.residents.length
  )
    throw new Error('检查点生活状态无效');
  if (
    !list(s.ships, 64) ||
    s.ships.some(
      (w) =>
        !numbers(w, ['x', 'tx', 'minX', 'maxX', 'y', 'cat', 'ph']) ||
        !strings(w, ['tabId', 'kind']) ||
        !object(w) ||
        typeof w.far !== 'boolean' ||
        typeof w.arriving !== 'boolean' ||
        typeof w.leaving !== 'boolean' ||
        (w.source !== undefined &&
          !['browser', 'agent', 'memory', 'network', 'media'].includes(String(w.source))) ||
        (w.agent !== undefined &&
          (!Number.isInteger(w.agent) ||
            (w.agent as number) < 0 ||
            (w.agent as number) >= (s.agents as unknown[]).length)),
    )
  )
    throw new Error('检查点船只无效');
  if (!list(s.planes, 16) || s.planes.some((p) => !numbers(p, ['x', 'y', 'vx', 'ph'])))
    throw new Error('检查点航班无效');
  if (
    !list(s.particles, 5000) ||
    s.particles.some(
      (p) =>
        !numbers(p, ['x', 'y', 'vx', 'vy', 'g', 'life', 'max']) ||
        !object(p) ||
        !['rocket', 'fw', 'rain', 'snow', 'spark', 'splash', 'meteor'].includes(String(p.kind)),
    )
  )
    throw new Error('检查点粒子无效');
  if (
    !list(s.log, 5) ||
    s.log.some((l) => !numbers(l, ['h']) || !strings(l, ['txt'])) ||
    !list(s.browserTabs, 500) ||
    s.browserTabs.some((t) => !numbers(t, ['cat']) || !strings(t, ['id']))
  )
    throw new Error('检查点记录无效');
  if (
    !list(s.towers, 1000) ||
    s.towers.some((t) => {
      if (
        !numbers(t, [
          'idx',
          'seed',
          'litK',
          'shim',
          'owner',
          'err',
          'flash',
          'target',
          'layer',
          'x',
          'w',
          'h',
          'spectrum',
        ]) ||
        !strings(t, ['win', 'kind', 'key', 'roof']) ||
        !object(t) ||
        typeof t.site !== 'boolean' ||
        typeof t.wave !== 'boolean' ||
        !object(t.st)
      )
        return true;
      const st = t.st;
      return (
        !numbers(st, ['w', 'h']) ||
        !Number.isInteger(st.w) ||
        !Number.isInteger(st.h) ||
        (st.w as number) < 1 ||
        (st.h as number) < 1 ||
        (st.w as number) * (st.h as number) > 80000 ||
        !(st.mask instanceof Uint8Array) ||
        !(st.cls instanceof Uint16Array) ||
        st.mask.length !== (st.w as number) * (st.h as number) ||
        st.cls.length !== st.mask.length ||
        !list(st.ov, 80000) ||
        st.ov.some((o) => !numbers(o, ['dx', 'dy', 'k', 'g']) || !strings(o, ['key'])) ||
        !Array.isArray(t.wc) ||
        !Array.isArray(t.tone) ||
        t.wc.length !== 3 ||
        t.tone.length !== 3 ||
        !t.wc.every(finite) ||
        !t.tone.every(finite)
      );
    })
  )
    throw new Error('检查点楼宇无效');
  const agents = s.agents as World['agents'],
    towers = s.towers as World['towers'];
  const unit = (n: number) => Number.isFinite(n) && n >= 0 && n <= 1;
  const state = s as unknown as Checkpoint['state'];
  if (
    ![
      state.sig.cpu,
      state.sig.mem,
      state.sig.net,
      state.away,
      state.act,
      state.musicLvl,
      state.audio.bass,
      state.audio.mid,
      state.audio.high,
      state.audio.energy8s,
      state.weather.rain,
      state.weather.snow,
      state.weather.lightning,
      ...state.audio.spectrum,
      ...state.audio.levels,
    ].every(unit)
  )
    throw new Error('检查点信号越界');
  if (state.weather.real !== null)
    parseEvent({ v: 1, ts: 0, src: 'weather', type: 'weather.real', data: state.weather.real });
  const canonical = createWorld(geometry.cols, geometry.rows, geometry.seed, settings.scene);
  const immutable = [
    'idx',
    'seed',
    'x',
    'w',
    'kind',
    'win',
    'layer',
    'site',
    'roof',
    'spectrum',
    'wave',
  ] as const;
  if (
    towers.length !== canonical.towers.length ||
    towers.some((tower, i) => {
      const reference = canonical.towers[i];
      return (
        immutable.some((key) => tower[key] !== reference[key]) ||
        tower.st.w !== tower.w ||
        tower.h < 1 ||
        tower.h > geometry.rows * 2 ||
        tower.target < 0 ||
        tower.target > geometry.rows * 2 ||
        tower.st.h > geometry.rows * 2
      );
    }) ||
    agents.filter((a) => a.state !== 'ended').length > 5
  )
    throw new Error('检查点楼宇尺寸或会话容量越界');
  const index = (n: number, length: number, empty = false) =>
    Number.isInteger(n) && n >= (empty ? -1 : 0) && n < length;
  if (
    agents.some(
      (agent, i) =>
        agent.id !== i ||
        !index(agent.site, towers.length, true) ||
        !['thinking', 'responding', 'working'].includes(agent.phase) ||
        ![null, 'read', 'edit', 'run', 'test', 'subtask'].includes(agent.tool),
    ) ||
    towers.some(
      (tower, i) =>
        tower.idx !== i ||
        !index(tower.owner, agents.length, true) ||
        !Number.isInteger(tower.spectrum) ||
        tower.spectrum < -1 ||
        tower.spectrum > 6,
    )
  )
    throw new Error('检查点关联无效');
  if (
    (s.walkers as World['walkers']).some((w) => !index(w.agent, agents.length)) ||
    (s.ships as World['ships']).some(
      (ship) => !index(ship.cat, CATS.length) || !Object.hasOwn(BOAT_NAMES, ship.kind),
    ) ||
    (s.browserTabs as World['browserTabs']).some((tab) => !index(tab.cat, CATS.length))
  )
    throw new Error('检查点居民或船只关联无效');
  if (
    (s.particles as World['particles']).some(
      (p) =>
        p.col !== undefined &&
        (!Array.isArray(p.col) || p.col.length !== 3 || !p.col.every(finite)),
    )
  )
    throw new Error('检查点粒子颜色无效');
  return {
    tick: v.tick,
    cursor: 0,
    randomState: v.randomState as number,
    settings: structuredClone(settings),
    state: s as unknown as Checkpoint['state'],
  };
}

export function privateCheckpoint(point: Checkpoint, includeText: boolean): Checkpoint {
  const copy = structuredClone(point);
  copy.cursor = 0;
  copy.settings.privacy = !includeText;
  copy.settings.cursor = null;
  if (!includeText) {
    for (const a of copy.state.agents) {
      a.name = a.src === 'codex' ? 'Codex' : a.src === 'claude-code' ? 'Claude Code' : '本地 Agent';
      a.current = a.total ? `步骤 ${a.done}/${a.total}` : '';
    }
    copy.state.track.title = '正在播放';
    copy.state.track.artist = '';
    copy.state.log = [];
  }
  return copy;
}
