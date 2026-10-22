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

const ENTITIES: Record<string, string> = {
  amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ', ordf: 'ª', ordm: 'º', deg: '°', middot: '·', times: '×',
  hellip: '…', ndash: '–', mdash: '—', lsquo: '‘', rsquo: '’', ldquo: '“', rdquo: '”', laquo: '«', raquo: '»',
  bull: '•', iexcl: '¡', iquest: '¿', szlig: 'ß', sharp: '♯', flat: '♭', natur: '♮',
};
const ACCENTS: Record<string, string> = { acute: '\u0301', grave: '\u0300', circ: '\u0302', tilde: '\u0303', uml: '\u0308', cedil: '\u0327', ring: '\u030a' };
/** HTML entities, including the accented letters (`&atilde;`) that UG's names and sheets come with. */
export const unescapeHtml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    const accent = /^([a-z])(acute|grave|circ|tilde|uml|cedil|ring)$/i.exec(e);
    return accent ? (accent[1] + ACCENTS[accent[2]]).normalize('NFC') : (ENTITIES[e] ?? m);
  });

const capoLine = (capo: number) => `Capotraste na ${capo}ª casa`;

// Ultimate Guitar lists the fingerings first ("Em7   0-2-2-0-3-3"); the band knows their chords.
const FINGERING = /^\s*\S+\s+(?:[x\d]{1,2}-){5}[x\d]{1,2}\s*$|^\s*\S+\s+[x\d]{6}\s*$/i;

/**
 * Ultimate Guitar's markup (`[ch]Em7[/ch]` inside `[tab]…[/tab]`) as a plain sheet, with the capo on top. The text
 * itself is still HTML-escaped (`1&ordf; casa`).
 */
export function ugSheet(content: string, capo = 0) {
  const lines = unescapeHtml(content)
    .replace(/\[\/?(?:tab|ch)\]/g, '')
    .split(/\r\n?|\n/)
    .filter((l) => !FINGERING.test(l));
  const body = tidy(lines);
  if (!body) return '';
  // Brazilian sheets on UG often say it themselves.
  const saysCapo = /\bcapo(?:traste)?\b/i.test(body);
  return capo > 0 && capo < 20 && !saysCapo ? `${capoLine(capo)}\n\n${body}` : body;
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
