import type { World, Settings, Entity } from '../world/types';
import { LM, CATS } from '../scenes';
import { fogParams } from '../world/light';
import { fmtH } from '../systems/actions';
import { weatherFromCode, WEATHER_NAMES } from '../systems/weather';
const pct = (v: number) => Math.round(v * 100) + '%';
function weatherText(W: World) {
  const real = W.weather.real;
  if (real)
    return `${real.city ?? '城市'} ${Math.round(real.tempC)}°C，${WEATHER_NAMES[weatherFromCode(real.code, real.precip)]}，风速 ${Math.round(real.windKph ?? 0)} km/h`;
  const e = W.env;
  if (e.rain > 0.2) return '本机负载超过下雨阈值';
  if (fogParams(W).deck > 0.3) return '云层压得很低，内存占用偏高';
  if (e.heat > 0.3) return '空气发烫，CPU 正在高负载';
  return '天气晴朗';
}
export function describe(W: World, S: Settings, info: Entity) {
  const sc = W.sc;
  switch (info.kind) {
    case 'tower': {
      const T = info.ref;
      if (T.kind === 'mark') {
        const L = LM[T.key];
        return { title: L.name, lines: [L.desc] };
      }
      const a = T.owner >= 0 ? W.agents[T.owner] : null;
      if (a) {
        const lines = [];
        if (a.state === 'awaiting') lines.push('等你确认，楼顶的琥珀灯正在呼吸');
        else if (T.err > 0) lines.push('刚刚报错，外墙变成红色乱码');
        else if (a.total)
          lines.push(
            `${a.done} / ${a.total} 步，${S.privacy ? '任务详情已隐藏' : a.current || '步骤已完成'}`,
          );
        else lines.push(`${Math.floor(T.h)} 层，外墙滚动着这个会话的代码`);
        lines.push('由这个 Agent 的会话盖起来');
        return { title: `${a.name} 的楼`, lines };
      }
      if (T.site) return { title: '待建地块', lines: ['等下一个 Agent 会话来加盖'] };
      return { title: T.layer === 0 ? sc.far : '写字楼', lines: ['窗灯跟着本机时间亮起和熄灭'] };
    }
    case 'wheel':
      return { title: '摩天轮', lines: ['转速和灯色跟着音乐'] };
    case 'ridge':
      return { title: '太平山', lines: ['山上的灯是半山的住宅'] };
    case 'bridge':
      return { title: '布鲁克林大桥', lines: [`桥上的车流跟着网络，现在 ${pct(W.sig.net)}`] };
    case 'plane':
      return { title: '航班', lines: ['网络越忙，飞过的航班越多'] };
    case 'laser':
      return { title: '激光秀', lines: [`跟着音乐节拍扫动，${S.bpm} BPM`] };
    case 'ship': {
      const s = info.ref;
      return {
        title: `浏览器标签：${CATS[s.cat].name}`,
        lines: [
          s.leaving
            ? '标签页关了，船正在离开'
            : s.arriving
              ? '新开的标签页，船正在驶来'
              : '在水面上漂着',
          '船窗的颜色代表网页类别',
        ],
      };
    }
    case 'walker': {
      const w = info.ref,
        a = W.agents[w.agent];
      return {
        title: `${a.name} 的居民`,
        lines: [
          w.run > 0
            ? '刚刚报错了，正在慌乱奔跑'
            : w.state === 'stand'
              ? '停下来看对岸'
              : '在步道上散步',
          '每个会话派出两名居民',
        ],
      };
    }
    case 'moon':
      return {
        title: 'LED 天气月亮',
        lines: W.weather.real
          ? [weatherText(W), '晴天微笑，下雨流泪，雪天发冷，雷暴惊讶', '表情跟随系统城市天气']
          : [`本机时间 ${fmtH(S.hour)}`, '等待实况天气后显示天气表情'],
      };
    case 'sun':
      return {
        title: '太阳',
        lines: [`色温跟着 CPU，现在 ${pct(W.sig.cpu)}`, `本机时间 ${fmtH(S.hour)}`],
      };
    case 'sky':
      return { title: '天空', lines: [`本机时间 ${fmtH(S.hour)}`, weatherText(W)] };
    case 'cloud':
      return {
        title: '云',
        lines: [
          W.weather.usesReal
            ? '云层跟随实况天气'
            : `本机负载气候：${WEATHER_NAMES[W.weather.state]}，阈值可在控制台调整`,
          `内存 ${pct(W.sig.mem)}`,
        ],
      };
    case 'water':
      return {
        title: sc.water,
        lines: [
          S.waterMode === 'mirror'
            ? '普通城市倒影'
            : `${S.waterMode === 'binary' ? '01 二进制' : 'ASCII 状态流'}，来自 CPU、内存和 Agent 任务，内容可在控制台选择`,
          `浪速跟着网络，现在 ${pct(W.sig.net)}`,
          `水上 ${W.ships.filter((s) => !s.leaving).length} 艘船，对应打开的标签页`,
        ],
      };
    case 'shore':
      return { title: '对岸的堤岸', lines: ['一串路灯倒映在水里'] };
    case 'prom':
    case 'rail':
      return { title: sc.shore, lines: ['你站的位置，居民在这里散步'] };
    case 'lamp':
      return { title: '路灯', lines: ['跟着本机时间亮起'] };
  }
  return null;
}
