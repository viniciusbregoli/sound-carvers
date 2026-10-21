import { useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCorners,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type DragOverEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { ImagePlus, Plus, Search, X } from 'lucide-react';
import { columnSongs, useBand } from '../lib/store';
import { STAGES } from '../lib/stages';
import { STATUSES, type Level, type Match, type Member, type Song, type Status } from '../lib/types';
import { plural, formatRuntime, splitTitleArtist } from '../lib/format';
import { StageIcon } from '../components/StageIcon';
import { SongCard } from '../components/SongCard';
import { useOpenSong } from './Shell';
import { SongSearch } from '../components/SongSearch';
import { useToast } from '../components/Toast';
import { NewSongDialog } from './NewSongDialog';

type Columns = Record<Status, string[]>;

export function Board() {
  const { state, me, songsById, moveSong, setBusy, enrichAll } = useBand();
  const toast = useToast();
  const [findingCovers, setFindingCovers] = useState(false);
  const openSong = useOpenSong();
  const [query, setQuery] = useState('');
  const [mineOnly, setMineOnly] = useState(false);
  const [creating, setCreating] = useState(false);
  const [dragColumns, setDragColumns] = useState<Columns | null>(null);
  const [activeId, setActiveId] = useState<string | null>(null);
  const origin = useRef<Status | null>(null);
  const columnRefs = useRef<Partial<Record<Status, HTMLElement | null>>>({});
  const announceMove = useRef('');

  const levelsBySong = useMemo(() => {
    const map = new Map<string, Map<string, Level>>();
    for (const c of state.confidence) {
      if (!map.has(c.songId)) map.set(c.songId, new Map());
      map.get(c.songId)!.set(c.memberId, c.level);
    }
    return map;
  }, [state.confidence]);

  const visible = (song: Song) => {
    const q = query.trim().toLowerCase();
    if (q && !`${song.title} ${song.artist}`.toLowerCase().includes(q)) return false;
    if (mineOnly && me && levelsBySong.get(song.id)?.get(me.id) === 3) return false;
    return true;
  };

  const baseColumns = useMemo(() => {
    const cols = {} as Columns;
    for (const status of STATUSES) cols[status] = columnSongs(state.songs, status).map((s) => s.id);
    return cols;
  }, [state.songs]);
  const columns = dragColumns ?? baseColumns;
  const filtering = !!query.trim() || mineOnly;

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 220, tolerance: 6 } }),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
      // Enter opens the song; Space picks it up.
      keyboardCodes: { start: ['Space'], cancel: ['Escape'], end: ['Space', 'Enter'] },
    }),
  );

  const containerOf = (id: string, cols: Columns): Status | undefined =>
    (STATUSES as readonly string[]).includes(id) ? (id as Status) : STATUSES.find((s) => cols[s].includes(id));

  const onDragStart = ({ active }: DragStartEvent) => {
    announceMove.current = '';
    setBusy(true);
    setActiveId(String(active.id));
    setDragColumns(baseColumns);
    origin.current = containerOf(String(active.id), baseColumns) ?? null;
  };

  const onDragOver = ({ active, over }: DragOverEvent) => {
    if (!over) return;
    setDragColumns((cols) => {
      if (!cols) return cols;
      const from = containerOf(String(active.id), cols);
      const to = containerOf(String(over.id), cols);
      if (!from || !to || from === to) return cols;
      const target = cols[to].filter((id) => id !== active.id);
      const overIndex = target.indexOf(String(over.id));
      target.splice(overIndex < 0 ? target.length : overIndex, 0, String(active.id));
      return { ...cols, [from]: cols[from].filter((id) => id !== active.id), [to]: target };
    });
  };

  const finish = () => {
    setActiveId(null);
    setDragColumns(null);
    setBusy(false);
  };

  const onDragEnd = ({ active, over }: DragEndEvent) => {
    const id = String(active.id);
    const cols = dragColumns;
    if (!over || !cols) return finish();
    const to = containerOf(id, cols)!;
    let list = cols[to];
    const overIndex = list.indexOf(String(over.id));
    const fromIndex = list.indexOf(id);
    if (overIndex >= 0 && overIndex !== fromIndex) list = arrayMove(list, fromIndex, overIndex);
    // Columns hold every song (filters only hide cards), so this index is valid for the full column.
    const index = list.indexOf(id);
    const song = songsById.get(id)!;
    const unchanged = to === origin.current && baseColumns[to].indexOf(id) === index;
    finish();
    if (!unchanged) void moveSong(id, to, index).catch(() => {});
    if (to !== song.status) announceMove.current = `${song.title} movida para ${STAGES[to].label}.`;
  };
  const titleOf = (id: string | number) => songsById.get(String(id))?.title ?? 'música';
  const where = (id: string | number | undefined) => {
    if (id === undefined || !dragColumns) return '';
    const col = containerOf(String(id), dragColumns);
    if (!col) return '';
    const i = dragColumns[col].indexOf(String(id));
    return ` ${STAGES[col].label}${i >= 0 ? `, posição ${i + 1} de ${dragColumns[col].length}` : ''}`;
  };
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${titleOf(active.id)} selecionada. Use as setas para mover, Espaço para soltar e Esc para cancelar.`,
    onDragOver: ({ active, over }) => (over ? `${titleOf(active.id)} sobre${where(over.id)}.` : `${titleOf(active.id)} fora das colunas.`),
    onDragEnd: ({ active }) => announceMove.current || `${titleOf(active.id)} solta.`,
    onDragCancel: ({ active }) => `Movimento de ${titleOf(active.id)} cancelado.`,
  };

  const total = state.songs.length;
  const counts = Object.fromEntries(STATUSES.map((s) => [s, baseColumns[s].length])) as Record<Status, number>;
  const readyRuntime = state.songs.filter((s) => s.status === 'ready').reduce((sum, s) => sum + (s.duration ?? 0), 0);
  const activeSong = activeId ? songsById.get(activeId) : null;
  const missingCovers = state.songs.filter((s) => !s.enriched && !s.original).length;

  return (
    <div className="board-page">
      <div className="page-head">
        <div className="page-title">
          <h1 className="display-lg">Músicas</h1>
          <p className="muted">
            {total === 0
              ? 'Tudo o que a banda toca ou quer tocar.'
              : `${plural(total, 'música')} · ${plural(counts.ready, 'pronta', 'prontas')} pro show${readyRuntime ? ` · ${formatRuntime(readyRuntime)} de repertório pronto` : ''}`}
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setCreating(true)}>
          <Plus size={18} aria-hidden />
          Adicionar música
        </button>
      </div>

      {total > 0 && <Readiness counts={counts} total={total} />}

      <div className="toolbar" role="search">
        <label className="search">
          <Search size={18} aria-hidden />
          <span className="visually-hidden">Buscar músicas</span>
          <input type="search" placeholder="Buscar músicas ou artistas" value={query} onChange={(e) => setQuery(e.target.value)} />
          {query && (
            <button className="icon-btn icon-btn-sm" aria-label="Limpar busca" onClick={() => setQuery('')}>
              <X size={16} aria-hidden />
            </button>
          )}
        </label>
        <button className="chip-toggle" aria-pressed={mineOnly} onClick={() => setMineOnly((x) => !x)}>
          Só as que eu não domino
        </button>
        {missingCovers > 0 && (
          <button
            className="btn btn-ghost btn-sm toolbar-end"
            disabled={findingCovers}
            onClick={async () => {
              setFindingCovers(true);
              try {
                const { updated, checked } = await enrichAll();
                toast.info(
                  updated === checked
                    ? `${plural(updated, 'música completada', 'músicas completadas')}`
                    : `${plural(updated, 'música completada', 'músicas completadas')}. ${plural(checked - updated, 'não foi encontrada', 'não foram encontradas')}: dá para completar à mão na música.`,
                );
              } catch {
                // Store showed the error.
              } finally {
                setFindingCovers(false);
              }
            }}
          >
            <ImagePlus size={16} aria-hidden />
            {findingCovers ? 'Buscando…' : `Completar capas, tom e links (${missingCovers})`}
          </button>
        )}
      </div>

      <nav className="column-tabs" aria-label="Ir para a coluna">
        {STATUSES.map((s) => (
          <button key={s} className={`column-tab stage-${s}`} onClick={() => columnRefs.current[s]?.scrollIntoView({ inline: 'start', block: 'nearest' })}>
            <StageIcon status={s} />
            {STAGES[s].label}
            <span className="count">{counts[s]}</span>
          </button>
        ))}
      </nav>

      <DndContext
        sensors={sensors}
        collisionDetection={closestCorners}
        onDragStart={onDragStart}
        onDragOver={onDragOver}
        onDragEnd={onDragEnd}
        onDragCancel={finish}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: 'Pressione Enter para abrir esta música. Pressione Espaço para pegá-la, use as setas para movê-la entre as colunas e Espaço de novo para soltar.',
          },
        }}
      >
        <div className="columns">
          {STATUSES.map((status) => {
            const ids = columns[status].filter((id) => id === activeId || visible(songsById.get(id)!));
            return (
              <Column key={status} status={status} ids={ids} count={counts[status]} sectionRef={(el) => (columnRefs.current[status] = el)} filtering={filtering}>
                {ids.map((id) => {
                  const song = songsById.get(id)!;
                  return (
                    <SortableCard
                      key={id}
                      song={song}
                      members={state.members}
                      levels={levelsBySong.get(id) ?? new Map()}
                      onOpen={() => openSong(id)}
                    />
                  );
                })}
              </Column>
            );
          })}
        </div>
        <DragOverlay dropAnimation={{ duration: 180, easing: 'cubic-bezier(0.2, 0, 0, 1)' }}>
          {activeSong && <SongCard song={activeSong} members={state.members} levels={levelsBySong.get(activeSong.id) ?? new Map()} lifted />}
        </DragOverlay>
      </DndContext>

      <NewSongDialog open={creating} onClose={() => setCreating(false)} onCreated={(id) => openSong(id)} />
    </div>
  );
}

function Readiness({ counts, total }: { counts: Record<Status, number>; total: number }) {
  const label = STATUSES.map((s) => `${counts[s]} ${STAGES[s].label.toLowerCase()}`).join(', ');
  return (
    <div className="readiness" role="img" aria-label={`Prontidão da banda: ${label}`}>
      {STATUSES.map((s) =>
        counts[s] ? <span key={s} className={`readiness-seg stage-${s}`} style={{ flexGrow: counts[s] }} title={`${STAGES[s].label}: ${counts[s]}`} /> : null,
      )}
      <span className="visually-hidden">{plural(total, 'música')}</span>
    </div>
  );
}

function Column({
  status,
  ids,
  count,
  filtering,
  sectionRef,
  children,
}: {
  status: Status;
  ids: string[];
  count: number;
  filtering: boolean;
  sectionRef: (el: HTMLElement | null) => void;
  children: ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status });
  const headingId = `col-${status}`;
  return (
    <section className={`column stage-${status}`} aria-labelledby={headingId} ref={sectionRef}>
      <header className="column-head">
        <h2 id={headingId} className="column-title">
          <StageIcon status={status} />
          {STAGES[status].label}
        </h2>
        <span className="count" aria-label={plural(count, 'música')}>
          {count}
        </span>
      </header>
      <p className="column-hint">{STAGES[status].hint}</p>
      <SortableContext id={status} items={ids} strategy={verticalListSortingStrategy}>
        <ul className={`column-list${isOver ? ' is-over' : ''}`} ref={setNodeRef} role="list">
          {children}
          {ids.length === 0 && (
            <li className="column-empty">
              {filtering ? 'Nada encontrado aqui' : status === 'todo' ? 'Adicione as músicas que vocês querem aprender' : 'Arraste músicas para cá'}
            </li>
          )}
        </ul>
      </SortableContext>
      <QuickAdd status={status} />
    </section>
  );
}

function SortableCard({ song, members, levels, onOpen }: { song: Song; members: Member[]; levels: Map<string, Level>; onOpen: () => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: song.id });
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.key === 'Enter' && !isDragging) {
      e.preventDefault();
      onOpen();
      return;
    }
    listeners?.onKeyDown?.(e);
  };
  return (
    <li
      ref={setNodeRef}
      className={`card-slot${isDragging ? ' is-placeholder' : ''}`}
      style={{ transform: CSS.Translate.toString(transform), transition }}
    >
      <SongCard
        song={song}
        members={members}
        levels={levels}
        interactive={{ ...attributes, ...listeners, onKeyDown, onClick: onOpen }}
      />
    </li>
  );
}

function QuickAdd({ status }: { status: Status }) {
  const { addSong } = useBand();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const inputId = `quick-add-${status}`;
  const hintId = `${inputId}-hint`;

  const close = () => {
    setOpen(false);
    setValue('');
  };

  const addTyped = async () => {
    const { title, artist } = splitTitleArtist(value);
    if (!title) return;
    setValue('');
    await addSong({ title, artist, status }).catch(() => setValue(value));
  };

  const addMatch = async (m: Match) => {
    setValue('');
    try {
      await addSong({ title: m.title, artist: m.artist, duration: m.duration, coverUrl: m.cover, deezerId: m.deezerId, status });
      toast.info(`“${m.title}” adicionada`);
    } catch {
      // The store already showed the error.
    }
  };

  if (!open) {
    return (
      <button className="quick-add-btn" onClick={() => setOpen(true)}>
        <Plus size={16} aria-hidden />
        Adicionar música
      </button>
    );
  }
  return (
    <div className="quick-add">
      <label htmlFor={inputId} className="visually-hidden">
        Nova música em {STAGES[status].label}
      </label>
      <SongSearch
        id={inputId}
        autoFocus
        placeholder="Busque ou digite: Título – Artista"
        value={value}
        onChange={setValue}
        onPick={addMatch}
        onEnter={addTyped}
        onEscape={close}
        onBlur={() => !value && setOpen(false)}
        describedBy={hintId}
      />
      <p id={hintId} className="quick-add-hint">
        ↑↓ escolhe uma sugestão · Enter adiciona · Esc fecha
      </p>
    </div>
  );
}
