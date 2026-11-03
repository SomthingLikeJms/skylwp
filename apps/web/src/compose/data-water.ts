import type { World, Settings } from '../world/types';
import { gi } from '../engine/glyphs';

interface Stream {
  key: string;
  ascii: string;
  binary: string;
  glyphs: Uint16Array;
  readouts: Uint16Array[];
}
const cache = new WeakMap<World, Stream>();
const asciiSafe = (text: string) =>
  Array.from(text.slice(0, 64), (c) =>
    c.codePointAt(0)! < 127 && c.codePointAt(0)! >= 32
      ? c
      : `U+${c.codePointAt(0)!.toString(16).toUpperCase()}`,
  ).join('');

/** The bits are ASCII bytes of the same measured status shown in text mode. */
export function waterData(W: World, S: Settings): Stream {
  const parts: string[] = [];
  if (S.waterSource !== 'agent')
    parts.push(`CPU=${Math.round(W.sig.cpu * 100)}% MEM=${Math.round(W.sig.mem * 100)}%`);
  if (S.waterSource !== 'cpu') {
    let active = false;
    for (const a of W.agents) {
      if (a.state === 'ended' || a.state === 'idle') continue;
      active = true;
      parts.push(
        `${asciiSafe(a.src).toUpperCase()} ${a.state === 'awaiting' ? 'WAIT' : a.phase.toUpperCase()} ${a.tool && W.t < a.toolUntil ? a.tool.toUpperCase() : ''} STEP=${a.done}/${a.total} CALLS=${a.calls}${S.privacy || !a.current ? '' : ` TASK=${asciiSafe(a.current)}`}`,
      );
    }
    if (!active) parts.push('AGENT=IDLE');
  }
  const ascii = parts.join(' | ') + '  ',
    key = `${S.waterMode}:${ascii}`;
  const previous = cache.get(W);
  if (previous?.key === key) return previous;
  const binary = Array.from(ascii, (c) => c.charCodeAt(0).toString(2).padStart(8, '0')).join('');
  const stream = S.waterMode === 'ascii' ? ascii : binary;
  const labels: string[] = [];
  if (S.waterSource !== 'agent') {
    const cpu = Math.round(W.sig.cpu * 100),
      mem = Math.round(W.sig.mem * 100);
    labels.push(
      S.waterMode === 'binary'
        ? `CPU ${cpu.toString(2).padStart(8, '0')}  MEM ${mem.toString(2).padStart(8, '0')}`
        : `CPU ${cpu}%  MEM ${mem}%`,
    );
  }
  if (S.waterSource !== 'cpu') {
    let latest = null as World['agents'][number] | null;
    for (const a of W.agents)
      if (
        a.state !== 'ended' &&
        a.state !== 'idle' &&
        (!latest || a.lastActive > latest.lastActive)
      )
        latest = a;
    if (latest) {
      const action =
        latest.state === 'awaiting'
          ? 'WAIT INPUT'
          : latest.tool && W.t < latest.toolUntil
            ? latest.tool.toUpperCase()
            : latest.phase === 'thinking'
              ? 'THINK'
              : latest.phase === 'responding'
                ? 'WRITE'
                : 'WORK';
      labels.push(
        `${asciiSafe(latest.src).toUpperCase()} ${action}  ${latest.total ? `${latest.done}/${latest.total}` : `${latest.calls} CALLS`}`,
      );
    } else labels.push('AGENT IDLE');
  }
  const value = {
    key,
    ascii,
    binary,
    glyphs: Uint16Array.from(stream, (c) => gi(c)),
    readouts: labels.map((label) => Uint16Array.from(label, (c) => gi(c))),
  };
  cache.set(W, value);
  return value;
}

export function drawDataRipples(W: World, S: Settings): void {
  if (S.waterMode === 'mirror' || S.waterStrength <= 0) return;
  const depth = Math.max(1, W.promY - W.wy),
    readouts = waterData(W, S).readouts;
  for (let k = 0; k < readouts.length; k++) {
    const text = readouts[k],
      maxWidth = Math.min(text.length, Math.floor(W.cols * 0.38));
    const x0 = Math.floor(W.cols * (k ? 0.56 : 0.12) + Math.sin(W.t * 0.13 + k * 2) * 1.5);
    const y = W.wy + Math.floor(depth * (k ? 0.47 : 0.7));
    if (y >= W.promY - 1) continue;
    const light = (0.1 + S.waterStrength * 0.26) * (0.9 + Math.sin(W.t * 0.23 + k) * 0.1);
    for (let j = 0; j < maxWidth && x0 + j < W.cols; j++) {
      const i = y * W.cols + x0 + j;
      W.glyph[i] = text[j];
      W.fr[i] = light * 0.58;
      W.fgc[i] = light;
      W.fb[i] = light * 0.94;
    }
  }
}
