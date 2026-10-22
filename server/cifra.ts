// Turns chord sheets from elsewhere into the Cifra tab's format: plain text, chords on the line above the lyrics,
// aligned with spaces, `[Section]` lines as labels.

/** Tabs to spaces (8-column stops, like a browser `<pre>`), so chords stay over the right syllable. */
function expandTabs(line: string) {
  let out = '';
  for (const ch of line) out += ch === '\t' ? ' '.repeat(8 - (out.length % 8)) : ch;
  return out;
}

/** Same line endings and spacing everywhere; at most one blank line in a row; no blank lines at either end. */
function tidy(lines: string[]) {
  return lines
    .map((l) => expandTabs(l).replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '');
}

const capoLine = (capo: number) => `Capotraste na ${capo}ª casa`;

// Ultimate Guitar lists the fingerings first ("Em7   0-2-2-0-3-3"); the band knows their chords.
const FINGERING = /^\s*\S+\s+(?:[x\d]{1,2}-){5}[x\d]{1,2}\s*$|^\s*\S+\s+[x\d]{6}\s*$/i;

/** Ultimate Guitar's markup (`[ch]Em7[/ch]` inside `[tab]…[/tab]`) as a plain sheet, with the capo on top. */
export function ugSheet(content: string, capo = 0) {
  const lines = content
    .replace(/\[\/?(?:tab|ch)\]/g, '')
    .split(/\r\n?|\n/)
    .filter((l) => !FINGERING.test(l));
  const body = tidy(lines);
  if (!body) return '';
  return capo > 0 && capo < 20 ? `${capoLine(capo)}\n\n${body}` : body;
}

// Bits of the Cifra Club page that come along when you select the whole sheet.
const PAGE_JUNK = [/^parte \d+ de \d+$/i, /^composição de\b/i, /^colaboração e revisão\b/i, /^essa informação está errada\?/i, /^nos avise\.?$/i];
const TOM = /^\s*tom:\s*([A-G](?:#|b|♯|♭)?m?)(?=\s|\(|$)/i;

/**
 * Cleans a chord sheet copied from Cifra Club (or anywhere): no tabs, non-breaking or zero-width spaces, page
 * leftovers or runs of blank lines. Also reads the key from its "Tom:" line.
 */
export function cleanCifra(raw: string): { text: string; key: string | null } {
  const lines = raw
    .replace(/ /g, ' ')
    .replace(/[​-‍﻿]/g, '')
    .split(/\r\n?|\n/)
    .filter((l) => !PAGE_JUNK.some((re) => re.test(l.trim())));
  const tom = lines.map((l) => TOM.exec(l)).find(Boolean);
  const key = tom ? tom[1][0].toUpperCase() + tom[1].slice(1).replace('#', '♯').replace(/^b/, '♭') : null;
  return { text: tidy(lines), key };
}
