import { useState, type FormEvent } from 'react';
import { X } from 'lucide-react';
import { Dialog } from '../components/Dialog';
import { StageIcon } from '../components/StageIcon';
import { SongSearch } from '../components/SongSearch';
import { useBand } from '../lib/store';
import { STAGES } from '../lib/stages';
import { artUrl } from '../lib/api';
import { formatDuration } from '../lib/format';
import { STATUSES, type Match, type Status } from '../lib/types';

export function NewSongDialog({ open, onClose, onCreated }: { open: boolean; onClose: () => void; onCreated: (id: string) => void }) {
  const { addSong } = useBand();
  const [title, setTitle] = useState('');
  const [artist, setArtist] = useState('');
  const [original, setOriginal] = useState(false);
  const [status, setStatus] = useState<Status>('todo');
  const [match, setMatch] = useState<Match | null>(null);
  const [busy, setBusy] = useState(false);

  const close = () => {
    setTitle('');
    setArtist('');
    setOriginal(false);
    setStatus('todo');
    setMatch(null);
    onClose();
  };

  const pick = (m: Match) => {
    setMatch(m);
    setTitle(m.title);
    setArtist(m.artist);
    setOriginal(false);
  };

  const submit = async (e?: FormEvent) => {
    e?.preventDefault();
    if (!title.trim()) return;
    setBusy(true);
    try {
      // The match only applies while the title still says what was picked.
      const m = match && match.title === title.trim() ? match : null;
      const id = await addSong({
        title: title.trim(),
        artist: original ? '' : artist.trim(),
        original,
        status,
        ...(m && { duration: m.duration, coverUrl: m.cover, deezerId: m.deezerId }),
      });
      close();
      onCreated(id);
    } catch {
      // The store already showed the error.
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onClose={close} title="Adicionar música">
      <form className="stack-4" onSubmit={submit}>
        <div className="field">
          <label htmlFor="new-title">Título</label>
          <SongSearch
            id="new-title"
            autoFocus
            placeholder="Comece a digitar para buscar no Deezer"
            value={title}
            onChange={(v) => {
              setTitle(v);
              if (match && v !== match.title) setMatch(null);
            }}
            onPick={pick}
            onEnter={() => void submit()}
          />
        </div>
        {match && (
          <div className="match-preview">
            {match.art && <img className="cover" src={artUrl(match.art)!} width={56} height={56} alt="" />}
            <div className="match-text">
              <span className="match-title">{match.title}</span>
              <span className="muted">{[match.artist, match.album, formatDuration(match.duration)].filter(Boolean).join(' · ')}</span>
              <span className="hint">Vamos salvar a capa e a duração.</span>
            </div>
            <button type="button" className="icon-btn icon-btn-sm" aria-label="Não usar esta sugestão" onClick={() => setMatch(null)}>
              <X size={16} aria-hidden />
            </button>
          </div>
        )}
        <label className="checkbox">
          <input
            type="checkbox"
            checked={original}
            onChange={(e) => {
              setOriginal(e.target.checked);
              if (e.target.checked) setMatch(null);
            }}
          />
          É uma música autoral
        </label>
        {!original && (
          <div className="field">
            <label htmlFor="new-artist">
              Artista original <span className="optional">opcional</span>
            </label>
            <input id="new-artist" maxLength={120} value={artist} onChange={(e) => setArtist(e.target.value)} />
          </div>
        )}
        <fieldset className="field">
          <legend>Em que pé a banda está?</legend>
          <div className="segmented segmented-stages">
            {STATUSES.map((s) => (
              <label key={s} className={`segment stage-${s}`}>
                <input type="radio" name="new-status" value={s} checked={status === s} onChange={() => setStatus(s)} />
                <StageIcon status={s} />
                <span>{STAGES[s].label}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="row-end">
          <button type="button" className="btn btn-ghost" onClick={close}>
            Cancelar
          </button>
          <button className="btn btn-primary" disabled={busy || !title.trim()}>
            {busy ? 'Adicionando…' : 'Adicionar música'}
          </button>
        </div>
      </form>
    </Dialog>
  );
}
