import './style.css';
import './ui/terminal.css';
import { Renderer } from './engine/renderer';
import { LoopScheduler } from './engine/scheduler';
import { compose } from './compose';
import { drawTextLayer } from './systems/textlayer';
import { describe } from './ui/tooltip';
import { fmtH } from './systems/actions';
import { WEATHER_NAMES, weatherFromCode } from './systems/weather';
import { DEFAULT_THRESHOLDS, validThresholds } from './systems/climate-config';
import { EventBus } from './events/bus';
import { makeEvent, type EventData, type EventType, type Source } from './events/protocol';
import { CityEngine, DEFAULT_SETTINGS, NATIVE_HISTORY } from './events/replay';
import { demoEvents, scenarioEvents } from './events/sim/demo';
import { parseRecording, serializeRecording, type Recording } from './events/log';
import type { Settings, Theme, World } from './world/types';
import { WidgetLayout } from './ui/widgets';
import { WeatherMoon } from './ui/weather-moon';
import {
  isNative,
  connectHost,
  invokeHost,
  type HostConfig,
  type HostControl,
  type HostStatus,
} from './events/native';

const element = <T extends HTMLElement>(id: string): T => {
  const value = document.getElementById(id);
  if (!value) throw new Error(`缺少界面元素 ${id}`);
  return value as T;
};
const canvas = element<HTMLCanvasElement>('world');
const weatherMoon = new WeatherMoon(element<HTMLCanvasElement>('weatherMoon'));
const panel = element('panel'),
  tip = element('tip'),
  toast = element('toast');
const timeCursor = element<HTMLInputElement>('timeCursor');
const agentSelect = element<HTMLSelectElement>('agentSelect');
const query = new URLSearchParams(location.search);
const initialSettings = structuredClone(DEFAULT_SETTINGS);
try {
  const saved = JSON.parse(localStorage.getItem('ascii-city.preferences') ?? '{}') as Record<
    string,
    unknown
  >;
  if (['harbor', 'phosphor', 'ink'].includes(String(saved.theme)))
    initialSettings.theme = saved.theme as Theme;
  if ([7, 9, 12].includes(Number(saved.density)))
    initialSettings.density = saved.density as Settings['density'];
  if (typeof saved.privacy === 'boolean') initialSettings.privacy = saved.privacy;
  if (['binary', 'ascii', 'mirror'].includes(String(saved.waterMode)))
    initialSettings.waterMode = saved.waterMode as Settings['waterMode'];
  if (['combined', 'cpu', 'agent'].includes(String(saved.waterSource)))
    initialSettings.waterSource = saved.waterSource as Settings['waterSource'];
  if (
    typeof saved.waterStrength === 'number' &&
    saved.waterStrength >= 0 &&
    saved.waterStrength <= 1
  )
    initialSettings.waterStrength = saved.waterStrength;
  if (['load', 'real'].includes(String(saved.weatherMode)))
    initialSettings.weatherMode = saved.weatherMode as Settings['weatherMode'];
  if (validThresholds(saved.weatherThresholds))
    initialSettings.weatherThresholds = saved.weatherThresholds;
} catch {
  /* Storage may be unavailable inside a host WebView. */
}
if (query.has('qa')) Object.assign(initialSettings, DEFAULT_SETTINGS);
if (isNative) {
  const now = new Date();
  Object.assign(initialSettings, {
    cpu: 0,
    mem: 0,
    net: 0,
    music: false,
    tabs: 0,
    hour: now.getHours() + now.getMinutes() / 60,
    flow: 'real',
  });
}
const dimensions = (density: number) => {
  const dpr = Math.min(devicePixelRatio || 1, 2.5);
  const cw = Math.max(5, Math.round(density * (isNative ? 1 : dpr)));
  return {
    cols: Math.max(20, Math.ceil((innerWidth * dpr) / cw)),
    rows: Math.max(20, Math.ceil((innerHeight * dpr) / (cw * 2))),
    cw,
    ch: cw * 2,
    dpr,
  };
};
let geometry = dimensions(initialSettings.density);
const epoch = query.has('qa') ? 1793611800000 : Date.now();
let live = new CityEngine(
  { seed: 20261102, epoch, ...geometry, settings: initialSettings },
  isNative ? [] : demoEvents(epoch),
  NATIVE_HISTORY,
);
let replay: CityEngine | null = null;
let importedDuration: number | null = null;
let interactive = !isNative && query.get('mode') !== 'wallpaper';
let hostConfig: HostConfig | null = null;
let hostPaused = false,
  hostBattery = false,
  rejectedEvents = 0;
let metricsTime = 0;
let lastHudKey = '';
let theme = initialSettings.theme,
  density = initialSettings.density,
  privacy = initialSettings.privacy;
let renderer: Renderer;
let playing = false,
  busy = false;
let simTime = 0,
  replayTime = 0,
  lastFrame = performance.now(),
  lastUi = 0;
let frameCount = 0,
  fpsTime = lastFrame,
  costAverage = 0,
  stepCost = 0,
  measuredFps = 0;
let pointer: { x: number; y: number; px: number; py: number } | null = null;
let lastLog = '',
  lastAgentChoices = '',
  toastTimer = 0,
  touchTimer = 0;
let eventSerial = 0,
  seekSerial = 0,
  resizeTimer = 0;
const bus = new EventBus();
const widgets = new WidgetLayout((positions, appearance) => {
  if (isNative && hostConfig) {
    hostConfig.widgetPositions = positions;
    hostConfig.widgetAppearance = appearance;
    void invokeHost('host_config', { config: hostConfig }).catch((error) =>
      showToast(String(error)),
    );
  }
});
const active = () => replay ?? live;
const duration = () => importedDuration ?? live.elapsedMs;
const currentRecording = (): Recording => ({
  config: active().config,
  events: active().events,
  durationMs: duration(),
});

