import { expect, test } from 'vitest';
import { characterWidth, displayWidth, truncateText } from '../src/engine/text';

test('CJK and fullwidth characters occupy two cells, symbols remain single width', () => {
  expect(displayWidth('Codex 修复')).toBe(10);
  expect(characterWidth('Ａ')).toBe(2);
  expect(characterWidth('𠀀')).toBe(2);
  expect(characterWidth('│')).toBe(1);
  expect(characterWidth('\u0301')).toBe(0);
});

test('truncation reserves a complete ellipsis and never cuts a wide glyph', () => {
  expect(truncateText('中文测试', 5)).toBe('中文…');
  expect(truncateText('中文测试', 4)).toBe('中…');
  expect(truncateText('中文', 1)).toBe('…');
  expect(truncateText('中文', 0)).toBe('');
  expect(truncateText('Codex', 5)).toBe('Codex');
});
