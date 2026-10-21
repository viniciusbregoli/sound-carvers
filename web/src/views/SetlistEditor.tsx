import { useMemo, useState, type CSSProperties } from 'react';
import {
  DndContext,
  KeyboardSensor,
  MouseSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
} from '@dnd-kit/core';
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { restrictToVerticalAxis } from '@dnd-kit/modifiers';
import { CSS } from '@dnd-kit/utilities';
import {
  ArrowLeft,
  Copy,
  Drum,
  GripVertical,
  ListPlus,
  Mic2,
  MonitorPlay,
  Plus,
  Printer,
  Search,
  SeparatorHorizontal,
  StickyNote,
  Trash2,
  TriangleAlert,
  Wand2,
  X,
} from 'lucide-react';
import { Link, navigate } from '../lib/router';
import { useBand } from '../lib/store';
import { ConfirmDialog, Dialog } from '../components/Dialog';
import { StageIcon } from '../components/StageIcon';
import { STAGES } from '../lib/stages';
import { STATUSES, type Setlist, type SetlistItem, type Song } from '../lib/types';
import { formatDate, formatDuration, formatRuntime, plural } from '../lib/format';
import { needsWork, newItemId, rowsOf, setRuntimes, summarize, type Row } from '../lib/setlist';
import { useOpenSong } from './Shell';
import { CoverArt } from '../components/Cover';
import { useToast } from '../components/Toast';

export function SetlistEditor({ setlistId }: { setlistId: string }) {
  const { state } = useBand();
  const setlist = state.setlists.find((l) => l.id === setlistId);
  if (!setlist) {
    return (
      <div className="empty-page">
        <h1 className="display-sm">Setlist não encontrado</h1>
        <p className="muted">Alguém da banda pode ter excluído.</p>
        <Link className="btn btn-secondary" href="/setlists">
          Todos os setlists
        </Link>
      </div>
    );
  }
  return <Editor key={setlist.id} setlist={setlist} />;
}