function showToast(message: string): void {
  toast.textContent = message;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove('show'), 3000);
}

function savePreferences(): void {
  try {
    const { waterMode, waterSource, waterStrength, weatherMode, weatherThresholds } = live.settings;
    localStorage.setItem(
      'ascii-city.preferences',
      JSON.stringify({
        theme,
        density,
        privacy,
        waterMode,
        waterSource,
        waterStrength,
        weatherMode,
        weatherThresholds,
      }),
    );
  } catch {
    /* Preferences are optional. */
  }
  if (isNative && hostConfig) {
    Object.assign(hostConfig, {
      theme,
      density,
      privacy,
      scene: live.settings.scene,
      intensity: live.settings.intensity,
      effects: live.settings.effects,
      waterMode: live.settings.waterMode,
      waterSource: live.settings.waterSource,
      waterStrength: live.settings.waterStrength,
      weatherMode: live.settings.weatherMode,
      weatherThresholds: { ...live.settings.weatherThresholds },
    });
    void invokeHost('host_config', { config: hostConfig }).catch((error) =>
      showToast(String(error)),
    );
  }
}

const thresholdInputs = {
  cloud: 'cloudThreshold',
  rain: 'rainThreshold',
  storm: 'stormThreshold',
  memoryFog: 'fogThreshold',
  responseSeconds: 'weatherResponse',
  holdSeconds: 'weatherHold',
} as const;
function syncClimateControls(S: Settings): void {
  if (!element('waterGroup').contains(document.activeElement)) {
    element<HTMLSelectElement>('waterMode').value = S.waterMode;
    element<HTMLSelectElement>('waterSource').value = S.waterSource;
    element<HTMLInputElement>('waterStrength').value = String(S.waterStrength * 100);
  }
  element('waterStrengthO').textContent = `${Math.round(S.waterStrength * 100)}%`;
  if (!element('weatherRulesForm').contains(document.activeElement)) {
    element<HTMLSelectElement>('weatherMode').value = S.weatherMode;
    for (const [key, id] of Object.entries(thresholdInputs))
      element<HTMLInputElement>(id).value = String(
        S.weatherThresholds[key as keyof typeof thresholdInputs] *
          (['responseSeconds', 'holdSeconds'].includes(key) ? 1 : 100),
      );
  }
}
for (const id of ['waterMode', 'waterSource', 'waterStrength'])
  element(id).addEventListener('change', () => {
    send('water.configure', {
      mode: element<HTMLSelectElement>('waterMode').value as Settings['waterMode'],
      source: element<HTMLSelectElement>('waterSource').value as Settings['waterSource'],
      strength: Number(element<HTMLInputElement>('waterStrength').value) / 100,
    });
  });
element('weatherRulesForm').addEventListener('submit', (event) => {
  event.preventDefault();
  const thresholds = Object.fromEntries(
    Object.entries(thresholdInputs).map(([key, id]) => [
      key,
      Number(element<HTMLInputElement>(id).value) /
        (['responseSeconds', 'holdSeconds'].includes(key) ? 1 : 100),
    ]),
  );
  if (!validThresholds(thresholds)) {
    showToast('CPU 阈值需依次升高，时间范围为 1–120 秒，保持可为 0');
    return;
  }
  send('weather.configure', {
    mode: element<HTMLSelectElement>('weatherMode').value as Settings['weatherMode'],
    thresholds,
  });
  showToast('气候阈值已保存');
});
element('weatherReset').addEventListener('click', () => {
  send('weather.configure', { mode: 'load', thresholds: { ...DEFAULT_THRESHOLDS } });
  (document.activeElement as HTMLElement | null)?.blur();
  syncClimateControls(active().settings);
});

function send<K extends EventType>(
  type: K,
  data: EventData[K],
  src: Source = 'sim',
  session?: string,
): void {
  if (replay) {
    showToast('正在回放，回到实时后可以修改信号');
    return;
  }
  bus.publish(makeEvent(type, data, live.config.epoch + live.elapsedMs, src, session));
  if (
    [
      'world.scene',
      'music.intensity',
      'world.effects',
      'water.configure',
      'weather.configure',
    ].includes(type)
  )
    savePreferences();
  updateUi();
}
bus.subscribe((event) => live.append(event));

function fitRenderer(): void {
  const engine = active();
  const dpr = Math.min(devicePixelRatio || 1, 2.5);
  let cw = Math.round(density * (isNative ? 1 : dpr));
  if (replay && importedDuration !== null)
    cw = Math.max(
      2,
      Math.floor(
        Math.min(
          (innerWidth * dpr) / engine.world.cols,
          (innerHeight * dpr) / (engine.world.rows * 2),
        ),
      ),
    );
  geometry = { ...geometry, cols: engine.world.cols, rows: engine.world.rows, cw, ch: cw * 2, dpr };
  renderer.resize(engine.world, cw, cw * 2, dpr);
}

function setMode(on: boolean, fromHost = false): void {
  if (isNative && !fromHost) {
    void invokeHost('host_command', { command: on ? 'interactive' : 'wallpaper' }).catch((error) =>
      showToast(String(error)),
    );
    return;
  }
  interactive = on;
  if (!on && widgets.editing) widgets.edit(false);
  panel.classList.toggle('hidden', !on);
  element('wake').classList.toggle('show', !on);
  document.body.classList.toggle('live', on);
  document.body.classList.toggle('wallpaper', !on);
  panel.inert = !on;
  tip.hidden = true;
  pointer = null;
  updateUi();
  updateLoopRate();
}

