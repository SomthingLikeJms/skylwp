import type { BoatKind, Settings, World } from '../world/types';
import { spawnShip, type ShipRequest } from './actions';
import { clamp } from '../world/math';

function browserKind(id: string, category: number): BoatKind {
  if (category < 5) return (['sail', 'cruise', 'launch', 'workboat', 'sail'] as const)[category];
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) >>> 0;
  return (['sail', 'launch', 'junk'] as const)[h % 3];
}
/** Only existing world signals are read. Reconcile once a second, never poll the OS here. */
export function fleetRequests(W: World, S: Settings): ShipRequest[] {
  const result: ShipRequest[] = [];
  if (W.sig.mem > 0) result.push({ tabId: 'memory', source: 'memory', kind: 'cargo', cat: 0 });
  for (const agent of W.agents.filter((a) => a.state !== 'ended').slice(-2))
    result.push({
      tabId: 'agent:' + agent.id,
      source: 'agent',
      kind: 'workboat',
      cat: 3,
      agent: agent.id,
    });
  if (S.music) result.push({ tabId: 'media', source: 'media', kind: 'music', cat: 1 });
  for (let n = 0; n < 2; n++) {
    const id = 'network:' + n,
      existing = W.ships.some((s) => s.source === 'network' && s.tabId === id && !s.leaving),
      threshold = n === 0 ? (existing ? 0.025 : 0.07) : existing ? 0.22 : 0.4;
    if (W.sig.net > threshold)
      result.push({ tabId: id, source: 'network', kind: 'launch', cat: 4 });
  }
  // Group a busy browser into up to four boats so it cannot crowd out the entire river.
  for (const tab of W.browserTabs.slice(0, Math.min(4, Math.ceil(W.browserTabs.length / 3))))
    result.push({
      tabId: tab.id,
      source: 'browser',
      kind: browserKind(tab.id, tab.cat),
      cat: tab.cat,
    });
  return result;
}
export function stepFleet(W: World, S: Settings, dt: number) {
  W.shipCool -= dt;
  if (W.shipCool <= 0) {
    const wanted = fleetRequests(W, S);
    for (const ship of W.ships) {
      const request = wanted.find(
        (r) => r.source === (ship.source ?? 'browser') && r.tabId === ship.tabId,
      );
      if (!request || request.kind !== ship.kind) ship.leaving = true;
      else ship.cat = request.cat;
    }
    for (const request of wanted) {
      if (
        W.ships.some(
          (s) =>
            !s.leaving && (s.source ?? 'browser') === request.source && s.tabId === request.tabId,
        )
      )
        continue;
      if (spawnShip(W, W.t < 2, request)) break;
    }
    W.shipCool = 1;
  }
  for (const ship of W.ships) {
    const speed = ship.source === 'network' ? 5 + W.sig.net * 9 : ship.kind === 'cargo' ? 3.5 : 5;
    if (ship.leaving) ship.x += dt * speed;
    else if (ship.arriving) {
      ship.x -= dt * speed;
      if (ship.x <= ship.tx) {
        ship.x = ship.tx;
        ship.arriving = false;
      }
    } else
      ship.x = clamp(
        ship.x + Math.sin(W.t * 0.12 + ship.ph) * dt * 0.3,
        Math.max(ship.minX, ship.tx - 0.75),
        Math.min(ship.maxX, ship.tx + 0.75),
      );
  }
  W.ships = W.ships.filter((s) => !(s.leaving && s.x > W.cols + 2));
}
