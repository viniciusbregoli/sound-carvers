import { useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ChevronRight, List, TriangleAlert, X } from 'lucide-react';
import { navigate } from '../lib/router';
import { useBand } from '../lib/store';
import { rowsOf, type Row } from '../lib/setlist';
import { formatDuration } from '../lib/format';
import { isStandardTuning } from '../lib/stages';
import { CoverArt } from '../components/Cover';
import { Avatar } from '../components/Avatar';

/** Big, high-contrast view for reading from a phone or tablet on stage. */
export function Stage({ setlistId }: { setlistId: string }) {
  const { state, songsById } = useBand();
  const setlist = state.setlists.find((l) => l.id === setlistId);
  const rows = useMemo(() => (setlist ? rowsOf(setlist, songsById).filter((r) => r.song || r.item.type !== 'song') : []), [setlist, songsById]);
  const [index, setIndex] = useState(0);
  const [overview, setOverview] = useState(false);
  const touchStart = useRef<{ x: number; y: number } | null>(null);
  const exit = () => navigate(`/setlists/${setlistId}`);

  const current = Math.min(index, Math.max(rows.length - 1, 0));
  const go = (delta: number) => setIndex((i) => Math.max(0, Math.min(rows.length - 1, i + delta)));

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLElement && e.target.closest('input, textarea')) return;
      // Page-turner pedals send PageDown/PageUp or arrow keys.
      if (['ArrowRight', 'ArrowDown', 'PageDown', ' '].includes(e.key)) {
        e.preventDefault();
        go(1);
      } else if (['ArrowLeft', 'ArrowUp', 'PageUp'].includes(e.key)) {
        e.preventDefault();
        go(-1);
      } else if (e.key === 'Escape') {
        if (overview) setOverview(false);
        else exit();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  // Keep the screen awake while on stage.
  useEffect(() => {
    let lock: WakeLockSentinel | null = null;
    const acquire = async () => {
      try {
        lock = (await navigator.wakeLock?.request('screen')) ?? null;
      } catch {
        // Not supported or denied (e.g. low battery); the view still works.
      }
    };
    void acquire();
    const onVisible = () => document.visibilityState === 'visible' && void acquire();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      document.removeEventListener('visibilitychange', onVisible);
      void lock?.release();
    };
  }, []);

  if (!setlist) {
    return (
      <div className="stage">
        <div className="stage-empty">
          <p>Setlist não encontrado.</p>
          <button className="stage-btn" onClick={() => navigate('/setlists')}>
            Voltar para os setlists
          </button>
        </div>
      </div>
    );
  }

  const row = rows[current];
  const next = rows.slice(current + 1).find((r) => r.song);
  const songCount = rows.filter((r) => r.song).length;

  return (
    <div
      className="stage"
      onTouchStart={(e) => (touchStart.current = { x: e.touches[0].clientX, y: e.touches[0].clientY })}
      onTouchEnd={(e) => {
        const start = touchStart.current;
        touchStart.current = null;
        if (!start || overview) return;
        const dx = e.changedTouches[0].clientX - start.x;
        const dy = e.changedTouches[0].clientY - start.y;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) go(dx < 0 ? 1 : -1);
      }}
    >
      <header className="stage-top">
        <button className="stage-icon-btn" onClick={exit} aria-label="Sair do modo palco">
          <X size={26} aria-hidden />
        </button>
        <span className="stage-setlist-name">{setlist.name}</span>
        <button className="stage-icon-btn" onClick={() => setOverview((o) => !o)} aria-pressed={overview} aria-label="Setlist inteiro">
          <List size={26} aria-hidden />
        </button>
      </header>

      {rows.length === 0 ? (
        <div className="stage-empty">
          <p>Este setlist ainda não tem músicas.</p>
          <button className="stage-btn" onClick={exit}>
            Adicionar músicas
          </button>
        </div>
      ) : overview ? (
        <ol className="stage-overview" role="list">
          {rows.map((r, i) => (
            <li key={r.item.id}>
              <button
                className={`stage-overview-row${i === current ? ' is-current' : ''}${r.item.type !== 'song' ? ' is-marker' : ''}`}
                aria-current={i === current ? 'step' : undefined}
                onClick={() => {
                  setIndex(i);
                  setOverview(false);
                }}
              >
                {r.song ? (
                  <>
                    <span className="stage-overview-num">{r.number}</span>
                    <span className="stage-overview-title">{r.song.title}</span>
                    {r.retuneTo && <span className="stage-overview-retune">→ {r.retuneTo}</span>}
                  </>
                ) : (
                  <span className="stage-overview-title">{r.item.text || (r.item.type === 'break' ? 'Intervalo' : 'Anotação')}</span>
                )}
              </button>
            </li>
          ))}
        </ol>
      ) : (
        <main className="stage-main" aria-live="polite">
          <Current row={row} total={songCount} />
        </main>
      )}

      {!overview && rows.length > 0 && (
        <footer className="stage-bottom">
          <button className="stage-nav" onClick={() => go(-1)} disabled={current === 0} aria-label="Anterior">
            <ChevronLeft size={34} aria-hidden />
          </button>
          <div className="stage-next">
            {next ? (
              <>
                <span className="stage-next-label">Próxima</span>
                <span className="stage-next-title">
                  {next.retuneTo && <TriangleAlert size={20} aria-label={`Trocar afinação para ${next.retuneTo}`} />}
                  {next.song!.title}
                </span>
              </>
            ) : (
              <span className="stage-next-label">Última música</span>
            )}
          </div>
          <button className="stage-nav" onClick={() => go(1)} disabled={current === rows.length - 1} aria-label="Próxima">
            <ChevronRight size={34} aria-hidden />
          </button>
        </footer>
      )}
    </div>
  );
}

