import type { World, Agent, Resident, ResidentGoal, ResidentSignal } from '../world/types';
import { mulberry32 } from '../world/rng';
import { LIFE_SCENES } from '../scenes/life';

export const MAX_RESIDENTS = 14;
type LifeGeometry = Pick<World, 'cols' | 'rows' | 'sceneKey' | 'promY'>;
const layouts = new WeakMap<LifeGeometry, ReturnType<typeof makeLayout>>();
function makeLayout(W: LifeGeometry) {
  const scene = LIFE_SCENES[W.sceneKey],
    depth = W.rows - W.promY,
    foot = Math.min(W.rows - 2, W.promY + Math.max(5, Math.floor(depth * 0.68)));
  return {
    foot,
    laneY: W.promY + 3,
    shopX: Math.round(scene.props.find((p) => p.kind === 'kiosk')!.x * W.cols),
    benchX: Math.round(scene.props.find((p) => p.kind === 'bench')!.x * W.cols),
    workX: Math.round(scene.work * W.cols),
    pierX: Math.round(scene.pier * W.cols),
    ferryY: W.promY - 5,
    queueY: foot - 2,
  };
}
export function lifeLayout(W: LifeGeometry) {
  let value = layouts.get(W);
  if (!value) {
    value = makeLayout(W);
    layouts.set(W, value);
  }
  return value;
}
export function ferryPose(W: World) {
  const clock = W.t + (W.seed % 29),
    phase = clock % 95,
    pier = lifeLayout(W).pierX;
  return {
    phase,
    trip: Math.floor(clock / 95),
    x:
      phase < 38
        ? -20 + ((pier + 20) * phase) / 38
        : phase < 58
          ? pier
          : pier + ((W.cols + 20 - pier) * (phase - 58)) / 37,
    docked: phase >= 38 && phase < 58,
    boarding: phase >= 39 && phase < 51,
  };
}
export function residentSignal(W: World, a: Agent): ResidentSignal {
  if (a.state === 'ended') return a.inactive ? 'idle' : 'done';
  if (a.state === 'awaiting') return 'awaiting';
  if (a.site >= 0 && W.towers[a.site]?.err > 0) return 'error';
  if (a.total > 0 && a.done === a.total && W.t > a.toolUntil) return 'done';
  if (W.t - a.lastActive > 45 || a.state === 'idle') return 'idle';
  return a.phase === 'thinking' ? 'thinking' : 'working';
}
const signalGoal: Record<Exclude<ResidentSignal, 'ambient'>, ResidentGoal> = {
  working: 'work',
  thinking: 'shop',
  awaiting: 'bench',
  idle: 'shop',
  done: 'pier',
  error: 'work',
};
function go(r: Resident, goal: ResidentGoal) {
  r.goal = goal;
  r.activity = 'walk';
  r.slot = -1;
  r.timer = 0;
}
export function createResidents(W: World): Resident[] {
  const l = lifeLayout(W),
    random = mulberry32(W.seed ^ 0x173ac3),
    result: Resident[] = [];
  for (let id = 0; id < 4; id++) {
    result.push({
      id,
      agent: -1,
      x: id === 0 ? l.shopX + 12 : id === 1 ? l.benchX - 2 : id === 2 ? l.pierX - 4 : W.cols * 0.6,
      y: id < 2 ? l.foot - 1 : l.laneY,
      goal: id === 0 ? 'shop' : id === 1 ? 'bench' : id === 2 ? 'pier' : 'view',
      activity: id === 0 ? 'buy' : id === 1 ? 'sit' : id === 2 ? 'wait' : 'watch',
      signal: 'ambient',
      timer: id === 0 ? 4 : 12 + random() * 12,
      cup: id === 1 ? 18 : 0,
      cycle: id,
      slot: id === 1 ? 0 : -1,
      trip: -1,
    });
  }
  return result;
}
function syncResidents(W: World) {
  const selected = W.agents.filter((a) => a.state !== 'ended').slice(-5);
  const ended = W.agents.filter((a) => a.state === 'ended').slice(-5);
  const keep = new Set([...selected, ...ended].map((a) => a.id));
  W.residents = W.residents.filter((r) => r.agent < 0 || keep.has(r.agent));
  for (const a of [...selected, ...ended]) {
    if (W.residents.some((r) => r.agent === a.id)) continue;
    const signal = residentSignal(W, a),
      l = lifeLayout(W);
    W.residents.push({
      id: a.id + 4,
      agent: a.id,
      x: l.workX,
      y: l.laneY,
      signal,
      goal: signalGoal[signal as Exclude<ResidentSignal, 'ambient'>],
      activity: 'walk',
      timer: 0,
      cup: 0,
      cycle: 0,
      slot: -1,
      trip: -1,
    });
  }
  W.residents.sort((a, b) => a.id - b.id);
}
function toward(value: number, target: number, distance: number) {
  return value + Math.sign(target - value) * Math.min(Math.abs(target - value), distance);
}
function nextLeisure(W: World, r: Resident) {
  r.cycle++;
  const order: ResidentGoal[] = ['shop', 'bench', 'pier', 'view'];
  go(r, order[r.cycle % order.length]);
}

