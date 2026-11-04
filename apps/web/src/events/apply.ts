import type { World, Settings } from '../world/types';
import type { CityEvent } from './protocol';
import { hexColor } from './protocol';
import { handleAgentEvent } from '../systems/agents';
import { launchFirework, logEvent } from '../systems/actions';
import { CATS } from '../scenes';

export function applyEvent(W: World, S: Settings, event: CityEvent): void {
  if (event.type.startsWith('agent.')) {
    handleAgentEvent(W, event);
    return;
  }
  switch (event.type) {
    case 'sys.sample':
      Object.assign(S, event.data);
      break;
    case 'sim.activity':
      S.agentAct = event.data.value;
      break;
    case 'music.intensity':
      S.intensity = event.data.value;
      break;
    case 'clock.set':
      S.hour = event.data.hour;
      S.flow = event.data.flow;
      break;
    case 'media.state':
      S.music = event.data.playing;
      logEvent(W, S.music ? '音乐开始播放' : '音乐暂停');
      break;
    case 'media.track':
      W.track = {
        title: event.data.title,
        artist: event.data.artist,
        palette: event.data.palette.map(hexColor),
        previousPalette: W.track.palette.length ? W.track.palette : W.sc.mpal,
        changedAt: W.t,
      };
      logEvent(W, '切换了音乐，灯光开始换色');
      break;
    case 'audio.frame':
      {
        const { spectrum, ...bands } = event.data;
        Object.assign(W.audio, bands, { lastFrame: W.t });
        W.audio.spectrum.set(
          spectrum ?? [
            bands.bass,
            bands.bass,
            bands.mid,
            bands.mid,
            bands.mid,
            bands.high,
            bands.high,
          ],
        );
        if (Math.max(bands.bass, bands.mid, bands.high) > 0.01) W.audio.lastAudible = W.t;
      }
      break;
    case 'audio.beat':
      S.bpm = event.data.bpm;
      W.beatPh = Math.floor(W.beatPh) + event.data.phase;
      break;
    case 'browser.tabs':
      W.browserTabs = event.data.tabs.map((t) => ({
        id: t.id,
        cat: Math.max(
          0,
          CATS.findIndex((c) => c.name === t.cat),
        ),
      }));
      S.tabs = W.browserTabs.length;
      logEvent(W, `浏览器现在有 ${S.tabs} 个标签`);
      break;
    case 'presence': {
      const away = event.data.idleSec >= 300;
      if (away !== S.away)
        logEvent(W, away ? '你离开了电脑，城市逐渐熄灯' : '你回来了，城市亮起来');
      S.away = away;
      break;
    }
    case 'weather.real':
      W.weather.real = event.data;
      W.weather.realAt = W.t;
      break;
    case 'weather.mode':
      if (!event.data.live) W.weather.real = null;
      break;
    case 'world.effects':
      S.effects = event.data.value;
      break;
    case 'water.configure':
      S.waterMode = event.data.mode;
      S.waterSource = event.data.source;
      S.waterStrength = event.data.strength;
      break;
    case 'weather.configure':
      S.weatherMode = event.data.mode;
      S.weatherThresholds = { ...event.data.thresholds };
      logEvent(
        W,
        S.weatherMode === 'load'
          ? '城市气候跟随本机负载，月亮显示实况天气'
          : '城市气候跟随实况天气',
      );
      break;
    case 'desktop.click':
      launchFirework(
        W,
        event.data.x * W.cols,
        Math.max(2, Math.min(W.wy - 4, event.data.y * W.rows)),
        [
          [0.35, 0.9, 0.85],
          [1, 0.66, 0.34],
          [0.72, 0.62, 1],
        ][Math.floor(W.rng.next() * 3)],
      );
      logEvent(W, '桌面点击放了一束烟花');
      break;
    case 'world.firework':
      launchFirework(W, event.data.x * W.cols, event.data.y * W.wy, hexColor(event.data.color));
      logEvent(W, '你在天空放了一束烟花');
      break;
    case 'world.scene':
      S.scene = event.data.scene;
      break;
  }
}