function paint(): void {
  if (renderer.lost) {
    showFailure('画面连接已中断，请刷新页面恢复');
    return;
  }
  const engine = active(),
    W = engine.world;
  const settings: Settings = {
    ...engine.settings,
    theme,
    density,
    privacy,
    intensity: engine.settings.intensity * (interactive ? 1 : 0.5),
    cursor: interactive && pointer ? { x: pointer.x, y: pointer.y } : null,
  };
  if (document.body.dataset.visualTheme !== theme) document.body.dataset.visualTheme = theme;
  const start = performance.now();
  renderer.atlas.beginFrame();
  weatherMoon.hide();
  compose(
    W,
    settings,
    () => drawTextLayer(W, settings, renderer.atlas, interactive),
    (x, y, r) => weatherMoon.draw(W, x, y, r),
  );
  costAverage = costAverage * 0.9 + (performance.now() - start + stepCost) * 0.1;
  stepCost = 0;
  renderer.draw(W, theme, active().settings.effects);
  frameCount++;
  if (pointer && interactive) updateTooltip(settings);
}

function updateTooltip(settings: Settings): void {
  if (!pointer) {
    tip.hidden = true;
    return;
  }
  const W = active().world;
  const index = pointer.y * W.cols + pointer.x;
  const entity = W.entities[W.ent[index]];
  const description = entity ? describe(W, settings, entity) : null;
  if (!description) {
    tip.hidden = true;
    return;
  }
  tip.replaceChildren();
  const title = document.createElement('b');
  title.textContent = description.title;
  tip.append(title);
  for (const line of description.lines) {
    const child = document.createElement('div');
    child.textContent = line;
    tip.append(child);
  }
  tip.hidden = false;
  const box = tip.getBoundingClientRect();
  tip.style.left = `${Math.max(8, Math.min(innerWidth - box.width - 8, pointer.px + 16))}px`;
  tip.style.top = `${Math.max(8, Math.min(innerHeight - box.height - 8, pointer.py + 16))}px`;
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000);
  return `${Math.floor(seconds / 60)
    .toString()
    .padStart(2, '0')}:${(seconds % 60).toString().padStart(2, '0')}`;
}

function updateUi(): void {
  const engine = active(),
    W = engine.world,
    S = engine.settings;
  element<HTMLInputElement>('privacyChk').checked = privacy;
  for (const [id, value, label] of [
    ['cpu', S.cpu * 100, `${Math.round(S.cpu * 100)}%`],
    ['mem', S.mem * 100, `${Math.round(S.mem * 100)}%`],
    ['net', S.net * 100, `${Math.round(S.net * 100)}%`],
    ['act', S.agentAct * 100, `${Math.round(S.agentAct * 100)}%`],
    ['bpm', S.bpm, `${Math.round(S.bpm)}`],
    ['tabs', S.tabs, `${S.tabs} 个`],
    ['hour', S.hour, fmtH(S.hour)],
    ['intensity', S.intensity * 100, `${Math.round(S.intensity * 100)}%`],
  ] as const) {
    const input = element<HTMLInputElement>(id);
    if (document.activeElement !== input) input.value = String(value);
    element(`${id}O`).textContent = label;
  }
  element<HTMLInputElement>('awayChk').checked = S.away;
  syncClimateControls(S);
  for (const group of document.querySelectorAll<HTMLElement>('.chips')) {
    const key = group.dataset.group;
    const value =
      key === 'theme'
        ? theme
        : key === 'effects'
          ? String(S.effects)
          : key === 'density'
            ? String(density)
            : key === 'music'
              ? S.music
                ? 'on'
                : 'off'
              : key === 'scene'
                ? S.scene
                : S.flow;
    for (const button of group.querySelectorAll<HTMLButtonElement>('button')) {
      const on = button.dataset.v === value;
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', String(on));
    }
  }
  const choices = W.agents.map((a) => `${a.session}:${a.src}:${a.state}`).join('|');
  if (choices !== lastAgentChoices) {
    const selected = agentSelect.value;
    agentSelect.replaceChildren();
    for (const a of W.agents) {
      const option = document.createElement('option');
      option.value = String(a.id);
      option.textContent = `${a.name}${a.state === 'ended' ? '（已结束）' : a.state === 'awaiting' ? '（等待）' : ''}`;
      agentSelect.append(option);
    }
    if ([...agentSelect.options].some((o) => o.value === selected)) agentSelect.value = selected;
    lastAgentChoices = choices;
  }
  const logKey = `${W.logVer}:${W.sceneKey}:${privacy}:${Boolean(replay)}`;
  if (logKey !== lastLog) {
    const log = element('log');
    log.replaceChildren();
    for (const item of W.log) {
      const li = document.createElement('li'),
        time = document.createElement('time');
      time.textContent = fmtH(item.h);
      li.append(time, document.createTextNode(item.txt));
      log.append(li);
    }
    lastLog = logKey;
  }
  element('statusline').textContent =
    W.agents
      .filter((a) => a.state !== 'ended' || a.id >= W.agents.length - 2)
      .map(
        (a) =>
          `${a.name} ${a.state === 'awaiting' ? '⏸ 等你确认' : a.state === 'ended' ? (a.inactive ? '暂停跟踪' : '✓ 已完成') : `▸ ${a.done}/${a.total || '—'} ${privacy ? '任务详情已隐藏' : a.current}`}`,
      )
      .join('    ') +
    `    ${S.music ? (isNative && !live.events.some((e) => e.type === 'audio.beat') ? '♪ 检测节拍中' : `♪ ${Math.round(S.bpm)} BPM`) : '音乐暂停'}    ${WEATHER_NAMES[W.weather.state]}    ${replay ? '回放中' : isNative ? '本机实时' : '模拟模式'}`;
  element('perf').textContent = `${Math.round(measuredFps)} fps，${costAverage.toFixed(1)} ms`;
  element('perf').title = `${W.cols} × ${W.rows} 字格，世界步进与合成耗时`;
  updateLiveCards(W, S);
  panel.classList.toggle('replaying', Boolean(replay));
  for (const control of panel.querySelectorAll<
    HTMLInputElement | HTMLButtonElement | HTMLSelectElement
  >(
    '.group input:not(#privacyChk):not(#iconsChk):not(#includePrivateChk):not(#importFile), .group select, .group button',
  )) {
    if (
      ['exportBtn', 'importBtn', 'demoBtn', 'layoutBtn'].includes(control.id) ||
      control.closest('[data-group=theme]') ||
      control.closest('[data-group=density]') ||
      control.closest('[data-group=effects]') ||
      control.closest('#nativeGroup')
    )
      continue;
    control.disabled =
      Boolean(replay) ||
      busy ||
      (isNative &&
        !control.closest('[data-group=scene]') &&
        control.id !== 'intensity' &&
        !control.closest('#waterGroup') &&
        !control.closest('#weatherRulesForm'));
  }
  timeCursor.min = String(active().historyStartMs / 1000);
  timeCursor.max = String(Math.max(active().historyStartMs, duration()) / 1000);
  if (document.activeElement !== timeCursor)
    timeCursor.value = String((replay ? replayTime : live.elapsedMs) / 1000);
  element('timeLabel').textContent = formatDuration(replay ? replayTime : live.elapsedMs);
  element('playBtn').textContent = replay && !playing ? '播放' : '暂停';
  element('liveBtn').classList.toggle('on', !replay);
  drawTimeline();
}

