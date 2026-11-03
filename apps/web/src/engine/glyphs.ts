export const GLYPHS = (() => {
  const a: string[] = [];
  for (let c = 32; c < 127; c++) a.push(String.fromCharCode(c));
  a.push(
    '·',
    '•',
    '≈',
    '‾',
    '¦',
    '°',
    '▪',
    '░',
    '▒',
    '▓',
    '█',
    '▀',
    '▄',
    '│',
    '─',
    '┌',
    '┐',
    '└',
    '┘',
    '├',
    '┤',
    '┬',
    '┴',
    '┼',
    '║',
    '═',
    '╬',
    'Λ',
    'λ',
  );
  for (let i = 0; i < 256; i++) a.push(String.fromCharCode(0x2800 + i));
  return a;
})();
export const GI = new Map(GLYPHS.map((c, i) => [c, i]));
export const BR0 = GI.get('\u2800')!;
export const gi = (c: string) => {
  const v = GI.get(c);
  return v === undefined ? 0 : v;
};
export const G_DOT = gi('.'),
  G_DASH = gi('-'),
  G_TIL = gi('~'),
  G_APX = gi('≈'),
  G_EQ = gi('='),
  G_SQ = gi('▪'),
  G_BRK = gi('¦'),
  G_MID = gi('·'),
  G_US = gi('_');
export const CODEG = [
    '0',
    '1',
    '<',
    '>',
    '{',
    '}',
    '=',
    '/',
    '*',
    '+',
    ';',
    ':',
    '(',
    ')',
    '[',
    ']',
  ].map(gi),
  GLITCHG = ['#', '!', 'x', '%', '?', '&'].map(gi);
