import { useEffect, useMemo, useState } from 'react';
import guitarUrl from '@tombatossals/chords-db/lib/guitar.json?url';
import { chordsIn, findGuitarShapes, fitsChord, guitarLookup, noteName, parseChord, pianoVoicing, powerChordShapes, prefersFlats, type Chord, type GuitarShape } from '../lib/chords';

type Instrument = 'guitar' | 'piano';
type GuitarDb = { chords: Record<string, { suffix: string; positions: GuitarShape[] }[]> };

const INSTRUMENT_KEY = 'sc-chord-instrument';
const OPEN_KEY = 'sc-chords-open';

// Browser storage can be blocked (some private modes) or full; the preference then just isn't remembered.
function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function store(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Keep going with the in-memory choice.
  }
}

// The fingering database (~240 KB, cached by the browser) only loads once someone opens a sheet with chords.
let guitarDb: Promise<GuitarDb> | null = null;
function loadGuitarDb() {
  guitarDb ??= fetch(guitarUrl)
    .then((r) => (r.ok ? (r.json() as Promise<GuitarDb>) : Promise.reject(new Error(`${r.status}`))))
    .catch((err) => {
      guitarDb = null;
      throw err;
    });
  return guitarDb;
}

function useGuitarDb() {
  const [db, setDb] = useState<GuitarDb | 'error' | null>(null);
  useEffect(() => {
    let live = true;
    loadGuitarDb().then(
      (d) => live && setDb(d),
      () => live && setDb('error'),
    );
    return () => {
      live = false;
    };
  }, []);
  return db;
}

/** Diagrams for every chord a sheet uses, on guitar or piano (the choice sticks on this device). */
export function ChordDiagrams({ text, tuning }: { text: string; tuning: string }) {
  const chords = useMemo(() => chordsIn(text).map(parseChord).filter((c): c is Chord => !!c), [text]);
  const [instrument, setInstrument] = useState<Instrument>(() => (stored(INSTRUMENT_KEY) === 'piano' ? 'piano' : 'guitar'));
  const [open, setOpen] = useState(() => stored(OPEN_KEY) !== 'closed');
  if (!chords.length) return null;

  const pick = (next: Instrument) => {
    setInstrument(next);
    store(INSTRUMENT_KEY, next);
  };
  const retuned = instrument === 'guitar' && tuning && tuning !== 'Padrão';

  return (
    <details
      className="chord-diagrams notes-disclosure"
      open={open}
      onToggle={(e) => {
        const now = e.currentTarget.open;
        setOpen(now);
        store(OPEN_KEY, now ? 'open' : 'closed');
      }}
    >
      <summary className="section-title">Acordes ({chords.length})</summary>
      <div className="chord-diagrams-body">
        <div className="segmented chord-instrument" role="radiogroup" aria-label="Instrumento">
          {(['guitar', 'piano'] as const).map((i) => (
            <label key={i} className="segment">
              <input type="radio" name="chord-instrument" value={i} checked={instrument === i} onChange={() => pick(i)} />
              {i === 'guitar' ? 'Violão' : 'Piano'}
            </label>
          ))}
        </div>
        {retuned && <p className="hint">Formas na afinação padrão. A música usa {tuning}.</p>}
        <ul className={`chord-list is-${instrument}`} role="list">
          {chords.map((c) => (
            <li key={c.symbol}>{instrument === 'guitar' ? <GuitarChord chord={c} /> : <PianoChord chord={c} />}</li>
          ))}
        </ul>
      </div>
    </details>
  );
}

const notesOf = (chord: Chord) => {
  const flats = prefersFlats(chord);
  return [...new Set(chord.intervals.map((i) => noteName(chord.root + i, flats)))].join(' · ');
};

function GuitarChord({ chord }: { chord: Chord }) {
  const db = useGuitarDb();
  const [index, setIndex] = useState(0);
  // Power chords are built; otherwise the database's shapes, which are hand-checked, come first. A slash chord it
  // lacks gets a shape found with that bass; anything still missing gets one found for the plain chord.
  const found = useMemo(() => {
    const built = powerChordShapes(chord);
    if (built.length) return { positions: built, slash: false };
    if (!db) return null;
    const fromDb = (suffix: string) =>
      db === 'error' ? [] : (db.chords[key]?.find((c) => c.suffix === suffix)?.positions.filter((p) => fitsChord(chord, p.midi, suffix.includes('/'))) ?? []);
    const { key, suffixes } = guitarLookup(chord);
    const plain = suffixes[suffixes.length - 1];
    for (const suffix of suffixes.slice(0, -1)) {
      const positions = fromDb(suffix);
      if (positions.length) return { positions, slash: true };
    }
    const hasBass = chord.bass !== null && chord.bass !== chord.root;
    if (hasBass) {
      const positions = findGuitarShapes(chord);
      if (positions.length) return { positions, slash: true };
    }
    const positions = fromDb(plain);
    if (positions.length) return { positions, slash: !hasBass };
    const searched = findGuitarShapes({ ...chord, bass: null });
    return searched.length ? { positions: searched, slash: !hasBass } : null;
  }, [db, chord]);

  const bassNote = chord.bassName && !found?.slash ? `baixo em ${chord.bassName}` : null;
  if (!found) {
    return (
      <figure className="chord-card">
        <div className="chord-shape is-empty" aria-hidden>
          {db ? '?' : '…'}
        </div>
        <figcaption>
          <span className="chord-name">{chord.symbol}</span>
          <span className="chord-notes">{db ? notesOf(chord) : 'Carregando…'}</span>
        </figcaption>
      </figure>
    );
  }
  const { positions } = found;
  const n = index % positions.length;
  return (
    <figure className="chord-card">
      <button
        type="button"
        className="chord-shape"
        onClick={() => setIndex(n + 1)}
        disabled={positions.length < 2}
        aria-label={`${chord.symbol}, posição ${n + 1} de ${positions.length}${positions.length > 1 ? '. Toque para ver outra.' : ''}`}
      >
        <GuitarSvg position={positions[n]} />
      </button>
      <figcaption>
        <span className="chord-name">{chord.symbol}</span>
        {positions.length > 1 && (
          <span className="chord-notes" aria-hidden>
            {n + 1}/{positions.length}
          </span>
        )}
        {bassNote && <span className="chord-notes">{bassNote}</span>}
      </figcaption>
    </figure>
  );
}

