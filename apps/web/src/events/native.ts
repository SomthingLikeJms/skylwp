import type { CityEvent } from './protocol';
import type { WidgetPositions } from '../ui/widgets';
import type {
  WeatherThresholds,
  WeatherMode,
  WaterMode,
  WaterSource,
} from '../systems/climate-config';

export interface HostConfig {
  system: boolean;
  audio: boolean;
  media: boolean;
  agents: boolean;
  browser: boolean;
  weather: boolean;
  weatherCity: string;
  effects: number;
  desktopFireworks: boolean;
  waterMode: WaterMode;
  waterSource: WaterSource;
  waterStrength: number;
  weatherMode: WeatherMode;
  weatherThresholds: WeatherThresholds;
  widgetPositions: WidgetPositions;
  privacy: boolean;
  pauseWhenCovered: boolean;
  scene: 'bund' | 'nyc' | 'hk';
  theme: 'harbor' | 'phosphor' | 'ink';
  density: 7 | 9 | 12;
  intensity: number;
}
export interface HostStatus {
  sources: Record<string, string>;
  counters: Record<string, number>;
  mode: string;
  paused: boolean;
  config: HostConfig;
}
export interface HostBoot {
  watermark: number;
  config: HostConfig;
  events: CityEvent[];
  status: HostStatus;
  autostart: boolean;
}
export interface HostControl {
  kind: 'state' | 'privacy' | 'error';
  interactive?: boolean;
  paused?: boolean;
  battery?: boolean;
  privacy?: boolean;
  on?: boolean;
  message?: string;
}
interface Tauri {
  core: { invoke<T>(command: string, args?: Record<string, unknown>): Promise<T> };
  event: {
    listen<T>(name: string, listener: (event: { payload: T }) => void): Promise<() => void>;
  };
}
const tauri = (window as unknown as { __TAURI__?: Tauri }).__TAURI__;
export const isNative = Boolean(tauri);
export function invokeHost<T = void>(command: string, args?: Record<string, unknown>): Promise<T> {
  if (!tauri) return Promise.reject(new Error('桌面宿主未连接'));
  return tauri.core.invoke<T>(command, args);
}
export async function connectHost(
  events: (batch: CityEvent[]) => void,
  control: (state: HostControl) => void,
): Promise<HostBoot> {
  if (!tauri) throw new Error('桌面宿主未连接');
  let watermark = 0;
  await tauri.event.listen<(CityEvent & { seq?: number })[]>('city:events', (event) =>
    events(event.payload.filter((e) => e.seq === undefined || e.seq > watermark)),
  );
  await tauri.event.listen<HostControl>('city:control', (event) => control(event.payload));
  const boot = await invokeHost<HostBoot>('host_boot');
  watermark = boot.watermark ?? 0;
  return boot;
}
