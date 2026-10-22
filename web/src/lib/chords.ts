// Chord symbols as they appear in cifras: spotting chord lines, and reading a symbol into notes for the diagrams.
// No imports, so the server tests can exercise it directly.

// A chord: root, accidental, quality, extensions like 7M, m7(b5), sus4, add9, and an optional bass note (or the
// Brazilian 7/4, 6/9). One digit per repetition: `\d+` inside the outer `*` backtracks exponentially on a long digit
// run that then fails.
const CHORD = /^\(?[A-G][#b♯♭]?(?:maj|min|m|M|dim|aug|sus|add|°|ø|o|Δ|\+|-)?(?:\d|maj|M|add|sus|[#b♯♭+-]|\([^)\s]*\))*(?:\/(?:[A-G][#b♯♭]?|\d{1,2}))?\)?$/;
// Bar lines, dashes and repeat marks that sit between chords.
const FILLER = /^(?:\|+:?|:\|+|-+|–|—|x\d+|\d+x|\(\d*x\d*\)|%|\.{2,}|\/)$/i;

const tokens = (line: string) => line.trim().split(/\s+/).filter(Boolean);

/** True for lines made only of chords (and bar lines, dashes, repeat marks). */
export function isChordLine(line: string) {
  const t = tokens(line);
  return t.some((x) => CHORD.test(x)) && t.every((x) => CHORD.test(x) || FILLER.test(x));
}

const SECTION = /^\s*\[[^\]]{1,40}\]\s*(.*)$/;

/** The distinct chords a sheet uses, in order of first appearance (only from chord-only lines, so lyrics never count). */
export function chordsIn(text: string): string[] {
  const seen = new Set<string>();
  for (const raw of text.replace(/\r\n?/g, '\n').split('\n')) {
    const line = SECTION.exec(raw)?.[1] ?? raw;
    if (!isChordLine(line)) continue;
    for (const t of tokens(line)) {
      // "(Am)" is an optional chord: draw Am. "Bm7(9)" keeps its parentheses.
      const chord = /^\(.*\)$/.test(t) && CHORD.test(t.slice(1, -1)) ? t.slice(1, -1) : t;
      if (parseChord(chord)) seen.add(chord);
    }
  }
  return [...seen];
}

const LETTERS: Record<string, number> = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

/** Pitch class (0 = C) of a note name like "F#", "Bb", "E♭". */
export function pitchClass(name: string): number | null {
  const m = /^([A-G])([#b♯♭]?)$/.exec(name);
  if (!m) return null;
  const shift = m[2] === '#' || m[2] === '♯' ? 1 : m[2] === 'b' || m[2] === '♭' ? -1 : 0;
  return (LETTERS[m[1]] + shift + 12) % 12;
}

/** Chord qualities we know, as intervals in semitones above the root. Names match the guitar chord database. */
export const QUALITIES: Record<string, number[]> = {
  major: [0, 4, 7],
  minor: [0, 3, 7],
  '5': [0, 7],
  '5add9': [0, 7, 14],
  dim: [0, 3, 6],
  dim7: [0, 3, 6, 9],
  aug: [0, 4, 8],
  sus2: [0, 2, 7],
  sus4: [0, 5, 7],
  '7sus4': [0, 5, 7, 10],
  '6': [0, 4, 7, 9],
  '69': [0, 4, 7, 9, 14],
  '7': [0, 4, 7, 10],
  '7b5': [0, 4, 6, 10],
  aug7: [0, 4, 8, 10],
  '9': [0, 4, 7, 10, 14],
  '7b9': [0, 4, 7, 10, 13],
  '7#9': [0, 4, 7, 10, 15],
  '11': [0, 4, 7, 10, 14, 17],
  '13': [0, 4, 7, 10, 14, 21],
  maj7: [0, 4, 7, 11],
  maj9: [0, 4, 7, 11, 14],
  maj13: [0, 4, 7, 11, 14, 21],
  'maj7#5': [0, 4, 8, 11],
  add9: [0, 4, 7, 14],
  m6: [0, 3, 7, 9],
  m69: [0, 3, 7, 9, 14],
  m7: [0, 3, 7, 10],
  m7b5: [0, 3, 6, 10],
  m9: [0, 3, 7, 10, 14],
  m11: [0, 3, 7, 10, 14, 17],
  mmaj7: [0, 3, 7, 11],
  madd9: [0, 3, 7, 14],
};

// How cifras spell each quality, after removing parentheses and spaces. Brazilian conventions win where they differ
// from American ones: "A9" is A with an added ninth (no seventh), "7M" is major seventh, "4" and "7/4" are suspended.
const ALIASES: Record<string, string> = {
  '': 'major', M: 'major', maj: 'major',
  m: 'minor', min: 'minor', '-': 'minor',
  '5': '5', '59': '5add9', '5(9)': '5add9', '5add9': '5add9',
  '°': 'dim', o: 'dim', dim: 'dim', '°7': 'dim7', o7: 'dim7', dim7: 'dim7',
  '+': 'aug', aug: 'aug', '5+': 'aug', '#5': 'aug', '+5': 'aug',
  sus: 'sus4', sus4: 'sus4', '4': 'sus4', sus2: 'sus2', '2': 'sus2',
  '7sus4': '7sus4', '7sus': '7sus4', '74': '7sus4', '7/4': '7sus4', '7(4)': '7sus4',
  '6': '6', '69': '69', '6/9': '69', '6(9)': '69',
  '7': '7', '7b5': '7b5', '7-5': '7b5', '7#5': 'aug7', '7+5': 'aug7', aug7: 'aug7', '+7': 'aug7',
  '79': '9', '7/9': '9', '7(9)': '9', '7b9': '7b9', '7-9': '7b9', '7#9': '7#9', '7+9': '7#9',
  '711': '11', '7(11)': '11', '11': '11', '713': '13', '7(13)': '13', '13': '13',
  '7M': 'maj7', maj7: 'maj7', M7: 'maj7', 'Δ': 'maj7', 'Δ7': 'maj7', '7M9': 'maj9', '7M(9)': 'maj9', maj9: 'maj9',
  '7M13': 'maj13', '7M(13)': 'maj13', '7M(9)(13)': 'maj13', maj13: 'maj13',
  '7M#5': 'maj7#5', '7M(#5)': 'maj7#5', '7M+5': 'maj7#5', '7M(+5)': 'maj7#5', 'maj7#5': 'maj7#5',
  '9': 'add9', add9: 'add9', '(9)': 'add9', add2: 'add9',
  m6: 'm6', m69: 'm69', 'm6/9': 'm69', 'm6(9)': 'm69', m7: 'm7', min7: 'm7', '-7': 'm7',
  m7b5: 'm7b5', 'm7(b5)': 'm7b5', 'm7-5': 'm7b5', ø: 'm7b5', ø7: 'm7b5',
  m79: 'm9', 'm7(9)': 'm9', m711: 'm11', 'm7(11)': 'm11', m11: 'm11',
  m7M: 'mmaj7', mmaj7: 'mmaj7', mM7: 'mmaj7', 'm(7M)': 'mmaj7',
  m9: 'madd9', 'm(9)': 'madd9', madd9: 'madd9', madd2: 'madd9',
};

export type Chord = {
  symbol: string;
  root: number;
  rootName: string;
  quality: string;
  intervals: number[];
  bass: number | null;
  bassName: string | null;
};

/** Reads "F#m7(b5)", "C7M", "A7/4", "G/B"…; null when it isn't a chord we can draw. */
export function parseChord(symbol: string): Chord | null {
  const m = /^([A-G][#b♯♭]?)(.*?)(?:\/([A-G][#b♯♭]?))?$/.exec(symbol.replace(/\s/g, ''));
  if (!m) return null;
  const root = pitchClass(m[1]);
  // Try the spelling as written, then without parentheses: m7(b5) and m7b5 mean the same.
  const rest = m[2].replace(/♯/g, '#').replace(/♭/g, 'b');
  const quality = ALIASES[rest] ?? ALIASES[rest.replace(/[()]/g, '')];
  if (root === null || !quality) return null;
  const bass = m[3] ? pitchClass(m[3]) : null;
  return {
    symbol,
    root,
    rootName: m[1].replace('♯', '#').replace('♭', 'b'),
    quality,
    intervals: QUALITIES[quality],
    bass,
    bassName: m[3] ? m[3].replace('♯', '#').replace('♭', 'b') : null,
  };
}

const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];
const FLAT_NAMES = ['C', 'Db', 'D', 'Eb', 'E', 'F', 'Gb', 'G', 'Ab', 'A', 'Bb', 'B'];

/** Spells a pitch class in the chord's own flavour: flats for flat roots (and F), sharps otherwise. */
export function noteName(pc: number, flats: boolean) {
  return (flats ? FLAT_NAMES : SHARP_NAMES)[((pc % 12) + 12) % 12];
}
export const prefersFlats = (chord: Chord) => chord.rootName.includes('b') || chord.rootName === 'F';

/**
 * Piano keys to press on a 2-octave keyboard, as semitones above its first C. Plain chords sit in root position
 * (extensions fold down an octave when they'd run off the end). Slash chords put the bass lowest and each chord tone
 * at its first key above it, like a left-hand bass under a right-hand chord.
 */
export function pianoVoicing(chord: Chord): { notes: number[]; bass: number | null } {
  const pcs = chord.intervals.map((i) => (chord.root + i) % 12);
  if (chord.bass !== null && chord.bass !== chord.root) {
    const bass = chord.bass;
    const notes = pcs.map((pc) => (pc > bass ? pc : pc + 12));
    return { notes: [...new Set(notes)].sort((a, b) => a - b), bass };
  }
  let notes = chord.intervals.map((i) => chord.root + i);
  if (notes.some((n) => n > 23)) notes = chord.intervals.map((i) => chord.root + (i >= 12 ? i - 12 : i));
  return { notes: [...new Set(notes)].sort((a, b) => a - b), bass: null };
}

// Key names in the guitar chord database, by pitch class.
const GUITAR_KEYS = ['C', 'Csharp', 'D', 'Eb', 'E', 'F', 'Fsharp', 'G', 'Ab', 'A', 'Bb', 'B'];

/**
 * Where to find a chord in the guitar database: its key, and suffixes to try in order. Slash chords exist there
 * only over major and minor triads (and are spelled with sharps or flats), so the plain chord is the fallback.
 */
export function guitarLookup(chord: Chord): { key: string; suffixes: string[] } {
  const suffixes: string[] = [];
  if (chord.bass !== null && chord.bass !== chord.root && (chord.quality === 'major' || chord.quality === 'minor')) {
    const prefix = chord.quality === 'minor' ? 'm/' : '/';
    for (const name of new Set([noteName(chord.bass, false), noteName(chord.bass, true)])) suffixes.push(prefix + name);
  }
  suffixes.push(chord.quality);
  return { key: GUITAR_KEYS[chord.root], suffixes };
}

/**
 * Whether a fingering (as MIDI notes) only sounds notes of the chord: the database has a few wrong shapes, and we'd
 * rather show none than teach the band a wrong one. Thirteenth chords may keep the eleventh, as guitar voicings do.
 * A slash shape must also put the bass note lowest; a plain shape standing in for a slash chord is checked as the
 * plain chord (the card then says which bass to add).
 */
export function fitsChord(chord: Chord, midi: number[], slashShape = false) {
  const allowed = new Set(chord.intervals.map((i) => (chord.root + i) % 12));
  if (chord.quality === '13') allowed.add((chord.root + 5) % 12);
  if (slashShape) {
    if (chord.bass === null || !midi.length || Math.min(...midi) % 12 !== chord.bass) return false;
    allowed.add(chord.bass);
  }
  return midi.every((n) => allowed.has(n % 12));
}

/** A fingering in the guitar database's format: frets per string from low E (-1 muted, 0 open), relative to `baseFret`. */
export type GuitarShape = { frets: number[]; fingers: number[]; baseFret: number; barres: number[]; midi: number[] };

// Standard tuning, low E to high E, as MIDI notes.
const OPEN_STRINGS = [40, 45, 50, 55, 59, 64];

/**
 * Power chords (A5, B5(9)) aren't in the database: they're one movable shape, so we build it with the root on the low
 * E, A or D string and the fifth and octave (or ninth) on the next two strings. Lowest on the neck first.
 */
export function powerChordShapes(chord: Chord): GuitarShape[] {
  if (chord.quality !== '5' && chord.quality !== '5add9') return [];
  const ninth = chord.quality === '5add9';
  const shapes: (GuitarShape & { fret: number })[] = [];
  for (const string of ninth ? [0, 1] : [0, 1, 2]) {
    const root = (chord.root - (OPEN_STRINGS[string] % 12) + 12) % 12;
    // The G-to-B string is a third, not a fourth, so the octave from the D string sits one fret further up.
    const top = root + (ninth ? 4 : string === 2 ? 3 : 2);
    const played = [root, root + 2, top];
    const fingers = root === 0 ? [0, 1, ninth ? 3 : 2] : ninth ? [1, 2, 4] : [1, 3, 4];
    const baseFret = top <= 4 ? 1 : root;
    const frets = [-1, -1, -1, -1, -1, -1];
    const fingerList = [0, 0, 0, 0, 0, 0];
    played.forEach((f, i) => {
      frets[string + i] = baseFret === 1 ? f : f - baseFret + 1;
      fingerList[string + i] = fingers[i];
    });
    shapes.push({ frets, fingers: fingerList, baseFret, barres: [], midi: played.map((f, i) => OPEN_STRINGS[string + i] + f), fret: root });
  }
  return shapes.sort((a, b) => a.fret - b.fret).map(({ fret: _, ...shape }) => shape);
}
