import { useId, type HTMLAttributes } from 'react';
import { History } from 'lucide-react';
import type { Level, Member, Song } from '../lib/types';
import { formatDuration, shortAgo } from '../lib/format';
import { isStandardTuning } from '../lib/stages';
import { ConfidenceStack } from './Avatar';
import { CoverArt, useSongTint } from './Cover';

type Props = {
  song: Song;
  members: Member[];
  levels: Map<string, Level>;
  lifted?: boolean;
  interactive?: HTMLAttributes<HTMLDivElement>;
};

export function SongCard({ song, members, levels, lifted, interactive }: Props) {
  const detailsId = useId();
  const tint = useSongTint(song.cover, song.title);
  const meta = [
    song.key && { label: 'Tom', value: song.key },
    song.bpm && { label: 'Andamento', value: `${song.bpm} bpm` },
    song.duration && { label: 'Duração', value: formatDuration(song.duration) },
  ].filter(Boolean) as { label: string; value: string }[];

  // The card is a button, whose children are presentational: expose the details as its description.
  const describedBy = [interactive?.['aria-describedby'], detailsId].filter(Boolean).join(' ');

  return (
    <div
      className={`song-card${lifted ? ' is-lifted' : ''}`}
      style={tint}
      {...interactive}
      aria-label={interactive ? `${song.title}${song.artist ? `, de ${song.artist}` : ''}` : undefined}
      aria-describedby={interactive ? describedBy : undefined}
    >
      <div className="song-card-top">
        <CoverArt src={song.cover} title={song.title} size={52} className="song-card-cover" />
        <div className="song-card-heading">
          <span className="song-title">{song.title}</span>
          {song.artist && <span className="song-artist">{song.artist}</span>}
          {song.original && <span className="tag tag-original">Autoral</span>}
        </div>
      </div>
      <div id={detailsId} className="song-card-details">
        {(meta.length > 0 || !isStandardTuning(song.tuning)) && (
          <dl className="song-meta">
            {meta.map((m) => (
              <div key={m.label} className="meta-item">
                <dt className="visually-hidden">{m.label}</dt>
                <dd>{m.value}</dd>
              </div>
            ))}
            {!isStandardTuning(song.tuning) && (
              <div className="meta-item meta-tuning">
                <dt className="visually-hidden">Afinação</dt>
                <dd>{song.tuning}</dd>
              </div>
            )}
          </dl>
        )}
        <div className="song-card-foot">
          <ConfidenceStack members={members} levels={levels} />
          {song.lastRehearsed && (
            <span className="rehearsed" title={`Último ensaio em ${new Date(song.lastRehearsed).toLocaleDateString('pt-BR')}`}>
              <History size={14} aria-hidden />
              <span className="visually-hidden">Último ensaio </span>
              {shortAgo(song.lastRehearsed)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
