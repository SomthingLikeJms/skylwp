import type { Settings, World } from '../world/types';
import { createWorld } from '../world/world';
import { stepWorld } from '../world/step';
import { assignSite } from '../systems/actions';
import { syncProgress } from '../systems/agents';
import { retargetResidents } from '../systems/residents';
import { applyEvent } from './apply';
import { parseEvent, type CityEvent } from './protocol';
import { DEFAULT_THRESHOLDS } from '../systems/climate-config';
import { STATE_KEYS, type Checkpoint } from './checkpoint';
export type { Checkpoint } from './checkpoint';

export const RULE_VERSION = 'city-v9';
export const TICK_RATE = 30;
export const TICK_MS = 1000 / TICK_RATE;
export const DEFAULT_SETTINGS: Settings = {
  scene: 'bund',
  hour: 20.5,
  flow: 'real',
  cpu: 0.35,
  mem: 0.55,
  net: 0.4,
  music: true,
  bpm: 112,
  agentAct: 0.65,
  tabs: 5,
  away: false,
  theme: 'harbor',
  density: 9,
  cursor: null,
  privacy: false,
  intensity: 1,
  effects: 0.85,
  waterMode: 'ascii',
  waterSource: 'combined',
  waterStrength: 0.25,
  weatherMode: 'load',
  weatherThresholds: { ...DEFAULT_THRESHOLDS },
};
export interface EngineConfig {
  seed: number;
  epoch: number;
  cols: number;
  rows: number;
  settings: Settings;
  initial?: Checkpoint;
  audio?: 'recorded' | 'live-only';
}
export interface HistoryPolicy {
  windowMs: number;
  maxEvents: number;
  checkpointMs: number;
  audioFrames: boolean;
  maxBytes?: number;
}
export const NATIVE_HISTORY: HistoryPolicy = {
  windowMs: 15 * 60_000,
  maxEvents: 10_000,
  checkpointMs: 30_000,
  audioFrames: false,
  maxBytes: 6 * 1024 * 1024,
};

/** The engine has no DOM, wall clock or animation-frame dependency. */
export class CityEngine {
  world: World;
  settings: Settings;
  readonly config: EngineConfig;
  readonly events: CityEvent[];
  private cursor = 0;
  private checkpoints: Checkpoint[] = [];
  private audioQueue: CityEvent[] = [];
  private sizes = new WeakMap<CityEvent, number>();
  private retainedBytes = 0;

  constructor(
    config: EngineConfig,
    events: readonly CityEvent[] = [],
    private history?: HistoryPolicy,
  ) {
    this.config = structuredClone(config);
    this.settings = structuredClone(config.settings);
    this.world = createWorld(config.cols, config.rows, config.seed, config.settings.scene);
    this.world.hourNow = this.settings.hour;
    this.world.sig = { cpu: this.settings.cpu, mem: this.settings.mem, net: this.settings.net };
    this.world.weather.cpuAverage = this.settings.cpu;
    this.world.weather.memAverage = this.settings.mem;
    const parsed = events.map(parseEvent).sort((a, b) => (a.at ?? a.ts) - (b.at ?? b.ts));
    this.events =
      history && !history.audioFrames ? parsed.filter((e) => e.type !== 'audio.frame') : parsed;
    if (history) {
      if (this.events.length > history.maxEvents) throw new Error('初始事件超过录制窗口容量');
      for (const event of this.events) this.retainedBytes += this.eventSize(event);
    }
    if (config.initial) this.restore(config.initial);
    if (history && !history.audioFrames)
      this.audioQueue = parsed.filter((e) => e.type === 'audio.frame').slice(-90);
    if (history && !history.audioFrames) this.config.audio = 'live-only';
    this.cursor = 0;
    this.consumeUntil(config.epoch + this.elapsedMs);
  }

  get elapsedMs(): number {
    return this.world.tick * TICK_MS;
  }
  get historyStartMs(): number {
    return (this.config.initial?.tick ?? 0) * TICK_MS;
  }
  get pendingAudioFrames(): number {
    return this.audioQueue.length;
  }

