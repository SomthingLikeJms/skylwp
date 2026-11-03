import { makeEvent, type CityEvent } from '../protocol';

/** Data, not timers: the same script drives a live demo and a replay. */
export function demoEvents(epoch: number): CityEvent[] {
  return [
    makeEvent(
      'agent.session',
      { state: 'start', name: 'Claude Code' },
      epoch,
      'claude-code',
      'demo-claude',
    ),
    makeEvent(
      'agent.todo',
      { done: 2, total: 7, current: '修复登录测试' },
      epoch,
      'claude-code',
      'demo-claude',
    ),
    makeEvent('agent.session', { state: 'start', name: 'Codex' }, epoch, 'codex', 'demo-codex'),
    makeEvent(
      'agent.todo',
      { done: 1, total: 5, current: '构建城市渲染器' },
      epoch,
      'codex',
      'demo-codex',
    ),
    makeEvent(
      'browser.tabs',
      {
        tabs: ['文档', '代码', '视频', '搜索', '文档'].map((cat, i) => ({
          id: `demo-tab-${i}`,
          cat,
        })),
      },
      epoch,
      'browser',
    ),
    makeEvent(
      'media.track',
      { title: '夜航', artist: '城市电台', palette: ['#ff529e', '#9e61ff', '#4dd1ff'] },
      epoch,
      'media',
    ),
  ];
}

export function scenarioEvents(epoch: number): CityEvent[] {
  const events = demoEvents(epoch);
  events.push(
    makeEvent('agent.tool', { kind: 'read' }, epoch + 2000, 'codex', 'demo-codex'),
    makeEvent('agent.tool', { kind: 'edit' }, epoch + 4000, 'codex', 'demo-codex'),
    makeEvent(
      'agent.todo',
      { done: 2, total: 5, current: '连接统一事件流' },
      epoch + 6000,
      'codex',
      'demo-codex',
    ),
    makeEvent(
      'agent.await',
      { on: true, reason: 'permission' },
      epoch + 9000,
      'claude-code',
      'demo-claude',
    ),
    makeEvent(
      'agent.await',
      { on: false, reason: 'permission' },
      epoch + 14000,
      'claude-code',
      'demo-claude',
    ),
    makeEvent('agent.tool', { kind: 'test', ok: false }, epoch + 17000, 'codex', 'demo-codex'),
    makeEvent('agent.tool', { kind: 'test', ok: true }, epoch + 25000, 'codex', 'demo-codex'),
    makeEvent(
      'agent.todo',
      { done: 5, total: 5, current: '完成验收' },
      epoch + 28000,
      'codex',
      'demo-codex',
    ),
    makeEvent(
      'agent.session',
      { state: 'end', name: 'Codex' },
      epoch + 31000,
      'codex',
      'demo-codex',
    ),
  );
  return events;
}
