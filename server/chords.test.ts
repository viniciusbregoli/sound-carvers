import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { chordsIn, findGuitarShapes, fitsChord, guitarLookup, isChordLine, parseChord, pianoVoicing, powerChordShapes, QUALITIES } from '../web/src/lib/chords.ts';

test('reads chord symbols the way cifras write them', () => {
  const q = (s: string) => parseChord(s)?.quality;
  assert.equal(q('C'), 'major');
  assert.equal(q('Am'), 'minor');
  assert.equal(q('C7M'), 'maj7');
  assert.equal(q('F#m7(b5)'), 'm7b5');
  assert.equal(q('Bm7(9)'), 'm9');
  assert.equal(q('E7(#9)'), '7#9');
  assert.equal(q('A9'), 'add9', 'Brazilian A9 is an added ninth, no seventh');
  assert.equal(q('A7(9)'), '9');
  assert.equal(q('D4'), 'sus4');
  assert.equal(q('A7/4'), '7sus4');
  assert.equal(q('C6/9'), '69');
  assert.equal(q('B°'), 'dim');
  assert.equal(q('E♭'), 'major');
  assert.equal(q('Am7M'), 'mmaj7');
  assert.equal(q('B5(9)'), '5add9');
  assert.equal(q('Am6(9)'), 'm69');
  assert.equal(q('C7M(#5)'), 'maj7#5');
  // The rest of the commonly used qualities (Chordonomicon), in cifra and American spellings.
  assert.equal(q('Cadd11'), 'add11');
  assert.equal(q('Am(11)'), 'madd11');
  assert.equal(q('A7sus2'), '7sus2');
  assert.equal(q('Am13'), 'm13');
  assert.equal(q('Cmaj7sus2'), 'maj7sus2');
  assert.equal(q('A4(9)'), 'sus4add9');
  assert.equal(q('G7/4(9)'), '9sus4');
  assert.equal(q('E7(b13)'), '7b13');
  assert.equal(q('Bº'), 'dim');
  // Extension combinations are read piece by piece, and named when the database knows those notes.
  assert.equal(q('C7(9/13)'), '13');
  assert.equal(q('Am7(9)(11)'), 'm11');
  assert.equal(q('C7M(9)(#11)'), '0-4-7-11-14-18');
  assert.equal(q('G7(4)(b9)'), '0-5-7-10-13');
  assert.equal(q('E7(#9)(b13)'), '0-4-7-10-15-20');
  assert.equal(q('D7(9-)'), '7b9');
  assert.equal(q('Cmaj9sus4'), '0-5-7-11-14');
  assert.equal(q('C7(b5)(9)'), '0-4-6-10-14');
  assert.equal(q('Cm(add4)'), 'madd11');
  assert.equal(parseChord('C7(9/Q)'), null);
  assert.equal(parseChord('Cfoo'), null);
  assert.equal(parseChord('Hm'), null);
  assert.equal(parseChord('Dumb'), null);

  const slash = parseChord('F#/A#')!;
  assert.deepEqual([slash.root, slash.quality, slash.bass, slash.bassName], [6, 'major', 10, 'A#']);
  assert.equal(parseChord('Bb')!.root, 10);
});

test('finds the chords a sheet uses, only on chord lines', () => {
  const sheet = '[Intro] Am  F  C  G  (2x)\n\n[Verso]\nAm          F\nE agora a vida segue\nC7M    G/B   (Am)\nA casa é de Ana';
  assert.deepEqual(chordsIn(sheet), ['Am', 'F', 'C', 'G', 'C7M', 'G/B']);
  assert.ok(isChordLine('B - D#m - E'));
  assert.ok(isChordLine('A7/4  D'));
  assert.ok(isChordLine('A7/4(9)  Bº  C7(9/13)'));
  assert.deepEqual(chordsIn('CΔ  FΔ7  Bo  Co7'), ['CΔ', 'FΔ7', 'Bo', 'Co7'], 'Δ and o spellings count as chords');
  assert.deepEqual(['CΔ', 'FΔ7', 'Bo', 'Co7'].map((c) => parseChord(c)?.quality), ['maj7', 'maj7', 'dim', 'dim7']);
  assert.ok(!isChordLine('E agora a vida segue'));
  assert.ok(!isChordLine(`A${'1'.repeat(60)}.`), 'long digit runs fail fast instead of hanging');
});

