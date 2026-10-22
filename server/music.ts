import { randomUUID } from 'node:crypto';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ugSheet } from './cifra.ts';

/** A track found on Deezer (or iTunes as a fallback), shaped for the add-song autocomplete. */
export type Match = {
  id: string;
  title: string;
  artist: string;
  album: string;
  duration: number | null;
  /** Small artwork for the suggestion list. */
  art: string | null;
  /** Larger artwork that gets stored when the song is added. */
  cover: string | null;
  deezerId: number | null;
};

// Only these CDNs are ever fetched, so the server can't be used to reach arbitrary hosts.
const ART_HOSTS = [/^([a-z0-9-]+\.)*dzcdn\.net$/, /^([a-z0-9-]+\.)*mzstatic\.com$/];
const IMAGE_TYPES: Record<string, string> = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' };
const MAX_IMAGE_BYTES = 2_000_000;

export function isArtUrl(raw: string) {
  try {
    const url = new URL(raw);
    return url.protocol === 'https:' && ART_HOSTS.some((re) => re.test(url.hostname));
  } catch {
    return false;
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getJson(url: string, ms = 4000): Promise<any> {
  const res = await fetch(url, { signal: AbortSignal.timeout(ms), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).hostname}`);
  return res.json();
}

type DeezerTrack = {
  id: number;
  title: string;
  duration: number;
  artist: { name: string };
  album: { title: string; cover_small?: string; cover_medium?: string; cover_big?: string };
};
type ItunesTrack = { trackId: number; trackName: string; artistName: string; collectionName?: string; trackTimeMillis?: number; artworkUrl100?: string };

async function searchDeezer(q: string): Promise<Match[]> {
  const data = await getJson(`https://api.deezer.com/search?limit=8&q=${encodeURIComponent(q)}`);
  if (data.error) throw new Error(data.error.message ?? 'Deezer error');
  return (data.data as DeezerTrack[]).map((t) => ({
    id: `dz-${t.id}`,
    title: t.title,
    artist: t.artist.name,
    album: t.album.title,
    duration: t.duration || null,
    art: t.album.cover_medium ?? null,
    cover: t.album.cover_big ?? t.album.cover_medium ?? null,
    deezerId: t.id,
  }));
}

async function searchItunes(q: string): Promise<Match[]> {
  const data = await getJson(`https://itunes.apple.com/search?entity=song&limit=8&country=BR&term=${encodeURIComponent(q)}`);
  return (data.results as ItunesTrack[]).map((t) => ({
    id: `it-${t.trackId}`,
    title: t.trackName,
    artist: t.artistName,
    album: t.collectionName ?? '',
    duration: t.trackTimeMillis ? Math.round(t.trackTimeMillis / 1000) : null,
    art: t.artworkUrl100?.replace('100x100bb', '200x200bb') ?? null,
    cover: t.artworkUrl100?.replace('100x100bb', '600x600bb') ?? null,
    deezerId: null,
  }));
}

export function createMusic(coversDir: string) {
  mkdirSync(coversDir, { recursive: true });
  const cache = new Map<string, { at: number; matches: Match[] }>();

  /** Search Deezer, falling back to iTunes; results are cached for an hour. */
  async function lookup(rawQuery: string): Promise<Match[]> {
    const q = rawQuery.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 120);
    const hit = cache.get(q);
    if (hit && Date.now() - hit.at < 3_600_000) return hit.matches;
    let matches: Match[];
    try {
      matches = await searchDeezer(q);
    } catch (err) {
      console.warn('deezer search failed, trying itunes:', (err as Error).message);
      matches = await searchItunes(q);
    }
    // Drop exact duplicates (same title + artist), which Deezer returns for reissues.
    const seen = new Set<string>();
    matches = matches.filter((m) => {
      const key = `${m.title.toLowerCase()}|${m.artist.toLowerCase()}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    if (cache.size > 300) cache.delete(cache.keys().next().value!);
    cache.set(q, { at: Date.now(), matches });
    return matches;
  }

  async function fetchImage(url: string) {
    if (!isArtUrl(url)) throw new Error('artwork host not allowed');
    const res = await fetch(url, { signal: AbortSignal.timeout(6000), redirect: 'error' });
    const type = (res.headers.get('content-type') ?? '').split(';')[0].trim();
    if (!res.ok || !IMAGE_TYPES[type]) throw new Error(`unexpected artwork response (${res.status} ${type})`);
    const bytes = Buffer.from(await res.arrayBuffer());
    if (bytes.length > MAX_IMAGE_BYTES) throw new Error('artwork too large');
    return { bytes, type };
  }

  /** Downloads artwork into the data dir; returns the stored file name. */
  async function saveCover(url: string): Promise<string> {
    const { bytes, type } = await fetchImage(url);
    const file = `${randomUUID()}.${IMAGE_TYPES[type]}`;
    writeFileSync(join(coversDir, file), bytes);
    return file;
  }

  function removeCover(file: string | null | undefined) {
    if (file && isCoverFile(file)) rmSync(join(coversDir, file), { force: true });
  }

  /**
   * Everything we can learn about a recording beyond the search result, each source best effort:
   * - Deezer track: tempo (when known) and the ISRC
   * - ReccoBeats (Spotify's audio analysis, looked up by ISRC): key and tempo
   * - Songsterr: the guitar tuning from the most-viewed guitar tab
   */
  async function details(match: { deezerId: number | null; title: string; artist: string }): Promise<Details> {
    const out: Details = { bpm: null, key: null, tuning: null, links: [] };
    let isrc: string | null = null;
    if (match.deezerId) {
      try {
        const track = await getJson(`https://api.deezer.com/track/${match.deezerId}`, 3000);
        out.bpm = validBpm(track.bpm);
        isrc = typeof track.isrc === 'string' ? track.isrc : null;
      } catch {
        // Keep going with the other sources.
      }
    }
    const [features, songsterr, cifra] = await Promise.all([
      isrc ? getJson(`https://api.reccobeats.com/v1/audio-features?ids=${encodeURIComponent(isrc)}`, 4000).catch(() => null) : null,
      songsterrSong(match.title, match.artist),
      cifraClubUrl(match.title, match.artist),
    ]);
    const f = features?.content?.[0];
    if (f && Number.isInteger(f.key) && f.key >= 0 && f.key < 12) out.key = KEY_NAMES[f.key] + (f.mode === 0 ? 'm' : '');
    out.bpm ??= f ? validBpm(f.tempo) : null;
    if (f && typeof f.href === 'string' && f.href.startsWith('https://open.spotify.com/')) out.links.unshift({ label: '', url: f.href });
    if (cifra) out.links.push({ label: '', url: cifra });
    if (songsterr) {
      out.tuning = songsterr.tuning;
      out.links.push({ label: '', url: songsterr.url });
    }
    out.links.push({
      label: 'YouTube (busca)',
      url: `https://www.youtube.com/results?search_query=${encodeURIComponent(`${match.title} ${match.artist}`.trim())}`,
    });
    return out;
  }

  async function songsterrSong(title: string, artist: string): Promise<{ url: string; tuning: string | null } | null> {
    try {
      const songs = (await getJson(`https://www.songsterr.com/api/songs?size=5&pattern=${encodeURIComponent(`${title} ${artist}`)}`, 4000)) as SongsterrSong[];
      const song = songs.find((s) => sameSong(s.title, s.artist, title, artist));
      if (!song) return null;
      const guitars = (song.tracks ?? [])
        .filter((t) => /guitar/i.test(t.instrument) && !/bass/i.test(t.instrument) && Array.isArray(t.tuning) && t.tuning.length >= 6)
        .sort((a, b) => (b.views ?? 0) - (a.views ?? 0));
      return {
        url: `https://www.songsterr.com/a/wsa/${slug(song.artist)}-${slug(song.title)}-tab-s${song.songId}`,
        tuning: guitars.length ? tuningName(guitars[0].tuning) : null,
      };
    } catch {
      return null;
    }
  }

  /** Cifra Club's own search index; we only link to the chord sheet, never fetch it. */
  async function cifraClubUrl(title: string, artist: string): Promise<string | null> {
    try {
      const data = await getJson(`https://solr.sscdn.co/cc/c7/?limit=5&q=${encodeURIComponent(`${title} ${artist}`)}`, 4000);
      const docs = (data?.response?.docs ?? []) as { art: string; txt: string; dns: string; url: string }[];
      const doc = docs.find((d) => d.dns && d.url && sameSong(d.txt, d.art, title, artist));
      return doc ? `https://www.cifraclub.com.br/${encodeURIComponent(doc.dns)}/${encodeURIComponent(doc.url)}/` : null;
    } catch {
      return null;
    }
  }

  /** Plain lyrics from LRCLIB (free and community-run), matched by title and artist, closest length first. */
  async function lyrics(title: string, artist: string, duration: number | null): Promise<string | null> {
    const params = new URLSearchParams({ track_name: title, ...(artist ? { artist_name: artist } : {}) });
    const res = await fetch(`https://lrclib.net/api/search?${params}`, {
      signal: AbortSignal.timeout(6000),
      headers: { accept: 'application/json', 'user-agent': 'SoundCarversSetlist/1.0' },
    });
    if (!res.ok) throw new Error(`${res.status} from lrclib.net`);
    const found = (await res.json()) as LrclibTrack[];
    const candidates = found.filter((t) => !t.instrumental && t.plainLyrics?.trim() && sameSong(t.trackName, t.artistName, title, artist));
    if (duration) candidates.sort((a, b) => Math.abs((a.duration ?? 0) - duration) - Math.abs((b.duration ?? 0) - duration));
    return candidates[0]?.plainLyrics?.trim() ?? null;
  }

  /**
   * The most-voted "Chords" version of a song on Ultimate Guitar, as a plain sheet. Their pages carry the data as JSON
   * in a `js-store` element; we read the search page and then the one sheet we pick.
   */
  async function chords(title: string, artist: string): Promise<{ text: string; url: string } | null> {
    const search = await ugStore(`https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(`${title} ${artist}`.trim())}`);
    const results = (search?.store?.page?.data?.results ?? []) as UgResult[];
    const best = results
      .filter((r): r is UgResult & { tab_url: string } => r.type === 'Chords' && isUgTabUrl(r.tab_url) && sameSong(unescapeHtml(r.song_name ?? ''), unescapeHtml(r.artist_name ?? ''), title, artist))
      .sort((a, b) => (b.votes ?? 0) - (a.votes ?? 0))[0];
    if (!best) return null;
    const tab = (await ugStore(best.tab_url))?.store?.page?.data?.tab_view;
    const content = tab?.wiki_tab?.content;
    if (typeof content !== 'string') return null;
    const text = ugSheet(content, Number(tab?.meta?.capo) || 0);
    return text ? { text, url: best.tab_url } : null;
  }

  return { lookup, fetchImage, saveCover, removeCover, details, lyrics, chords, coversDir };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function ugStore(url: string): Promise<any> {
  const res = await fetch(url, {
    signal: AbortSignal.timeout(8000),
    redirect: 'error',
    headers: { accept: 'text/html', 'user-agent': 'SoundCarversSetlist/1.0' },
  });
  if (!res.ok) throw new Error(`${res.status} from ${new URL(url).hostname}`);
  const html = await res.text();
  if (html.length > 5_000_000) throw new Error(`page too large on ${new URL(url).hostname}`);
  const store = /class="js-store" data-content="([^"]*)"/.exec(html);
  if (!store) throw new Error(`no data on ${new URL(url).hostname} (page changed or blocked)`);
  return JSON.parse(unescapeHtml(store[1]));
}

