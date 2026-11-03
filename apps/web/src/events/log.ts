import { DEFAULT_SETTINGS, RULE_VERSION, type EngineConfig } from './replay';
import { parseEvent, type CityEvent } from './protocol';
import { validThresholds } from '../systems/climate-config';

export interface Recording {
  config: EngineConfig;
  events: CityEvent[];
  durationMs: number;
}

export function serializeRecording(recording: Recording, includePrivateText = false): string {
  const config = structuredClone(recording.config);
  config.settings.cursor = null;
  config.settings.privacy = !includePrivateText;
  const lines = [
    JSON.stringify({
      v: 1,
      type: 'recording',
      rules: RULE_VERSION,
      ...config,
      durationMs: recording.durationMs,
    }),
  ];
  for (const input of recording.events) {
    if ((input.at ?? input.ts) > config.epoch + recording.durationMs + 0.0001) continue;
    const event = structuredClone(input);
    if (!includePrivateText) {
      if (event.type === 'agent.todo')
        event.data.current = `步骤 ${event.data.done}/${event.data.total}`;
      if (event.type === 'agent.error') delete event.data.summary;
      if (event.type === 'agent.session')
        event.data.name =
          event.src === 'codex'
            ? 'Codex'
            : event.src === 'claude-code'
              ? 'Claude Code'
              : '本地 Agent';
      if (event.type === 'media.track') {
        event.data.title = '正在播放';
        event.data.artist = '';
      }
    }
    lines.push(JSON.stringify(event));
  }
  return lines.join('\n') + '\n';
}

export function parseRecording(text: string): Recording {
  if (text.length > 10 * 1024 * 1024) throw new Error('记录超过 10 MB');
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 1 || lines.length > 200001) throw new Error('记录行数无效');
  let header: Record<string, unknown>;
  try {
    header = JSON.parse(lines[0]) as Record<string, unknown>;
  } catch {
    throw new Error('无法读取记录头');
  }
  if (!header || header.type !== 'recording' || header.v !== 1 || header.rules !== RULE_VERSION)
    throw new Error('记录规则版本不兼容');
  const { seed, epoch, cols, rows, durationMs, settings } = header;
  const finite = (v: unknown, min: number, max: number): v is number =>
    typeof v === 'number' && Number.isFinite(v) && v >= min && v <= max;
  if (
    !finite(seed, 0, 0xffffffff) ||
    !Number.isInteger(seed) ||
    !finite(epoch, 0, Number.MAX_SAFE_INTEGER - 86400000) ||
    !finite(cols, 20, 600) ||
    !Number.isInteger(cols) ||
    !finite(rows, 20, 240) ||
    !Number.isInteger(rows) ||
    cols * rows > 80000 ||
    !finite(durationMs, 0, 86400000)
  )
    throw new Error('记录尺寸或时间范围无效');
  if (!settings || typeof settings !== 'object' || Array.isArray(settings))
    throw new Error('记录设置无效');
  const S = settings as Record<string, unknown>;
  if (
    !['bund', 'nyc', 'hk'].includes(String(S.scene)) ||
    !['harbor', 'phosphor', 'ink'].includes(String(S.theme)) ||
    !['stop', 'real', 'fast'].includes(String(S.flow)) ||
    ![7, 9, 12].includes(Number(S.density)) ||
    !finite(S.hour, 0, 24) ||
    !finite(S.bpm, 20, 300) ||
    !finite(S.tabs, 0, 500)
  )
    throw new Error('记录画面设置无效');
  if (S.effects === undefined) S.effects = DEFAULT_SETTINGS.effects;
  for (const key of [
    'waterMode',
    'waterSource',
    'waterStrength',
    'weatherMode',
    'weatherThresholds',
  ])
    if (S[key] === undefined)
      S[key] = structuredClone(DEFAULT_SETTINGS[key as keyof typeof DEFAULT_SETTINGS]);
  if (
    !['binary', 'ascii', 'mirror'].includes(String(S.waterMode)) ||
    !['combined', 'cpu', 'agent'].includes(String(S.waterSource)) ||
    !['load', 'real'].includes(String(S.weatherMode)) ||
    !validThresholds(S.weatherThresholds)
  )
    throw new Error('记录水面或气候设置无效');
  for (const key of ['cpu', 'mem', 'net', 'agentAct', 'intensity', 'effects', 'waterStrength'])
    if (!finite(S[key], 0, 1)) throw new Error('记录信号范围无效');
  for (const key of ['music', 'away', 'privacy'])
    if (typeof S[key] !== 'boolean') throw new Error('记录开关无效');
  const clean = { ...DEFAULT_SETTINGS };
  for (const key of Object.keys(DEFAULT_SETTINGS) as (keyof typeof DEFAULT_SETTINGS)[])
    if (key !== 'cursor') Object.assign(clean, { [key]: S[key] });
  const events: CityEvent[] = [];
  for (let i = 1; i < lines.length; i++) {
    let event: CityEvent;
    try {
      event = parseEvent(JSON.parse(lines[i]));
    } catch {
      throw new Error(`第 ${i + 1} 行事件无效`);
    }
    const effective = event.at ?? event.ts;
    if (effective < epoch || effective > epoch + durationMs + 0.001)
      throw new Error(`第 ${i + 1} 行事件时间越界`);
    events.push(event);
  }
  return { config: { seed, epoch, cols, rows, settings: clean }, events, durationMs };
}
