export interface WeatherThresholds {
  cloud: number;
  rain: number;
  storm: number;
  memoryFog: number;
  responseSeconds: number;
  holdSeconds: number;
}
export type WeatherMode = 'load' | 'real';
export type WaterMode = 'binary' | 'ascii' | 'mirror';
export type WaterSource = 'combined' | 'cpu' | 'agent';

export const DEFAULT_THRESHOLDS: WeatherThresholds = {
  cloud: 0.2,
  rain: 0.45,
  storm: 0.7,
  memoryFog: 0.85,
  responseSeconds: 8,
  holdSeconds: 5,
};

export function validThresholds(value: unknown): value is WeatherThresholds {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const d = value as Record<string, unknown>;
  const keys = Object.keys(DEFAULT_THRESHOLDS);
  if (
    Object.keys(d).length !== keys.length ||
    !keys.every((k) => typeof d[k] === 'number' && Number.isFinite(d[k]))
  )
    return false;
  const t = value as WeatherThresholds;
  return (
    t.cloud >= 0 &&
    t.cloud < t.rain &&
    t.rain < t.storm &&
    t.storm <= 1 &&
    t.memoryFog >= 0 &&
    t.memoryFog <= 1 &&
    t.responseSeconds >= 1 &&
    t.responseSeconds <= 120 &&
    t.holdSeconds >= 0 &&
    t.holdSeconds <= 120
  );
}