// Strings start at x = 16, leaving room on the left for the fret number of shapes up the neck.
const STRING_X = (s: number) => 16 + s * 12;
const FRET_Y = (f: number) => 22 + f * 14;

/** A chord box: low E on the left, 5 frets, dots with finger numbers, barres, × for muted and ○ for open strings. */
function GuitarSvg({ position: p }: { position: GuitarShape }) {
  return (
    <svg viewBox="0 0 88 96" className="guitar-svg" aria-hidden>
      {p.baseFret > 1 ? (
        <text x={8} y={FRET_Y(0.5) + 3} className="svg-fret-label">
          {p.baseFret}
        </text>
      ) : (
        <line x1={STRING_X(0)} x2={STRING_X(5)} y1={FRET_Y(0)} y2={FRET_Y(0)} className="svg-nut" />
      )}
      {[0, 1, 2, 3, 4, 5].map((f) => (
        <line key={`f${f}`} x1={STRING_X(0)} x2={STRING_X(5)} y1={FRET_Y(f)} y2={FRET_Y(f)} className="svg-fret" />
      ))}
      {[0, 1, 2, 3, 4, 5].map((s) => (
        <line key={`s${s}`} x1={STRING_X(s)} x2={STRING_X(s)} y1={FRET_Y(0)} y2={FRET_Y(5)} className="svg-string" />
      ))}
      {p.frets.map((f, s) =>
        f <= 0 ? (
          <text key={`m${s}`} x={STRING_X(s)} y={FRET_Y(0) - 5} className="svg-marker">
            {f < 0 ? '×' : '○'}
          </text>
        ) : null,
      )}
      {p.barres.map((b) => {
        const strings = p.frets.flatMap((f, s) => (f === b ? [s] : []));
        if (strings.length < 2) return null;
        const from = STRING_X(Math.min(...strings));
        const to = STRING_X(Math.max(...strings));
        return <rect key={`b${b}`} x={from - 5} y={FRET_Y(b - 0.5) - 5} width={to - from + 10} height={10} rx={5} className="svg-dot" />;
      })}
      {p.frets.map((f, s) =>
        f > 0 ? (
          <g key={`d${s}`}>
            <circle cx={STRING_X(s)} cy={FRET_Y(f - 0.5)} r={5} className="svg-dot" />
            {p.fingers[s] > 0 && (
              <text x={STRING_X(s)} y={FRET_Y(f - 0.5) + 3} className="svg-finger">
                {p.fingers[s]}
              </text>
            )}
          </g>
        ) : null,
      )}
    </svg>
  );
}

const WHITE = [0, 2, 4, 5, 7, 9, 11];
const BLACK = [1, 3, 6, 8, 10];
const KEY_W = 12;
// Every voicing fits two octaves (see pianoVoicing), so all keyboards are the same size.
const OCTAVES = 2;

function PianoChord({ chord }: { chord: Chord }) {
  const { notes, bass } = pianoVoicing(chord);
  const on = new Set(notes);
  const flats = prefersFlats(chord);
  const whites = Array.from({ length: OCTAVES * 7 }, (_, i) => Math.floor(i / 7) * 12 + WHITE[i % 7]);
  const blacks = Array.from({ length: OCTAVES * 5 }, (_, i) => Math.floor(i / 5) * 12 + BLACK[i % 5]);
  const blackX = (n: number) => (Math.floor(n / 12) * 7 + WHITE.indexOf((n % 12) - 1) + 1) * KEY_W - 4;
  const cls = (n: number, base: string) => `${base}${n === bass ? ' is-bass' : on.has(n) ? ' is-on' : ''}`;
  const spelled = notes.map((n) => noteName(n, flats));
  return (
    <figure className="chord-card">
      <svg viewBox={`0 0 ${OCTAVES * 7 * KEY_W + 1} 50`} className="piano-svg" aria-hidden>
        {whites.map((n, i) => (
          <rect key={n} x={i * KEY_W + 0.5} y={0.5} width={KEY_W} height={48} rx={2} className={cls(n, 'key-white')} />
        ))}
        {blacks.map((n) => (
          <rect key={n} x={blackX(n)} y={0.5} width={8} height={30} rx={1.5} className={cls(n, 'key-black')} />
        ))}
      </svg>
      <figcaption>
        <span className="chord-name">{chord.symbol}</span>
        <span className="chord-notes">
          {bass !== null && `${noteName(bass, flats)} no baixo · `}
          {spelled.join(' · ')}
        </span>
      </figcaption>
    </figure>
  );
}