function Editor({ setlist }: { setlist: Setlist }) {
  const { state, songsById, setItems, updateSetlist, deleteSetlist, addSetlist, markRehearsed, setBusy } = useBand();
  const [pickerOpen, setPickerOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const toast = useToast();
  const isShow = setlist.kind === 'show';
  const rows = useMemo(() => rowsOf(setlist, songsById), [setlist, songsById]);
  const summary = summarize(setlist, songsById);
  const runtimes = setRuntimes(rows);
  const hasBreaks = setlist.items.some((i) => i.type === 'break');

  const save = (items: SetlistItem[]) => void setItems(setlist.id, items).catch(() => {});
  const addSongs = (songs: Song[]) =>
    save([...setlist.items, ...songs.map((s) => ({ id: newItemId(), type: 'song' as const, songId: s.id, text: '', done: false }))]);
  const addMarker = (type: 'break' | 'note') => {
    const sets = setlist.items.filter((i) => i.type === 'break').length;
    save([...setlist.items, { id: newItemId(), type, songId: null, text: type === 'break' ? (sets === 0 ? 'Set 2' : sets === 1 ? 'Bis' : `Set ${sets + 2}`) : '', done: false }]);
  };

  const removeItem = (row: Row) => {
    const before = setlist.items;
    save(before.filter((i) => i.id !== row.item.id));
    const name = row.song?.title ?? (row.item.text || (row.item.type === 'break' ? 'Intervalo' : 'Anotação'));
    toast.info(`“${name}” saiu do setlist`, { label: 'Desfazer', run: () => save(before) });
  };

  const sensors = useSensors(
    useSensor(MouseSensor, { activationConstraint: { distance: 4 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 120, tolerance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const onDragEnd = ({ active, over }: DragEndEvent) => {
    setBusy(false);
    if (!over || active.id === over.id) return;
    const from = setlist.items.findIndex((i) => i.id === active.id);
    const to = setlist.items.findIndex((i) => i.id === over.id);
    save(arrayMove(setlist.items, from, to));
  };
  const labelOf = (id: string | number) => {
    const row = rows.find((r) => r.item.id === id);
    return row?.song?.title ?? (row?.item.type === 'break' ? row.item.text || 'Intervalo' : row?.item.text || 'Anotação');
  };
  const positionOf = (id: string | number) => setlist.items.findIndex((i) => i.id === id) + 1;
  const announcements: Announcements = {
    onDragStart: ({ active }) => `${labelOf(active.id)} selecionada, posição ${positionOf(active.id)} de ${setlist.items.length}.`,
    onDragOver: ({ active, over }) => (over ? `${labelOf(active.id)} na posição ${positionOf(over.id)}.` : ''),
    onDragEnd: ({ active, over }) => (over ? `${labelOf(active.id)} solta na posição ${positionOf(over.id)}.` : `${labelOf(active.id)} solta.`),
    onDragCancel: ({ active }) => `Movimento de ${labelOf(active.id)} cancelado.`,
  };

  const duplicate = async () => {
    try {
      const id = await addSetlist({
        kind: setlist.kind,
        name: `${setlist.name} (cópia)`,
        date: null,
        time: null,
        venue: setlist.venue,
        notes: setlist.notes,
        items: setlist.items.map((i) => ({ ...i, id: newItemId(), done: false })),
      });
      navigate(`/setlists/${id}`);
    } catch {
      // Store showed the error.
    }
  };

  const toggleDone = (item: SetlistItem, done: boolean) => {
    save(setlist.items.map((i) => (i.id === item.id ? { ...i, done } : i)));
    if (done && item.songId) {
      // Rehearsals logged after the fact still count on the day they happened.
      const at = setlist.date ? new Date(`${setlist.date}T12:00:00`).getTime() : Date.now();
      void markRehearsed(item.songId, Math.min(at, Date.now())).catch(() => {});
    }
  };

  const suggestions = needsWork(state.songs, state.confidence).filter((s) => !setlist.items.some((i) => i.songId === s.id));

  return (
    <div className="editor-page">
      <Link href="/setlists" className="back-link">
        <ArrowLeft size={18} aria-hidden />
        Setlists
      </Link>

      <h1 className="visually-hidden">{setlist.name}</h1>
      <div className="editor-head">
        <div className="editor-meta">
          <span className={`setlist-kind kind-${setlist.kind}`}>
            {isShow ? <Mic2 size={16} aria-hidden /> : <Drum size={16} aria-hidden />}
            {isShow ? 'Show' : 'Ensaio'}
          </span>
          <MetaFields setlist={setlist} onSave={(patch) => void updateSetlist(setlist.id, patch).catch(() => {})} />
        </div>
        <div className="editor-actions">
          <Link href={`/setlists/${setlist.id}/stage`} className={`btn ${isShow ? 'btn-primary' : 'btn-secondary'}`} aria-disabled={!summary.songs.length || undefined}>
            <MonitorPlay size={18} aria-hidden />
            Modo palco
          </Link>
          <button className="btn btn-secondary" onClick={() => window.print()} disabled={!summary.songs.length}>
            <Printer size={18} aria-hidden />
            Imprimir
          </button>
          <button className="icon-btn" aria-label="Duplicar setlist" title="Duplicar setlist" onClick={duplicate}>
            <Copy size={20} aria-hidden />
          </button>
          <button className="icon-btn icon-btn-danger" aria-label="Excluir setlist" title="Excluir setlist" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={20} aria-hidden />
          </button>
        </div>
      </div>

      <div className="editor-summary" aria-live="polite">
        <span>
          <strong>{plural(summary.songs.length, 'música')}</strong>
        </span>
        {summary.runtime > 0 && (
          <span>
            <strong>{formatRuntime(summary.runtime)}</strong>
            {summary.missingDuration > 0 && <span className="muted"> + {summary.missingDuration} sem duração</span>}
          </span>
        )}
        {isShow && summary.songs.length > 0 && (
          <span className={summary.ready === summary.songs.length ? 'ok' : 'warn'}>
            {summary.ready === summary.songs.length ? (
              <>
                <StageIcon status="ready" size={16} /> Todas prontas pro show
              </>
            ) : (
              <>
                <TriangleAlert size={16} aria-hidden /> {plural(summary.songs.length - summary.ready, 'ainda não está pronta', 'ainda não estão prontas')}
              </>
            )}
          </span>
        )}
        {!isShow && summary.songs.length > 0 && (
          <span>
            {summary.done} de {summary.songs.length} tocadas
          </span>
        )}
      </div>

      <div className="editor-body">
        <section className="running-order" aria-labelledby="order-title">
          <h2 id="order-title" className="visually-hidden">
            Ordem das músicas
          </h2>
          {setlist.items.length === 0 ? (
            <div className="order-empty">
              <p className="display-sm">Setlist vazio</p>
              <p className="muted">
                {isShow ? 'Adicione as músicas na ordem em que vão tocar. Arraste para reordenar.' : 'Adicione o que vocês querem trabalhar e marque cada música conforme forem tocando.'}
              </p>
              {!isShow && suggestions.length > 0 && (
                <button className="btn btn-secondary" onClick={() => addSongs(suggestions)}>
                  <Wand2 size={18} aria-hidden />
                  Adicionar {plural(suggestions.length, 'música')} que precisa{suggestions.length === 1 ? '' : 'm'} de trabalho
                </button>
              )}
            </div>
          ) : (
            <DndContext
              sensors={sensors}
              collisionDetection={closestCenter}
              modifiers={[restrictToVerticalAxis]}
              onDragStart={() => setBusy(true)}
              onDragEnd={onDragEnd}
              onDragCancel={() => setBusy(false)}
              accessibility={{
                announcements,
                screenReaderInstructions: { draggable: 'Pressione Espaço para pegar esta linha, as setas para movê-la e Espaço de novo para soltar.' },
              }}
            >
              <SortableContext items={setlist.items.map((i) => i.id)} strategy={verticalListSortingStrategy}>
                <ol className="order-list" role="list">
                  {rows.map((row) => (
                    <OrderRow
                      key={row.item.id}
                      row={row}
                      isShow={isShow}
                      subtotal={runtimes.totals.get(row.item.id)}
                      onText={(text) => save(setlist.items.map((i) => (i.id === row.item.id ? { ...i, text } : i)))}
                      onDone={(done) => toggleDone(row.item, done)}
                      onRemove={() => removeItem(row)}
                    />
                  ))}
                </ol>
              </SortableContext>
            </DndContext>
          )}
          {hasBreaks && runtimes.last > 0 && <p className="set-subtotal-end">Último set · {formatRuntime(runtimes.last)}</p>}
          <div className="order-add">
            <button className="btn btn-secondary picker-trigger" onClick={() => setPickerOpen(true)}>
              <ListPlus size={18} aria-hidden />
              Adicionar músicas
            </button>
            <button className="btn btn-ghost" onClick={() => addMarker('break')}>
              <SeparatorHorizontal size={18} aria-hidden />
              Adicionar intervalo
            </button>
            <button className="btn btn-ghost" onClick={() => addMarker('note')}>
              <StickyNote size={18} aria-hidden />
              Adicionar anotação
            </button>
          </div>
          <div className="field setlist-notes">
            <label htmlFor="sl-notes">{isShow ? 'Anotações do show' : 'Anotações do ensaio'}</label>
            <textarea
              id="sl-notes"
              rows={3}
              defaultValue={setlist.notes}
              maxLength={5000}
              placeholder={isShow ? 'Horário de chegada, backline, quem leva o quê…' : 'No que focar, o que foi bem…'}
              onBlur={(e) => e.target.value !== setlist.notes && void updateSetlist(setlist.id, { notes: e.target.value }).catch(() => {})}
            />
          </div>
        </section>

        <aside className="picker-aside" aria-labelledby="picker-title">
          <h2 id="picker-title" className="aside-title">
            Adicionar músicas
          </h2>
          <SongPicker setlist={setlist} onAdd={addSongs} suggestions={isShow ? [] : suggestions} />
        </aside>
      </div>

      <Dialog open={pickerOpen} onClose={() => setPickerOpen(false)} title="Adicionar músicas" variant="sheet">
        <SongPicker setlist={setlist} onAdd={addSongs} suggestions={isShow ? [] : suggestions} />
      </Dialog>

      <ConfirmDialog
        open={confirmDelete}
        onClose={() => setConfirmDelete(false)}
        title={`Excluir “${setlist.name}”?`}
        message="As músicas continuam no quadro; só este setlist é excluído. Não dá para desfazer."
        confirmLabel="Excluir setlist"
        onConfirm={() => {
          navigate('/setlists');
          void deleteSetlist(setlist.id).catch(() => {});
        }}
      />

      <PrintSheet setlist={setlist} rows={rows} />
    </div>
  );
}

function MetaFields({ setlist, onSave }: { setlist: Setlist; onSave: (patch: Partial<Setlist>) => void }) {
  const [name, setName] = useState(setlist.name);
  return (
    <div className="meta-fields">
      <label htmlFor="sl-title" className="visually-hidden">
        Nome do setlist
      </label>
      <textarea
        id="sl-title"
        className="title-input title-input-lg"
        rows={1}
        value={name}
        maxLength={120}
        onChange={(e) => setName(e.target.value.replace(/\n/g, ' '))}
        onBlur={() => {
          if (!name.trim()) setName(setlist.name);
          else if (name.trim() !== setlist.name) onSave({ name: name.trim() });
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
      />
      <div className="meta-row">
        <label className="meta-input">
          <span className="visually-hidden">Data</span>
          <input type="date" defaultValue={setlist.date ?? ''} onChange={(e) => onSave({ date: e.target.value || null })} />
        </label>
        <label className="meta-input">
          <span className="visually-hidden">Horário</span>
          <input type="time" defaultValue={setlist.time ?? ''} onBlur={(e) => e.target.value !== (setlist.time ?? '') && onSave({ time: e.target.value || null })} />
        </label>
        <label className="meta-input grow">
          <span className="visually-hidden">{setlist.kind === 'show' ? 'Local' : 'Onde'}</span>
          <input
            defaultValue={setlist.venue}
            maxLength={120}
            placeholder={setlist.kind === 'show' ? 'Local' : 'Onde'}
            onBlur={(e) => e.target.value.trim() !== setlist.venue && onSave({ venue: e.target.value.trim() })}
          />
        </label>
      </div>
    </div>
  );
}

function OrderRow({
  row,
  isShow,
  subtotal,
  onText,
  onDone,
  onRemove,
}: {
  row: Row;
  isShow: boolean;
  subtotal?: number;
  onText: (text: string) => void;
  onDone: (done: boolean) => void;
  onRemove: () => void;
}) {
  const openSong = useOpenSong();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } = useSortable({ id: row.item.id });
  const { item, song } = row;
  const style = { transform: CSS.Translate.toString(transform), transition };
  const dragLabel = song ? `Reordenar ${song.title}` : item.type === 'break' ? `Reordenar ${item.text || 'intervalo'}` : 'Reordenar anotação';

  const handle = (
    <button className="drag-handle" ref={setActivatorNodeRef} {...attributes} {...listeners} aria-label={dragLabel}>
      <GripVertical size={18} aria-hidden />
    </button>
  );
  const remove = (
    <button className="icon-btn icon-btn-sm row-remove" aria-label={`Remover ${song?.title ?? (item.type === 'break' ? 'intervalo' : 'anotação')} do setlist`} onClick={onRemove}>
      <X size={16} aria-hidden />
    </button>
  );

  if (item.type === 'break') {
    return (
      <li ref={setNodeRef} style={style} className={`order-row order-break${isDragging ? ' is-dragging' : ''}`}>
        {handle}
        <div className="break-line">
          {subtotal !== undefined && subtotal > 0 && <span className="break-subtotal">Set acima · {formatRuntime(subtotal)}</span>}
          <label className="visually-hidden" htmlFor={`break-${item.id}`}>
            Nome do intervalo
          </label>
          <input id={`break-${item.id}`} className="break-input" defaultValue={item.text} maxLength={200} placeholder="Intervalo" onBlur={(e) => e.target.value !== item.text && onText(e.target.value)} />
        </div>
        {remove}
      </li>
    );
  }

  if (item.type === 'note') {
    return (
      <li ref={setNodeRef} style={style} className={`order-row order-note${isDragging ? ' is-dragging' : ''}`}>
        {handle}
        <StickyNote size={16} className="note-icon" aria-hidden />
        <label className="visually-hidden" htmlFor={`note-${item.id}`}>
          Anotação
        </label>
        <input
          id={`note-${item.id}`}
          className="note-input"
          defaultValue={item.text}
          maxLength={200}
          placeholder="Ex.: agradecer a casa, trocar de guitarra"
          onBlur={(e) => e.target.value !== item.text && onText(e.target.value)}
          autoFocus={!item.text}
        />
        {remove}
      </li>
    );
  }

  if (!song) return null;
  return (
    <li ref={setNodeRef} style={style} className={`order-row order-song${isDragging ? ' is-dragging' : ''}${item.done ? ' is-done' : ''}`}>
      {handle}
      {row.retuneTo && (
        <span className="retune">
          <TriangleAlert size={14} aria-hidden /> Trocar afinação → {row.retuneTo}
        </span>
      )}
      <span className="order-number">{row.number}</span>
      {!isShow && (
        <label className="done-check" title="Tocada neste ensaio">
          <input type="checkbox" checked={item.done} onChange={(e) => onDone(e.target.checked)} />
          <span className="visually-hidden">Tocada: {song.title}</span>
        </label>
      )}
      <CoverArt src={song.cover} title={song.title} size={40} className="order-cover" />
      <button className="order-song-main" onClick={() => openSong(song.id)}>
        <span className="order-title">{song.title}</span>
        {song.artist && <span className="order-artist">{song.artist}</span>}
      </button>
      <span className="order-meta">
        {song.key && <span>{song.key}</span>}
        {song.bpm && <span>{song.bpm} bpm</span>}
        {song.duration && <span className="order-length">{formatDuration(song.duration)}</span>}
      </span>
      {(isShow ? song.status !== 'ready' : true) && (
        <span className={`stage-pill stage-${song.status}`} title={STAGES[song.status].hint}>
          <StageIcon status={song.status} size={14} />
          <span className={isShow ? '' : 'stage-pill-label'}>{STAGES[song.status].label}</span>
        </span>
      )}
      {remove}
    </li>
  );
}

function SongPicker({ setlist, onAdd, suggestions }: { setlist: Setlist; onAdd: (songs: Song[]) => void; suggestions: Song[] }) {
  const { state } = useBand();
  const [query, setQuery] = useState('');
  const inSet = new Set(setlist.items.map((i) => i.songId));
  const q = query.trim().toLowerCase();
  // Shows lead with what's ready; rehearsals lead with what needs work.
  const order = setlist.kind === 'show' ? (['ready', 'shaky', 'learning', 'todo'] as const) : (['shaky', 'learning', 'ready', 'todo'] as const);

  return (
    <div className="picker">
      <label className="search">
        <Search size={18} aria-hidden />
        <span className="visually-hidden">Buscar músicas</span>
        <input type="search" placeholder="Buscar músicas" value={query} onChange={(e) => setQuery(e.target.value)} />
      </label>
      {!q && suggestions.length > 0 && (
        <button className="btn btn-secondary btn-block" onClick={() => onAdd(suggestions)}>
          <Wand2 size={18} aria-hidden />
          Adicionar {plural(suggestions.length, 'música')} que precisa{suggestions.length === 1 ? '' : 'm'} de trabalho
        </button>
      )}
      {state.songs.length === 0 && (
        <p className="muted">
          Ainda não há músicas no quadro. <Link href="/">Adicione algumas</Link> primeiro.
        </p>
      )}
      {order.map((status) => {
        const songs = state.songs
          .filter((s) => s.status === status && (!q || `${s.title} ${s.artist}`.toLowerCase().includes(q)))
          .sort((a, b) => a.title.localeCompare(b.title));
        if (!songs.length) return null;
        return (
          <section key={status} className="picker-group" aria-label={STAGES[status].label}>
            <h3 className={`picker-group-title stage-${status}`}>
              <StageIcon status={status} size={14} />
              {STAGES[status].label}
            </h3>
            <ul role="list">
              {songs.map((s) => (
                <li key={s.id}>
                  <button className="picker-row" onClick={() => onAdd([s])} disabled={inSet.has(s.id)}>
                    <CoverArt src={s.cover} title={s.title} size={36} />
                    <span className="picker-text">
                      <span className="picker-title">{s.title}</span>
                      {s.artist && <span className="picker-artist">{s.artist}</span>}
                    </span>
                    {s.duration && <span className="picker-length">{formatDuration(s.duration)}</span>}
                    {inSet.has(s.id) ? (
                      <span className="picker-in">No set</span>
                    ) : (
                      <span className="picker-add">
                        <Plus size={16} aria-hidden />
                        <span className="visually-hidden">Adicionar {s.title}</span>
                      </span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
      {STATUSES.every((st) => !state.songs.some((s) => s.status === st && (!q || `${s.title} ${s.artist}`.toLowerCase().includes(q)))) && q && (
        <p className="muted">Nenhuma música encontrada para “{query}”.</p>
      )}
    </div>
  );
}

/** Paper setlist for the stage floor: only rendered when printing. */
function PrintSheet({ setlist, rows }: { setlist: Setlist; rows: Row[] }) {
  // Readable from the floor: as large as the song count allows on one page.
  const lines = rows.length;
  const size = lines > 22 ? '16pt' : lines > 17 ? '20pt' : lines > 13 ? '24pt' : '30pt';
  return (
    <div className="print-sheet" aria-hidden style={{ '--print-size': size } as CSSProperties}>
      <header className="print-head">
        <span>{setlist.name}</span>
        <span>
          {formatDate(setlist.date)}
          {setlist.venue && ` · ${setlist.venue}`}
        </span>
      </header>
      <ol className="print-list">
        {rows.map(({ item, song, number, retuneTo }) =>
          item.type === 'song' && song ? (
            <li key={item.id} className="print-song">
              <span className="print-number">{number}</span>
              <span className="print-title">{song.title}</span>
              {(retuneTo || song.key) && <span className="print-extra">{[retuneTo && `→ ${retuneTo}`, song.key].filter(Boolean).join(' · ')}</span>}
            </li>
          ) : item.type === 'break' ? (
            <li key={item.id} className="print-break">
              {item.text || 'Intervalo'}
            </li>
          ) : item.type === 'note' && item.text ? (
            <li key={item.id} className="print-note">
              {item.text}
            </li>
          ) : null,
        )}
      </ol>
    </div>
  );
}
