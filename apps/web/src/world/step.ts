import type { World, Settings, Particle } from './types';
import { clamp, smooth } from './math';
import { bGen } from '../scenes/stamp';
import { assignSite, spawnShip, logEvent, burst } from '../systems/actions';
import { stepWeather } from '../systems/weather';
export function stepWorld(W: World, S: Settings, dt: number) {
  W.tick++;
  W.t = W.tick / 30;
  W.frame = W.tick;
  W.previousCloudOff = W.cloudOff;
  W.hourNow = S.hour;
  const t = W.t;
  const k = Math.min(1, dt * 0.9),
    g = W.sig;
  g.cpu += (S.cpu - g.cpu) * k;
  g.mem += (S.mem - g.mem) * k;
  g.net += (S.net - g.net) * k;
  if (S.music) W.beatPh += (dt * S.bpm) / 60;
  const audioFresh = W.t - W.audio.lastFrame < 1;
  W.musicLvl +=
    ((S.music && (!audioFresh || W.t - W.audio.lastAudible < 10) ? 1 : 0) - W.musicLvl) *
    Math.min(1, dt * 0.7);
  for (let i = 0; i < 7; i++) {
    const target = audioFresh ? W.audio.spectrum[i] : 0;
    W.audio.levels[i] +=
      (target - W.audio.levels[i]) * Math.min(1, dt / (target > W.audio.levels[i] ? 0.12 : 0.4));
  }
  W.beatEnv =
    (W.t - W.audio.lastFrame < 1 ? W.audio.bass : Math.exp(-(W.beatPh % 1) * 5)) * W.musicLvl;
  stepWeather(W, dt, S);
  W.away += ((S.away ? 1 : 0) - W.away) * Math.min(1, dt * 0.6);
  const realWind = W.weather.usesReal ? W.weather.real?.windKph : undefined;
  W.cloudOff +=
    dt * (realWind === undefined ? 0.8 + g.net * 5 : 0.6 + Math.min(8, realWind / 8)) * 0.035;
  const realWork = W.agents.some(
    (a) => a.src !== 'sim' && a.state === 'working' && W.t - a.lastActive < 60,
  );
  const act =
    (realWork ? Math.max(0.5, S.agentAct) : S.agentAct) * (1 - W.away * (realWork ? 0.25 : 1));
  W.act = act;
  const wind =
    realWind === undefined
      ? 0.4 + g.net * 2.5
      : Math.min(5, realWind / 12) *
        Math.sin((((W.weather.real?.windDeg ?? 90) + 180) * Math.PI) / 180);
  W.wind = wind;
  const P = W.particles;
  for (const a of W.agents) {
    if (a.site < 0) continue;
    const T = W.towers[a.site];
    if (!T) {
      a.site = -1;
      continue;
    }
    T.h += (T.target - T.h) * Math.min(1, dt / 0.2);
    if (Math.floor(T.h) !== T.st.h && T.h >= 1)
      T.st = bGen(T.w, Math.max(1, Math.floor(T.h)), 'flat', W.rng.next);
    if (a.state === 'working' && act > 0.05 && W.rng.next() < dt * act * 6)
      P.push({
        kind: 'spark',
        x: T.x + W.rng.next() * T.w,
        y: W.baseY - T.h + 0.6,
        vx: (W.rng.next() - 0.5) * 5,
        vy: -2 - W.rng.next() * 3,
        g: 9,
        life: 0.7,
        max: 0.7,
      });
  }
  for (const T of W.towers) {
    if (T.err > 0) T.err = Math.max(0, T.err - dt);
    if (T.flash > 0) T.flash = Math.max(0, T.flash - dt * 0.45);
  }
  const rain = W.weather.rain;
  if (rain > 0) {
    const n = rain * W.cols * 3 * dt;
    let c = Math.floor(n) + (W.rng.next() < n % 1 ? 1 : 0);
    while (c-- > 0) {
      const vy = 24 + W.rng.next() * 10;
      const yEnd = W.wy + W.rng.next() * (W.rows - W.wy);
      P.push({
        kind: 'rain',
        x: W.rng.next() * (W.cols + 24) - 12 - wind * 2,
        y: -1,
        vx: wind * 2.2,
        vy,
        g: 0,
        life: (yEnd + 1) / vy,
        max: 1,
      });
    }
  }
  if (W.weather.snow > 0.01) {
    const n = W.weather.snow * W.cols * 0.18 * dt;
    let count = Math.floor(n) + (W.rng.next() < n % 1 ? 1 : 0);
    while (count-- > 0) {
      const vy = 1.4 + W.rng.next() * 2.6,
        life = (W.rows + 2) / vy;
      P.push({
        kind: 'snow',
        x: W.rng.next() * W.cols,
        y: -1,
        vx: wind * 0.7,
        vy,
        g: 0,
        life,
        max: life,
      });
    }
  }
  // walkers on the promenade
  const fy = W.promY;
  for (const w of W.walkers) {
    w.timer -= dt;
    if (w.run > 0) {
      w.run -= dt;
      w.x += w.dir * dt * 9;
      if (w.x < 1) {
        w.x = 1;
        w.dir = 1;
      }
      if (w.x > W.cols - 2) {
        w.x = W.cols - 2;
        w.dir = -1;
      }
      if (w.run <= 0) {
        w.state = 'walk';
        w.tx = 2 + W.rng.next() * (W.cols - 4);
      }
      continue;
    }
    if (w.state === 'stand') {
      if (w.timer <= 0) {
        w.state = 'walk';
        w.tx = 2 + W.rng.next() * (W.cols - 4);
      }
      continue;
    }
    const a = W.agents[w.agent];
    if (a?.state === 'awaiting') {
      w.tx = Math.max(
        2,
        Math.min(
          W.cols - 3,
          (a.site >= 0 ? W.towers[a.site].x : W.cols / 2) + (w.agent % 2 ? 2 : -2),
        ),
      );
      w.x += (w.tx - w.x) * Math.min(1, dt * 1.2);
      w.state = 'stand';
      continue;
    }
    if (a?.state === 'ended') {
      w.state = 'stand';
      continue;
    }
    const gate = W.musicLvl * S.intensity > 0.5 ? (W.beatEnv > 0.5 ? 1.6 : 0.12) : 1;
    const d = w.tx - w.x;
    if (Math.abs(d) < 0.35) {
      if (W.rng.next() < 0.5) {
        w.state = 'stand';
        w.timer = 4 + W.rng.next() * 8;
      } else w.tx = 2 + W.rng.next() * (W.cols - 4);
    } else {
      w.x += Math.sign(d) * Math.min(Math.abs(d), w.speed * dt * gate);
      w.dir = Math.sign(d);
    }
  }
  // ships
  const want = Math.min(8, W.browserTabs.length);
  let alive = 0;
  W.shipCool -= dt;
  for (const ship of W.ships) {
    const tab = W.browserTabs.find((tab) => tab.id === ship.tabId);
    if (!tab) ship.leaving = true;
    else ship.cat = tab.cat;
    if (!ship.leaving) alive++;
  }
  if (alive < want && W.shipCool <= 0) {
    spawnShip(W, false);
    W.shipCool = 0.8;
  }
  for (const s of W.ships) {
    if (s.leaving) s.x += dt * 5;
    else if (s.arriving) {
      s.x -= dt * 6;
      if (s.x <= s.tx) {
        s.x = s.tx;
        s.arriving = false;
      }
    } else s.x = clamp(s.x + Math.sin(t * 0.12 + s.ph) * dt * 0.3, s.minX, s.maxX);
  }
  W.ships = W.ships.filter((s) => !(s.leaving && s.x > W.cols + 2));
  // planes, more when the network is busy
  if (W.planes.length < 4 && W.rng.next() < dt * (0.015 + g.net * 0.12)) {
    const dir = W.rng.next() < 0.5 ? 1 : -1;
    W.planes.push({
      x: dir > 0 ? -3 : W.cols + 3,
      y: 2 + Math.floor(W.rng.next() * Math.max(2, W.baseY - W.Hmax - 3)),
      vx: dir * (3 + W.rng.next() * 3),
      ph: W.rng.next() * 6,
    });
  }
  for (const p of W.planes) p.x += p.vx * dt;
  W.planes = W.planes.filter((p) => p.x > -6 && p.x < W.cols + 6);
  // particles
  const keep: Particle[] = [];
  for (const p of P) {
    p.life -= dt;
    if (p.kind === 'rocket') {
      p.y += p.vy * dt;
      if (W.rng.next() < dt * 30)
        keep.push({
          kind: 'spark',
          x: p.x,
          y: p.y + 0.4,
          vx: W.rng.next() - 0.5,
          vy: 1,
          g: 4,
          life: 0.4,
          max: 0.4,
        });
      if (p.life <= 0) {
        burst(W, keep, p);
        continue;
      }
      keep.push(p);
      continue;
    }
    if (p.life <= 0) {
      if (p.kind === 'rain' && W.rng.next() < 0.25 && p.y > W.wy)
        keep.push({ kind: 'splash', x: p.x, y: p.y, vx: 0, vy: 0, g: 0, life: 0.18, max: 0.18 });
      continue;
    }
    p.vy += (p.g || 0) * dt;
    if (p.kind === 'fw') {
      p.vx *= 1 - dt * 0.9;
      p.vy *= 1 - dt * 0.6;
    }
    p.x += p.vx * dt;
    if (p.kind === 'snow') p.x += Math.sin(t * 1.4 + p.max) * dt * 1.2;
    p.y += p.vy * dt;
    keep.push(p);
  }
  W.particles = keep.length > 5000 ? keep.slice(keep.length - 5000) : keep;
}