function Current({ row, total }: { row: Row; total: number }) {
  if (!row.song) {
    return (
      <div className="stage-marker">
        <span className="stage-marker-kind">{row.item.type === 'break' ? 'Intervalo' : 'Anotação'}</span>
        <h1 className="stage-marker-text">{row.item.text || (row.item.type === 'break' ? 'Intervalo' : 'Anotação')}</h1>
      </div>
    );
  }
  const { song } = row;
  const facts = [
    song.key && { label: 'Tom', value: song.key },
    song.bpm && { label: 'BPM', value: `${song.bpm}` },
    !isStandardTuning(song.tuning) && { label: 'Afinação', value: song.tuning },
    song.duration && { label: 'Duração', value: formatDuration(song.duration) },
  ].filter(Boolean) as { label: string; value: string }[];

  return (
    <article className="stage-song">
      {song.cover && <img className="stage-backdrop" src={song.cover} alt="" aria-hidden />}
      <CoverArt src={song.cover} title={song.title} size={280} className="stage-cover" />
      <div className="stage-song-text">
      <p className="stage-count">
        {row.number} <span>/ {total}</span>
      </p>
      {row.retuneTo && (
        <p className="stage-retune">
          <TriangleAlert size={24} aria-hidden /> Trocar afinação → {row.retuneTo}
        </p>
      )}
      <h1 className="stage-title">{song.title}</h1>
      {song.artist && <p className="stage-artist">{song.artist}</p>}
      {facts.length > 0 && (
        <dl className="stage-facts">
          {facts.map((f) => (
            <div key={f.label}>
              <dt>{f.label}</dt>
              <dd>{f.value}</dd>
            </div>
          ))}
        </dl>
      )}
      <StageParts songId={song.id} />
      {song.notes.trim() && <p className="stage-notes">{song.notes}</p>}
      </div>
    </article>
  );
}

/** Who plays what on this song; members without a part for it fall back to their usual instrument. */
function StageParts({ songId }: { songId: string }) {
  const { state } = useBand();
  const parts = state.members
    .map((m) => ({ member: m, role: state.parts.find((p) => p.songId === songId && p.memberId === m.id)?.role ?? '', fallback: m.instrument }))
    .filter((p) => p.role || p.fallback);
  if (!parts.some((p) => p.role)) return null;
  return (
    <ul className="stage-parts" role="list" aria-label="Quem faz o quê">
      {parts.map(({ member, role, fallback }) => (
        <li key={member.id} className={role ? '' : 'is-default'}>
          <Avatar member={member} size="md" />
          <span className="stage-part-name">{member.name}</span>
          <span className="stage-part-role">{role || fallback}</span>
        </li>
      ))}
    </ul>
  );
}
