import { useId, useState, type FormEvent } from 'react';
import { CalendarDays, ChevronRight, Drum, MapPin, Mic2, Plus } from 'lucide-react';
import { Link, navigate } from '../lib/router';
import { useBand } from '../lib/store';
import { Dialog } from '../components/Dialog';
import { formatDate, formatRuntime, plural, relativeDay, todayIso } from '../lib/format';
import { needsWork, newItemId, summarize } from '../lib/setlist';
import type { Setlist, SetlistKind } from '../lib/types';

export function Setlists() {
  const { state, songsById } = useBand();
  const [creating, setCreating] = useState<SetlistKind | null>(null);
  const today = todayIso();

  const upcoming = state.setlists.filter((l) => l.date && l.date >= today).sort((a, b) => a.date!.localeCompare(b.date!) || (a.time ?? '').localeCompare(b.time ?? ''));
  const undated = state.setlists.filter((l) => !l.date);
  const past = state.setlists.filter((l) => l.date && l.date < today);

  return (
    <div className="setlists-page">
      <div className="page-head">
        <div className="page-title">
          <h1 className="display-lg">Setlists</h1>
          <p className="muted">Planeje os shows e o que trabalhar nos ensaios.</p>
        </div>
        <div className="row">
          <button className="btn btn-secondary" onClick={() => setCreating('rehearsal')}>
            <Drum size={18} aria-hidden />
            Planejar ensaio
          </button>
          <button className="btn btn-primary" onClick={() => setCreating('show')}>
            <Plus size={18} aria-hidden />
            Novo show
          </button>
        </div>
      </div>

      {state.setlists.length === 0 ? (
        <div className="empty-state">
          <ListIllustration />
          <h2 className="display-sm">Nenhum setlist ainda</h2>
          <p className="muted">
            Planeje o próximo ensaio e a gente sugere as músicas que mais precisam de trabalho. Ou monte a ordem do próximo show.
          </p>
          <div className="row">
            <button className="btn btn-secondary" onClick={() => setCreating('rehearsal')}>
              Planejar ensaio
            </button>
            <button className="btn btn-primary" onClick={() => setCreating('show')}>
              Novo show
            </button>
          </div>
        </div>
      ) : (
        <>
          <Group title="Próximos" lists={upcoming} songsById={songsById} highlightFirst />
          <Group title="Sem data" lists={undated} songsById={songsById} />
          <Group title="Anteriores" lists={past} songsById={songsById} />
        </>
      )}

      <NewSetlistDialog kind={creating} onClose={() => setCreating(null)} />
    </div>
  );
}