function drawTimeline(): void {
  const c = element<HTMLCanvasElement>('eventMarks'),
    context = c.getContext('2d');
  if (!context) return;
  c.width = Math.max(1, c.clientWidth * devicePixelRatio);
  c.height = 24;
  const start = active().historyStartMs;
  const full = Math.max(1, duration() - start);
  for (const event of active().events) {
    const t = (event.at ?? event.ts) - active().config.epoch - start;
    if (t > full) continue;
    const y = event.type.startsWith('agent.')
      ? 1
      : event.src === 'media' || event.src === 'audio'
        ? 10
        : event.src === 'presence'
          ? 18
          : -1;
    if (y < 0) continue;
    context.fillStyle =
      y === 1 ? (event.src === 'codex' ? '#73dbcc' : '#f2986b') : y === 10 ? '#9c86e7' : '#879bb4';
    context.fillRect((t / full) * c.width, y, Math.max(2, c.width / 500), 4);
  }
}

async function seek(milliseconds: number): Promise<void> {
  const serial = ++seekSerial;
  if (!replay) replay = new CityEngine(live.config, live.events);
  playing = false;
  busy = true;
  replayTime = Math.max(active().historyStartMs, Math.min(duration(), milliseconds));
  const target = replayTime;
  replay.beginSeek(target);
  while (!replay.advanceTo(target, 240)) {
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    if (serial !== seekSerial) return;
  }
  if (serial !== seekSerial) return;
  busy = false;
  fitRenderer();
  paint();
  updateUi();
}

function backToLive(): void {
  seekSerial++;
  replay = null;
  importedDuration = null;
  playing = false;
  busy = false;
  fitRenderer();
  paint();
  updateUi();
}

async function resize(): Promise<void> {
  if (replay && importedDuration !== null) {
    fitRenderer();
    paint();
    return;
  }
  const next = dimensions(density);
  if (next.cols === live.world.cols && next.rows === live.world.rows) {
    geometry = next;
    fitRenderer();
    return;
  }
  const target = live.elapsedMs;
  const nextLive = live.reconfigure(next.cols, next.rows);
  busy = true;
  while (!nextLive.advanceTo(target, 240))
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  live = nextLive;
  geometry = next;
  busy = false;
  if (replay) {
    const time = replayTime;
    replay = new CityEngine(live.config, live.events);
    await seek(time);
  } else {
    fitRenderer();
    paint();
  }
}

function selectedAgent() {
  return live.world.agents.find((a) => a.id === Number(agentSelect.value));
}
function agentAction(
  type: 'progress' | 'await' | 'end' | 'pass' | 'error' | 'read' | 'edit' | 'run',
): void {
  const a = selectedAgent();
  if (!a || a.state === 'ended') {
    showToast('请选择正在进行的会话');
    return;
  }
  const src = a.src as Source;
  if (type === 'progress')
    send(
      'agent.todo',
      {
        done: Math.min(a.total || 5, a.done + 1),
        total: a.total || 5,
        current: '继续完成当前任务',
      },
      src,
      a.session,
    );
  else if (type === 'await')
    send('agent.await', { on: a.state !== 'awaiting', reason: 'permission' }, src, a.session);
  else if (type === 'end') send('agent.session', { state: 'end', name: a.name }, src, a.session);
  else if (type === 'error') send('agent.error', {}, src, a.session);
  else
    send(
      'agent.tool',
      type === 'pass' ? { kind: 'test', ok: true } : { kind: type },
      src,
      a.session,
    );
}

