import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, clientId, upload } from './api';
import { useToast } from '../components/Toast';
import { STAGES } from './stages';
import type { BandState, Level, Member, Setlist, SetlistItem, Song, Status, TextKind } from './types';

export type NewSong = Partial<Omit<Song, 'cover'>> & { title: string; coverUrl?: string | null; deezerId?: number | null };

type Store = {
  state: BandState;
  me: Member | null;
  songsById: Map<string, Song>;
  /** Pause realtime refetches while the user is mid-drag. */
  setBusy: (busy: boolean) => void;
  refresh: () => Promise<void>;
  addSong: (song: NewSong) => Promise<string>;
  updateSong: (id: string, patch: Partial<Song>) => Promise<void>;
  /** Downloads remote artwork as the song's cover, or removes it with null. */
  setCover: (id: string, coverUrl: string | null) => Promise<void>;
  /** Looks up cover, key, tuning and links for every song (not originals) never looked up. */
  enrichAll: () => Promise<{ checked: number; updated: number }>;
  /** Same for one song; returns which fields were filled. */
  enrichSong: (id: string) => Promise<string[]>;
  moveSong: (id: string, status: Status, index: number) => Promise<void>;
  deleteSong: (id: string) => Promise<void>;
  setConfidence: (songId: string, level: Level | 0) => Promise<void>;
  markRehearsed: (songId: string, at?: number | null) => Promise<void>;
  setPart: (songId: string, memberId: string, role: string) => Promise<void>;
  /** Saves a lyrics/chords/tab sheet (empty removes it); resolves with its new version stamp. */
  saveText: (songId: string, kind: TextKind, body: string) => Promise<number | null>;
  /** Fills empty lyrics from the internet; resolves false when nothing was found. */
  lookupLyrics: (songId: string) => Promise<boolean>;
  lookupChords: (songId: string) => Promise<boolean>;
  importChords: (songId: string, text: string) => Promise<void>;
  uploadFile: (songId: string, file: Blob, type: string, name: string, onProgress?: (fraction: number) => void) => Promise<void>;
  renameFile: (id: string, name: string) => Promise<void>;
  deleteFile: (id: string) => Promise<void>;
  addSetlist: (setlist: Partial<Setlist> & { name: string }) => Promise<string>;
  updateSetlist: (id: string, patch: Partial<Setlist>) => Promise<void>;
  setItems: (id: string, items: SetlistItem[]) => Promise<void>;
  deleteSetlist: (id: string) => Promise<void>;
  addMember: (member: Pick<Member, 'name' | 'instrument' | 'color'>) => Promise<string>;
  updateMember: (id: string, patch: Partial<Member>) => Promise<void>;
  deleteMember: (id: string) => Promise<void>;
};

const Ctx = createContext<Store | null>(null);

export function useBand() {
  const store = useContext(Ctx);
  if (!store) throw new Error('useBand outside BandProvider');
  return store;
}

