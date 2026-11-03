import type { World, Agent, Tower, Particle, Color } from '../world/types';
import { AGENT_DEFS, CATS } from '../scenes';
import { mix3 } from '../world/math';
export function fmtH(h: number) {
  const m = Math.floor((((h % 24) + 24) % 24) * 60);
  return String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
}
export function logEvent(W: World, txt: string) {
  W.log.unshift({ h: W.hourNow, txt });
  if (W.log.length > 5) W.log.pop();
  W.logVer++;
}
export function assignSite(W: World, a: Agent) {
  const cap = Math.round(W.Hmax * 0.66);
  let best: Tower | null = null,
    bs = -1e9;
  for (const T of W.sites) {
    const prior = T.owner >= 0 ? W.agents[T.owner] : null;
    if (T.h >= cap - 1 && prior?.state !== 'ended') continue;
    if (W.agents.some((o) => o !== a && o.state !== 'ended' && o.site === T.idx)) continue;
    const s = (T.owner < 0 ? 6 : 0) - T.h * 0.2 + W.rng.next() * 3;
    if (s > bs) {
      bs = s;
      best = T;
    }
  }
  if (!best) {
    a.site = -1;
    return;
  }
  if (best.owner >= 0 && W.agents[best.owner]?.state === 'ended') W.agents[best.owner].site = -1;
  best.owner = a.id;
  best.target = Math.min(
    cap,
    Math.floor(best.h) + 3 + Math.floor(W.rng.next() * Math.max(2, W.Hmax * 0.18)),
  );
  a.site = best.idx;
}
export function addAgent(W: World) {
  if (W.agents.filter((a) => a.state !== 'ended').length >= AGENT_DEFS.length) return null;
  const d = AGENT_DEFS[W.agents.length % AGENT_DEFS.length];
  const a: Agent = {
    id: W.agents.length,
    name: d.name,
    col: d.col,
    site: -1,
    session: '',
    src: 'sim',
    state: 'working' as const,
    done: 0,
    total: 0,
    current: '',
    tool: null,
    toolUntil: 0,
    calls: 0,
    baseHeight: 0,
    toolProgress: 0,
    lastActive: W.t,
    phase: 'working',
  };
  W.agents.push(a);
  W.walkers = W.walkers.filter((w) => W.agents[w.agent]?.state !== 'ended');
  assignSite(W, a);
  for (let k = 0; k < 2; k++)
    W.walkers.push({
      agent: a.id,
      x: 2 + W.rng.next() * (W.cols - 4),
      tx: 2 + W.rng.next() * (W.cols - 4),
      state: 'walk',
      timer: W.rng.next() * 3,
      speed: 1.4 + W.rng.next() * 1.4,
      run: 0,
      dir: 1,
    });
  return a;
}
export function spawnShip(W: World, docked: boolean) {
  const top = W.wy + 1,
    bot = W.promY - 3,
    span_ = bot - top;
  if (span_ < 2) return false;
  for (let tries = 0; tries < 24; tries++) {
    const y = top + Math.floor(W.rng.next() * span_);
    const far = y - W.wy < (W.promY - W.wy) * 0.35;
    const hgt = far ? 2 : 3,
      wid = far ? 3 : 7;
    if (y + hgt > W.promY - 1) continue;
    if (W.bridge && y <= W.bridge.deckY + 1 && y + hgt >= W.bridge.deckY - 1) continue;
    if (W.ships.some((o) => !o.leaving && Math.abs(o.y - y) < (far ? 2 : 3))) continue;
    const minX = 2,
      maxX = W.cols - wid - 2;
    if (maxX - minX < 1) continue;
    const tx = minX + W.rng.next() * (maxX - minX);
    const kind = W.sc.boat === 'hk' && W.rng.next() < 0.35 ? 'junk' : W.sc.boat;
    const tab = W.browserTabs.find(
      (tab) => !W.ships.some((ship) => !ship.leaving && ship.tabId === tab.id),
    );
    if (!tab) return false;
    W.ships.push({
      tabId: tab.id,
      x: docked ? tx : W.cols + 1,
      tx,
      minX,
      maxX,
      y,
      far,
      kind,
      cat: tab.cat,
      ph: W.rng.next() * 6,
      arriving: !docked,
      leaving: false,
    });
    return true;
  }
  return false;
}
export function launchFirework(W: World, x: number, y: number, col: Color) {
  const dur = 0.8;
  W.particles.push({
    kind: 'rocket',
    x,
    y: W.wy,
    vx: 0,
    vy: -(W.wy - y) / dur,
    g: 0,
    life: dur,
    max: dur,
    col,
  });
}
export function burst(W: World, arr: Particle[], p: Particle) {
  for (let n = 0; n < 64; n++) {
    const a = W.rng.next() * Math.PI * 2,
      sp = 2.5 + W.rng.next() * 5;
    const l = 1.2 + W.rng.next() * 1.1;
    arr.push({
      kind: 'fw',
      x: p.x,
      y: p.y,
      vx: Math.cos(a) * sp * 2,
      vy: Math.sin(a) * sp,
      g: 3.5,
      life: l,
      max: l,
      col: mix3(p.col ?? [1, 1, 1], [1, 0.96, 0.85], W.rng.next() * 0.45),
    });
  }
}
export function agentTower(W: World, a: Agent) {
  if (a.site >= 0) return W.towers[a.site];
  const own = W.towers.filter((T) => T.owner === a.id);
  return own.length ? own[own.length - 1] : null;
}
export function evTestPass(W: World) {
  if (!W.agents.length) return;
  const a = W.agents[Math.floor(W.rng.next() * W.agents.length)];
  const T = agentTower(W, a);
  const cx = T ? T.x + T.w / 2 : W.cols * (0.3 + W.rng.next() * 0.4);
  launchFirework(W, cx, Math.max(2, W.baseY - W.Hmax * (0.55 + W.rng.next() * 0.3)), a.col);
  if (T) T.flash = 1.4;
  logEvent(W, `${a.name} 测试通过`);
}
export function evError(W: World) {
  const cand = W.agents.filter((a) => agentTower(W, a));
  if (!cand.length) return false;
  const a = cand[Math.floor(W.rng.next() * cand.length)];
  agentTower(W, a)!.err = 6;
  for (const w of W.walkers)
    if (w.agent === a.id) {
      w.run = 4;
      w.dir = W.rng.next() < 0.5 ? -1 : 1;
    }
  logEvent(W, `${a.name} 报错，它的楼亮起红灯`);
  return true;
}
export function evSession(W: World) {
  const a = addAgent(W);
  if (a) logEvent(W, `${a.name} 开了新会话，认领了一块地`);
  return a;
}