function updateLiveCards(W: World, S: Settings): void {
  const real = W.weather.real;
  const activeAgents = W.agents.filter((a) => a.state !== 'ended').slice(-3);
  element('liveHud').hidden = false;
  element('liveHud').dataset.live = String(isNative || Boolean(real));
  const weather = real ? weatherFromCode(real.code, real.precip) : W.weather.state;
  element('climateStatus').textContent =
    `${S.weatherMode === 'real' ? (W.weather.usesReal ? '实况气候' : '等待实况，暂用本机负载') : '本机负载'}：${WEATHER_NAMES[W.weather.state]}，平滑 CPU ${Math.round(W.weather.cpuAverage * 100)}%`;
  element('weatherCityLabel').textContent = real?.city ?? (isNative ? '城市天气' : '天气预览');
  element('weatherTemp').textContent = real ? `${Math.round(real.tempC)}°C` : '—';
  element('weatherCondition').textContent = real
    ? WEATHER_NAMES[weather]
    : hostConfig?.weather === false
      ? '系统气候'
      : '等待在线天气';
  element('weatherSymbol').textContent = {
    clear: '[CLR]',
    cloudy: '[CLD]',
    low: '[OVC]',
    rain: '[RAIN]',
    storm: '[STORM]',
    haze: '[FOG]',
    snow: '[SNOW]',
  }[weather];
  element('weatherDetails').textContent = real
    ? `wind: ${Math.round(real.windKph ?? 0)} km/h   rh: ${Math.round((real.humidity ?? 0) * 100)}%`
    : isNative
      ? '等待天气数据'
      : '模拟输入';
  element('weatherCredit').textContent = real
    ? hostConfig?.weatherCity === 'system'
      ? '系统位置，Open-Meteo 天气，GeoNames 城市'
      : 'Open-Meteo 天气模型，每 10 分钟更新'
    : hostConfig?.weather === false
      ? '在线天气已关闭'
      : '可在本机数据中设置城市';
  element('weatherTime').textContent =
    real?.localHour === undefined
      ? ''
      : fmtH((real.localHour + (W.t - W.weather.realAt) / 3600) % 24);
  const key = activeAgents
    .map(
      (a) =>
        `${a.id}/${a.calls}/${a.state}/${a.phase}/${a.tool}/${a.current}/${a.done}/${Math.floor(W.t - a.lastActive)}/${privacy}`,
    )
    .join('|');
  if (key === lastHudKey && element('agentFeed').childElementCount) return;
  lastHudKey = key;
  const feed = element('agentFeed');
  feed.replaceChildren();
  for (const a of activeAgents) {
    const card = document.createElement('div');
    card.className = 'agent-card';
    card.style.setProperty(
      '--agent-color',
      `rgb(${a.col.map((c) => Math.round(c * 255)).join(',')})`,
    );
    const head = document.createElement('div');
    head.className = 'agent-top';
    const name = document.createElement('strong');
    name.textContent = a.name;
    const phase = document.createElement('span');
    phase.className = 'agent-phase';
    const age = Math.max(0, Math.floor(W.t - a.lastActive));
    const toolNames = {
      read: '读取资料',
      edit: '修改文件',
      run: '执行命令',
      test: '运行测试',
      subtask: '调度任务',
    };
    phase.textContent =
      a.state === 'awaiting'
        ? '等你确认'
        : age > 60
          ? '等待新活动'
          : W.t < a.toolUntil && a.tool
            ? `${a.tool.toUpperCase()} / ${toolNames[a.tool]}`
            : a.phase === 'thinking'
              ? 'THINK'
              : a.phase === 'responding'
                ? 'WRITE'
                : 'RUN';
    const time = document.createElement('time');
    time.textContent =
      age < 3 ? '刚刚' : age < 60 ? `${age} 秒前` : `${Math.floor(age / 60)} 分钟前`;
    head.append(name, phase, time);
    const detail = document.createElement('div');
    detail.className = 'agent-detail';
    detail.textContent = a.total
      ? `${a.done}/${a.total} 步　${privacy ? '任务详情已隐藏' : a.current}`
      : `calls: ${String(a.calls).padStart(3, '0')}  次实际工具活动`;
    const progress = document.createElement('div');
    progress.className = `agent-progress${a.total ? ' determinate' : ''}`;
    const bar = document.createElement('span');
    const filled = a.total ? Math.round((a.done / a.total) * 16) : 0;
    const headAt = Math.floor(W.t * 2) % 16;
    bar.textContent = a.total
      ? `[${'#'.repeat(filled)}${'-'.repeat(16 - filled)}]`
      : `[${'.'.repeat(headAt)}>${'.'.repeat(15 - headAt)}]`;
    progress.append(bar);
    card.append(head, detail, progress);
    feed.append(card);
  }
  if (!activeAgents.length) {
    const idle = document.createElement('div');
    idle.className = 'agent-idle';
    idle.textContent = '等待 Agent 的下一次真实活动';
    feed.append(idle);
  }
}

function bindRange(id: string, action: (value: number) => void): void {
  element<HTMLInputElement>(id).addEventListener('input', (event) =>
    action(Number((event.target as HTMLInputElement).value)),
  );
}
for (const id of ['cpu', 'mem', 'net'] as const)
  bindRange(id, (value) =>
    send(
      'sys.sample',
      { cpu: live.settings.cpu, mem: live.settings.mem, net: live.settings.net, [id]: value / 100 },
      'system',
    ),
  );