export function BandProvider({ initial, memberId, children }: { initial: BandState; memberId: string | null; children: ReactNode }) {
  const [state, setState] = useState(initial);
  const toast = useToast();
  const busy = useRef(false);
  const pending = useRef(false);

  const refresh = useCallback(async () => {
    if (busy.current) {
      pending.current = true;
      return;
    }
    try {
      setState(await api<BandState>('GET', '/api/state'));
    } catch (err) {
      if ((err as { status?: number }).status === 401) location.reload();
    }
  }, []);

  const setBusy = useCallback(
    (value: boolean) => {
      busy.current = value;
      if (!value && pending.current) {
        pending.current = false;
        void refresh();
      }
    },
    [refresh],
  );

  // Realtime: the server pings us on any change; refetch unless we caused it.
  useEffect(() => {
    let timer: number | undefined;
    const source = new EventSource('/api/events');
    const schedule = () => {
      clearTimeout(timer);
      timer = window.setTimeout(refresh, 120);
    };
    source.addEventListener('changed', (e) => {
      const { origin } = JSON.parse((e as MessageEvent).data);
      if (origin !== clientId) schedule();
    });
    // After a reconnect (phone slept, wifi hopped) we may have missed events.
    source.addEventListener('hello', schedule);
    const onVisible = () => document.visibilityState === 'visible' && schedule();
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      source.close();
      clearTimeout(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [refresh]);

  /** Apply locally first, then persist; on failure, explain and resync from the server. */
  const optimistic = useCallback(
    async (apply: (s: BandState) => BandState, request: () => Promise<unknown>) => {
      setState(apply);
      try {
        await request();
      } catch (err) {
        toast.error((err as Error).message);
        await refresh();
        throw err;
      }
    },
    [refresh, toast],
  );

  const withRefresh = useCallback(
    async <T,>(request: () => Promise<T>) => {
      try {
        const result = await request();
        await refresh();
        return result;
      } catch (err) {
        toast.error((err as Error).message);
        throw err;
      }
    },
    [refresh, toast],
  );

  const store = useMemo<Store>(() => {
    const songsById = new Map(state.songs.map((s) => [s.id, s]));
    const me = state.members.find((m) => m.id === memberId) ?? null;
    const patchSong = (id: string, patch: Partial<Song>) => (s: BandState) => ({
      ...s,
      songs: s.songs.map((song) => (song.id === id ? { ...song, ...patch } : song)),
    });
    const patchSetlist = (id: string, patch: Partial<Setlist>) => (s: BandState) => ({
      ...s,
      setlists: s.setlists.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    });

    return {
      state,
      me,
      songsById,
      setBusy,
      refresh,
      addSong: (song) => withRefresh(() => api<{ id: string }>('POST', '/api/songs', song).then((r) => r.id)),
      updateSong: (id, patch) => optimistic(patchSong(id, patch), () => api('PATCH', `/api/songs/${id}`, patch)),
      setCover: (id, coverUrl) => withRefresh(() => api('PATCH', `/api/songs/${id}`, { coverUrl }).then(() => undefined)),
      enrichAll: () => withRefresh(() => api<{ checked: number; updated: number }>('POST', '/api/songs/enrich')),
      enrichSong: (id) => withRefresh(() => api<{ filled: string[] }>('POST', `/api/songs/${id}/enrich`).then((r) => r.filled)),
      moveSong: (id, status, index) =>
        optimistic(
          (s) => {
            const song = s.songs.find((x) => x.id === id);
            if (!song) return s;
            const column = s.songs.filter((x) => x.status === status && x.id !== id).sort((a, b) => a.position - b.position);
            column.splice(index, 0, { ...song, status });
            const positions = new Map(column.map((x, i) => [x.id, i]));
            return {
              ...s,
              songs: s.songs.map((x) => (positions.has(x.id) ? { ...x, status, position: positions.get(x.id)! } : x)),
            };
          },
          () => api('POST', `/api/songs/${id}/move`, { status, index }),
        ),
      deleteSong: (id) =>
        optimistic(
          (s) => ({
            ...s,
            songs: s.songs.filter((x) => x.id !== id),
            files: s.files.filter((f) => f.songId !== id),
            setlists: s.setlists.map((l) => ({ ...l, items: l.items.filter((i) => i.songId !== id) })),
          }),
          () => api('DELETE', `/api/songs/${id}`),
        ),
      setConfidence: (songId, level) =>
        optimistic(
          (s) => {
            const rest = s.confidence.filter((c) => !(c.songId === songId && c.memberId === memberId));
            const confidence = level && memberId ? [...rest, { songId, memberId, level, updatedAt: Date.now() }] : rest;
            // Mirrors the server: when everyone says "Domino", the song jumps to the top of "ready".
            const song = s.songs.find((x) => x.id === songId);
            const mastered = new Set(confidence.filter((c) => c.songId === songId && c.level === 3).map((c) => c.memberId));
            if (level !== 3 || !song || song.status === 'ready' || !s.members.length || !s.members.every((m) => mastered.has(m.id))) {
              return { ...s, confidence };
            }
            const ready = s.songs.filter((x) => x.status === 'ready' && x.id !== songId).sort((a, b) => a.position - b.position);
            const left = s.songs.filter((x) => x.status === song.status && x.id !== songId).sort((a, b) => a.position - b.position);
            const positions = new Map([...[song, ...ready].map((x, i) => [x.id, i] as const), ...left.map((x, i) => [x.id, i] as const)]);
            return {
              ...s,
              confidence,
              songs: s.songs.map((x) => (x.id === songId ? { ...x, status: 'ready' as const, position: 0 } : positions.has(x.id) ? { ...x, position: positions.get(x.id)! } : x)),
            };
          },
          async () => {
            const r = await api<{ promoted?: boolean }>('PUT', `/api/songs/${songId}/confidence`, { level });
            if (r.promoted) toast.info(`Todo mundo domina “${songsById.get(songId)?.title ?? 'a música'}”: foi para ${STAGES.ready.label}`);
          },
        ),
      setPart: (songId, memberId, role) =>
        optimistic(
          (s) => ({
            ...s,
            parts: [...s.parts.filter((p) => !(p.songId === songId && p.memberId === memberId)), ...(role.trim() ? [{ songId, memberId, role: role.trim() }] : [])],
          }),
          () => api('PUT', `/api/songs/${songId}/parts/${memberId}`, { role }),
        ),
      saveText: async (songId, kind, body) => {
        try {
          const { updatedAt } = await api<{ updatedAt: number | null }>('PUT', `/api/songs/${songId}/texts/${kind}`, { body });
          setState((s) => ({
            ...s,
            songs: s.songs.map((song) => {
              if (song.id !== songId) return song;
              const { [kind]: _, ...rest } = song.texts;
              return { ...song, texts: updatedAt ? { ...rest, [kind]: updatedAt } : rest };
            }),
          }));
          return updatedAt;
        } catch (err) {
          toast.error((err as Error).message);
          throw err;
        }
      },
      lookupLyrics: (songId) => withRefresh(() => api<{ found: boolean }>('POST', `/api/songs/${songId}/lyrics/lookup`).then((r) => r.found)),
      lookupChords: (songId) => withRefresh(() => api<{ found: boolean }>('POST', `/api/songs/${songId}/chords/lookup`).then((r) => r.found)),
      importChords: (songId, text) => withRefresh(() => api('POST', `/api/songs/${songId}/chords/import`, { text }).then(() => undefined)),
      uploadFile: (songId, file, type, name, onProgress) =>
        withRefresh(() => upload(`/api/songs/${songId}/files?name=${encodeURIComponent(name)}`, file, type, onProgress).then(() => undefined)),
      renameFile: (id, name) =>
        optimistic((s) => ({ ...s, files: s.files.map((f) => (f.id === id ? { ...f, name } : f)) }), () => api('PATCH', `/api/files/${id}`, { name })),
      deleteFile: (id) => optimistic((s) => ({ ...s, files: s.files.filter((f) => f.id !== id) }), () => api('DELETE', `/api/files/${id}`)),
      markRehearsed: (songId, at) =>
        optimistic(patchSong(songId, { lastRehearsed: at === undefined ? Date.now() : at }), () =>
          api('POST', `/api/songs/${songId}/rehearsed`, at === undefined ? {} : { at }),
        ),
      addSetlist: (setlist) => withRefresh(() => api<{ id: string }>('POST', '/api/setlists', setlist).then((r) => r.id)),
      updateSetlist: (id, patch) => optimistic(patchSetlist(id, patch), () => api('PATCH', `/api/setlists/${id}`, patch)),
      setItems: (id, items) => optimistic(patchSetlist(id, { items }), () => api('PATCH', `/api/setlists/${id}`, { items })),
      deleteSetlist: (id) =>
        optimistic((s) => ({ ...s, setlists: s.setlists.filter((l) => l.id !== id) }), () => api('DELETE', `/api/setlists/${id}`)),
      addMember: (member) => withRefresh(() => api<{ id: string }>('POST', '/api/members', member).then((r) => r.id)),
      updateMember: (id, patch) =>
        optimistic((s) => ({ ...s, members: s.members.map((m) => (m.id === id ? { ...m, ...patch } : m)) }), () =>
          api('PATCH', `/api/members/${id}`, patch),
        ),
      deleteMember: (id) =>
        optimistic(
          (s) => ({ ...s, members: s.members.filter((m) => m.id !== id), confidence: s.confidence.filter((c) => c.memberId !== id) }),
          () => api('DELETE', `/api/members/${id}`),
        ),
    };
  }, [state, memberId, optimistic, withRefresh, refresh, setBusy, toast]);

  return <Ctx.Provider value={store}>{children}</Ctx.Provider>;
}

/** Songs in a column, in board order. */
export function columnSongs(songs: Song[], status: Status) {
  return songs.filter((s) => s.status === status).sort((a, b) => a.position - b.position);
}
