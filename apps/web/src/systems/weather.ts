import type { World, WeatherState, Settings } from '../world/types';
import { logEvent } from './actions';
import { DEFAULT_THRESHOLDS } from './climate-config';

const NAMES: Record<WeatherState, string> = {
  clear: '晴',
  cloudy: '多云',
  low: '低云',
  rain: '雨',
  storm: '雷暴',
  haze: '雾',
  snow: '雪',
};
export { NAMES as WEATHER_NAMES };

/** Open-Meteo WMO codes: fog and snow are distinct from rain. */
export function weatherFromCode(code: number, precip = 0): WeatherState {
  if (code >= 95) return 'storm';
  if ([71, 73, 75, 77, 85, 86].includes(code)) return 'snow';
  if ([45, 48].includes(code)) return 'haze';
  if ((code >= 51 && code <= 67) || (code >= 80 && code <= 82) || precip > 0) return 'rain';
  if (code === 3) return 'low';
  return code > 0 ? 'cloudy' : 'clear';
}

export function stepWeather(
  W: World,
  dt: number,
  S?: Pick<Settings, 'weatherMode' | 'weatherThresholds'>,
): void {
  const w = W.weather,
    head = w.historyHead;
  if (w.historyCount === 5400) {
    w.cpuSum -= w.cpuHistory[head];
    w.memSum -= w.memHistory[head];
  } else w.historyCount++;
  // Sum the stored float32 values to avoid drift between a checkpoint and a fresh replay.
  w.cpuHistory[head] = W.sig.cpu;
  w.memHistory[head] = W.sig.mem;
  w.cpuSum += w.cpuHistory[head];
  w.memSum += w.memHistory[head];
  w.historyHead = (head + 1) % 5400;
  const limits = S?.weatherThresholds ?? DEFAULT_THRESHOLDS;
  const response = 1 - Math.exp(-dt / limits.responseSeconds);
  w.cpuAverage += (W.sig.cpu - w.cpuAverage) * response;
  w.memAverage += (W.sig.mem - w.memAverage) * response;
  const cpu = w.cpuAverage,
    mem = w.memAverage;
  w.highMemorySec = mem > 0.78 ? w.highMemorySec + dt : 0;
  w.highCpuSec = cpu > 0.75 ? w.highCpuSec + dt : 0;
  let target: WeatherState = w.state;
  w.usesReal = S?.weatherMode === 'real' && w.real !== null;
  if (w.usesReal && w.real) {
    target = weatherFromCode(w.real.code, w.real.precip);
  } else {
    // A small release band avoids flicker, including for thresholds below 3%.
    const reaches = (value: number, threshold: number, held: boolean) =>
      value >= threshold - (held ? Math.min(0.03, threshold * 0.12) : 0);
    if (reaches(cpu, limits.storm, w.state === 'storm')) target = 'storm';
    else if (reaches(cpu, limits.rain, w.state === 'rain')) target = 'rain';
    else if (reaches(mem, limits.memoryFog, w.state === 'haze')) target = 'haze';
    else if (reaches(cpu, limits.cloud, w.state === 'cloudy')) target = 'cloudy';
    else target = 'clear';
  }
  if (target !== w.state && (w.usesReal || W.t - w.changedAt >= limits.holdSeconds)) {
    const wasWet = w.state === 'rain' || w.state === 'storm';
    w.state = target;
    w.changedAt = W.t;
    if (wasWet && target !== 'rain' && target !== 'storm' && W.hourNow >= 6 && W.hourNow <= 18)
      w.rainbowUntil = W.t + 90;
    logEvent(W, `天气转为${NAMES[target]}`);
  }
  const rainTarget =
    w.state === 'storm'
      ? 1
      : w.state === 'rain'
        ? w.usesReal && w.real
          ? Math.min(0.95, 0.25 + w.real.precip * 0.35)
          : 0.65
        : 0;
  w.rain += (rainTarget - w.rain) * Math.min(1, dt / 8);
  w.snow += ((w.state === 'snow' ? 0.65 : 0) - w.snow) * Math.min(1, dt / 8);
  w.lightning = Math.max(0, w.lightning - dt * 3.5);
  if (w.state === 'storm' && W.t >= w.nextLightning) {
    w.lightning = 1;
    w.nextLightning = W.t + 8 + W.rng.next() * 17;
  }
}
