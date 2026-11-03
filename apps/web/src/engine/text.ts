import { eastAsianWidth } from 'get-east-asian-width';

/** Ambiguous characters stay one cell, matching the original symbol atlas. */
export function characterWidth(character: string): 0 | 1 | 2 {
  const cp = character.codePointAt(0) ?? 0;
  if (
    cp < 32 ||
    (cp >= 0x7f && cp < 0xa0) ||
    /\p{Mark}/u.test(character) ||
    cp === 0x200d ||
    (cp >= 0xfe00 && cp <= 0xfe0f)
  )
    return 0;
  return eastAsianWidth(cp, { ambiguousAsWide: false });
}

export function displayWidth(text: string): number {
  let width = 0;
  for (const char of text) width += characterWidth(char);
  return width;
}

export function truncateText(text: string, maxWidth: number): string {
  if (maxWidth <= 0) return '';
  if (displayWidth(text) <= maxWidth) return text;
  let out = '',
    width = 0;
  for (const char of text) {
    const size = characterWidth(char);
    if (!size) continue;
    if (width + size > maxWidth - 1) break;
    out += char;
    width += size;
  }
  return out + '…';
}