test('piano voicings fit two octaves, bass lowest', () => {
  assert.deepEqual(pianoVoicing(parseChord('C')!), { notes: [0, 4, 7], bass: null });
  assert.deepEqual(pianoVoicing(parseChord('G/B')!), { notes: [14, 19, 23], bass: 11 });
  assert.deepEqual(pianoVoicing(parseChord('F#/A#')!), { notes: [13, 18, 22], bass: 10 });
  for (const symbol of ['B13', 'B7M(9)', 'Bm7(11)', 'A#/B', 'C/B', 'Bb6/9']) {
    const { notes, bass } = pianoVoicing(parseChord(symbol)!);
    assert.ok(Math.max(...notes) <= 23, symbol);
    if (bass !== null) assert.ok(notes.every((n) => n > bass), symbol);
  }
});

test('guitar shapes come from the database, minus the ones that play wrong notes', () => {
  const require = createRequire(import.meta.url);
  const db = JSON.parse(readFileSync(require.resolve('@tombatossals/chords-db/lib/guitar.json'), 'utf8')) as {
    chords: Record<string, { suffix: string; positions: { midi: number[] }[] }[]>;
  };
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const symbols = { major: '', minor: 'm', dim: '°', dim7: '°7', aug: '+', sus2: 'sus2', sus4: '4', '7sus4': '7/4', '6': '6', '69': '6/9', '7': '7', '7b5': '7(b5)', aug7: '7(#5)', '9': '7(9)', '7b9': '7(b9)', '7#9': '7(#9)', '11': '7(11)', '13': '7(13)', maj7: '7M', maj9: '7M(9)', maj13: '7M(13)', 'maj7#5': '7M(#5)', add9: '9', m6: 'm6', m69: 'm6/9', m7: 'm7', m7b5: 'm7(b5)', m9: 'm7(9)', m11: 'm7(11)', mmaj7: 'm7M', madd9: 'm(9)' } as Record<string, string>;
  const searched = ['sus4add9', '7sus2', '9sus4', '7#11', '7b13', 'maj7#11', 'maj7sus2', 'maj7sus4', 'add11', 'm13', 'madd11'];
  assert.deepEqual(Object.keys(symbols).sort(), Object.keys(QUALITIES).filter((q) => q !== '5' && q !== '5add9' && !searched.includes(q)).sort(), 'every database quality is checked');
  const missing: string[] = [];
  let shown = 0;
  for (const root of names) {
    for (const [quality, suffix] of Object.entries(symbols)) {
      for (const bass of quality === 'major' || quality === 'minor' ? ['', '/E', '/G#'] : ['']) {
        const chord = parseChord(root + suffix + bass)!;
        assert.equal(chord.quality, quality, root + suffix);
        const { key, suffixes } = guitarLookup(chord);
        const positions = suffixes.map((s) => db.chords[key]?.find((c) => c.suffix === s)?.positions.filter((p) => fitsChord(chord, p.midi, s.includes('/')))).find((p) => p?.length);
        if (positions) shown++;
        else missing.push(chord.symbol);
      }
    }
  }
  // Only the database's broken entries go without a diagram (they show their notes instead).
  assert.deepEqual(missing, ['C#7(11)', 'Em(9)']);
  assert.equal(shown + missing.length, 12 * 35, "12 keys × 31 qualities, plus 2 slash chords each for major and minor");
  assert.ok(fitsChord(parseChord('C')!, [48, 52, 55, 60, 64]));
  assert.ok(!fitsChord(parseChord('C')!, [48, 52, 55, 58]), 'a B♭ is not in C major');
  const cOverE = parseChord('C/E')!;
  assert.ok(fitsChord(cOverE, [52, 55, 60, 64], true), 'C/E with E lowest');
  assert.ok(!fitsChord(cOverE, [48, 52, 55, 60, 64], true), 'a slash shape with C lowest is just C');
  assert.ok(!fitsChord(cOverE, [], true));
  assert.ok(!fitsChord(parseChord('C/B')!, [48, 52, 55, 59]), 'the plain stand-in for C/B leaves the B to the bass');
});

