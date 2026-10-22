import { useEffect, useMemo, useRef, useState } from 'react';
import { ExternalLink, ImageOff, ImagePlus, Plus, Trash2, Wand2, X } from 'lucide-react';
import { Dialog, ConfirmDialog } from '../components/Dialog';
import { StageIcon } from '../components/StageIcon';
import { Avatar, LevelGlyph } from '../components/Avatar';
import { CoverArt, useSongTint } from '../components/Cover';
import { SongSearch } from '../components/SongSearch';
import { useToast } from '../components/Toast';
import { columnSongs, useBand } from '../lib/store';
import { LEVELS, STAGES, TUNINGS } from '../lib/stages';
import { STATUSES, type Level, type Link, type Match, type Member, type Song } from '../lib/types';
import { formatDuration, parseDuration, plural } from '../lib/format';
import { FilesPanel, SongTabBar, TextPanel, isTextTab, panelId, tabId, useSongTexts, type SongTab } from './SongTabs';

const KEYS = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'].flatMap((k) => [k, `${k}m`]);

type Draft = Pick<Song, 'title' | 'artist' | 'original' | 'key' | 'tuning' | 'notes'> & { bpm: string; duration: string };

const toDraft = (s: Song): Draft => ({
  title: s.title,
  artist: s.artist,
  original: s.original,
  key: s.key,
  tuning: s.tuning,
  notes: s.notes,
  bpm: s.bpm ? String(s.bpm) : '',
  duration: formatDuration(s.duration),
});

/** The tab stays put when opening the next song, so you can flip through lyrics or chords song by song. */
let lastTab: SongTab = 'overview';

export function SongSheet({ songId, onClose }: { songId: string | null; onClose: () => void }) {
  const { songsById } = useBand();
  const song = songId ? songsById.get(songId) : undefined;
  return (
    <Dialog open={!!song} onClose={onClose} title={song?.title || 'Música'} hideTitle variant="sheet" className="song-sheet">
      {song && <SongForm key={song.id} song={song} onDeleted={onClose} />}
    </Dialog>
  );
}

