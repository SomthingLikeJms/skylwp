import type { World, Agent } from '../world/types';
import type { CityEvent } from '../events/protocol';
import { addAgent, agentTower, launchFirework, logEvent } from './actions';
import { bGen } from '../scenes/stamp';

export function syncProgress(W: World, agent: Agent): void {
  const tower = agentTower(W, agent);
  if (!tower) return;
  const cap = Math.max(2, Math.floor(W.Hmax * 0.66));
  if (agent.total > 0) {
    // The building always has one visible construction floor, even at zero done.
    const stepHeight = Math.max(1, Math.floor((cap - 1) / agent.total));
    tower.target = Math.min(cap, 1 + agent.done * stepHeight);
    if (agent.state !== 'ended' && agent.done < agent.total)
      tower.target = Math.min(cap, tower.target + 0.65 * stepHeight);
  } else tower.target = Math.min(cap, Math.max(4, cap * 0.42) + Math.log2(1 + agent.calls) * 1.8);
}

export function handleAgentEvent(W: World, event: CityEvent): void {
  if (!event.type.startsWith('agent.')) return;
  let agent = W.agents.find((a) => a.session === event.session && a.src === event.src);
  if (event.type === 'agent.session' && event.data.state === 'start') {
    if (agent) return;
    const created = addAgent(W);
    if (!created) {
      logEvent(W, '地块已满，暂时无法认领新会话');
      return;
    }
    agent = created;
    agent.session = event.session!;
    agent.src = event.src;
    agent.name = event.data.name;
    if (event.src === 'codex') agent.col = [0.45, 0.86, 0.8];
    if (event.src === 'claude-code') agent.col = [0.95, 0.6, 0.42];
    const tower = agentTower(W, agent);
    if (tower) {
      tower.h = 1;
      tower.target = 1;
      tower.st = bGen(tower.w, 1, 'flat', W.rng.next);
      agent.baseHeight = 1;
    }
    syncProgress(W, agent);
    logEvent(W, `${agent.name} 开了新会话，认领了一块地`);
    return;
  }
  if (!agent || agent.state === 'ended') return;
  agent.lastActive = W.t;
  const tower = agentTower(W, agent);
  switch (event.type) {
    case 'agent.activity':
      agent.phase = event.data.phase;
      break;
    case 'agent.todo':
      agent.done = event.data.done;
      agent.total = event.data.total;
      agent.current = event.data.current;
      if (agent.state !== 'awaiting') agent.state = 'working';
      syncProgress(W, agent);
      logEvent(W, `${agent.name} 更新步骤 ${agent.done}/${agent.total}`);
      break;
    case 'agent.await':
      agent.state = event.data.on ? 'awaiting' : 'working';
      logEvent(W, `${agent.name} ${event.data.on ? '等你确认' : '继续工作'}`);
      break;
    case 'agent.tool':
      agent.phase = 'working';
      agent.calls++;
      agent.tool = event.data.kind;
      agent.toolUntil = W.t + 5;
      agent.state = 'working';
      if (!agent.total) syncProgress(W, agent);
      if (event.data.kind === 'test') {
        if (event.data.ok === true) {
          if (tower) tower.flash = 1.4;
          logEvent(W, `${agent.name} 测试通过`);
        } else if (event.data.ok === false) fail(W, agent);
        else logEvent(W, `${agent.name} 正在运行测试`);
      }
      break;
    case 'agent.error':
      fail(W, agent);
      break;
    case 'agent.session':
      agent.state = 'ended';
      agent.current = '';
      agent.tool = null;
      if (event.data.reason === 'inactive') {
        agent.inactive = true;
        logEvent(W, `${agent.name} 暂停跟踪这个会话`);
        break;
      }
      if (tower) {
        if (agent.total > 0) {
          syncProgress(W, agent);
        }
        tower.flash = 1.4;
        launchFirework(
          W,
          tower.x + tower.w / 2,
          Math.max(2, W.baseY - tower.target - 5),
          agent.col,
        );
      }
      logEvent(W, `${agent.name} 完成会话，楼宇封顶`);
      break;
  }
}

function fail(W: World, agent: Agent): void {
  const tower = agentTower(W, agent);
  if (tower) tower.err = 6;
  for (const walker of W.walkers)
    if (walker.agent === agent.id) {
      walker.run = 4;
      walker.dir = W.rng.next() < 0.5 ? -1 : 1;
    }
  logEvent(W, `${agent.name} 报错，外墙亮起红灯`);
}