test('power chords get built shapes, lowest on the neck first', () => {
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  for (const root of names) {
    for (const suffix of ['5', '5(9)']) {
      const chord = parseChord(root + suffix)!;
      const shapes = powerChordShapes(chord);
      assert.equal(shapes.length, suffix === '5' ? 3 : 2, root + suffix);
      for (const s of shapes) {
        assert.ok(fitsChord(chord, s.midi), root + suffix);
        assert.equal(new Set(s.midi.map((n) => n % 12)).size, chord.intervals.length, `${root + suffix} sounds every chord tone`);
        assert.ok(Math.max(...s.frets) <= 5, `${root + suffix} fits the 5-fret box`);
      }
    }
  }
  assert.deepEqual(powerChordShapes(parseChord('E5')!)[0].frets, [0, 2, 2, -1, -1, -1]);
  assert.deepEqual(powerChordShapes(parseChord('A5')!)[0].frets, [-1, 0, 2, 2, -1, -1]);
  assert.deepEqual(powerChordShapes(parseChord('D5')!)[0].frets, [-1, -1, 0, 2, 3, -1]);
  const b9 = powerChordShapes(parseChord('B5(9)')!)[0];
  assert.deepEqual([b9.frets, b9.baseFret], [[-1, 1, 3, 5, -1, -1], 2], 'B5(9): x-2-4-6, drawn from fret 2');
  assert.deepEqual(powerChordShapes(parseChord('C')!), []);
});

test('shapes are found for chords the database lacks, and they play only chord tones', () => {
  const names = ['C', 'C#', 'D', 'Eb', 'E', 'F', 'F#', 'G', 'Ab', 'A', 'Bb', 'B'];
  const show = (p: { frets: number[]; baseFret: number }) => p.frets.map((f) => (f < 0 ? 'x' : f === 0 ? 0 : f + p.baseFret - 1)).join('');
  const started = performance.now();
  for (const root of names) {
    for (const quality of Object.keys(QUALITIES).filter((q) => q !== '5' && q !== '5add9')) {
      for (const bass of ['', '/E']) {
        const chord = parseChord(root + (quality === 'major' ? '' : quality === 'minor' ? 'm' : quality) + bass);
        if (!chord) continue;
        const shapes = findGuitarShapes(chord);
        if (!bass) assert.ok(shapes.length, `${chord.symbol} gets a shape`);
        for (const p of shapes) {
          assert.ok(fitsChord(chord, p.midi, !!bass), `${chord.symbol} ${show(p)}`);
          assert.ok(Math.max(...p.frets) <= 5, `${chord.symbol} ${show(p)} fits the box`);
          assert.ok(p.frets.filter((f) => f > 0).length <= 4 || p.barres.length, `${chord.symbol} ${show(p)} fits four fingers`);
        }
      }
    }
  }
  assert.ok(performance.now() - started < 10_000, 'fast enough to run in the browser');
  // The open shapes everyone knows come first.
  assert.equal(show(findGuitarShapes(parseChord('C')!)[0]), 'x32010');
  assert.equal(show(findGuitarShapes(parseChord('D')!)[0]), 'xx0232');
  assert.equal(show(findGuitarShapes(parseChord('A7sus2')!)[0]), 'x02000');
  assert.equal(show(findGuitarShapes(parseChord('C/E')!)[0]), '032010');
  assert.deepEqual(findGuitarShapes(parseChord('F')!)[0].barres, [1]);
  // The two the database gets wrong now have shapes.
  assert.ok(findGuitarShapes(parseChord('C#7(11)')!).length);
  assert.ok(findGuitarShapes(parseChord('Em(9)')!).length);
});