// Only sheet pages are fetched, never whatever URL a search result claims.
const isUgTabUrl = (raw: unknown): raw is string => typeof raw === 'string' && /^https:\/\/tabs\.ultimate-guitar\.com\/tab\/[^?#]+$/.test(raw);

const ENTITIES: Record<string, string> = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' };
const ACCENTS: Record<string, string> = { acute: '\u0301', grave: '\u0300', circ: '\u0302', tilde: '\u0303', uml: '\u0308', cedil: '\u0327', ring: '\u030a' };
/** HTML entities, including the accented letters (`&atilde;`) that UG's song and artist names come with. */
export const unescapeHtml = (s: string) =>
  s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e: string) => {
    if (e[0] === '#') return String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1)));
    const accent = /^([a-z])(acute|grave|circ|tilde|uml|cedil|ring)$/i.exec(e);
    return accent ? (accent[1] + ACCENTS[accent[2]]).normalize('NFC') : (ENTITIES[e] ?? m);
  });

const norm = (s: string) =>
  s
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/\(.*?\)|\[.*?\]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/** The search result that is plausibly the same song, preferring studio versions over live ones. */
export function bestMatch(matches: Match[], title: string, artist: string): Match | null {
  const candidates = matches.filter((m) => m.cover && sameSong(m.title, m.artist, title, artist));
  const live = (m: Match) => /ao vivo|live|ac[uú]stico|acoustic/i.test(`${m.title} ${m.album}`);
  return candidates.find((m) => !live(m)) ?? candidates[0] ?? null;
}