function Group({ title, lists, songsById, highlightFirst }: { title: string; lists: Setlist[]; songsById: ReturnType<typeof useBand>['songsById']; highlightFirst?: boolean }) {
  if (!lists.length) return null;
  const id = useId();
  return (
    <section className="setlist-group" aria-labelledby={id}>
      <h2 id={id} className="group-title">
        {title}
      </h2>
      <ul className="setlist-cards" role="list">
        {lists.map((l, i) => {
          const s = summarize(l, songsById);
          const Icon = l.kind === 'show' ? Mic2 : Drum;
          return (
            <li key={l.id}>
              <Link href={`/setlists/${l.id}`} className={`setlist-card kind-${l.kind}${highlightFirst && i === 0 ? ' is-next' : ''}`}>
                <span className="setlist-kind">
                  <Icon size={16} aria-hidden />
                  {l.kind === 'show' ? 'Show' : 'Ensaio'}
                  {highlightFirst && i === 0 && l.date && <span className="setlist-when">{relativeDay(l.date)}</span>}
                </span>
                <span className="setlist-name">{l.name}</span>
                <span className="setlist-facts">
                  <span>
                    <CalendarDays size={14} aria-hidden />
                    {formatDate(l.date)}
                    {l.time && ` · ${l.time}`}
                  </span>
                  {l.venue && (
                    <span>
                      <MapPin size={14} aria-hidden />
                      {l.venue}
                    </span>
                  )}
                </span>
                <span className="setlist-stats">
                  {plural(s.songs.length, 'música')}
                  {s.runtime > 0 && ` · ${formatRuntime(s.runtime)}`}
                  {l.kind === 'show' && s.songs.length > 0 && (
                    <span className={s.ready === s.songs.length ? 'ok' : 'warn'}>
                      {s.ready === s.songs.length ? 'Todas prontas' : `${s.songs.length - s.ready} não ${s.songs.length - s.ready === 1 ? 'está pronta' : 'estão prontas'}`}
                    </span>
                  )}
                  {l.kind === 'rehearsal' && s.songs.length > 0 && s.done > 0 && <span>{`${s.done} de ${s.songs.length} tocadas`}</span>}
                </span>
                <ChevronRight className="setlist-chevron" size={20} aria-hidden />
              </Link>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function NewSetlistDialog({ kind, onClose }: { kind: SetlistKind | null; onClose: () => void }) {
  const { state, addSetlist } = useBand();
  const [name, setName] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [venue, setVenue] = useState('');
  const [autofill, setAutofill] = useState(true);
  const [busy, setBusy] = useState(false);
  const isShow = kind === 'show';
  const suggestions = needsWork(state.songs, state.confidence);

  const close = () => {
    setName('');
    setDate('');
    setTime('');
    setVenue('');
    setAutofill(true);
    onClose();
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!kind) return;
    setBusy(true);
    try {
      const items = !isShow && autofill ? suggestions.map((s) => ({ id: newItemId(), type: 'song' as const, songId: s.id, text: '', done: false })) : [];
      const id = await addSetlist({
        kind,
        name: name.trim() || (isShow ? 'Novo show' : `Ensaio${date ? ` ${formatDate(date, { weekday: false })}` : ''}`),
        date: date || null,
        time: time || null,
        venue: venue.trim(),
        items,
      });
      close();
      navigate(`/setlists/${id}`);
    } catch {
      // Store showed the error.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={!!kind} onClose={close} title={isShow ? 'Novo show' : 'Planejar ensaio'}>
      <form className="stack-4" onSubmit={submit}>
        <div className="field">
          <label htmlFor="sl-name">{isShow ? 'Nome do show' : 'Nome'}</label>
          <input
            id="sl-name"
            autoFocus
            maxLength={120}
            required={isShow}
            placeholder={isShow ? 'Sexta no Bar do Zé' : 'Ensaio'}
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="details-grid details-grid-2">
          <div className="field">
            <label htmlFor="sl-date">Data</label>
            <input id="sl-date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="sl-time">
              {isShow ? 'Horário do show' : 'Horário'} <span className="optional">opcional</span>
            </label>
            <input id="sl-time" type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="sl-venue">
            {isShow ? 'Local' : 'Onde'} <span className="optional">opcional</span>
          </label>
          <input id="sl-venue" maxLength={120} value={venue} onChange={(e) => setVenue(e.target.value)} placeholder={isShow ? 'Bar do Zé' : 'Estúdio, garagem…'} />
        </div>
        {!isShow && (
          <label className="checkbox checkbox-block">
            <input type="checkbox" checked={autofill} onChange={(e) => setAutofill(e.target.checked)} disabled={!suggestions.length} />
            <span>
              Começar com as músicas que precisam de trabalho
              <span className="hint">
                {suggestions.length
                  ? `${plural(suggestions.length, 'música')} sendo aprendidas, quase lá ou que alguém ainda não domina, das menos ensaiadas para as mais ensaiadas.`
                  : 'Nada precisa de trabalho agora. Adicione músicas depois de criar.'}
              </span>
            </span>
          </label>
        )}
        <div className="row-end">
          <button type="button" className="btn btn-ghost" onClick={close}>
            Cancelar
          </button>
          <button className="btn btn-primary" disabled={busy || (isShow && !name.trim())}>
            {isShow ? 'Criar show' : 'Criar ensaio'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

function ListIllustration() {
  return (
    <svg className="empty-illustration" width="120" height="96" viewBox="0 0 120 96" aria-hidden>
      <rect x="22" y="6" width="76" height="86" rx="6" transform="rotate(-4 60 49)" fill="var(--surface-2)" stroke="var(--border)" />
      <g transform="rotate(-4 60 49)" fill="var(--text-tertiary)">
        <rect x="34" y="22" width="44" height="6" rx="3" />
        <rect x="34" y="36" width="36" height="6" rx="3" />
        <rect x="34" y="50" width="48" height="6" rx="3" />
        <rect x="34" y="64" width="30" height="6" rx="3" />
      </g>
      <rect x="54" y="0" width="16" height="10" rx="2" fill="var(--accent-solid)" opacity="0.85" />
    </svg>
  );
}
