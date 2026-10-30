import type { Hono } from 'hono';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js';
import type { CallToolResult } from '@modelcontextprotocol/sdk/types.js';
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { z } from 'zod';
import { STATUSES, type Db, type Status } from './db.ts';
import { HttpError } from './validate.ts';
import type { SongRow } from './app.ts';

/**
 * Remote MCP endpoint (Streamable HTTP, stateless, JSON responses) for an AI agent that organizes the band:
 * songs, setlists for shows, and rehearsals. Rehearsals are setlists of kind "rehearsal", the same records the
 * app's Setlists screen shows. Authenticated by one Bearer token, read from a file on every request so rotating
 * it needs no restart.
 */

type TextKind = 'lyrics' | 'chords' | 'tab';
type Body = Record<string, unknown>;

/** The app's own write paths, shared with the REST API so both validate and log the same way. */
export type Ops = {
  db: Db;
  getSong: (id: string) => SongRow | undefined;
  addSong: (body: Body, actor: string | null) => Promise<string>;
  editSong: (song: SongRow, body: Body) => Promise<void>;
  removeSong: (song: SongRow, actor: string | null) => void;
  placeSong: (song: SongRow, status: Status, index: number, actor: string | null) => void;
  writeText: (song: SongRow, kind: TextKind, body: string, actor: string | null) => void;
  markRehearsed: (songId: string, at: number) => boolean;
  createSetlist: (body: Body, actor: string | null) => string;
  editSetlist: (id: string, body: Body) => void;
  removeSetlist: (id: string, actor: string | null) => void;
  /** Tells every open browser to refresh. */
  changed: () => void;
};

const sha256 = (s: string) => createHash('sha256').update(s).digest();

/** The current token, or null when the file is missing or empty (then every request is refused). */
function readToken(file: string): string | null {
  try {
    const token = readFileSync(file, 'utf8').trim();
    return token.length >= 32 ? token : null;
  } catch {
    return null;
  }
}

function authorized(header: string | undefined, file: string) {
  const token = readToken(file);
  const given = /^Bearer\s+(\S+)\s*$/i.exec(header ?? '')?.[1];
  return !!token && !!given && timingSafeEqual(sha256(given), sha256(token));
}

export function mountMcp(app: Hono<any>, tokenFile: string, ops: Ops) {
  app.all('/mcp', async (c) => {
    c.header('Cache-Control', 'no-store');
    if (!authorized(c.req.header('authorization'), tokenFile)) {
      c.header('WWW-Authenticate', 'Bearer realm="sound-carvers-mcp"');
      return c.json({ error: 'Missing or invalid bearer token' }, 401);
    }
    // Stateless: a fresh server and transport per request, as the SDK recommends.
    const server = buildServer(ops);
    const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    await server.connect(transport);
    try {
      return await transport.handleRequest(c.req.raw);
    } finally {
      void server.close();
    }
  });
}

// ---- output shapes ----

const iso = (ms: number | null) => (ms == null ? null : new Date(ms).toISOString());

function songSummary(ops: Ops, r: SongRow) {
  const sheets = (ops.db.prepare('SELECT kind FROM song_texts WHERE song_id = ?').all(r.id) as { kind: string }[]).map((t) => t.kind);
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    original: !!r.original,
    status: r.status,
    key: r.song_key,
    bpm: r.bpm,
    durationSeconds: r.duration,
    tuning: r.tuning,
    lastRehearsed: iso(r.last_rehearsed),
    sheets,
  };
}

