import type { Settings, World } from '../world/types';
import { createWorld } from '../world/world';
import { stepWorld } from '../world/step';
import { assignSite } from '../systems/actions';
import { syncProgress } from '../systems/agents';
import { applyEvent } from './apply';
import { parseEvent, type CityEvent } from './protocol';
import { DEFAULT_THRESHOLDS } from '../systems/climate-config';

export const RULE_VERSION = 'city-v4';
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
}
const STATE_KEYS = [
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
type WorldState = Pick<World, (typeof STATE_KEYS)[number]>;
export interface Checkpoint {
  tick: number;
  cursor: number;
  settings: Settings;
  randomState: number;
  state: WorldState;
}

/** The engine has no DOM, wall clock or animation-frame dependency. */
export class CityEngine {
  world: World;
  settings: Settings;
  readonly config: EngineConfig;
  readonly events: CityEvent[];
  private cursor = 0;
  private checkpoints: Checkpoint[] = [];

  constructor(config: EngineConfig, events: readonly CityEvent[] = []) {
    this.config = structuredClone(config);
    this.settings = structuredClone(config.settings);
    this.world = createWorld(config.cols, config.rows, config.seed, config.settings.scene);
    this.world.hourNow = this.settings.hour;
    this.world.sig = { cpu: this.settings.cpu, mem: this.settings.mem, net: this.settings.net };
    this.world.weather.cpuAverage = this.settings.cpu;
    this.world.weather.memAverage = this.settings.mem;
    this.events = events.map(parseEvent).sort((a, b) => (a.at ?? a.ts) - (b.at ?? b.ts));
    this.consumeUntil(config.epoch);
  }

  get elapsedMs(): number {
    return this.world.tick * TICK_MS;
  }

  append(input: unknown): CityEvent {
    const event = parseEvent(input);
    // Persist the actual application time, so late delivery replays identically.
    if (event.ts < this.config.epoch + this.elapsedMs)
      event.at = this.config.epoch + this.elapsedMs;
    this.events.push(event);
    if (
      this.events.length > 1 &&
      (event.at ?? event.ts) <
        (this.events[this.events.length - 2].at ?? this.events[this.events.length - 2].ts)
    )
      this.events.sort((a, b) => (a.at ?? a.ts) - (b.at ?? b.ts));
    if (this.checkpoints.at(-1)?.tick === this.world.tick) this.checkpoints.pop();
    this.consumeUntil(this.config.epoch + this.elapsedMs);
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
      if (this.world.tick % (TICK_RATE * 300) === 0) this.saveCheckpoint();
      steps++;
    }
    return this.world.tick >= target;
  }

  seek(milliseconds: number): void {
    this.beginSeek(milliseconds);
    this.advanceTo(milliseconds);
  }

  beginSeek(milliseconds: number): void {
    const tick = Math.floor((milliseconds + 0.000001) / TICK_MS);
    let nearest: Checkpoint | undefined;
    for (const point of this.checkpoints)
      if (point.tick <= tick && (!nearest || point.tick > nearest.tick)) nearest = point;
    if (nearest) this.restore(nearest);
    else {
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
    const state = Object.fromEntries(STATE_KEYS.map((key) => [key, this.world[key]])) as WorldState;
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
    this.world.sites = this.world.towers.filter((tower) => tower.site);
    this.world.drawOrder = this.world.towers.slice().sort((a, b) => a.layer - b.layer);
  }

  private saveCheckpoint(): void {
    const index = this.checkpoints.findIndex((point) => point.tick === this.world.tick);
    if (index >= 0) this.checkpoints[index] = this.snapshot();
    else this.checkpoints.push(this.snapshot());
    // 24 hours of five-minute points is bounded to 288 snapshots.
    if (this.checkpoints.length > 288) this.checkpoints.shift();
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
  }

  private changeScene(scene: Settings['scene']): void {
    const old = this.world;
    const next = createWorld(old.cols, old.rows, old.seed, scene);
    // Keep semantic state and seeded stream, rebuild only scene geometry.
    for (const key of STATE_KEYS) if (key !== 'towers') Object.assign(next, { [key]: old[key] });
    next.rng.state = old.rng.state;
    next.walkers = old.walkers;
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