bindRange('act', (value) => send('sim.activity', { value: value / 100 }));
bindRange('bpm', (value) =>
  send('audio.beat', { bpm: value, phase: live.world.beatPh % 1 }, 'audio'),
);
bindRange('intensity', (value) => send('music.intensity', { value: value / 100 }));
bindRange('hour', (value) => send('clock.set', { hour: value, flow: live.settings.flow }));
function setTabs(count: number): void {
  send(
    'browser.tabs',
    {
      tabs: Array.from({ length: count }, (_, i) => ({
        id: `demo-tab-${i}`,
        cat: ['文档', '代码', '视频', '搜索', '社交'][i % 5],
      })),
    },
    'browser',
  );
}
bindRange('tabs', setTabs);
element<HTMLInputElement>('awayChk').addEventListener('change', (event) =>
  send(
    'presence',
    { idleSec: (event.target as HTMLInputElement).checked ? 600 : 0, fullscreen: false },
    'presence',
  ),
);
element<HTMLInputElement>('privacyChk').addEventListener('change', (event) => {
  privacy = (event.target as HTMLInputElement).checked;
  savePreferences();
  tip.hidden = true;
  updateUi();
});
element<HTMLInputElement>('iconsChk').addEventListener('change', (event) => {
  element('icons-layer').hidden = !(event.target as HTMLInputElement).checked;
});
for (const group of document.querySelectorAll<HTMLElement>('.chips'))
  group.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('button');
    if (!button || button.disabled) return;
    const value = button.dataset.v;
    switch (group.dataset.group) {
      case 'theme':
        theme = value as Theme;
        savePreferences();
        break;
      case 'density':
        density = Number(value) as Settings['density'];
        savePreferences();
        void resize();
        break;
      case 'effects':
        send('world.effects', { value: Number(value) });
        break;
      case 'scene':
        send('world.scene', { scene: value as Settings['scene'] });
        break;
      case 'flow':
        send('clock.set', { hour: live.settings.hour, flow: value as Settings['flow'] });
        break;
      case 'music':
        send('media.state', { playing: value === 'on' }, 'media');
        break;
    }
    updateUi();
  });
for (const button of document.querySelectorAll<HTMLButtonElement>('[data-ev]'))
  button.addEventListener('click', () => {
    const type = button.dataset.ev;
    if (type === 'session') {
      if (live.world.agents.length >= 5) {
        showToast('当前城市的五个地块都已认领');
        return;
      }
      const name = ['Claude Code', 'Codex', 'Cursor', 'Aider', '本地 Agent'][
        live.world.agents.length
      ];
      const session = `local-${++eventSerial}`;
      send('agent.session', { state: 'start', name }, 'sim', session);
      send('agent.todo', { done: 0, total: 5, current: '开始新任务' }, 'sim', session);
      agentSelect.value = String(live.world.agents.length - 1);
    } else if (type === 'tab') setTabs(Math.min(8, live.settings.tabs + 1));
    else agentAction(type as Parameters<typeof agentAction>[0]);
  });
element('hideBtn').addEventListener('click', () => setMode(false));
element('layoutBtn').addEventListener('click', () => {
  widgets.edit(true);
  element('liveHud').hidden = false;
});
element('layoutDone').addEventListener('click', () => {
  widgets.edit(false);
  showToast('小组件设置已保存');
  element('layoutBtn').focus();
});
element('layoutReset').addEventListener('click', () => widgets.reset());
element('wake').addEventListener('click', () => setMode(true));
element('liveBtn').addEventListener('click', backToLive);
element('playBtn').addEventListener('click', () => {
  if (!replay) void seek(live.elapsedMs);
  else {
    if (replayTime >= duration()) {
      replay.seek(0);
      replayTime = 0;
    }
    playing = !playing;
    updateUi();
  }
});
timeCursor.addEventListener('input', () => {
  void seek(Number(timeCursor.value) * 1000);
});
element('demoBtn').addEventListener('click', () => {
  backToLive();
  const now = live.config.epoch + live.elapsedMs;
  for (const event of scenarioEvents(now).slice(6)) bus.publish(event);
  showToast('演示已开始，将依次展示进度、等待、报错与完成');
});
element('exportBtn').addEventListener('click', async () => {
  try {
    const content = serializeRecording(
      currentRecording(),
      element<HTMLInputElement>('includePrivateChk').checked,
    );
    if (isNative) {
      try {
        const path = await invokeHost<string>('host_export', { content });
        showToast(`记录已保存：${path}`);
      } catch (error) {
        showToast(String(error));
      }
      return;
    }
    const url = URL.createObjectURL(new Blob([content], { type: 'application/x-ndjson' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'ascii-city-recording.jsonl';
    link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    showToast(
      element<HTMLInputElement>('includePrivateChk').checked
        ? '记录已导出，包含任务和曲名'
        : '记录已导出，任务和曲名已脱敏',
    );
  } catch (error) {
    showToast(error instanceof Error ? error.message : '无法导出记录');
  }
});
element('importBtn').addEventListener('click', () =>
  element<HTMLInputElement>('importFile').click(),
);
element<HTMLInputElement>('importFile').addEventListener('change', async (event) => {
  const input = event.target as HTMLInputElement,
    file = input.files?.[0];
  if (!file) return;
  try {
    if (file.size > 10 * 1024 * 1024) throw new Error('记录超过 10 MB');
    const record = parseRecording(await file.text());
    replay = new CityEngine(record.config, record.events);
    importedDuration = record.durationMs;
    await seek(0);
    showToast(
      record.config.audio === 'live-only'
        ? '已导入最近的记录，实时频谱未录制'
        : '已导入记录，点击播放开始回放',
    );
  } catch (error) {
    showToast(error instanceof Error ? error.message : '无法导入记录');
  }
  input.value = '';
});

function pointerAt(event: PointerEvent): void {
  const box = canvas.getBoundingClientRect();
  pointer = {
    x: Math.floor(((event.clientX - box.left) * canvas.width) / box.width / geometry.cw),
    y: Math.floor(((event.clientY - box.top) * canvas.height) / box.height / geometry.ch),
    px: event.clientX,
    py: event.clientY,
  };
}
canvas.addEventListener('pointermove', (event) => {
  if (interactive) pointerAt(event);
});
canvas.addEventListener('pointerleave', () => {
  pointer = null;
  tip.hidden = true;
});
canvas.addEventListener('pointerdown', (event) => {
  if (!interactive) return;
  pointerAt(event);
  const W = active().world;
  if (
    !replay &&
    pointer &&
    pointer.x >= 0 &&
    pointer.x < W.cols &&
    pointer.y >= 0 &&
    pointer.y < W.baseY - 2 &&
    !W.solid[pointer.y * W.cols + pointer.x]
  )
    send('world.firework', {
      x: pointer.x / W.cols,
      y: pointer.y / W.wy,
      color: ['#ffca73', '#99d9ff', '#ff8db3', '#b3ffbf'][eventSerial++ % 4],
    });
  if (event.pointerType !== 'mouse') {
    updateTooltip({ ...active().settings, privacy });
    clearTimeout(touchTimer);
    touchTimer = window.setTimeout(() => {
      pointer = null;
      tip.hidden = true;
    }, 2600);
  }
});
addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && widgets.editing) {
    widgets.edit(false);
    event.preventDefault();
    return;
  }
  const target = event.target as HTMLElement | null;
  if (target?.matches('input,select,textarea') || target?.isContentEditable || event.repeat) return;
  if (event.key === 'Escape') setMode(false);
  else if (event.key.toLowerCase() === 'h' && !event.ctrlKey && !event.metaKey)
    setMode(!interactive);
  else if (event.altKey && event.key.toLowerCase() === 'p') {
    privacy = !privacy;
    savePreferences();
    updateUi();
  }
});
addEventListener('resize', () => {
  clearTimeout(resizeTimer);
  resizeTimer = window.setTimeout(() => void resize(), 160);
});
document.addEventListener('visibilitychange', () => {
  lastFrame = performance.now();
  updateLoopRate();
});