  append(input: unknown): CityEvent {
    const event = parseEvent(input);
    // Persist the actual application time, so late delivery replays identically.
    if ((event.at ?? event.ts) < this.config.epoch + this.elapsedMs)
      event.at = this.config.epoch + this.elapsedMs;
    if (event.type === 'audio.frame' && this.history && !this.history.audioFrames) {
      // Pending samples are bounded and consumed, never copied into history.
      this.audioQueue.push(event);
      if (
        this.audioQueue.length > 1 &&
        (event.at ?? event.ts) < (this.audioQueue.at(-2)!.at ?? this.audioQueue.at(-2)!.ts)
      )
        this.audioQueue.sort((a, b) => (a.at ?? a.ts) - (b.at ?? b.ts));
      if (this.audioQueue.length > 90) this.audioQueue.shift();
      this.consumeAudio(this.config.epoch + this.elapsedMs);
      return event;
    }
    const bytes = this.history ? this.eventSize(event) : 0;
    if (
      this.history &&
      (this.events.length >= this.history.maxEvents ||
        this.retainedBytes + bytes > (this.history.maxBytes ?? Infinity))
    ) {
      this.trimHistory(true);
      if (
        this.events.length >= this.history.maxEvents ||
        this.retainedBytes + bytes > (this.history.maxBytes ?? Infinity)
      )
        throw new Error('待处理事件超过录制窗口容量');
    }
    this.events.push(event);
    this.retainedBytes += bytes;
    if (
      this.events.length > 1 &&
      (event.at ?? event.ts) <
        (this.events[this.events.length - 2].at ?? this.events[this.events.length - 2].ts)
    )
      this.events.sort((a, b) => (a.at ?? a.ts) - (b.at ?? b.ts));
    const updatePoint = this.checkpoints.at(-1)?.tick === this.world.tick;
    this.consumeUntil(this.config.epoch + this.elapsedMs);
    if (updatePoint) this.saveCheckpoint();
    return event;
  }