function SongForm({ song, onDeleted }: { song: Song; onDeleted: () => void }) {
  const { state, me, updateSong, moveSong, setConfidence, deleteSong, enrichSong } = useBand();
  const toast = useToast();
  const [enriching, setEnriching] = useState(false);
  const [draft, setDraft] = useState(() => toDraft(song));
  const [errors, setErrors] = useState<Partial<Record<keyof Draft, string>>>({});
  const [saveState, setSaveState] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle');
  const [confirming, setConfirming] = useState(false);
  const pending = useRef<Partial<Song>>({});
  const timer = useRef<number>(undefined);
  const tint = useSongTint(song.cover, song.title);
  const head = useRef<HTMLDivElement>(null);
  const [tab, setTabState] = useState<SongTab>(lastTab);
  const { texts, failed, remember } = useSongTexts(song, isTextTab(tab));

  const setTab = (next: SongTab) => {
    // Scrolled deep into a long sheet: land at the top of the new tab, not somewhere in its middle.
    const body = head.current?.closest('.dialog-body');
    if (head.current && body) {
      const overshoot = body.getBoundingClientRect().top - head.current.getBoundingClientRect().bottom;
      if (overshoot > 0) body.scrollTop -= overshoot;
    }
    lastTab = next;
    setTabState(next);
  };

  const flush = async () => {
    window.clearTimeout(timer.current);
    const patch = pending.current;
    if (!Object.keys(patch).length) return;
    pending.current = {};
    setSaveState('saving');
    try {
      await updateSong(song.id, patch);
      setSaveState('saved');
    } catch {
      setSaveState('error');
    }
  };

  // Bandmates' edits and online lookups land in fields the person isn't editing right now.
  useEffect(() => {
    const fresh = toDraft(song);
    setDraft((d) => {
      const next = { ...d };
      for (const key of ['title', 'artist', 'key', 'tuning', 'notes', 'bpm', 'duration', 'original'] as const) {
        const editing = document.activeElement?.id === `song-${key}` || key in pending.current;
        if (!editing) (next as Record<string, unknown>)[key] = fresh[key];
      }
      return next;
    });
  }, [song]);

  const lookUp = async () => {
    setEnriching(true);
    try {
      const filled = await enrichSong(song.id);
      const names: Record<string, string> = { key: 'tom', tuning: 'afinação', bpm: 'andamento', duration: 'duração', cover: 'capa' };
      const parts = [...new Set(filled.filter((f) => f !== 'link').map((f) => names[f]))];
      const links = filled.filter((f) => f === 'link').length;
      if (links) parts.push(plural(links, 'link', 'links'));
      toast.info(parts.length ? `Preenchido: ${parts.join(', ')}` : 'Nada novo encontrado para esta música');
    } catch {
      // Store showed the error.
    } finally {
      setEnriching(false);
    }
  };

  // Save whatever is pending when the sheet closes.
  const flushRef = useRef(flush);
  flushRef.current = flush;
  useEffect(() => () => void flushRef.current(), []);

  const queue = (patch: Partial<Song>, delay = 700) => {
    pending.current = { ...pending.current, ...patch };
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(flush, delay);
  };

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  const commitText = (key: 'title' | 'artist' | 'key' | 'tuning' | 'notes', value: string, delay?: number) => {
    if (key === 'title' && !value.trim()) {
      setErrors((e) => ({ ...e, title: 'Dê um título para a música' }));
      return;
    }
    setErrors((e) => ({ ...e, [key]: undefined }));
    queue({ [key]: key === 'notes' ? value : value.trim() }, delay);
  };

  const commitBpm = () => {
    const value = draft.bpm.trim();
    const n = Number(value);
    if (value && (!Number.isInteger(n) || n < 20 || n > 400)) {
      setErrors((e) => ({ ...e, bpm: 'Use um andamento entre 20 e 400' }));
      return;
    }
    setErrors((e) => ({ ...e, bpm: undefined }));
    queue({ bpm: value ? n : null }, 0);
  };

  const commitDuration = () => {
    const seconds = parseDuration(draft.duration);
    if (seconds === undefined) {
      setErrors((e) => ({ ...e, duration: 'Use minutos e segundos, como 3:45' }));
      return;
    }
    setErrors((e) => ({ ...e, duration: undefined }));
    set('duration', formatDuration(seconds));
    queue({ duration: seconds }, 0);
  };

  const levels = useMemo(() => {
    const map = new Map<string, Level>();
    for (const c of state.confidence) if (c.songId === song.id) map.set(c.memberId, c.level);
    return map;
  }, [state.confidence, song.id]);
  const myLevel = me ? levels.get(me.id) : undefined;

  const inSetlists = state.setlists.filter((l) => l.items.some((i) => i.songId === song.id));

  return (
    <div className="song-form">
      <div className="song-form-head" style={tint} ref={head}>
        <CoverPicker song={song} />
        <div className="song-form-titles">
          <label htmlFor="song-title" className="visually-hidden">
            Título
          </label>
          <textarea
            id="song-title"
            className="title-input"
            rows={1}
            value={draft.title}
            maxLength={120}
            onChange={(e) => {
              const value = e.target.value.replace(/\n/g, ' ');
              set('title', value);
              commitText('title', value);
            }}
            onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
            onBlur={flush}
            aria-invalid={!!errors.title}
            aria-describedby={errors.title ? 'song-title-error' : undefined}
          />
          {errors.title && (
            <p id="song-title-error" className="field-error">
              {errors.title}
            </p>
          )}
          {!draft.original && (
            <>
              <label htmlFor="song-artist" className="visually-hidden">
                Artista original
              </label>
              <input
                id="song-artist"
                className="artist-input"
                placeholder="Artista original"
                value={draft.artist}
                maxLength={120}
                onChange={(e) => {
                  set('artist', e.target.value);
                  commitText('artist', e.target.value);
                }}
                onBlur={flush}
              />
            </>
          )}
          <div className={`save-state${saveState === 'error' ? ' is-error' : ''}`} aria-live="polite">
            {saveState === 'saving'
              ? 'Salvando…'
              : saveState === 'saved'
                ? 'Tudo salvo'
                : saveState === 'error'
                  ? 'Não salvou. Confira sua conexão e edite de novo.'
                  : ''}
          </div>
        </div>
      </div>

      <SongTabBar song={song} tab={tab} onChange={setTab} />

      <div role="tabpanel" id={panelId('overview')} aria-labelledby={tabId('overview')} className="song-panel" hidden={tab !== 'overview'}>
        <fieldset className="section">
          <legend className="section-title">Em que pé a banda está</legend>
          <div className="segmented segmented-stages">
            {STATUSES.map((s) => (
              <label key={s} className={`segment stage-${s}`}>
                <input
                  type="radio"
                  name="song-status"
                  value={s}
                  checked={song.status === s}
                  onChange={() => void moveSong(song.id, s, columnSongs(state.songs, s).length).catch(() => {})}
                />
                <StageIcon status={s} />
                <span>{STAGES[s].label}</span>
              </label>
            ))}
          </div>
          <p className="hint">{STAGES[song.status].hint}</p>
        </fieldset>

        <section className="section" aria-labelledby="confidence-title">
          <h3 id="confidence-title" className="section-title">
            Quem domina a música?
          </h3>
          {me && (
            <fieldset className="my-confidence">
              <legend className="field-label">Você, {me.name}</legend>
              <div className="segmented segmented-levels">
                {([1, 2, 3] as Level[]).map((l) => (
                  <label key={l} className={`segment level-${l}`} title={LEVELS[l].hint}>
                    <input type="radio" name="my-level" value={l} checked={myLevel === l} onChange={() => void setConfidence(song.id, l).catch(() => {})} />
                    <span className="level-dot">
                      <LevelGlyph level={l} />
                    </span>
                    <span>{LEVELS[l].label}</span>
                  </label>
                ))}
              </div>
              <p className="hint">
                {myLevel ? LEVELS[myLevel].hint : 'Avalie a sua parte para a banda saber o que ensaiar.'}
                {myLevel && (
                  <>
                    {' · '}
                    <button type="button" className="link-btn" onClick={() => void setConfidence(song.id, 0).catch(() => {})}>
                      Limpar
                    </button>
                  </>
                )}
              </p>
            </fieldset>
          )}
          <ul className="member-levels" role="list">
            {state.members
              .filter((m) => m.id !== me?.id)
              .map((m) => {
                const l = levels.get(m.id);
                return (
                  <li key={m.id} className={`member-level ${l ? `level-${l}` : 'level-none'}`}>
                    <Avatar member={m} size="sm" />
                    <span className="member-level-name">{m.name}</span>
                    <span className="member-level-value">
                      {l && (
                        <span className="level-dot">
                          <LevelGlyph level={l} />
                        </span>
                      )}
                      {l ? LEVELS[l].label : 'Não avaliou'}
                    </span>
                  </li>
                );
              })}
          </ul>
        </section>

        <section className="section" aria-labelledby="details-title">
          <div className="section-head">
            <h3 id="details-title" className="section-title">
              Detalhes
            </h3>
            {!draft.original && (
              <button type="button" className="btn btn-ghost btn-sm" onClick={lookUp} disabled={enriching}>
                <Wand2 size={16} aria-hidden />
                {enriching ? 'Buscando…' : 'Buscar tom, afinação e links'}
              </button>
            )}
          </div>
          <div className="details-grid">
            <div className="field">
              <label htmlFor="song-key">Tom</label>
              <input
                id="song-key"
                list="key-options"
                maxLength={24}
                placeholder="Ex.: Am"
                value={draft.key}
                onChange={(e) => {
                  set('key', e.target.value);
                  commitText('key', e.target.value);
                }}
                onBlur={flush}
              />
              <datalist id="key-options">
                {KEYS.map((k) => (
                  <option key={k} value={k} />
                ))}
              </datalist>
            </div>
            <div className="field">
              <label htmlFor="song-bpm">Andamento (bpm)</label>
              <input
                id="song-bpm"
                inputMode="numeric"
                placeholder="120"
                value={draft.bpm}
                onChange={(e) => set('bpm', e.target.value.replace(/\D/g, '').slice(0, 3))}
                onBlur={commitBpm}
                aria-invalid={!!errors.bpm}
                aria-describedby={errors.bpm ? 'song-bpm-error' : undefined}
              />
              {errors.bpm && (
                <p id="song-bpm-error" className="field-error">
                  {errors.bpm}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="song-duration">Duração</label>
              <input
                id="song-duration"
                inputMode="decimal"
                placeholder="3:45"
                value={draft.duration}
                onChange={(e) => set('duration', e.target.value)}
                onBlur={commitDuration}
                aria-invalid={!!errors.duration}
                aria-describedby={errors.duration ? 'song-duration-error' : undefined}
              />
              {errors.duration && (
                <p id="song-duration-error" className="field-error">
                  {errors.duration}
                </p>
              )}
            </div>
            <div className="field">
              <label htmlFor="song-tuning">Afinação</label>
              <input
                id="song-tuning"
                list="tuning-options"
                maxLength={40}
                placeholder="Padrão"
                value={draft.tuning}
                onChange={(e) => {
                  set('tuning', e.target.value);
                  commitText('tuning', e.target.value);
                }}
                onBlur={flush}
              />
              <datalist id="tuning-options">
                {TUNINGS.map((t) => (
                  <option key={t} value={t} />
                ))}
              </datalist>
            </div>
          </div>
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.original}
              onChange={(e) => {
                set('original', e.target.checked);
                queue({ original: e.target.checked }, 0);
              }}
            />
            É uma música autoral
          </label>
          {!draft.original && <p className="hint">O tom vem da análise do Spotify e às vezes troca pelo relativo menor/maior. Confira de ouvido.</p>}
        </section>

        <Parts song={song} />

        <details className="section notes-disclosure" open={!!song.notes.trim()}>
          <summary className="section-title">Outras observações</summary>
          <label htmlFor="song-notes" className="visually-hidden">
            Outras observações
          </label>
          <textarea
            id="song-notes"
            rows={3}
            placeholder="Estrutura, deixas, aquela parte que sempre erramos…"
            value={draft.notes}
            maxLength={10_000}
            onChange={(e) => {
              set('notes', e.target.value);
              commitText('notes', e.target.value, 1200);
            }}
            onBlur={flush}
          />
        </details>

        <Links song={song} />

        <div className="sheet-danger">
          <button className="btn btn-ghost btn-danger-text btn-sm" onClick={() => setConfirming(true)}>
            <Trash2 size={16} aria-hidden />
            Excluir música
          </button>
        </div>
        <ConfirmDialog
          open={confirming}
          onClose={() => setConfirming(false)}
          title={`Excluir “${song.title}”?`}
          message={
            inSetlists.length
              ? `Ela também sai de ${inSetlists.length === 1 ? '1 setlist' : `${inSetlists.length} setlists`}, e as avaliações de todo mundo se perdem. Não dá para desfazer.`
              : 'As avaliações e anotações dela se perdem. Não dá para desfazer.'
          }
          confirmLabel="Excluir música"
          onConfirm={() => {
            pending.current = {};
            onDeleted();
            void deleteSong(song.id).catch(() => {});
          }}
        />
      </div>

      {isTextTab(tab) && <TextPanel key={tab} song={song} kind={tab} value={texts?.[tab]} failed={failed} onSaved={remember} />}
      {(tab === 'audio' || tab === 'image') && <FilesPanel key={tab} song={song} kind={tab} />}
    </div>
  );
}

/** The cover in the sheet header; opens a Deezer search to pick (or change) the artwork. */
function CoverPicker({ song }: { song: Song }) {
  const { setCover } = useBand();
  const [searching, setSearching] = useState(false);
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState(false);

  const start = () => {
    setQuery([song.title, song.artist].filter(Boolean).join(' '));
    setSearching(true);
  };
  const choose = async (m: Match) => {
    if (!m.cover) return;
    setBusy(true);
    try {
      await setCover(song.id, m.cover);
      setSearching(false);
    } catch {
      // Store showed the error.
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="cover-picker">
      <button type="button" className="cover-button" onClick={start} aria-label={song.cover ? 'Trocar a capa' : 'Buscar uma capa'} aria-expanded={searching}>
        <CoverArt src={song.cover} title={song.title} size={96} />
        <span className="cover-button-badge" aria-hidden>
          <ImagePlus size={14} />
        </span>
      </button>
      {searching && (
        <div className="cover-search" aria-busy={busy}>
          <label htmlFor="cover-query" className="field-label">
            Escolha a capa
          </label>
          <SongSearch id="cover-query" autoFocus value={query} onChange={setQuery} onPick={choose} onEscape={() => setSearching(false)} />
          <div className="row">
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => setSearching(false)}>
              Cancelar
            </button>
            {song.cover && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  void setCover(song.id, null).catch(() => {});
                  setSearching(false);
                }}
              >
                <ImageOff size={16} aria-hidden />
                Tirar a capa
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const ROLE_SUGGESTIONS = [
  'Voz principal', 'Backing vocal', 'Guitarra base', 'Guitarra solo', 'Violão', 'Baixo', 'Bateria', 'Teclado', 'Piano',
  'Synth', 'Percussão', 'Voz e guitarra', 'Voz e violão', 'Voz e piano', 'Não toca nessa',
];

/** "Quem faz o quê": each member's part on this song, defaulting (as a hint) to their usual instrument. */
function Parts({ song }: { song: Song }) {
  const { state, me, setPart } = useBand();
  const members = [...state.members].sort((a, b) => (a.id === me?.id ? -1 : b.id === me?.id ? 1 : 0));
  const roleOf = (memberId: string) => state.parts.find((p) => p.songId === song.id && p.memberId === memberId)?.role ?? '';
  return (
    <section className="section" aria-labelledby="parts-title">
      <h3 id="parts-title" className="section-title">
        Quem faz o quê
      </h3>
      <ul className="parts" role="list">
        {members.map((m) => (
          <PartRow key={`${m.id}-${roleOf(m.id)}`} member={m} isMe={m.id === me?.id} role={roleOf(m.id)} onSave={(role) => void setPart(song.id, m.id, role).catch(() => {})} />
        ))}
      </ul>
      <datalist id="role-suggestions">
        {ROLE_SUGGESTIONS.map((r) => (
          <option key={r} value={r} />
        ))}
      </datalist>
    </section>
  );
}

function PartRow({ member, isMe, role, onSave }: { member: Member; isMe: boolean; role: string; onSave: (role: string) => void }) {
  const [value, setValue] = useState(role);
  const id = `part-${member.id}`;
  const commit = () => value.trim() !== role && onSave(value.trim());
  return (
    <li className="part-row">
      <Avatar member={member} size="sm" />
      <label htmlFor={id} className="part-name">
        {isMe ? `${member.name} (você)` : member.name}
      </label>
      <input
        id={id}
        list="role-suggestions"
        maxLength={80}
        placeholder={member.instrument || 'O que faz nessa música'}
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), e.currentTarget.blur())}
      />
    </li>
  );
}

const KNOWN_SITES: [RegExp, string][] = [
  [/(^|\.)youtube\.com$|(^|\.)youtu\.be$/, 'YouTube'],
  [/(^|\.)spotify\.com$/, 'Spotify'],
  [/(^|\.)deezer\.com$/, 'Deezer'],
  [/(^|\.)cifraclub\.com\.br$/, 'Cifra Club'],
  [/(^|\.)ultimate-guitar\.com$/, 'Ultimate Guitar'],
  [/(^|\.)songsterr\.com$/, 'Songsterr'],
  [/(^|\.)music\.apple\.com$/, 'Apple Music'],
  [/(^|\.)soundcloud\.com$/, 'SoundCloud'],
  [/(^|\.)drive\.google\.com$/, 'Google Drive'],
];

function siteName(url: string) {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    return KNOWN_SITES.find(([re]) => re.test(host))?.[1] ?? host;
  } catch {
    return url;
  }
}