/** Rebuild destinations after geometry changes; do not leave a seated person at an old bench. */
export function retargetResidents(W: LifeGeometry & Pick<World, 'residents'>): void {
  const l = lifeLayout(W);
  for (const r of W.residents) {
    if (r.activity === 'gone') continue;
    if (r.activity === 'ride' || r.activity === 'board') {
      r.x = l.pierX - 4;
      r.y = l.laneY;
    }
    r.x = Math.max(2, Math.min(W.cols - 3, r.x));
    r.y = Math.max(l.laneY, Math.min(l.foot - 1, r.y));
    go(r, r.goal);
  }
}

/** Small persistent state machine. Drawing never changes decisions or service occupancy. */
export function stepResidents(W: World, dt: number): void {
  if (!W.residents.length) W.residents = createResidents(W);
  if (W.tick % 30 === 1) syncResidents(W);
  const l = lifeLayout(W),
    boat = ferryPose(W),
    wet = Math.max(W.weather.rain, W.weather.snow) > 0.3;
  for (const r of W.residents) {
    r.timer = Math.max(0, r.timer - dt);
    r.cup = Math.max(0, r.cup - dt);
    const a = r.agent >= 0 ? W.agents[r.agent] : undefined;
    if (a) {
      const signal = residentSignal(W, a);
      if (signal !== r.signal) {
        r.signal = signal;
        // A passenger finishes the crossing before returning to a resumed task.
        if (r.activity !== 'ride' && r.activity !== 'board') {
          if (r.activity === 'gone') {
            r.x = -2;
            r.y = l.laneY;
          }
          go(r, signalGoal[signal as Exclude<ResidentSignal, 'ambient'>]);
        }
      }
    }
    if (r.activity === 'gone') continue;
    if (r.activity === 'ride') {
      r.x = boat.x - 6 + r.slot * 2;
      r.y = l.ferryY;
      if (boat.trip !== r.trip) {
        if (r.agent >= 0 && r.signal === 'done') r.activity = 'gone';
        else {
          r.x = -2;
          r.y = l.laneY;
          go(r, a ? signalGoal[r.signal as Exclude<ResidentSignal, 'ambient'>] : 'shop');
        }
      }
      continue;
    }
    if (r.activity === 'board') {
      const seatX = l.pierX - 6 + r.slot * 2;
      r.x = toward(r.x, seatX, dt * 4);
      r.y = toward(r.y, l.ferryY, dt * 3.5);
      if (r.y === l.ferryY && r.x === seatX) {
        r.activity = 'ride';
        r.trip = boat.trip;
      }
      continue;
    }
    if (r.activity === 'buy') {
      if (r.timer === 0) {
        r.cup = 36;
        go(r, 'bench');
      }
      continue;
    }
    if (r.activity === 'sit') {
      if (a && r.signal === 'awaiting') continue;
      if (wet && r.timer > 3) r.timer = 3;
      if (r.timer === 0) nextLeisure(W, r);
      continue;
    }
    if (r.activity === 'work') {
      // CPU and tool activity change the pace of the task animation, not reported progress.
      if (r.agent < 0 && r.timer === 0) nextLeisure(W, r);
      continue;
    }
    if (r.activity === 'watch') {
      if (r.timer === 0) nextLeisure(W, r);
      continue;
    }
    let tx: number,
      ty = l.foot - 1;
    if (r.goal === 'shop') {
      const ahead = W.residents.filter(
        (o) =>
          o !== r &&
          o.goal === 'shop' &&
          (o.activity === 'buy' ||
            ((o.activity === 'queue' || Math.abs(o.x - (l.shopX + 12)) < 10) && o.id < r.id)),
      ).length;
      tx = l.shopX + 12 + ahead * 3;
    } else if (r.goal === 'bench') {
      if (r.slot < 0) {
        const occupied = W.residents
          .filter((o) => o !== r && o.goal === 'bench' && o.slot >= 0)
          .map((o) => o.slot);
        r.slot = [0, 1].find((slot) => !occupied.includes(slot)) ?? -1;
      }
      tx = l.benchX + (r.slot < 0 ? 7 + (r.id % 3) * 3 : r.slot * 4 - 2);
    } else if (r.goal === 'pier') {
      tx = l.pierX - 4 - (r.id % 4) * 3;
      ty = l.queueY;
    } else if (r.goal === 'work') {
      tx = l.workX + 6 + (r.agent % 3) * 3;
    } else {
      tx = Math.max(
        3,
        Math.min(W.cols - 3, W.cols * (0.1 + ((r.id * 0.19 + r.cycle * 0.23) % 0.8))),
      );
      ty = l.laneY;
    }
    tx = Math.max(2, Math.min(W.cols - 3, tx));
    const speed = dt * (r.signal === 'error' ? 10 : r.signal === 'working' ? 7 : wet ? 4 : 5);
    if (Math.abs(r.x - tx) > 0.1) {
      r.y = toward(r.y, l.laneY, speed * 0.5);
      if (Math.abs(r.y - l.laneY) < 0.1) r.x = toward(r.x, tx, speed);
      r.activity = 'walk';
      continue;
    }
    r.y = toward(r.y, ty, speed * 0.5);
    if (Math.abs(r.y - ty) > 0.1) {
      r.activity = 'walk';
      continue;
    }
    if (r.goal === 'shop') {
      if (W.residents.some((o) => o !== r && o.activity === 'buy')) r.activity = 'queue';
      else {
        r.activity = 'buy';
        r.timer = 4 + (r.id % 3);
      }
    } else if (r.goal === 'bench') {
      if (r.slot < 0) r.activity = 'wait';
      else {
        r.activity = 'sit';
        r.timer = 15 + (r.id % 4) * 3;
      }
    } else if (r.goal === 'pier') {
      const passengers = W.residents.filter((o) => o.activity === 'board' || o.activity === 'ride');
      const crossing = Math.max(Math.abs(r.y - l.ferryY) / 3.5, (Math.abs(r.x - l.pierX) + 6) / 4);
      if (boat.boarding && boat.phase + crossing < 57 && passengers.length < 6) {
        r.activity = 'board';
        r.slot = [0, 1, 2, 3, 4, 5].find((slot) => !passengers.some((p) => p.slot === slot))!;
      } else r.activity = 'wait';
    } else if (r.goal === 'work') {
      r.activity = 'work';
      r.timer = 10;
    } else {
      r.activity = 'watch';
      r.timer = 10 + (r.id % 3) * 4;
    }
  }
}