export type Details = { bpm: number | null; key: string | null; tuning: string | null; links: { label: string; url: string }[] };
type LrclibTrack = { trackName: string; artistName: string; duration?: number; instrumental?: boolean; plainLyrics?: string | null };
type UgResult = { type?: string; song_name?: string; artist_name?: string; votes?: number; tab_url?: unknown };
type SongsterrSong = { songId: number; title: string; artist: string; tracks?: { instrument: string; views?: number; tuning: number[] }[] };

const slug = (s: string) => norm(s).replace(/ /g, '-');

const KEY_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];
const NOTE_NAMES = ['C', 'C♯', 'D', 'E♭', 'E', 'F', 'F♯', 'G', 'A♭', 'A', 'B♭', 'B'];

function validBpm(value: unknown) {
  const bpm = Math.round(Number(value));
  return bpm >= 20 && bpm <= 400 ? bpm : null;
}

const STANDARD = [64, 59, 55, 50, 45, 40];
const NAMED_TUNINGS: [number[], string][] = [
  [STANDARD, 'Padrão'],
  [[64, 59, 55, 50, 45, 38], 'Drop D'],
  [STANDARD.map((n) => n - 1), 'Meio tom abaixo (E♭)'],
  [STANDARD.map((n) => n - 2), 'Um tom abaixo (D)'],
  [[63, 58, 54, 49, 44, 37], 'Drop C♯'],
  [[62, 57, 53, 48, 43, 36], 'Drop C'],
  [[62, 57, 55, 50, 45, 38], 'DADGAD'],
  [[62, 59, 55, 50, 43, 38], 'Open G'],
  [[62, 57, 54, 50, 45, 38], 'Open D'],
];

/** Songsterr tunings are MIDI notes from the highest string down. */
export function tuningName(midi: number[]): string {
  const named = NAMED_TUNINGS.find(([notes]) => notes.length === midi.length && notes.every((n, i) => n === midi[i]));
  if (named) return named[1];
  return [...midi].reverse().map((n) => NOTE_NAMES[((n % 12) + 12) % 12]).join(' ');
}

function sameSong(foundTitle: string, foundArtist: string, title: string, artist: string) {
  const mt = norm(foundTitle);
  const t = norm(title);
  const titleOk = mt === t || mt.startsWith(`${t} `) || t.startsWith(`${mt} `);
  const a = norm(artist);
  const ma = norm(foundArtist);
  return titleOk && (!a || ma.includes(a) || a.includes(ma));
}

export const isCoverFile = (file: string) => /^[0-9a-f-]{36}\.(jpg|png|webp)$/.test(file);
export const coverType = (file: string) =>
  file.endsWith('.png') ? 'image/png' : file.endsWith('.webp') ? 'image/webp' : 'image/jpeg';

export type Music = ReturnType<typeof createMusic>;