function songDetail(ops: Ops, r: SongRow) {
  const { db } = ops;
  const texts: Record<TextKind, string> = { lyrics: '', chords: '', tab: '' };
  for (const t of db.prepare('SELECT kind, body FROM song_texts WHERE song_id = ?').all(r.id) as { kind: TextKind; body: string }[]) {
    if (t.kind in texts) texts[t.kind] = t.body;
  }
  const members = db
    .prepare(
      `SELECT m.id, m.name, m.instrument, p.role, c.level FROM members m
       LEFT JOIN parts p ON p.member_id = m.id AND p.song_id = ?
       LEFT JOIN confidence c ON c.member_id = m.id AND c.song_id = ?
       ORDER BY m.created_at`,
    )
    .all(r.id, r.id) as { id: string; name: string; instrument: string; role: string | null; level: number | null }[];
  const setlists = db
    .prepare(`SELECT DISTINCT s.id, s.kind, s.name, s.date FROM setlists s JOIN setlist_items i ON i.setlist_id = s.id WHERE i.song_id = ? ORDER BY s.date DESC`)
    .all(r.id);
  const files = db.prepare('SELECT kind, name, mime, size FROM song_files WHERE song_id = ? ORDER BY created_at').all(r.id);
  return {
    ...songSummary(ops, r),
    position: r.position,
    notes: r.notes,
    links: JSON.parse(r.links),
    lyrics: texts.lyrics,
    chords: texts.chords,
    tab: texts.tab,
    members: members.map((m) => ({
      memberId: m.id,
      name: m.name,
      instrument: m.instrument,
      part: m.role ?? '',
      confidence: m.level == null ? null : CONFIDENCE[m.level] ?? m.level,
    })),
    setlists,
    files,
    createdAt: iso(r.created_at),
    updatedAt: iso(r.updated_at),
  };
}

const CONFIDENCE: Record<number, string> = { 1: 'lost', 2: 'shaky', 3: 'solid' };

/** A setlist item the way the REST API takes it. */
type Item = { id: string; type: 'song' | 'break' | 'note'; songId?: string; text: string; done: boolean };
type ItemRow = { id: string; type: 'song' | 'break' | 'note'; song_id: string | null; text: string; done: number };
type SetlistRow = { id: string; kind: 'show' | 'rehearsal'; name: string; date: string | null; time: string | null; venue: string; notes: string; created_at: number; updated_at: number };

const itemsOf = (ops: Ops, setlistId: string) =>
  ops.db.prepare('SELECT id, type, song_id, text, done FROM setlist_items WHERE setlist_id = ? ORDER BY position').all(setlistId) as ItemRow[];

function setlistSummary(ops: Ops, s: SetlistRow) {
  const items = itemsOf(ops, s.id);
  const songs = items.filter((i) => i.type === 'song').map((i) => ops.getSong(i.song_id!)).filter((x) => !!x);
  return {
    id: s.id,
    kind: s.kind,
    name: s.name,
    date: s.date,
    time: s.time,
    venue: s.venue,
    songCount: songs.length,
    totalDurationSeconds: songs.reduce((sum, x) => sum + (x.duration ?? 0), 0),
    notStageReady: songs.filter((x) => x.status !== 'ready').length,
  };
}

function setlistDetail(ops: Ops, s: SetlistRow) {
  return {
    ...setlistSummary(ops, s),
    notes: s.notes,
    items: itemsOf(ops, s.id).map((i) => {
      if (i.type !== 'song') return { itemId: i.id, type: i.type, text: i.text };
      const song = ops.getSong(i.song_id!);
      return {
        itemId: i.id,
        type: 'song' as const,
        songId: i.song_id,
        title: song?.title ?? '(deleted song)',
        artist: song?.artist ?? '',
        status: song?.status ?? null,
        key: song?.song_key ?? '',
        durationSeconds: song?.duration ?? null,
        tuning: song?.tuning ?? '',
        note: i.text,
        done: !!i.done,
      };
    }),
    createdAt: iso(s.created_at),
    updatedAt: iso(s.updated_at),
  };
}

/** Rehearsals call the venue "place" and the items "songs". */
function rehearsalDetail(ops: Ops, s: SetlistRow) {
  const { venue, kind: _kind, ...rest } = setlistDetail(ops, s);
  return { ...rest, place: venue };
}

// ---- tool plumbing ----