function showFailure(message: string): void {
  const error = element('nogl');
  error.textContent = message;
  error.hidden = false;
  panel.hidden = true;
  element('timeline').hidden = true;
  element('statusline').hidden = true;
}

function loop(now: number): void {
  const delta = Math.max(0, Math.min(2000, now - lastFrame));
  lastFrame = now;
  if (document.hidden || busy || renderer.lost) return;
  const start = performance.now();
  simTime += delta;
  live.advanceTo(simTime, hostPaused ? 90 : 8);
  if (replay && playing) {
    replayTime = Math.min(duration(), replayTime + delta);
    replay.advanceTo(replayTime, 8);
    if (replayTime >= duration()) playing = false;
  }
  stepCost += performance.now() - start;
  if (hostPaused) stepCost = 0;
  if (!hostPaused) {
    paint();
  }
  if (now - fpsTime >= 1000) {
    measuredFps = (frameCount * 1000) / (now - fpsTime);
    fpsTime = now;
    frameCount = 0;
  }
  if (now - lastUi > 500 && (!isNative || interactive)) {
    lastUi = now;
    updateUi();
  }
  if (isNative && now - metricsTime > 2000) {
    metricsTime = now;
    void invokeHost('host_metrics', {
      metrics: {
        fps: hostPaused ? 0 : measuredFps,
        cost: costAverage,
        cols: live.world.cols,
        rows: live.world.rows,
        rejectedEvents,
        events: live.events.length,
        historyStartMs: live.historyStartMs,
        pendingAudioFrames: live.pendingAudioFrames,
        agents: live.world.agents.filter((a) => a.state !== 'ended').length,
      },
    }).catch(() => {});
  }
}
const scheduler = new LoopScheduler(loop, {
  now: () => performance.now(),
  frame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (id) => cancelAnimationFrame(id),
  timer: (callback, delay) => window.setTimeout(callback, delay),
  cancelTimer: (id) => window.clearTimeout(id),
});
function updateLoopRate(): void {
  scheduler.setRate(document.hidden ? 0 : hostPaused ? 1 : interactive ? 30 : hostBattery ? 6 : 12);
}

function hostControl(state: HostControl): void {
  if (state.kind === 'error') {
    showToast(state.message ?? '桌面连接错误');
    return;
  }
  if (state.kind === 'privacy') {
    privacy = Boolean(state.on);
    if (hostConfig) hostConfig.privacy = privacy;
    updateUi();
    return;
  }
  hostPaused = Boolean(state.paused);
  document.body.classList.toggle('host-paused', hostPaused);
  hostBattery = Boolean(state.battery);
  updateLoopRate();
  if (typeof state.privacy === 'boolean') {
    privacy = state.privacy;
    if (hostConfig) hostConfig.privacy = privacy;
  }
  if (typeof state.interactive === 'boolean' && state.interactive !== interactive)
    setMode(state.interactive, true);
  element('hostState').textContent = hostPaused ? '画面已暂停，采集继续' : '本机实时';
  element('hostPause').textContent = hostPaused ? '继续动画' : '暂停动画';
}