function Links({ song }: { song: Song }) {
  const { updateSong } = useBand();
  const toast = useToast();
  const [url, setUrl] = useState('');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);

  const add = () => {
    let value = url.trim();
    if (!value) return;
    if (!/^https?:\/\//i.test(value)) value = `https://${value}`;
    try {
      new URL(value);
    } catch {
      setError('Cole o endereço completo, como https://youtu.be/…');
      return;
    }
    setError(null);
    const links: Link[] = [...song.links, { url: value, label: label.trim() }];
    setUrl('');
    setLabel('');
    void updateSong(song.id, { links }).catch(() => {});
  };

  const remove = (index: number) => {
    const before = song.links;
    const name = before[index].label || siteName(before[index].url);
    void updateSong(song.id, { links: before.filter((_, j) => j !== index) }).catch(() => {});
    toast.info(`Link “${name}” removido`, { label: 'Desfazer', run: () => void updateSong(song.id, { links: before }).catch(() => {}) });
  };

  return (
    <section className="section" aria-labelledby="links-title">
      <h3 id="links-title" className="section-title">
        Links
      </h3>
      {song.links.length > 0 && (
        <ul className="links" role="list">
          {song.links.map((l, i) => (
            <li key={`${l.url}-${i}`} className="link-row">
              <a href={l.url} target="_blank" rel="noopener noreferrer" className="link-open">
                <ExternalLink size={16} aria-hidden />
                <span className="link-label">{l.label || siteName(l.url)}</span>
                {l.label && !l.label.toLowerCase().includes(siteName(l.url).toLowerCase()) && <span className="link-host">{siteName(l.url)}</span>}
              </a>
              <button className="icon-btn icon-btn-sm" aria-label={`Remover link ${l.label || siteName(l.url)}`} onClick={() => remove(i)}>
                <X size={16} aria-hidden />
              </button>
            </li>
          ))}
        </ul>
      )}
      <form
        className="link-add"
        onSubmit={(e) => {
          e.preventDefault();
          add();
        }}
      >
        <div className="field grow">
          <label htmlFor="link-url" className="visually-hidden">
            Endereço do link
          </label>
          <input
            id="link-url"
            inputMode="url"
            placeholder="Cole um link do YouTube, Spotify ou da cifra"
            value={url}
            onChange={(e) => setUrl(e.target.value)}
            aria-invalid={!!error}
            aria-describedby={error ? 'link-error' : undefined}
          />
        </div>
        <div className="field link-label-field">
          <label htmlFor="link-label" className="visually-hidden">
            Nome do link (opcional)
          </label>
          <input id="link-label" placeholder="Nome (opcional)" maxLength={60} value={label} onChange={(e) => setLabel(e.target.value)} />
        </div>
        <button className="btn btn-secondary" disabled={!url.trim() || song.links.length >= 12}>
          <Plus size={16} aria-hidden />
          Adicionar
        </button>
      </form>
      {error && (
        <p id="link-error" className="field-error">
          {error}
        </p>
      )}
    </section>
  );
}
