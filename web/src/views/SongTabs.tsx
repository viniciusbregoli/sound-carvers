import { useEffect, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, Download, ExternalLink, Pencil, Search, Trash2, Upload } from 'lucide-react';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { useToast } from '../components/Toast';
import { api } from '../lib/api';
import { useBand } from '../lib/store';
import { plural } from '../lib/format';
import type { FileKind, Song, SongFile, SongTexts, TextKind } from '../lib/types';

export type SongTab = 'overview' | TextKind | FileKind;

export const SONG_TABS: { id: SongTab; label: string }[] = [
  { id: 'overview', label: 'Geral' },
  { id: 'lyrics', label: 'Letra' },
  { id: 'chords', label: 'Cifra' },
  { id: 'tab', label: 'Tab' },
  { id: 'audio', label: 'Áudios' },
  { id: 'image', label: 'Imagens' },
];

export const isTextTab = (tab: SongTab): tab is TextKind => tab === 'lyrics' || tab === 'chords' || tab === 'tab';

export const tabId = (tab: SongTab) => `song-tab-${tab}`;
export const panelId = (tab: SongTab) => `song-panel-${tab}`;

/** ARIA tabs: arrow keys move between tabs (and open them), Home/End jump to the ends. */
export function SongTabBar({ song, tab, onChange }: { song: Song; tab: SongTab; onChange: (tab: SongTab) => void }) {
  const { state } = useBand();
  const refs = useRef(new Map<SongTab, HTMLButtonElement>());
  // On a phone the last tabs sit past the edge; keep the open one in view.
  useEffect(() => {
    refs.current.get(tab)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [tab]);
  const count = (kind: FileKind) => state.files.filter((f) => f.songId === song.id && f.kind === kind).length;

  const onKeyDown = (e: KeyboardEvent) => {
    const i = SONG_TABS.findIndex((t) => t.id === tab);
    const next = { ArrowRight: i + 1, ArrowLeft: i - 1, Home: 0, End: SONG_TABS.length - 1 }[e.key];
    if (next === undefined) return;
    e.preventDefault();
    const target = SONG_TABS[(next + SONG_TABS.length) % SONG_TABS.length].id;
    onChange(target);
    refs.current.get(target)?.focus();
  };

  return (
    <div className="song-tabs" role="tablist" aria-label="Partes da música" onKeyDown={onKeyDown}>
      {SONG_TABS.map((t) => {
        const n = t.id === 'audio' || t.id === 'image' ? count(t.id) : 0;
        const has = isTextTab(t.id) && !!song.texts[t.id];
        return (
          <button
            key={t.id}
            ref={(el) => void (el ? refs.current.set(t.id, el) : refs.current.delete(t.id))}
            type="button"
            role="tab"
            id={tabId(t.id)}
            aria-controls={panelId(t.id)}
            aria-selected={tab === t.id}
            tabIndex={tab === t.id ? 0 : -1}
            className="song-tab"
            onClick={() => onChange(t.id)}
          >
            {t.label}
            {n > 0 && <span className="song-tab-count">{n}</span>}
            {has && (
              <>
                <span className="song-tab-dot" aria-hidden />
                <span className="visually-hidden">, preenchida</span>
              </>
            )}
          </button>
        );
      })}
    </div>
  );
}

/**
 * Loads a song's sheets when a sheet tab is open, and again whenever a bandmate changes one (the version stamps in
 * `song.texts` move). `remember` records our own saves so they don't trigger a refetch of what we just wrote.
 */
export function useSongTexts(song: Song, wanted: boolean) {
  const [texts, setTexts] = useState<SongTexts | null>(null);
  const [failed, setFailed] = useState(false);
  const loaded = useRef<Partial<Record<TextKind, number>>>({});
  const stamps = JSON.stringify(song.texts);

  useEffect(() => {
    if (!wanted) return;
    const current = JSON.parse(stamps) as Partial<Record<TextKind, number>>;
    if (texts && JSON.stringify(loaded.current) === JSON.stringify(current)) return;
    let live = true;
    api<SongTexts>('GET', `/api/songs/${song.id}/texts`)
      .then((t) => {
        if (!live) return;
        loaded.current = current;
        setTexts(t);
        setFailed(false);
      })
      .catch(() => live && setFailed(true));
    return () => {
      live = false;
    };
    // `texts` is deliberately left out: it changes on our own saves, which `remember` already accounts for.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [song.id, stamps, wanted]);

  const remember = (kind: TextKind, body: string, updatedAt: number | null) => {
    const { [kind]: _, ...rest } = loaded.current;
    loaded.current = updatedAt ? { ...rest, [kind]: updatedAt } : rest;
    setTexts((t) => (t ? { ...t, [kind]: body } : t));
  };

  return { texts, failed, remember };
}

const TEXT_COPY: Record<TextKind, { empty: string; write: string; placeholder: string; hint: string }> = {
  lyrics: {
    empty: 'Ainda não tem letra.',
    write: 'Escrever a letra',
    placeholder: '[Verso]\nPrimeira linha da letra…\n\n[Refrão]\n…',
    hint: 'Marque as partes com colchetes, como [Verso] e [Refrão]. Linhas só com acordes ficam destacadas.',
  },
  chords: {
    empty: 'Ainda não tem cifra.',
    write: 'Escrever a cifra',
    placeholder: '[Intro] Am  F  C  G\n\n[Verso]\nAm          F\nPrimeira linha da letra…',
    hint: 'Acordes na linha de cima da letra, alinhados com espaços. Marque as partes com colchetes, como [Refrão].',
  },
  tab: {
    empty: 'Ainda não tem tablatura.',
    write: 'Colar a tablatura',
    placeholder: 'e|-----0-----|\nB|---1---1---|\nG|-2-------2-|',
    hint: 'Cole a tablatura como texto; ela aparece em fonte de largura fixa, do jeito que foi colada.',
  },
};

/** One sheet tab: reads nicely by default, turns into an autosaving editor on "Editar". */
export function TextPanel({
  song,
  kind,
  value,
  failed,
  onSaved,
}: {
  song: Song;
  kind: TextKind;
  value: string | undefined;
  failed: boolean;
  onSaved: (kind: TextKind, body: string, updatedAt: number | null) => void;
}) {
  const { saveText, lookupLyrics } = useBand();
  const toast = useToast();
  const copy = TEXT_COPY[kind];
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [searching, setSearching] = useState(false);
  const latest = useRef('');
  const dirty = useRef(false);
  const timer = useRef<number>(undefined);
  const textarea = useRef<HTMLTextAreaElement>(null);

  const flush = async () => {
    window.clearTimeout(timer.current);
    if (!dirty.current) return;
    dirty.current = false;
    const body = latest.current;
    setSaveState('saving');
    try {
      onSaved(kind, body, await saveText(song.id, kind, body));
      setSaveState('saved');
    } catch {
      dirty.current = true;
      setSaveState('error');
    }
  };
  // Save whatever is pending when the tab or the sheet closes.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => void flushRef.current(), []);

  const edit = () => {
    setDraft(value ?? '');
    latest.current = value ?? '';
    setSaveState('idle');
    setEditing(true);
  };
  useEffect(() => {
    if (editing) textarea.current?.focus({ preventScroll: true });
  }, [editing]);

  const done = async () => {
    await flush();
    if (!dirty.current) setEditing(false);
  };

  const search = async () => {
    setSearching(true);
    try {
      if (!(await lookupLyrics(song.id))) toast.info('Não achamos a letra dessa música. Cole ou escreva a letra.');
    } catch {
      // Store showed the error.
    } finally {
      setSearching(false);
    }
  };

  const panel = (children: ReactNode) => (
    <div role="tabpanel" id={panelId(kind)} aria-labelledby={tabId(kind)} className="song-panel is-compact">
      {children}
    </div>
  );

  if (editing) {
    return panel(
      <>
        <div className="sheet-toolbar">
          <span className={`save-state${saveState === 'error' ? ' is-error' : ''}`} aria-live="polite">
            {saveState === 'saving' ? 'Salvando…' : saveState === 'saved' ? 'Tudo salvo' : saveState === 'error' ? 'Não salvou. Confira sua conexão.' : ''}
          </span>
          <button type="button" className="btn btn-primary btn-sm" onClick={() => void done()}>
            Pronto
          </button>
        </div>
        <label htmlFor={`sheet-${kind}`} className="visually-hidden">
          {SONG_TABS.find((t) => t.id === kind)?.label}
        </label>
        <textarea
          id={`sheet-${kind}`}
          ref={textarea}
          className={`sheet-editor${kind === 'lyrics' ? '' : ' is-mono'}`}
          wrap={kind === 'lyrics' ? 'soft' : 'off'}
          spellCheck={kind === 'lyrics'}
          placeholder={copy.placeholder}
          value={draft}
          aria-describedby={`sheet-${kind}-hint`}
          onChange={(e) => {
            setDraft(e.target.value);
            latest.current = e.target.value;
            dirty.current = true;
            window.clearTimeout(timer.current);
            timer.current = window.setTimeout(() => void flush(), 1200);
          }}
          onBlur={() => void flush()}
        />
        <p id={`sheet-${kind}-hint`} className="hint">
          {copy.hint}
        </p>
      </>,
    );
  }

  if (value === undefined) {
    return panel(<p className="hint sheet-loading">{failed ? 'Não deu para carregar. Confira sua conexão.' : 'Carregando…'}</p>);
  }

  if (!value.trim()) {
    return panel(
      <div className="empty-state sheet-empty">
        <p className="muted">{copy.empty}</p>
        <div className="row">
          <button type="button" className="btn btn-secondary" onClick={edit}>
            <Pencil size={16} aria-hidden />
            {copy.write}
          </button>
          {kind === 'lyrics' && !song.original && (
            <button type="button" className="btn btn-ghost" onClick={() => void search()} disabled={searching}>
              <Search size={16} aria-hidden />
              {searching ? 'Buscando…' : 'Buscar na internet'}
            </button>
          )}
        </div>
      </div>,
    );
  }

  return panel(
    <>
      <div className="sheet-toolbar">
        <button type="button" className="btn btn-ghost btn-sm" onClick={edit}>
          <Pencil size={16} aria-hidden />
          Editar
        </button>
      </div>
      <SheetView kind={kind} text={value} />
    </>,
  );
}

// A chord: root, accidental, quality, extensions like 7M, m7(b5), sus4, add9, and an optional bass note.
const CHORD = /^\(?[A-G][#b♯♭]?(?:maj|min|m|M|dim|aug|sus|add|°|ø|\+|-)?(?:\d+|maj|M|add|sus|[#b♯♭+-]|\([^)\s]*\))*(?:\/[A-G][#b♯♭]?)?\)?$/;
// Bar lines, dashes and repeat marks that sit between chords.
const FILLER = /^(?:\|+:?|:\|+|-+|–|—|x\d+|\d+x|\(\d*x\d*\)|%|\.{2,}|\/)$/i;

/** True for lines made only of chords (and bar lines, dashes, repeat marks). */
export function isChordLine(line: string) {
  const tokens = line.trim().split(/\s+/).filter(Boolean);
  return tokens.some((t) => CHORD.test(t)) && tokens.every((t) => CHORD.test(t) || FILLER.test(t));
}

const SECTION = /^\s*\[([^\]]{1,40})\]\s*(.*)$/;

function SheetView({ kind, text }: { kind: TextKind; text: string }) {
  if (kind === 'tab') return <pre className="sheet sheet-mono">{text}</pre>;
  const lines = text.replace(/\r\n?/g, '\n').replace(/\s+$/, '').split('\n');
  const line = (content: string, key: string) => (
    <p key={key} className={isChordLine(content) ? 'sheet-line sheet-chords' : 'sheet-line'}>
      {content}
    </p>
  );
  return (
    <div className={`sheet ${kind === 'chords' ? 'sheet-mono' : 'sheet-lyrics'}`}>
      {lines.map((l, i) => {
        const section = SECTION.exec(l);
        if (section) {
          return [
            <p key={i} className="sheet-section">
              {section[1]}
            </p>,
            section[2] ? line(section[2], `${i}-rest`) : null,
          ];
        }
        if (!l.trim()) return <div key={i} className="sheet-gap" aria-hidden />;
        return line(l, String(i));
      })}
    </div>
  );
}

// ---------------- audio and images ----------------

const LIMITS: Record<FileKind, number> = { audio: 60_000_000, image: 15_000_000 };

const EXTENSION_TYPES: Record<string, string> = {
  mp3: 'audio/mpeg', m4a: 'audio/mp4', aac: 'audio/aac', wav: 'audio/wav', ogg: 'audio/ogg', oga: 'audio/ogg', opus: 'audio/ogg',
  webm: 'audio/webm', flac: 'audio/flac', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
};

// What the server accepts; anything else gets a second chance from its file extension.
const SENDABLE = new Set([
  'audio/mpeg', 'audio/mp3', 'audio/mp4', 'audio/x-m4a', 'audio/aac', 'audio/wav', 'audio/x-wav', 'audio/wave', 'audio/ogg', 'audio/opus',
  'audio/webm', 'audio/flac', 'audio/x-flac', 'image/jpeg', 'image/png', 'image/webp', 'image/gif',
]);

/** Phones sometimes leave `file.type` empty (or exotic) for voice notes; fall back to the extension. */
function fileType(file: File, kind: FileKind) {
  const type = file.type.split(';')[0].toLowerCase();
  if (SENDABLE.has(type) && type.startsWith(`${kind}/`)) return type;
  const guess = EXTENSION_TYPES[file.name.split('.').pop()?.toLowerCase() ?? ''];
  return guess?.startsWith(`${kind}/`) ? guess : null;
}

/** Phone photos are huge; shrink anything big to a sharp-enough JPEG before sending it over mobile data. */
async function shrinkImage(file: File, type: string): Promise<{ blob: Blob; type: string }> {
  if (type === 'image/gif' || file.size < 1_500_000) return { blob: file, type };
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const scale = Math.min(1, 2400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.86));
    return blob && blob.size < file.size ? { blob, type: 'image/jpeg' } : { blob: file, type };
  } catch {
    return { blob: file, type };
  }
}

export function formatBytes(bytes: number) {
  if (bytes < 1_000_000) return `${Math.max(1, Math.round(bytes / 1000))} KB`;
  return `${(bytes / 1_000_000).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} MB`;
}

const formatDate = (ms: number) => new Date(ms).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' });

const FILE_COPY: Record<FileKind, { add: string; empty: string; accept: string }> = {
  audio: {
    add: 'Enviar áudio',
    empty: 'Suba a gravação do ensaio, uma demo ou a versão de referência para todo mundo ouvir.',
    accept: 'audio/*,.mp3,.m4a,.aac,.wav,.ogg,.opus,.flac',
  },
  image: {
    add: 'Enviar imagem',
    empty: 'Fotos da cifra no papel, o mapa da música, prints da tablatura…',
    accept: 'image/jpeg,image/png,image/webp,image/gif',
  },
};

type Pending = { key: string; name: string; progress: number };

export function FilesPanel({ song, kind }: { song: Song; kind: FileKind }) {
  const { state, uploadFile } = useBand();
  const toast = useToast();
  const copy = FILE_COPY[kind];
  const input = useRef<HTMLInputElement>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const items = state.files.filter((f) => f.songId === song.id && f.kind === kind);

  const send = async (list: FileList) => {
    const files = [...list];
    const queue = files.map((f, i) => ({ key: `${Date.now()}-${i}`, name: f.name.replace(/\.[^.]+$/, '') || f.name, progress: 0 }));
    setPending((p) => [...p, ...queue]);
    const done = (key: string) => setPending((p) => p.filter((x) => x.key !== key));
    for (const [i, file] of files.entries()) {
      const { key, name } = queue[i];
      const type = fileType(file, kind);
      if (!type) {
        toast.error(`“${file.name}” não é ${kind === 'audio' ? 'um áudio' : 'uma imagem'} que dá para enviar.`);
        done(key);
        continue;
      }
      const { blob, type: sendType } = kind === 'image' ? await shrinkImage(file, type) : { blob: file, type };
      if (blob.size > LIMITS[kind]) {
        toast.error(`“${file.name}” tem ${formatBytes(blob.size)}; o limite é ${formatBytes(LIMITS[kind])}.`);
        done(key);
        continue;
      }
      try {
        await uploadFile(song.id, blob, sendType, name, (progress) => setPending((p) => p.map((x) => (x.key === key ? { ...x, progress } : x))));
      } catch {
        // Store showed the error.
      }
      done(key);
    }
  };

  return (
    <div role="tabpanel" id={panelId(kind)} aria-labelledby={tabId(kind)} className="song-panel is-compact">
      <input
        ref={input}
        type="file"
        accept={copy.accept}
        multiple
        hidden
        onChange={(e) => {
          if (e.target.files?.length) void send(e.target.files);
          e.target.value = '';
        }}
      />
      {items.length > 0 || pending.length > 0 ? (
        <div className="sheet-toolbar">
          <span className="hint">{kind === 'audio' ? plural(items.length, 'áudio', 'áudios') : plural(items.length, 'imagem', 'imagens')}</span>
          <button type="button" className="btn btn-secondary btn-sm" onClick={() => input.current?.click()}>
            <Upload size={16} aria-hidden />
            {copy.add}
          </button>
        </div>
      ) : (
        <div className="empty-state sheet-empty">
          <p className="muted">{copy.empty}</p>
          <div className="row">
            <button type="button" className="btn btn-secondary" onClick={() => input.current?.click()}>
              <Upload size={16} aria-hidden />
              {copy.add}
            </button>
          </div>
        </div>
      )}
      {pending.length > 0 && (
        <ul className="uploads" role="list" aria-label="Enviando">
          {pending.map((p) => (
            <li key={p.key} className="upload-row">
              <span className="upload-name">{p.name}</span>
              <progress max={1} value={p.progress} aria-label={`Enviando ${p.name}`} />
            </li>
          ))}
        </ul>
      )}
      {kind === 'audio' ? <AudioList files={items} /> : <ImageGrid files={items} />}
    </div>
  );
}

/** The file's name, edited in place like the song title; saves on blur or Enter. */
function FileName({ file, className = '' }: { file: SongFile; className?: string }) {
  const { renameFile } = useBand();
  const [value, setValue] = useState(file.name);
  useEffect(() => {
    setValue(file.name);
  }, [file.name]);
  const commit = () => {
    const name = value.trim();
    if (!name) setValue(file.name);
    else if (name !== file.name) void renameFile(file.id, name).catch(() => {});
  };
  return (
    <input
      className={`file-name-input ${className}`}
      aria-label="Nome do arquivo"
      maxLength={120}
      value={value}
      onChange={(e) => setValue(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
    />
  );
}

function FileMeta({ file }: { file: SongFile }) {
  const { state } = useBand();
  const who = state.members.find((m) => m.id === file.createdBy)?.name;
  return <span className="file-meta">{[who, formatDate(file.createdAt), formatBytes(file.size)].filter(Boolean).join(' · ')}</span>;
}

function DeleteFile({ file, onDeleted }: { file: SongFile; onDeleted?: () => void }) {
  const { deleteFile } = useBand();
  const [confirming, setConfirming] = useState(false);
  return (
    <>
      <button type="button" className="icon-btn icon-btn-sm icon-btn-danger" aria-label={`Apagar ${file.name}`} onClick={() => setConfirming(true)}>
        <Trash2 size={16} aria-hidden />
      </button>
      <ConfirmDialog
        open={confirming}
        onClose={() => setConfirming(false)}
        title={`Apagar “${file.name}”?`}
        message="O arquivo some para a banda toda. Não dá para desfazer."
        confirmLabel="Apagar"
        onConfirm={() => {
          onDeleted?.();
          void deleteFile(file.id).catch(() => {});
        }}
      />
    </>
  );
}

function AudioList({ files }: { files: SongFile[] }) {
  if (!files.length) return null;
  return (
    <ul className="audio-list" role="list">
      {[...files].reverse().map((f) => (
        <li key={f.id} className="audio-row">
          <div className="audio-row-head">
            <div className="audio-row-titles">
              <FileName file={f} />
              <FileMeta file={f} />
            </div>
            <a className="icon-btn icon-btn-sm" href={`${f.url}?download`} download aria-label={`Baixar ${f.name}`}>
              <Download size={16} aria-hidden />
            </a>
            <DeleteFile file={f} />
          </div>
          <audio controls preload="metadata" src={f.url} />
        </li>
      ))}
    </ul>
  );
}

function ImageGrid({ files }: { files: SongFile[] }) {
  const [open, setOpen] = useState<string | null>(null);
  const index = files.findIndex((f) => f.id === open);
  const current = index >= 0 ? files[index] : null;
  const step = (delta: number) => setOpen(files[(index + delta + files.length) % files.length].id);

  if (!files.length) return null;
  return (
    <>
      <ul className="image-grid" role="list">
        {files.map((f) => (
          <li key={f.id}>
            <button type="button" className="image-thumb" onClick={() => setOpen(f.id)} aria-label={`Abrir ${f.name}`}>
              <img src={f.url} alt="" loading="lazy" decoding="async" />
            </button>
            <span className="image-caption">{f.name}</span>
          </li>
        ))}
      </ul>
      <Dialog open={!!current} onClose={() => setOpen(null)} title={current?.name ?? 'Imagem'} hideTitle className="image-viewer">
        {current && (
          <div
            className="image-viewer-body"
            onKeyDown={(e) => {
              if (files.length < 2 || (e.target as HTMLElement).tagName === 'INPUT') return;
              if (e.key === 'ArrowRight') step(1);
              if (e.key === 'ArrowLeft') step(-1);
            }}
          >
            <div className="image-viewer-stage">
              <img src={current.url} alt={current.name} />
              {files.length > 1 && (
                <>
                  <button type="button" className="icon-btn image-nav is-prev" aria-label="Imagem anterior" onClick={() => step(-1)}>
                    <ChevronLeft size={22} aria-hidden />
                  </button>
                  <button type="button" className="icon-btn image-nav is-next" aria-label="Próxima imagem" onClick={() => step(1)}>
                    <ChevronRight size={22} aria-hidden />
                  </button>
                </>
              )}
            </div>
            <div className="image-viewer-bar">
              <div className="audio-row-titles">
                <FileName key={current.id} file={current} />
                <FileMeta file={current} />
              </div>
              <a className="icon-btn icon-btn-sm" href={current.url} target="_blank" rel="noopener" aria-label="Abrir em tamanho original">
                <ExternalLink size={16} aria-hidden />
              </a>
              <a className="icon-btn icon-btn-sm" href={`${current.url}?download`} download aria-label={`Baixar ${current.name}`}>
                <Download size={16} aria-hidden />
              </a>
              <DeleteFile file={current} onDeleted={() => setOpen(null)} />
            </div>
          </div>
        )}
      </Dialog>
    </>
  );
}