async function initializeHost(): Promise<void> {
  const boot = await connectHost((batch) => {
    for (const original of batch) {
      try {
        const delivery =
          document.hidden || busy
            ? live.elapsedMs
            : simTime + Math.max(0, Math.min(2000, performance.now() - lastFrame));
        const event = { ...original, ts: live.config.epoch + delivery };
        delete event.at;
        bus.publish(event);
      } catch {
        rejectedEvents++;
      }
    }
  }, hostControl);
  hostConfig = boot.config;
  widgets.set(boot.config.widgetPositions, boot.config.widgetAppearance);
  Object.assign(initialSettings, {
    scene: boot.config.scene,
    theme: boot.config.theme,
    density: boot.config.density,
    privacy: boot.config.privacy,
    intensity: boot.config.intensity,
    effects: boot.config.effects,
    waterMode: boot.config.waterMode,
    waterSource: boot.config.waterSource,
    waterStrength: boot.config.waterStrength,
    weatherMode: boot.config.weatherMode,
    weatherThresholds: { ...boot.config.weatherThresholds },
  });
  theme = boot.config.theme;
  density = boot.config.density;
  privacy = boot.config.privacy;
  geometry = dimensions(density);
  live = new CityEngine(
    { ...live.config, ...geometry, settings: initialSettings },
    [],
    NATIVE_HISTORY,
  );
  for (const original of boot.events) {
    try {
      const event = { ...original, ts: epoch };
      delete event.at;
      bus.publish(event);
    } catch {
      rejectedEvents++;
    }
  }
  fitRenderer();
  element('nativeGroup').hidden = false;
  element<HTMLInputElement>('desktopFireworksChk').checked = boot.config.desktopFireworks;
  element('desktopFireworksChk').addEventListener('change', (event) => {
    if (!hostConfig) return;
    hostConfig.desktopFireworks = (event.target as HTMLInputElement).checked;
    void invokeHost('host_config', { config: hostConfig }).catch((error) =>
      showToast(String(error)),
    );
  });
  element('demoBtn').hidden = true;
  const subtitle = panel.querySelector('.brand small');
  if (subtitle) subtitle.textContent = '真实数据留在本机';
  element<HTMLInputElement>('startupChk').checked = boot.autostart;
  element<HTMLInputElement>('coveredChk').checked = boot.config.pauseWhenCovered;
  const weatherLocationMode = element<HTMLSelectElement>('weatherLocationMode');
  weatherLocationMode.value = ['system', 'auto'].includes(boot.config.weatherCity)
    ? boot.config.weatherCity
    : 'fixed';
  element<HTMLInputElement>('weatherCity').value = ['system', 'auto'].includes(
    boot.config.weatherCity,
  )
    ? ''
    : boot.config.weatherCity;
  const updateWeatherInput = () => {
    element<HTMLInputElement>('weatherCity').disabled = weatherLocationMode.value !== 'fixed';
  };
  updateWeatherInput();
  weatherLocationMode.addEventListener('change', updateWeatherInput);
  element('weatherCityForm').addEventListener('submit', (event) => {
    event.preventDefault();
    if (!hostConfig) return;
    const mode = weatherLocationMode.value;
    const city = element<HTMLInputElement>('weatherCity').value.trim();
    if (mode === 'fixed' && !city) {
      showToast('请填写城市名称');
      return;
    }
    hostConfig.weatherCity = mode === 'fixed' ? city : mode;
    void invokeHost('host_config', { config: hostConfig })
      .then(() => showToast('天气城市已更新'))
      .catch((error) => showToast(String(error)));
  });
  for (const input of document.querySelectorAll<HTMLInputElement>('[data-source]')) {
    const key = input.dataset.source as
      'system' | 'audio' | 'media' | 'agents' | 'browser' | 'weather';
    input.checked = boot.config[key];
    input.addEventListener('change', () => {
      if (!hostConfig) return;
      hostConfig[key] = input.checked;
      void invokeHost('host_config', { config: hostConfig }).catch((error) =>
        showToast(String(error)),
      );
    });
  }
  element('hostPause').addEventListener(
    'click',
    () => void invokeHost('host_command', { command: hostPaused ? 'resume' : 'pause' }),
  );
  element('hostDesktop').addEventListener('click', () => setMode(false));
  element('hostExit').addEventListener(
    'click',
    () => void invokeHost('host_command', { command: 'exit' }),
  );
  element<HTMLInputElement>('coveredChk').addEventListener('change', (event) => {
    if (!hostConfig) return;
    hostConfig.pauseWhenCovered = (event.target as HTMLInputElement).checked;
    void invokeHost('host_config', { config: hostConfig });
  });
  element<HTMLInputElement>('startupChk').addEventListener(
    'change',
    (event) =>
      void invokeHost('host_command', {
        command: (event.target as HTMLInputElement).checked ? 'autostart-on' : 'autostart-off',
      }).catch((error) => showToast(String(error))),
  );
  const refresh = async () => {
    try {
      const status = await invokeHost<HostStatus>('host_status');
      element('sourceStatus').textContent = Object.entries(status.sources)
        .map(
          ([key, value]) =>
            `${({ system: '系统', audio: '音频', media: '媒体', agents: 'Agent', browser: '浏览器', weather: '天气', desktop: '桌面交互' } as Record<string, string>)[key] ?? key}：${value}`,
        )
        .join('\n');
    } catch {}
  };
  await refresh();
  window.setInterval(() => {
    updateLiveCards(active().world, active().settings);
    if (interactive) void refresh();
  }, 3000);
}

declare global {
  interface Window {
    asciiCity: { dispatch: (event: unknown) => void; export: (includePrivate?: boolean) => string };
    __city?: {
      engine: () => CityEngine;
      live: () => CityEngine;
      paint: () => void;
      seek: (ms: number) => Promise<void>;
      liveMode: () => void;
      setMode: (interactive: boolean) => void;
      freeze: () => void;
      metrics: () => { fps: number; cost: number; uploads: number };
    };
  }
}

async function start(): Promise<void> {
  try {
    renderer = new Renderer(canvas, geometry.cw, geometry.ch);
    fitRenderer();
    if (isNative) await initializeHost();
    setMode(interactive, true);
    window.asciiCity = {
      dispatch: (event) => {
        bus.publish(event);
        updateUi();
      },
      export: (includePrivate) => serializeRecording(currentRecording(), includePrivate),
    };
    if (import.meta.env.DEV || query.has('qa'))
      window.__city = {
        engine: active,
        live: () => live,
        paint,
        seek,
        liveMode: backToLive,
        setMode,
        freeze: () => {
          busy = true;
        },
        metrics: () => ({ fps: measuredFps, cost: costAverage, uploads: renderer.uploads }),
      };
    paint();
    updateUi();
    if (isNative) await invokeHost('host_ready');
    lastFrame = performance.now();
    updateLoopRate();
  } catch (error) {
    showFailure(error instanceof Error ? error.message : '城市启动失败');
  }
}
void start();
