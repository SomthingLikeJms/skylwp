import type { World, Settings, Color } from '../world/types';
import type { GlyphAtlas } from '../engine/atlas';
import { characterWidth, truncateText } from '../engine/text';
import { CATS } from '../scenes';

export function drawText(
  W: World,
  atlas: GlyphAtlas,
  x: number,
  y: number,
  text: string,
  width: number,
  color: Color,
  emission = 0,
): void {
  if (y < 0 || y >= W.rows) return;
  const clipped = truncateText(text, width);
  for (const char of clipped) {
    const size = characterWidth(char);
    if (!size) continue;
    if (x + size > W.cols) break;
    if (x < 0) {
      x += size;
      continue;
    }
    const glyph = atlas.glyph(char);
    for (let part = 0; part < size; part++) {
      const i = y * W.cols + x + part;
      W.glyph[i] = part ? (glyph.right ?? glyph.left) : glyph.left;
      W.fr[i] = color[0];
      W.fgc[i] = color[1];
      W.fb[i] = color[2];
      W.emR[i] = color[0] * emission;
      W.emG[i] = color[1] * emission;
      W.emB[i] = color[2] * emission;
    }
    x += size;
  }
}

export function drawTextLayer(
  W: World,
  S: Settings,
  atlas: GlyphAtlas,
  interactive: boolean,
): void {
  for (const agent of W.agents) {
    if (agent.site < 0 || agent.state === 'ended') continue;
    const tower = W.towers[agent.site],
      top = W.baseY - tower.st.h;
    const amber = [1, 0.68, 0.23];
    if (S.effects > 0 && agent.state !== 'awaiting') {
      const label = agent.name === 'Claude Code' ? 'CLAUDE' : agent.name.toUpperCase();
      drawText(
        W,
        atlas,
        Math.round(tower.x + tower.w / 2 - label.length / 2),
        Math.max(0, top - 6),
        label,
        Math.max(tower.w, 16),
        agent.col,
        0.6,
      );
    }
    if (agent.state === 'awaiting') {
      const breath = 0.55 + 0.4 * (0.5 + 0.5 * Math.sin(W.t * Math.PI));
      const text = '等你确认';
      drawText(
        W,
        atlas,
        Math.max(0, Math.round(tower.x + tower.w / 2 - 4)),
        Math.max(0, top - 2),
        text,
        8,
        [amber[0] * breath, amber[1] * breath, amber[2] * breath],
        0.7,
      );
    } else if (agent.current && (interactive || W.t % 30 < 5)) {
      const text = S.privacy ? `步骤 ${agent.done}/${agent.total}` : agent.current;
      drawText(
        W,
        atlas,
        Math.round(tower.x),
        Math.max(0, top + 2),
        text,
        Math.min(16, tower.w),
        agent.col,
        0.45,
      );
    }
  }
  if (S.effects > 0) {
    const buses = [
      ['cpu', W.sig.cpu],
      ['mem', W.sig.mem],
      ['net', W.sig.net],
    ] as const;
    for (let i = 0; i < buses.length; i++) {
      const [, value] = buses[i];
      drawText(
        W,
        atlas,
        Math.floor(W.cols * (0.22 + i * 0.25)),
        W.baseY + 1,
        `·${'─'.repeat(Math.round(value * 8))}▪${'·'.repeat(8 - Math.round(value * 8))}`,
        12,
        [0.37, 0.65, 0.64],
        0.35,
      );
    }
  }
  if (W.track.title && W.t - W.track.changedAt < 5) {
    const tower = W.towers.find((t) => t.kind === 'mark' && t.key !== 'opt');
    if (tower)
      drawText(
        W,
        atlas,
        Math.max(0, tower.x - 4),
        W.baseY - Math.max(3, Math.floor(tower.h * 0.6)),
        S.privacy ? '正在播放' : `${W.track.title} ${W.track.artist}`.trim(),
        20,
        [0.86, 0.88, 1],
        0.5,
      );
  }
  if (interactive && !S.privacy)
    for (const ship of W.ships) {
      if (ship.far || ship.arriving || ship.leaving) continue;
      drawText(
        W,
        atlas,
        Math.round(ship.x + 1),
        ship.y,
        CATS[ship.cat]?.name ?? '其他',
        4,
        [0.8, 0.85, 0.95],
      );
    }
}