  advanceTo(milliseconds: number, maxTicks = Infinity): boolean {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) throw new Error('时间游标无效');
    const target = Math.floor((milliseconds + 0.000001) / TICK_MS);
    let steps = 0;
    while (this.world.tick < target && steps < maxTicks) {
      if (this.settings.flow !== 'stop')
        this.settings.hour =
          (this.settings.hour + (TICK_MS / 3600000) * (this.settings.flow === 'fast' ? 300 : 1)) %
          24;
      stepWorld(this.world, this.settings, 1 / TICK_RATE);
      this.consumeUntil(this.config.epoch + this.world.tick * TICK_MS);
      const interval = Math.max(1, Math.round((this.history?.checkpointMs ?? 300_000) / TICK_MS));
      if (this.world.tick % interval === 0) {
        this.saveCheckpoint();
        this.trimHistory();
      }
      steps++;
    }
    return this.world.tick >= target;
  }

  seek(milliseconds: number): void {
    this.beginSeek(milliseconds);
    this.advanceTo(milliseconds);
  }

  beginSeek(milliseconds: number): void {
    milliseconds = Math.max(this.historyStartMs, milliseconds);
    const tick = Math.floor((milliseconds + 0.000001) / TICK_MS);
    let nearest: Checkpoint | undefined;
    for (const point of this.checkpoints)
      if (point.tick <= tick && (!nearest || point.tick > nearest.tick)) nearest = point;
    if (nearest) this.restore(nearest);
    else {
      if (this.config.initial) {
        this.restore(this.config.initial);
        this.cursor = 0;
        return;
      }
      this.settings = structuredClone(this.config.settings);
      this.world = createWorld(
        this.config.cols,
        this.config.rows,
        this.config.seed,
        this.settings.scene,
      );
      this.world.hourNow = this.settings.hour;
      this.world.sig = { cpu: this.settings.cpu, mem: this.settings.mem, net: this.settings.net };
      this.cursor = 0;
      this.consumeUntil(this.config.epoch);
    }
  }

  snapshot(): Checkpoint {
    const state = Object.fromEntries(
      STATE_KEYS.map((key) => [key, this.world[key]]),
    ) as Checkpoint['state'];
    return structuredClone({
      tick: this.world.tick,
      cursor: this.cursor,
      settings: this.settings,
      randomState: this.world.rng.state,
      state,
    });
  }

  restore(point: Checkpoint): void {
    const copy = structuredClone(point);
    this.settings = copy.settings;
    this.world = createWorld(
      this.config.cols,
      this.config.rows,
      this.config.seed,
      copy.settings.scene,
    );
    Object.assign(this.world, copy.state);
    this.world.rng.state = copy.randomState;
    this.cursor = copy.cursor;
    this.audioQueue = [];
    this.world.sites = this.world.towers.filter((tower) => tower.site);
    this.world.drawOrder = this.world.towers.slice().sort((a, b) => a.layer - b.layer);
  }

  private saveCheckpoint(): void {
    const index = this.checkpoints.findIndex((point) => point.tick === this.world.tick);
    if (index >= 0) this.checkpoints[index] = this.snapshot();
    else this.checkpoints.push(this.snapshot());
    // 24 hours of five-minute points is bounded to 288 snapshots.
    const limit = this.history
      ? Math.ceil(this.history.windowMs / this.history.checkpointMs) + 2
      : 288;
    if (this.checkpoints.length > limit) this.checkpoints.shift();
  }

  private trimHistory(force = false): void {
    if (!this.history) return;
    const cutoff = this.elapsedMs - this.history.windowMs;
    if (!force && this.historyStartMs >= cutoff) return;
    const minimumDrop = force ? Math.max(1, Math.floor(this.history.maxEvents / 10)) : 0;
    const point =
      this.checkpoints.find((p) => p.tick * TICK_MS >= cutoff && p.cursor >= minimumDrop) ??
      (force && this.cursor ? this.snapshot() : undefined);
    if (
      !point ||
      point.tick * TICK_MS < this.historyStartMs ||
      (!force && point.tick * TICK_MS === this.historyStartMs)
    )
      return;
    const dropped = point.cursor;
    for (let i = 0; i < dropped; i++) this.retainedBytes -= this.eventSize(this.events[i]);
    this.events.splice(0, dropped);
    this.cursor -= dropped;
    this.config.initial = structuredClone({ ...point, cursor: 0 });
    this.checkpoints = this.checkpoints
      .filter((p) => p.tick >= point.tick)
      .map((p) => ({ ...p, cursor: p.cursor - dropped }));
  }
  private eventSize(event: CityEvent): number {
    let bytes = this.sizes.get(event);
    if (bytes === undefined) {
      bytes = new TextEncoder().encode(JSON.stringify(event)).length;
      this.sizes.set(event, bytes);
    }
    return bytes;
  }

  reconfigure(cols: number, rows: number): CityEngine {
    const config = structuredClone({ ...this.config, cols, rows });
    if (config.initial && (cols !== this.config.cols || rows !== this.config.rows)) {
      const p = config.initial,
        next = createWorld(cols, rows, config.seed, p.settings.scene);
      for (const key of STATE_KEYS)
        if (key !== 'towers') Object.assign(next, { [key]: structuredClone(p.state[key]) });
      next.rng.state = p.randomState;
      const sx = cols / this.config.cols,
        sy = rows / this.config.rows;
      for (const r of next.residents) {
        r.x *= sx;
        r.y *= sy;
      }
      retargetResidents(next);
      for (const w of next.walkers) {
        w.x *= sx;
        w.tx *= sx;
      }
      for (const s of next.ships) {
        s.x *= sx;
        s.tx *= sx;
        s.minX *= sx;
        s.maxX *= sx;
        s.y *= sy;
      }
      for (const v of [...next.planes, ...next.particles]) {
        v.x *= sx;
        v.y *= sy;
        v.vx *= sx;
        if ('vy' in v) v.vy *= sy;
      }
      for (const a of next.agents) {
        a.site = -1;
        if (a.state !== 'ended') {
          assignSite(next, a);
          syncProgress(next, a);
        }
      }
      const state = Object.fromEntries(
        STATE_KEYS.map((key) => [key, next[key]]),
      ) as Checkpoint['state'];
      config.initial = { ...p, state, randomState: next.rng.state };
    }
    return new CityEngine(config, this.events, this.history);
  }

  private consumeAudio(timestamp: number): void {
    let count = 0;
    for (const event of this.audioQueue) {
      if ((event.at ?? event.ts) > timestamp + 0.0001) break;
      applyEvent(this.world, this.settings, event);
      count++;
    }
    if (count) this.audioQueue.splice(0, count);
  }

  private consumeUntil(timestamp: number): void {
    while (this.cursor < this.events.length) {
      const event = this.events[this.cursor];
      if ((event.at ?? event.ts) > timestamp + 0.0001) break;
      this.cursor++;
      if (event.type === 'world.scene' && event.data.scene !== this.settings.scene)
        this.changeScene(event.data.scene);
      applyEvent(this.world, this.settings, event);
      this.world.hourNow = this.settings.hour;
    }
    this.consumeAudio(timestamp);
  }

  private changeScene(scene: Settings['scene']): void {
    const old = this.world;
    const next = createWorld(old.cols, old.rows, old.seed, scene);
    // Keep semantic state and seeded stream, rebuild only scene geometry.
    for (const key of STATE_KEYS) if (key !== 'towers') Object.assign(next, { [key]: old[key] });
    next.rng.state = old.rng.state;
    next.walkers = old.walkers;
    retargetResidents(next);
    next.ships = [];
    for (const agent of next.agents) agent.site = -1;
    const active = next.agents.filter((a) => a.state !== 'ended');
    const recent = next.agents.filter((a) => a.state === 'ended').slice(-(5 - active.length));
    for (const agent of [...active, ...(active.length < 5 ? recent : [])]) {
      assignSite(next, agent);
      syncProgress(next, agent);
    }
    this.world = next;
  }
}
