import type { Confidence, Setlist, SetlistItem, Song } from './types';
import { isStandardTuning } from './stages';

export type Row = { item: SetlistItem; song?: Song; number?: number; retuneTo?: string };

const normTuning = (t: string) => (isStandardTuning(t) ? 'Padrão' : t.trim());

/** Numbers songs, and flags where the band has to retune since the previous song. */
export function rowsOf(setlist: Setlist, songsById: Map<string, Song>): Row[] {
  let n = 0;
  let lastTuning: string | null = null;
  return setlist.items.map((item) => {
    if (item.type !== 'song') return { item };
    const song = item.songId ? songsById.get(item.songId) : undefined;
    if (!song) return { item };
    const tuning = normTuning(song.tuning);
    const retuneTo = lastTuning !== null && tuning !== lastTuning ? tuning : undefined;
    lastTuning = tuning;
    return { item, song, number: ++n, retuneTo };
  });
}

export function summarize(setlist: Setlist, songsById: Map<string, Song>) {
  const songs = setlist.items.flatMap((i) => (i.songId && songsById.get(i.songId) ? [songsById.get(i.songId)!] : []));
  const runtime = songs.reduce((sum, s) => sum + (s.duration ?? 0), 0);
  return {
    songs,
    runtime,
    missingDuration: songs.filter((s) => !s.duration).length,
    ready: songs.filter((s) => s.status === 'ready').length,
    done: setlist.items.filter((i) => i.type === 'song' && i.done).length,
  };
}

/** Runtime of the set that ends at each break, keyed by the break item's id. */
export function setRuntimes(rows: Row[]) {
  const totals = new Map<string, number>();
  let running = 0;
  for (const row of rows) {
    if (row.item.type === 'break') {
      totals.set(row.item.id, running);
      running = 0;
    } else if (row.song) running += row.song.duration ?? 0;
  }
  return { totals, last: running };
}

/**
 * What to rehearse: songs in progress, plus ready songs someone still feels shaky on,
 * least recently rehearsed first.
 */
export function needsWork(songs: Song[], confidence: Confidence[], limit = 12): Song[] {
  const weak = new Set(confidence.filter((c) => c.level < 3).map((c) => c.songId));
  const rank = (s: Song) => (s.status === 'shaky' ? 0 : s.status === 'learning' ? 1 : 2);
  return songs
    .filter((s) => s.status === 'learning' || s.status === 'shaky' || (s.status === 'ready' && weak.has(s.id)))
    .sort((a, b) => (a.lastRehearsed ?? 0) - (b.lastRehearsed ?? 0) || rank(a) - rank(b))
    .slice(0, limit);
}

export const newItemId = () => crypto.randomUUID();