const ok = (data: unknown): CallToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 1) }] });
const fail = (message: string): CallToolResult => ({ isError: true, content: [{ type: 'text', text: message }] });

/** Runs a tool body; the app's validation errors come back as tool errors the agent can read and fix. */
async function run(fn: () => unknown): Promise<CallToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    if (err instanceof ToolError || err instanceof HttpError) return fail(err.message);
    console.error('mcp tool failed', err);
    return fail('Internal error while running the tool.');
  }
}

class ToolError extends Error {}

/** Drops undefined keys, so update tools only touch what the agent sent. */
const defined = (o: Record<string, unknown>) => Object.fromEntries(Object.entries(o).filter(([, value]) => value !== undefined));

const READ = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const CREATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;
const UPDATE = { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const DELETE = { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false } as const;

// ---- shared schemas ----

const id = (what: string) => z.string().min(1).max(64).describe(`The ${what} id (a UUID, from a list_* or get_* result).`);
const status = z
  .enum(STATUSES)
  .describe('Board column: "todo" (to learn), "learning", "shaky" (almost there), "ready" (stage-ready).');
const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');
const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Use HH:MM (24h)');
const link = z.object({
  url: z.string().url().describe('Full http(s) URL.'),
  label: z.string().max(60).optional().describe('Optional short label, e.g. "YouTube live version".'),
});

const songFields = {
  artist: z.string().max(120).optional().describe('Artist or band; empty for originals is fine.'),
  original: z.boolean().optional().describe('true for a Sound Carvers original song, false for a cover.'),
  key: z.string().max(24).optional().describe('Musical key as the band writes it, e.g. "Am", "F#", "Bb".'),
  bpm: z.number().int().min(20).max(400).nullable().optional().describe('Tempo in BPM; null clears it.'),
  durationSeconds: z.number().int().min(1).max(3600).nullable().optional().describe('Length in seconds; null clears it.'),
  tuning: z.string().max(40).optional().describe('Guitar tuning, e.g. "E standard", "Drop D", "Eb standard".'),
  notes: z.string().max(10_000).optional().describe('Free-form notes (arrangement, cues, who starts). Replaces the existing notes.'),
  links: z.array(link).max(12).optional().describe('Reference links (YouTube, Spotify, tabs). Replaces the whole list.'),
  lyrics: z.string().max(20_000).optional().describe('Full lyrics. Replaces the lyrics sheet; an empty string removes it.'),
  chords: z.string().max(40_000).optional().describe('Chord sheet (cifra), monospace text. Replaces it; empty string removes it.'),
  tab: z.string().max(100_000).optional().describe('Tablature text. Replaces it; empty string removes it.'),
};

const itemInput = z.object({
  type: z.enum(['song', 'break', 'note']).default('song').describe('"song", "break" (a set break, e.g. "Set 2" or "Encore") or "note".'),
  songId: z.string().max(64).optional().describe('Required when type is "song".'),
  text: z.string().max(200).optional().describe('Label for a break, text of a note, or a short cue on a song item.'),
});

type SongInput = { [K in keyof typeof songFields]?: z.infer<(typeof songFields)[K]> } & { title?: string; status?: Status };

/** Maps tool input onto the REST body the app's validation expects. */
const songBody = (a: SongInput) =>
  defined({ title: a.title, artist: a.artist, original: a.original, key: a.key, bpm: a.bpm, duration: a.durationSeconds, tuning: a.tuning, notes: a.notes, links: a.links });

function saveSheets(ops: Ops, songId: string, a: SongInput) {
  const song = ops.getSong(songId)!;
  for (const kind of ['lyrics', 'chords', 'tab'] as const) if (a[kind] !== undefined) ops.writeText(song, kind, a[kind], null);
}

function needSong(ops: Ops, songId: string) {
  const song = ops.getSong(songId);
  if (!song) throw new ToolError(`No song with id ${songId}. Use list_songs to find it.`);
  return song;
}

function needSetlist(ops: Ops, setlistId: string, kind?: 'rehearsal') {
  const s = ops.db.prepare('SELECT * FROM setlists WHERE id = ?').get(setlistId) as SetlistRow | undefined;
  if (!s) throw new ToolError(`No ${kind ?? 'setlist'} with id ${setlistId}.`);
  if (kind && s.kind !== kind) throw new ToolError(`${setlistId} is a ${s.kind} setlist, not a rehearsal. Use the *_setlist tools for it.`);
  return s;
}

function checkSongIds(ops: Ops, ids: string[]) {
  for (const songId of ids) needSong(ops, songId);
}

function listSetlists(ops: Ops, kind: 'show' | 'rehearsal' | undefined, from?: string, to?: string) {
  const where: string[] = [];
  const args: string[] = [];
  if (kind) where.push('kind = ?'), args.push(kind);
  if (from) where.push('date >= ?'), args.push(from);
  if (to) where.push('date <= ?'), args.push(to);
  const sql = `SELECT * FROM setlists ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY date IS NULL, date DESC, created_at DESC`;
  return ops.db.prepare(sql).all(...args) as SetlistRow[];
}

// ---- server ----

function buildServer(ops: Ops) {
  const server = new McpServer(
    { name: 'sound-carvers-setlist', version: '1.0.0' },
    {
      instructions:
        'Sound Carvers band notebook. Songs sit on a board with four columns (todo, learning, shaky, ready). ' +
        'Setlists are either shows or rehearsals; rehearsals have their own tools. Ids come from list_* results. ' +
        'Text the band typed is usually Brazilian Portuguese. Changes appear live in the band app.',
    },
  );
  const { db } = ops;

  // ---- members ----

  server.registerTool(
    'list_members',
    {
      title: 'List band members',
      description: 'List the band members with their instrument. Use their ids to read parts and confidence in get_song.',
      inputSchema: {},
      annotations: READ,
    },
    () => run(() => db.prepare('SELECT id, name, instrument FROM members ORDER BY created_at').all()),
  );

  // ---- songs ----

  server.registerTool(
    'list_songs',
    {
      title: 'List and search songs',
      description:
        "List the band's songs, optionally filtered. Returns a compact summary per song (no lyrics or chords; use get_song for those), " +
        'ordered by board column and position.',
      inputSchema: {
        query: z.string().max(120).optional().describe('Case-insensitive text matched against title and artist.'),
        status: status.optional(),
        original: z.boolean().optional().describe('true for originals only, false for covers only.'),
        key: z.string().max(24).optional().describe('Exact key match, case-insensitive, e.g. "Am".'),
        tuning: z.string().max(40).optional().describe('Case-insensitive substring of the tuning, e.g. "drop".'),
        hasSheet: z.enum(['lyrics', 'chords', 'tab']).optional().describe('Only songs that have this sheet filled in.'),
        limit: z.number().int().min(1).max(500).default(200).describe('Maximum songs to return.'),
      },
      annotations: READ,
    },
    (a) =>
      run(() => {
        const where: string[] = [];
        const args: (string | number)[] = [];
        if (a.query) where.push("(title LIKE ? ESCAPE '\\' OR artist LIKE ? ESCAPE '\\')"), args.push(...Array(2).fill(`%${a.query.replace(/[\\%_]/g, '\\$&')}%`));
        if (a.status) where.push('status = ?'), args.push(a.status);
        if (a.original !== undefined) where.push('original = ?'), args.push(a.original ? 1 : 0);
        if (a.key) where.push('lower(song_key) = lower(?)'), args.push(a.key);
        if (a.tuning) where.push('instr(lower(tuning), lower(?)) > 0'), args.push(a.tuning);
        if (a.hasSheet) where.push('EXISTS (SELECT 1 FROM song_texts t WHERE t.song_id = songs.id AND t.kind = ?)'), args.push(a.hasSheet);
        const order = "CASE status WHEN 'todo' THEN 0 WHEN 'learning' THEN 1 WHEN 'shaky' THEN 2 ELSE 3 END, position";
        const rows = db.prepare(`SELECT * FROM songs ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY ${order} LIMIT ?`).all(...args, a.limit) as SongRow[];
        return { count: rows.length, songs: rows.map((r) => songSummary(ops, r)) };
      }),
  );

  server.registerTool(
    'get_song',
    {
      title: 'Get a song',
      description:
        'Get everything about one song: details, notes, links, lyrics, chord sheet, tab, each member\'s part and confidence ("lost", "shaky", "solid"), ' +
        'attached files, and the setlists it is in.',
      inputSchema: { songId: id('song') },
      annotations: READ,
    },
    (a) => run(() => songDetail(ops, needSong(ops, a.songId))),
  );

  server.registerTool(
    'create_song',
    {
      title: 'Create a song',
      description:
        'Add a song to the board, at the end of its column (default "todo"). For covers the app then looks the song up online in the background ' +
        'and fills only still-empty fields (cover art, key, tempo, length, tuning, links). Returns the new song.',
      inputSchema: { title: z.string().min(1).max(120).describe('Song title.'), status: status.optional(), ...songFields },
      annotations: CREATE,
    },
    (a) =>
      run(async () => {
        const songId = await ops.addSong({ ...songBody(a), ...(a.status ? { status: a.status } : {}) }, null);
        saveSheets(ops, songId, a);
        ops.changed();
        return songDetail(ops, needSong(ops, songId));
      }),
  );

  server.registerTool(
    'update_song',
    {
      title: 'Update a song',
      description:
        'Change a song. Only the fields you pass change. Passing "status" moves the song to that column (at "position", or the end). ' +
        'lyrics, chords and tab replace the whole sheet. Returns the updated song.',
      inputSchema: {
        songId: id('song'),
        title: z.string().min(1).max(120).optional().describe('New title.'),
        status: status.optional(),
        position: z.number().int().min(0).max(100_000).optional().describe('0-based position inside the column; only used with status.'),
        ...songFields,
      },
      annotations: UPDATE,
    },
    (a) =>
      run(async () => {
        const song = needSong(ops, a.songId);
        const body = songBody(a);
        if (Object.keys(body).length) await ops.editSong(song, body);
        saveSheets(ops, song.id, a);
        if (a.status) {
          const current = needSong(ops, song.id);
          const end = (db.prepare('SELECT COUNT(*) AS n FROM songs WHERE status = ?').get(a.status) as { n: number }).n;
          if (a.status !== current.status || a.position !== undefined) ops.placeSong(current, a.status, a.position ?? end, null);
        }
        ops.changed();
        return songDetail(ops, needSong(ops, song.id));
      }),
  );

  server.registerTool(
    'delete_song',
    {
      title: 'Delete a song',
      description:
        'Permanently delete a song with its lyrics, chords, tab, audio and images. It is also removed from every setlist and rehearsal. Cannot be undone.',
      inputSchema: { songId: id('song') },
      annotations: DELETE,
    },
    (a) =>
      run(() => {
        const song = needSong(ops, a.songId);
        ops.removeSong(song, null);
        ops.changed();
        return { deleted: true, songId: song.id, title: song.title };
      }),
  );

  // ---- setlists (shows) ----

  server.registerTool(
    'list_setlists',
    {
      title: 'List setlists',
      description: 'List setlists (shows and, unless filtered, rehearsals), newest date first, with song count, total runtime and how many songs are not stage-ready.',
      inputSchema: {
        kind: z.enum(['show', 'rehearsal']).optional().describe('Only shows or only rehearsals.'),
        from: date.optional().describe('Only dates on or after this day (YYYY-MM-DD). Undated setlists are then excluded.'),
        to: date.optional().describe('Only dates on or before this day (YYYY-MM-DD).'),
      },
      annotations: READ,
    },
    (a) => run(() => listSetlists(ops, a.kind, a.from, a.to).map((s) => setlistSummary(ops, s))),
  );

  server.registerTool(
    'get_setlist',
    {
      title: 'Get a setlist',
      description: 'Get one setlist (show or rehearsal) with its items in order: songs (with key, length, tuning, done flag), set breaks and notes. Item ids are used by reorder_setlist.',
      inputSchema: { setlistId: id('setlist') },
      annotations: READ,
    },
    (a) => run(() => setlistDetail(ops, needSetlist(ops, a.setlistId))),
  );

  const setlistFields = {
    date: date.nullable().optional().describe('Day of the show (YYYY-MM-DD); null clears it.'),
    time: time.nullable().optional().describe('Start time (HH:MM, 24h); null clears it.'),
    venue: z.string().max(120).optional().describe('Venue or place.'),
    notes: z.string().max(5_000).optional().describe('Free-form notes. Replaces the existing notes.'),
  };

  server.registerTool(
    'create_setlist',
    {
      title: 'Create a setlist',
      description: 'Create a setlist for a show (or a rehearsal with kind "rehearsal"; create_rehearsal is simpler for those). Returns the new setlist.',
      inputSchema: {
        name: z.string().min(1).max(120).describe('Name, e.g. "Bar do Zé - 15/11".'),
        kind: z.enum(['show', 'rehearsal']).default('show').describe('"show" or "rehearsal".'),
        ...setlistFields,
        items: z.array(itemInput).max(200).optional().describe('Songs, breaks and notes in play order.'),
      },
      annotations: CREATE,
    },
    (a) =>
      run(() => {
        checkSongIds(ops, (a.items ?? []).flatMap((i) => (i.songId ? [i.songId] : [])));
        const setlistId = ops.createSetlist(defined({ ...a, items: a.items?.map((i) => defined(i)) }), null);
        ops.changed();
        return setlistDetail(ops, needSetlist(ops, setlistId));
      }),
  );

  server.registerTool(
    'update_setlist',
    {
      title: 'Update a setlist',
      description:
        'Change a setlist. Only the fields you pass change. "items" replaces the whole list (song done flags are kept for songs that stay); ' +
        'to only change the order use reorder_setlist. Returns the updated setlist.',
      inputSchema: {
        setlistId: id('setlist'),
        name: z.string().min(1).max(120).optional().describe('New name.'),
        kind: z.enum(['show', 'rehearsal']).optional().describe('"show" or "rehearsal".'),
        ...setlistFields,
        items: z.array(itemInput).max(200).optional().describe('New full list of songs, breaks and notes in play order.'),
      },
      annotations: UPDATE,
    },
    (a) =>
      run(() => {
        const s = needSetlist(ops, a.setlistId);
        const { setlistId: _, items, ...fields } = a;
        let rawItems: Body[] | undefined;
        if (items) {
          checkSongIds(ops, items.flatMap((i) => (i.songId ? [i.songId] : [])));
          const done = new Set(itemsOf(ops, s.id).filter((i) => i.done && i.song_id).map((i) => i.song_id));
          rawItems = items.map((i) => defined({ ...i, done: i.type === 'song' && !!i.songId && done.has(i.songId) }));
        }
        ops.editSetlist(s.id, defined({ ...fields, items: rawItems }));
        ops.changed();
        return setlistDetail(ops, needSetlist(ops, s.id));
      }),
  );

  server.registerTool(
    'reorder_setlist',
    {
      title: 'Reorder a setlist',
      description:
        'Put the items of a setlist or rehearsal in a new order. Pass every current item id (from get_setlist) exactly once, in the new order; ' +
        'nothing is added or removed. Returns the reordered setlist.',
      inputSchema: {
        setlistId: id('setlist'),
        itemIds: z.array(z.string().max(64)).max(200).describe('All item ids of the setlist, in the new order.'),
      },
      annotations: UPDATE,
    },
    (a) =>
      run(() => {
        const s = needSetlist(ops, a.setlistId);
        const items = itemsOf(ops, s.id);
        const byId = new Map(items.map((i) => [i.id, i]));
        if (a.itemIds.length !== items.length || new Set(a.itemIds).size !== items.length || a.itemIds.some((x) => !byId.has(x))) {
          throw new ToolError(`itemIds must list each of the ${items.length} current item ids exactly once. Current ids: ${items.map((i) => i.id).join(', ')}`);
        }
        const reordered = a.itemIds.map((x) => {
          const i = byId.get(x)!;
          return { id: i.id, type: i.type, songId: i.song_id ?? undefined, text: i.text, done: !!i.done };
        });
        ops.editSetlist(s.id, { items: reordered.map((i) => defined(i)) });
        ops.changed();
        return setlistDetail(ops, needSetlist(ops, s.id));
      }),
  );

  server.registerTool(
    'delete_setlist',
    {
      title: 'Delete a setlist',
      description: 'Permanently delete a setlist (show or rehearsal). The songs themselves stay on the board. Cannot be undone.',
      inputSchema: { setlistId: id('setlist') },
      annotations: DELETE,
    },
    (a) =>
      run(() => {
        const s = needSetlist(ops, a.setlistId);
        ops.removeSetlist(s.id, null);
        ops.changed();
        return { deleted: true, setlistId: s.id, name: s.name };
      }),
  );

  // ---- rehearsals ----

  const rehearsalFields = {
    date: date.nullable().optional().describe('Day of the rehearsal (YYYY-MM-DD); null clears it.'),
    time: time.nullable().optional().describe('Start time (HH:MM, 24h); null clears it.'),
    place: z.string().max(120).optional().describe('Where: studio, someone\'s house…'),
    notes: z.string().max(5_000).optional().describe('Agenda or notes. Replaces the existing notes.'),
  };

  /** Rehearsal song list: keeps done flags of songs that stay; notes and breaks already there go to the end. */
  const rehearsalItems = (current: ItemRow[], songIds: string[], doneIds: Set<string>): Item[] => {
    checkSongIds(ops, songIds);
    const existing = new Map(current.filter((i) => i.type === 'song').map((i) => [i.song_id!, i]));
    const songs: Item[] = songIds.map((songId) => {
      const was = existing.get(songId);
      return { id: was?.id ?? randomUUID(), type: 'song', songId, text: was?.text ?? '', done: doneIds.has(songId) || !!was?.done };
    });
    const others: Item[] = current.filter((i) => i.type !== 'song').map((i) => ({ id: i.id, type: i.type, text: i.text, done: false }));
    return [...songs, ...others];
  };

  /** Ticking a song off also updates its "last rehearsed" date, as in the app (rehearsal day, never in the future). */
  const markDone = (rehearsal: SetlistRow, songIds: Iterable<string>) => {
    const at = Math.min(rehearsal.date ? new Date(`${rehearsal.date}T12:00:00`).getTime() : Date.now(), Date.now());
    for (const songId of songIds) ops.markRehearsed(songId, at);
  };

  server.registerTool(
    'list_rehearsals',
    {
      title: 'List rehearsals',
      description: 'List rehearsals, newest date first, with how many songs are planned and the total runtime.',
      inputSchema: {
        from: date.optional().describe('Only rehearsals on or after this day (YYYY-MM-DD).'),
        to: date.optional().describe('Only rehearsals on or before this day (YYYY-MM-DD).'),
      },
      annotations: READ,
    },
    (a) =>
      run(() =>
        listSetlists(ops, 'rehearsal', a.from, a.to).map((s) => {
          const { kind: _kind, venue, notStageReady: _n, ...rest } = setlistSummary(ops, s);
          return { ...rest, place: venue };
        }),
      ),
  );

  server.registerTool(
    'get_rehearsal',
    {
      title: 'Get a rehearsal',
      description: 'Get one rehearsal: date, time, place, notes and the songs to rehearse in order, each with its done flag.',
      inputSchema: { rehearsalId: id('rehearsal') },
      annotations: READ,
    },
    (a) => run(() => rehearsalDetail(ops, needSetlist(ops, a.rehearsalId, 'rehearsal'))),
  );

  server.registerTool(
    'create_rehearsal',
    {
      title: 'Create a rehearsal',
      description: 'Plan a rehearsal with the songs to work on. Shows up in the app under Setlists as a rehearsal. Returns the new rehearsal.',
      inputSchema: {
        name: z.string().max(120).optional().describe('Name; defaults to "Ensaio DD/MM" from the date, or "Ensaio".'),
        ...rehearsalFields,
        songIds: z.array(z.string().max(64)).max(200).optional().describe('Songs to rehearse, in order.'),
      },
      annotations: CREATE,
    },
    (a) =>
      run(() => {
        const name = a.name?.trim() || (a.date ? `Ensaio ${a.date.slice(8, 10)}/${a.date.slice(5, 7)}` : 'Ensaio');
        const items = rehearsalItems([], a.songIds ?? [], new Set());
        const rehearsalId = ops.createSetlist(defined({ kind: 'rehearsal', name, date: a.date, time: a.time, venue: a.place, notes: a.notes, items }), null);
        ops.changed();
        return rehearsalDetail(ops, needSetlist(ops, rehearsalId));
      }),
  );

  server.registerTool(
    'update_rehearsal',
    {
      title: 'Update a rehearsal',
      description:
        'Change a rehearsal. Only the fields you pass change. "songIds" replaces the song list (done flags are kept for songs that stay). ' +
        '"doneSongIds" ticks songs off as rehearsed, which also updates each song\'s last-rehearsed date. Returns the updated rehearsal.',
      inputSchema: {
        rehearsalId: id('rehearsal'),
        name: z.string().min(1).max(120).optional().describe('New name.'),
        ...rehearsalFields,
        songIds: z.array(z.string().max(64)).max(200).optional().describe('New full list of songs to rehearse, in order.'),
        doneSongIds: z.array(z.string().max(64)).max(200).optional().describe('Songs of this rehearsal to mark as rehearsed.'),
        undoneSongIds: z.array(z.string().max(64)).max(200).optional().describe('Songs of this rehearsal to un-tick.'),
      },
      annotations: UPDATE,
    },
    (a) =>
      run(() => {
        const r = needSetlist(ops, a.rehearsalId, 'rehearsal');
        const current = itemsOf(ops, r.id);
        const done = new Set(a.doneSongIds ?? []);
        const undone = new Set(a.undoneSongIds ?? []);
        const songIds = a.songIds ?? current.filter((i) => i.type === 'song').map((i) => i.song_id!);
        for (const songId of [...done, ...undone]) {
          if (!songIds.includes(songId)) throw new ToolError(`Song ${songId} is not in this rehearsal; add it to songIds first.`);
        }
        const touchesItems = a.songIds !== undefined || done.size > 0 || undone.size > 0;
        const items = touchesItems
          ? rehearsalItems(current, songIds, done).map((i) => (i.type === 'song' && undone.has(i.songId!) ? { ...i, done: false } : i))
          : undefined;
        ops.editSetlist(r.id, defined({ name: a.name, date: a.date, time: a.time, venue: a.place, notes: a.notes, items }));
        const updated = needSetlist(ops, r.id);
        markDone(updated, done);
        ops.changed();
        return rehearsalDetail(ops, updated);
      }),
  );

  server.registerTool(
    'delete_rehearsal',
    {
      title: 'Delete a rehearsal',
      description: 'Permanently delete a rehearsal. The songs stay on the board and keep their last-rehearsed dates. Cannot be undone.',
      inputSchema: { rehearsalId: id('rehearsal') },
      annotations: DELETE,
    },
    (a) =>
      run(() => {
        const r = needSetlist(ops, a.rehearsalId, 'rehearsal');
        ops.removeSetlist(r.id, null);
        ops.changed();
        return { deleted: true, rehearsalId: r.id, name: r.name };
      }),
  );

  return server;
}
