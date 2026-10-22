import { Hono, type Context } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import { streamSSE } from 'hono/streaming';
import { createHash, randomBytes, randomUUID, timingSafeEqual } from 'node:crypto';
import { STATUSES, tx, type Db, type Status } from './db.ts';
import * as v from './validate.ts';
import { bestMatch, coverType, isArtUrl, isCoverFile, type Match, type Music } from './music.ts';
import { cleanCifra } from './cifra.ts';
import { MAX_BYTES, TooLarge, uploadType, type FileKind, type Files } from './files.ts';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const COOKIE = 'sc_session';
const SESSION_DAYS = 180;
const DAY = 86_400_000;

export type Config = {
  bandPassword: string;
  secureCookies: boolean;
  bandName: string;
  music: Music;
  files: Files;
  /** Look new songs up online in the background (off in tests). */
  enrichOnAdd?: boolean;
};

type Vars = { session: { tokenHash: string; memberId: string | null } };

const sha256 = (s: string) => createHash('sha256').update(s).digest();
const now = () => Date.now();

function passwordMatches(given: string, expected: string) {
  return timingSafeEqual(sha256(given), sha256(expected));
}

/** Failed logins per client; Caddy replaces X-Forwarded-For, so its last hop is the real peer. */
class LoginLimiter {
  private failures = new Map<string, number[]>();
  private readonly windowMs = 15 * 60_000;
  private readonly max = 8;
  blocked(ip: string) {
    const recent = (this.failures.get(ip) ?? []).filter((t) => now() - t < this.windowMs);
    this.failures.set(ip, recent);
    return recent.length >= this.max;
  }
  fail(ip: string) {
    this.failures.set(ip, [...(this.failures.get(ip) ?? []), now()]);
  }
  clear(ip: string) {
    this.failures.delete(ip);
  }
}

function clientIp(c: Context) {
  const forwarded = c.req.header('x-forwarded-for');
  if (forwarded) return forwarded.split(',').at(-1)!.trim();
  return 'local';
}

type SongRow = {
  id: string; title: string; artist: string; original: number; status: Status; position: number;
  song_key: string; bpm: number | null; duration: number | null; tuning: string; notes: string; links: string;
  last_rehearsed: number | null; created_by: string | null; created_at: number; updated_at: number; cover: string | null;
  enriched_at: number | null;
};

const songOut = (r: SongRow) => ({
  id: r.id,
  title: r.title,
  artist: r.artist,
  original: !!r.original,
  status: r.status,
  position: r.position,
  key: r.song_key,
  bpm: r.bpm,
  duration: r.duration,
  tuning: r.tuning,
  notes: r.notes,
  links: JSON.parse(r.links) as v.Link[],
  cover: r.cover ? `/api/covers/${r.cover}` : null,
  enriched: r.enriched_at != null,
  lastRehearsed: r.last_rehearsed,
  createdBy: r.created_by,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

const ITEM_TYPES = ['song', 'break', 'note'] as const;

/** `coverUrl`: an https URL on an allowed artwork CDN, or null to remove the cover. */
function artUrl(body: Record<string, unknown>): string | null | undefined {
  const value = body.coverUrl;
  if (value === undefined || value === null) return value as null | undefined;
  if (typeof value !== 'string' || !isArtUrl(value)) throw new v.BadRequest('Capa inválida');
  return value;
}
const SETLIST_KINDS = ['show', 'rehearsal'] as const;

/** Text sheets kept per song, each in its own tab of the song sheet. */
const TEXT_KINDS = ['lyrics', 'chords', 'tab'] as const;
type TextKind = (typeof TEXT_KINDS)[number];
const TEXT_MAX: Record<TextKind, number> = { lyrics: 20_000, chords: 40_000, tab: 100_000 };
const MAX_FILES_PER_SONG = 60;

const tooBig = (kind: FileKind) =>
  kind === 'audio' ? `Áudios podem ter até ${MAX_BYTES.audio / 1e6} MB. Exporte em MP3 ou M4A para ficar menor.` : `Imagens podem ter até ${MAX_BYTES.image / 1e6} MB.`;
const fileName = (raw: string) => raw.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 120);

export function createApp(db: Db, config: Config) {
  const { music, files } = config;
  const app = new Hono<{ Variables: Vars }>();
  const limiter = new LoginLimiter();
  const listeners = new Set<(event: { origin: string | null }) => void>();

  const broadcast = (c: Context) => {
    const origin = c.req.header('x-client-id') ?? null;
    for (const l of listeners) l({ origin });
  };
  /** For background work: every client refreshes, including the one that started it. */
  const broadcastAll = () => {
    for (const l of listeners) l({ origin: null });
  };

  const log = (memberId: string | null, kind: string, detail: Record<string, unknown>) => {
    db.prepare('INSERT INTO activity (member_id, kind, detail, created_at) VALUES (?, ?, ?, ?)').run(
      memberId, kind, JSON.stringify(detail), now(),
    );
    db.prepare('DELETE FROM activity WHERE id <= (SELECT id FROM activity ORDER BY id DESC LIMIT 1 OFFSET 500)').run();
  };

  const getSong = (id: string) => db.prepare('SELECT * FROM songs WHERE id = ?').get(id) as SongRow | undefined;

  app.onError((err, c) => {
    if (err instanceof v.BadRequest) return c.json({ error: err.message }, 400);
    if (err instanceof SyntaxError) return c.json({ error: 'Requisição malformada' }, 400);
    console.error(err);
    return c.json({ error: 'Algo deu errado no servidor. Tente de novo.' }, 500);
  });

  app.use('*', async (c, next) => {
    await next();
    c.header('X-Content-Type-Options', 'nosniff');
    c.header('Referrer-Policy', 'no-referrer');
    c.header('X-Frame-Options', 'DENY');
    c.header('X-Robots-Tag', 'noindex, nofollow');
    c.header(
      'Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; script-src 'self'; font-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'",
    );
  });

  // CSRF: mutations must be same-origin JSON. SameSite=Lax cookies cover the rest.
  app.use('/api/*', async (c, next) => {
    if (c.req.method !== 'GET' && c.req.method !== 'HEAD') {
      const origin = c.req.header('origin');
      const host = c.req.header('x-forwarded-host') ?? c.req.header('host');
      if (origin && new URL(origin).host !== host) return c.json({ error: 'Requisição de outro site recusada' }, 403);
      // Uploads carry the file's own type (audio/*, image/*). Browsers can't send those cross-site without a CORS
      // preflight we never answer, and every browser sends Origin on POST, so require it there.
      const upload = c.req.method === 'POST' && /^\/api\/songs\/[^/]+\/files$/.test(c.req.path);
      if (upload) {
        if (!origin) return c.json({ error: 'Requisição de outro site recusada' }, 403);
      } else if (!(c.req.header('content-type') ?? '').startsWith('application/json')) {
        return c.json({ error: 'Formato de requisição inválido' }, 415);
      }
    }
    c.header('Cache-Control', 'no-store');
    await next();
  });

  app.get('/api/health', (c) => c.json({ ok: true }));

  // ---- session ----

  const readSession = (c: Context) => {
    const token = getCookie(c, COOKIE);
    if (!token) return null;
    const tokenHash = sha256(token).toString('hex');
    const row = db.prepare('SELECT member_id, last_seen FROM sessions WHERE token_hash = ?').get(tokenHash) as
      | { member_id: string | null; last_seen: number }
      | undefined;
    if (!row || now() - row.last_seen > SESSION_DAYS * DAY) return null;
    if (now() - row.last_seen > 3_600_000) {
      db.prepare('UPDATE sessions SET last_seen = ? WHERE token_hash = ?').run(now(), tokenHash);
    }
    const memberExists = row.member_id && db.prepare('SELECT 1 FROM members WHERE id = ?').get(row.member_id);
    return { tokenHash, memberId: memberExists ? row.member_id : null };
  };

  app.get('/api/session', (c) => {
    const session = readSession(c);
    return c.json({ authed: !!session, memberId: session?.memberId ?? null, bandName: config.bandName });
  });

  app.post('/api/login', async (c) => {
    const ip = clientIp(c);
    if (limiter.blocked(ip)) return c.json({ error: 'Muitas tentativas erradas. Espere 15 minutos e tente de novo.' }, 429);
    const body = v.obj(await c.req.json());
    const password = typeof body.password === 'string' ? body.password : '';
    if (!passwordMatches(password, config.bandPassword)) {
      limiter.fail(ip);
      return c.json({ error: 'Essa não é a senha da banda. Confira com o pessoal e tente de novo.' }, 401);
    }
    limiter.clear(ip);
    const token = randomBytes(32).toString('base64url');
    db.prepare('INSERT INTO sessions (token_hash, member_id, created_at, last_seen) VALUES (?, NULL, ?, ?)').run(
      sha256(token).toString('hex'), now(), now(),
    );
    db.prepare('DELETE FROM sessions WHERE last_seen < ?').run(now() - SESSION_DAYS * DAY);
    setCookie(c, COOKIE, token, {
      httpOnly: true,
      secure: config.secureCookies,
      sameSite: 'Lax',
      path: '/',
      maxAge: SESSION_DAYS * 86_400,
    });
    return c.json({ ok: true });
  });

  app.post('/api/logout', (c) => {
    const session = readSession(c);
    if (session) db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(session.tokenHash);
    deleteCookie(c, COOKIE, { path: '/' });
    return c.json({ ok: true });
  });

  // Everything below needs the band password.
  app.use('/api/*', async (c, next) => {
    const session = readSession(c);
    if (!session) return c.json({ error: 'Sua sessão expirou. Digite a senha da banda de novo.' }, 401);
    c.set('session', session);
    await next();
  });

  const me = (c: Context<{ Variables: Vars }>) => c.get('session').memberId;

  app.post('/api/whoami', async (c) => {
    const body = v.obj(await c.req.json());
    const memberId = v.str(body, 'memberId', 64, { required: true })!;
    if (!db.prepare('SELECT 1 FROM members WHERE id = ?').get(memberId)) return c.json({ error: 'Integrante não encontrado' }, 404);
    db.prepare('UPDATE sessions SET member_id = ? WHERE token_hash = ?').run(memberId, c.get('session').tokenHash);
    return c.json({ ok: true });
  });

  // ---- realtime ----

  app.get('/api/events', (c) => {
    c.header('X-Accel-Buffering', 'no');
    return streamSSE(c, async (stream) => {
      const send = (event: { origin: string | null }) => {
        void stream.writeSSE({ event: 'changed', data: JSON.stringify(event) });
      };
      listeners.add(send);
      stream.onAbort(() => {
        listeners.delete(send);
      });
      await stream.writeSSE({ event: 'hello', data: '{}' });
      while (!stream.aborted) {
        await stream.sleep(25_000);
        if (!stream.aborted) await stream.writeSSE({ event: 'ping', data: '{}' });
      }
      listeners.delete(send);
    });
  });

  // ---- state ----

  app.get('/api/state', (c) => {
    const members = db.prepare('SELECT id, name, instrument, color, created_at AS createdAt FROM members ORDER BY created_at').all();
    // Which sheets each song has (and when they changed), so open song sheets know to refetch them.
    const texts = new Map<string, Record<string, number>>();
    for (const t of db.prepare('SELECT song_id AS songId, kind, updated_at AS updatedAt FROM song_texts').all() as { songId: string; kind: string; updatedAt: number }[]) {
      texts.set(t.songId, { ...texts.get(t.songId), [t.kind]: t.updatedAt });
    }
    const songs = (db.prepare('SELECT * FROM songs ORDER BY status, position').all() as SongRow[]).map((r) => ({ ...songOut(r), texts: texts.get(r.id) ?? {} }));
    const songFiles = (
      db.prepare('SELECT id, song_id AS songId, kind, name, mime, size, created_by AS createdBy, created_at AS createdAt FROM song_files ORDER BY created_at').all() as { id: string }[]
    ).map((f) => ({ ...f, url: `/api/files/${f.id}` }));
    const confidence = db.prepare('SELECT song_id AS songId, member_id AS memberId, level, updated_at AS updatedAt FROM confidence').all();
    const parts = db.prepare('SELECT song_id AS songId, member_id AS memberId, role FROM parts').all();
    const setlists = db
      .prepare('SELECT id, kind, name, date, time, venue, notes, created_at AS createdAt, updated_at AS updatedAt FROM setlists ORDER BY date IS NULL, date DESC, created_at DESC')
      .all() as Record<string, unknown>[];
    const items = db
      .prepare('SELECT id, setlist_id AS setlistId, type, song_id AS songId, text, done FROM setlist_items ORDER BY setlist_id, position')
      .all() as { setlistId: string; done: number }[];
    const bySetlist = new Map<string, unknown[]>();
    for (const item of items) {
      const { setlistId, ...rest } = item;
      if (!bySetlist.has(setlistId)) bySetlist.set(setlistId, []);
      bySetlist.get(setlistId)!.push({ ...rest, done: !!rest.done });
    }
    const activity = (db.prepare('SELECT id, member_id AS memberId, kind, detail, created_at AS createdAt FROM activity ORDER BY id DESC LIMIT 60').all() as { detail: string }[]).map(
      (a) => ({ ...a, detail: JSON.parse(a.detail) }),
    );
    return c.json({
      members,
      songs,
      confidence,
      parts,
      files: songFiles,
      setlists: setlists.map((s) => ({ ...s, items: bySetlist.get(s.id as string) ?? [] })),
      activity,
    });
  });

  // ---- members ----

  const memberFields = (body: Record<string, unknown>, required: boolean) => ({
    name: v.str(body, 'name', 40, { required }),
    instrument: v.str(body, 'instrument', 60),
    color: v.color(body, 'color'),
  });

  app.post('/api/members', async (c) => {
    const f = memberFields(v.obj(await c.req.json()), true);
    const id = randomUUID();
    db.prepare('INSERT INTO members (id, name, instrument, color, created_at) VALUES (?, ?, ?, ?, ?)').run(
      id, f.name!, f.instrument ?? '', f.color ?? '#e08a2c', now(),
    );
    log(me(c) ?? id, 'member.joined', { name: f.name });
    broadcast(c);
    return c.json({ id }, 201);
  });

  app.patch('/api/members/:id', async (c) => {
    const f = memberFields(v.obj(await c.req.json()), false);
    const res = db
      .prepare('UPDATE members SET name = COALESCE(?, name), instrument = COALESCE(?, instrument), color = COALESCE(?, color) WHERE id = ?')
      .run(f.name ?? null, f.instrument ?? null, f.color ?? null, c.req.param('id'));
    if (!res.changes) return c.json({ error: 'Integrante não encontrado' }, 404);
    broadcast(c);
    return c.json({ ok: true });
  });

  app.delete('/api/members/:id', (c) => {
    const member = db.prepare('SELECT name FROM members WHERE id = ?').get(c.req.param('id')) as { name: string } | undefined;
    if (!member) return c.json({ error: 'Integrante não encontrado' }, 404);
    db.prepare('DELETE FROM members WHERE id = ?').run(c.req.param('id'));
    log(me(c), 'member.removed', { name: member.name });
    broadcast(c);
    return c.json({ ok: true });
  });

  // ---- songs ----

  const songFields = (body: Record<string, unknown>, required: boolean) => ({
    title: v.str(body, 'title', 120, { required }),
    artist: v.str(body, 'artist', 120),
    original: v.bool(body, 'original'),
    key: v.str(body, 'key', 24),
    bpm: v.int(body, 'bpm', 20, 400),
    duration: v.int(body, 'duration', 1, 60 * 60),
    tuning: v.str(body, 'tuning', 40),
    notes: v.text(body, 'notes', 10_000),
    links: v.links(body, 'links'),
    coverUrl: artUrl(body),
    deezerId: v.int(body, 'deezerId', 1, Number.MAX_SAFE_INTEGER),
  });

  /** Stores remote artwork locally; a failed download just leaves the song without a cover. */
  const storeCover = async (url: string | null | undefined) => {
    if (!url) return null;
    try {
      return await music.saveCover(url);
    } catch (err) {
      console.warn('cover download failed:', (err as Error).message);
      return null;
    }
  };

  app.post('/api/songs', async (c) => {
    const body = v.obj(await c.req.json());
    const f = songFields(body, true);
    const status = v.oneOf(body, 'status', STATUSES) ?? 'todo';
    const id = randomUUID();
    const cover = await storeCover(f.coverUrl);
    tx(db, () => {
      const { next } = db.prepare('SELECT COALESCE(MAX(position) + 1, 0) AS next FROM songs WHERE status = ?').get(status) as { next: number };
      db.prepare(
        `INSERT INTO songs (id, title, artist, original, status, position, song_key, bpm, duration, tuning, notes, links, cover, created_by, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        id, f.title!, f.artist ?? '', f.original ? 1 : 0, status, next, f.key ?? '', f.bpm ?? null, f.duration ?? null,
        f.tuning ?? '', f.notes ?? '', JSON.stringify(f.links ?? []), cover, me(c), now(), now(),
      );
      log(me(c), 'song.added', { songId: id, title: f.title, status });
    });
    broadcast(c);
    // Fill in key, tuning and links after responding, so the card appears instantly; everyone refreshes when done.
    if (!f.original && config.enrichOnAdd !== false) {
      const picked = f.deezerId ? { deezerId: f.deezerId, title: f.title!, artist: f.artist ?? '', cover: null, duration: f.duration ?? null } : undefined;
      void enrichSong(id, picked)
        .then((filled) => filled.length && broadcastAll())
        .catch((err) => console.warn('background enrich failed:', (err as Error).message));
    }
    return c.json({ id }, 201);
  });

  app.patch('/api/songs/:id', async (c) => {
    const song = getSong(c.req.param('id'));
    if (!song) return c.json({ error: 'Essa música não existe mais' }, 404);
    const f = songFields(v.obj(await c.req.json()), false);
    const set = (value: unknown, current: unknown) => (value === undefined ? current : value);
    let cover = song.cover;
    if (f.coverUrl !== undefined) {
      const stored = await storeCover(f.coverUrl);
      if (f.coverUrl && !stored) return c.json({ error: 'Não deu para baixar essa capa. Tente outra.' }, 502);
      music.removeCover(song.cover);
      cover = stored;
    }
    db.prepare(
      `UPDATE songs SET title = ?, artist = ?, original = ?, song_key = ?, bpm = ?, duration = ?, tuning = ?, notes = ?, links = ?, cover = ?, updated_at = ?
       WHERE id = ?`,
    ).run(
      set(f.title, song.title) as string,
      set(f.artist, song.artist) as string,
      f.original === undefined ? song.original : f.original ? 1 : 0,
      set(f.key, song.song_key) as string,
      set(f.bpm, song.bpm) as number | null,
      set(f.duration, song.duration) as number | null,
      set(f.tuning, song.tuning) as string,
      set(f.notes, song.notes) as string,
      f.links === undefined ? song.links : JSON.stringify(f.links),
      cover,
      now(),
      song.id,
    );
    broadcast(c);
    return c.json({ ok: true });
  });

  /**
   * Looks a song up online and fills only what is still empty: cover, length, tempo, key, tuning, and a link per
   * site not linked yet. Never overwrites what the band typed. Returns which fields were filled.
   */
  const enrichSong = async (id: string, picked?: Pick<Match, 'deezerId' | 'title' | 'artist' | 'cover' | 'duration'>): Promise<string[]> => {
    const song = getSong(id);
    if (!song) return [];
    try {
      const match = picked ?? bestMatch(await music.lookup(`${song.title} ${song.artist}`), song.title, song.artist);
      const details = await music.details({ deezerId: match?.deezerId ?? null, title: song.title, artist: song.artist });
      const cover = song.cover ? null : await storeCover(match?.cover);
      const current = getSong(id);
      if (!current) {
        music.removeCover(cover);
        return [];
      }
      const filled: string[] = [];
      const fill = <T,>(field: string, existing: T, found: T | null | undefined, empty: (v: T) => boolean) => {
        if (!empty(existing) || found == null || empty(found)) return existing;
        filled.push(field);
        return found;
      };
      const links = JSON.parse(current.links) as v.Link[];
      const host = (u: string) => new URL(u).hostname.replace(/^(www|open|m)\./, '');
      const have = new Set(links.map((l) => host(l.url)));
      const newLinks = details.links.filter((l) => !have.has(host(l.url)));
      db.prepare(
        `UPDATE songs SET cover = COALESCE(cover, ?), duration = ?, bpm = ?, song_key = ?, tuning = ?, links = ?, enriched_at = ?, updated_at = ? WHERE id = ?`,
      ).run(
        cover,
        fill('duration', current.duration, match?.duration, (x) => x == null),
        fill('bpm', current.bpm, details.bpm, (x) => x == null),
        fill('key', current.song_key, details.key, (x) => !x),
        fill('tuning', current.tuning, details.tuning, (x) => !x),
        JSON.stringify([...links, ...newLinks].slice(0, 12)),
        now(),
        now(),
        id,
      );
      if (cover) filled.push('cover');
      if (newLinks.length) filled.push(...newLinks.map(() => 'link'));
      return filled;
    } catch (err) {
      console.warn('enrich failed for', song.title, (err as Error).message);
      db.prepare('UPDATE songs SET enriched_at = ? WHERE id = ?').run(now(), id);
      return [];
    }
  };

  /** Fills in every song (not originals) that was never looked up. Sequential and capped for the APIs' sake. */
  app.post('/api/songs/enrich', async (c) => {
    const pending = db.prepare('SELECT id FROM songs WHERE enriched_at IS NULL AND original = 0 ORDER BY created_at LIMIT 40').all() as { id: string }[];
    let updated = 0;
    for (const { id } of pending) if ((await enrichSong(id)).length) updated++;
    broadcast(c);
    return c.json({ checked: pending.length, updated });
  });

  app.post('/api/songs/:id/enrich', async (c) => {
    const song = getSong(c.req.param('id'));
    if (!song) return c.json({ error: 'Essa música não existe mais' }, 404);
    const filled = await enrichSong(song.id);
    broadcast(c);
    return c.json({ filled });
  });

  /** Put a song at an index in a column, renumbering both affected columns. */
  function placeSong(song: { id: string; title: string; status: string }, status: string, index: number, actor: string | null, extra: Record<string, unknown> = {}) {
    tx(db, () => {
      const ids = (db.prepare('SELECT id FROM songs WHERE status = ? AND id != ? ORDER BY position').all(status, song.id) as { id: string }[]).map((r) => r.id);
      ids.splice(Math.min(index, ids.length), 0, song.id);
      const update = db.prepare('UPDATE songs SET status = ?, position = ?, updated_at = CASE WHEN id = ? THEN ? ELSE updated_at END WHERE id = ?');
      ids.forEach((id, position) => update.run(status, position, song.id, now(), id));
      if (song.status !== status) {
        const rest = (db.prepare('SELECT id FROM songs WHERE status = ? ORDER BY position').all(song.status) as { id: string }[]);
        rest.forEach((r, position) => db.prepare('UPDATE songs SET position = ? WHERE id = ?').run(position, r.id));
        log(actor, 'song.moved', { songId: song.id, title: song.title, from: song.status, to: status, ...extra });
      }
    });
  }

  /** Move a song to a column and index; renumbers both affected columns. */
  app.post('/api/songs/:id/move', async (c) => {
    const body = v.obj(await c.req.json());
    const status = v.oneOf(body, 'status', STATUSES);
    const index = v.int(body, 'index', 0, 100_000);
    if (!status || index == null) throw new v.BadRequest('Informe a coluna e a posição');
    const song = getSong(c.req.param('id'));
    if (!song) return c.json({ error: 'Essa música não existe mais' }, 404);
    placeSong(song, status, index, me(c));
    broadcast(c);
    return c.json({ ok: true });
  });

  app.put('/api/songs/:id/confidence', async (c) => {
    const memberId = me(c);
    if (!memberId) return c.json({ error: 'Escolha quem você é primeiro' }, 409);
    const song = getSong(c.req.param('id'));
    if (!song) return c.json({ error: 'Essa música não existe mais' }, 404);
    const level = v.int(v.obj(await c.req.json()), 'level', 0, 3);
    if (!level) {
      db.prepare('DELETE FROM confidence WHERE song_id = ? AND member_id = ?').run(song.id, memberId);
    } else {
      db.prepare(
        `INSERT INTO confidence (song_id, member_id, level, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (song_id, member_id) DO UPDATE SET level = excluded.level, updated_at = excluded.updated_at`,
      ).run(song.id, memberId, level, now());
      log(memberId, 'song.confidence', { songId: song.id, title: song.title, level });
    }
    // Once every member says "Domino", the song is show-ready: move it to the top of that column.
    let promoted = false;
    if (level === 3 && song.status !== 'ready') {
      const { members } = db.prepare('SELECT COUNT(*) AS members FROM members').get() as { members: number };
      const { mastered } = db.prepare('SELECT COUNT(*) AS mastered FROM confidence WHERE song_id = ? AND level = 3').get(song.id) as { mastered: number };
      if (members > 0 && mastered >= members) {
        placeSong(song, 'ready', 0, memberId, { auto: true });
        promoted = true;
      }
    }
    broadcast(c);
    return c.json({ ok: true, promoted });
  });

  /** What one member plays or sings on a song ("Guitarra solo", "Voz e piano"); empty clears it. */
  app.put('/api/songs/:id/parts/:memberId', async (c) => {
    const song = getSong(c.req.param('id'));
    if (!song) return c.json({ error: 'Essa música não existe mais' }, 404);
    const memberId = c.req.param('memberId');
    if (!db.prepare('SELECT 1 FROM members WHERE id = ?').get(memberId)) return c.json({ error: 'Integrante não encontrado' }, 404);
    const role = v.str(v.obj(await c.req.json()), 'role', 80) ?? '';
    if (!role) db.prepare('DELETE FROM parts WHERE song_id = ? AND member_id = ?').run(song.id, memberId);
    else
      db.prepare(
        `INSERT INTO parts (song_id, member_id, role, updated_at) VALUES (?, ?, ?, ?)
         ON CONFLICT (song_id, member_id) DO UPDATE SET role = excluded.role, updated_at = excluded.updated_at`,
      ).run(song.id, memberId, role, now());
    broadcast(c);
    return c.json({ ok: true });
  });

  app.post('/api/songs/:id/rehearsed', async (c) => {
    const body = v.obj(await c.req.json());
    const at = v.int(body, 'at', 0, Number.MAX_SAFE_INTEGER);
    const res = db.prepare('UPDATE songs SET last_rehearsed = ? WHERE id = ?').run(at === undefined ? now() : at, c.req.param('id'));
    if (!res.changes) return c.json({ error: 'Essa música não existe mais' }, 404);
    broadcast(c);
    return c.json({ ok: true });
  });

  app.delete('/api/songs/:id', (c) => {
    const song = getSong(c.req.param('id'));
    if (!song) return c.json({ error: 'Essa música não existe mais' }, 404);
    const stored = db.prepare('SELECT file FROM song_files WHERE song_id = ?').all(song.id) as { file: string }[];
    tx(db, () => {
      db.prepare('DELETE FROM songs WHERE id = ?').run(song.id);
      const rest = db.prepare('SELECT id FROM songs WHERE status = ? ORDER BY position').all(song.status) as { id: string }[];
      rest.forEach((r, position) => db.prepare('UPDATE songs SET position = ? WHERE id = ?').run(position, r.id));
      log(me(c), 'song.deleted', { title: song.title });
    });
    music.removeCover(song.cover);
    for (const f of stored) files.remove(f.file);
    broadcast(c);
    return c.json({ ok: true });
  });

  // ---- lyrics, chords and tabs ----

  const textKind = (raw: string) => TEXT_KINDS.find((k) => k === raw);

  app.get('/api/songs/:id/texts', (c) => {
    const song = getSong(c.req.param('id'));
    if (!song) return c.json({ error: 'Essa música não existe mais' }, 404);
    const out: Record<TextKind, string> = { lyrics: '', chords: '', tab: '' };
    for (const r of db.prepare('SELECT kind, body FROM song_texts WHERE song_id = ?').all(song.id) as { kind: TextKind; body: string }[]) {
      if (r.kind in out) out[r.kind] = r.body;
    }
    return c.json(out);
  });

  /** Saves one sheet; an empty body removes it. Logged only when the sheet first appears, not on every keystroke save. */
  const writeText = (song: SongRow, kind: TextKind, body: string, memberId: string | null): number | null => {
    const had = db.prepare('SELECT 1 FROM song_texts WHERE song_id = ? AND kind = ?').get(song.id, kind);
    if (!body.trim()) {
      db.prepare('DELETE FROM song_texts WHERE song_id = ? AND kind = ?').run(song.id, kind);
      return null;
    }
    const at = now();
    db.prepare(
      `INSERT INTO song_texts (song_id, kind, body, updated_by, updated_at) VALUES (?, ?, ?, ?, ?)
       ON CONFLICT (song_id, kind) DO UPDATE SET body = excluded.body, updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ).run(song.id, kind, body, memberId, at);
    if (!had) log(memberId, 'song.text', { songId: song.id, title: song.title, kind });
    return at;
  };

  app.put('/api/songs/:id/texts/:kind', async (c) => {
    const kind = textKind(c.req.param('kind'));
    const song = getSong(c.req.param('id'));
    if (!kind || !song) return c.json({ error: 'Essa música não existe mais' }, 404);
    const body = v.text(v.obj(await c.req.json()), 'body', TEXT_MAX[kind]) ?? '';
    const updatedAt = writeText(song, kind, body, me(c));
    broadcast(c);
    // The saving tab learns the new version stamp, so it doesn't refetch what it just wrote.
    return c.json({ ok: true, updatedAt });
  });

  /** Fills an empty lyrics sheet from LRCLIB. Never replaces lyrics the band already has. */
  app.post('/api/songs/:id/lyrics/lookup', async (c) => {
    const song = getSong(c.req.param('id'));
    if (!song) return c.json({ error: 'Essa música não existe mais' }, 404);
    let found: string | null;
    try {
      found = await music.lyrics(song.title, song.artist, song.duration);
    } catch (err) {
      console.warn('lyrics lookup failed:', (err as Error).message);
      return c.json({ error: 'A busca de letras está fora do ar agora. Tente mais tarde ou cole a letra.' }, 502);
    }
    const existing = db.prepare('SELECT 1 FROM song_texts WHERE song_id = ? AND kind = ?').get(song.id, 'lyrics');
    if (!found || existing) return c.json({ found: false });
    writeText(song, 'lyrics', found, me(c));
    broadcast(c);
    return c.json({ found: true });
  });

  const hasText = (song: SongRow, kind: TextKind) => !!db.prepare('SELECT 1 FROM song_texts WHERE song_id = ? AND kind = ?').get(song.id, kind);

  /** Fills an empty chord sheet from Ultimate Guitar and links the version used. Never replaces a cifra the band already has. */
  app.post('/api/songs/:id/chords/lookup', async (c) => {
    const song = getSong(c.req.param('id'));
    if (!song) return c.json({ error: 'Essa música não existe mais' }, 404);
    let found: { text: string; url: string } | null;
    try {
      found = await music.chords(song.title, song.artist);
    } catch (err) {
      console.warn('chords lookup failed:', (err as Error).message);
      return c.json({ error: 'A busca de cifras está fora do ar agora. Tente mais tarde ou cole a cifra.' }, 502);
    }
    const current = getSong(song.id);
    if (!current || !found || found.text.length > TEXT_MAX.chords || hasText(current, 'chords')) return c.json({ found: false });
    writeText(current, 'chords', found.text, me(c));
    const links = JSON.parse(current.links) as v.Link[];
    if (links.length < 12 && !links.some((l) => l.url.includes('ultimate-guitar.com'))) {
      db.prepare('UPDATE songs SET links = ?, updated_at = ? WHERE id = ?').run(JSON.stringify([...links, { label: '', url: found.url }]), now(), song.id);
    }
    broadcast(c);
    return c.json({ found: true });
  });

  /** A cifra pasted from Cifra Club (or anywhere), cleaned up; its "Tom:" fills an empty key. Only into an empty sheet. */
  app.post('/api/songs/:id/chords/import', async (c) => {
    const song = getSong(c.req.param('id'));
    if (!song) return c.json({ error: 'Essa música não existe mais' }, 404);
    const { text, key } = cleanCifra(v.text(v.obj(await c.req.json()), 'text', TEXT_MAX.chords * 2) ?? '');
    if (!text) return c.json({ error: 'Cole a cifra antes de importar.' }, 400);
    if (text.length > TEXT_MAX.chords) return c.json({ error: 'Essa cifra é grande demais.' }, 400);
    if (hasText(song, 'chords')) return c.json({ error: 'Essa música já tem cifra. Edite a que está lá.' }, 409);
    writeText(song, 'chords', text, me(c));
    if (key) db.prepare(`UPDATE songs SET song_key = ?, updated_at = ? WHERE id = ? AND song_key = ''`).run(key, now(), song.id);
    broadcast(c);
    return c.json({ ok: true });
  });

  // ---- audio and images ----

  /** Raw body with the file's own content type; the name travels in the query string. */
  app.post('/api/songs/:id/files', async (c) => {
    const song = getSong(c.req.param('id'));
    if (!song) return c.json({ error: 'Essa música não existe mais' }, 404);
    const type = uploadType(c.req.header('content-type') ?? '');
    if (!type) return c.json({ error: 'Esse tipo de arquivo não é aceito. Envie áudio (MP3, M4A, WAV, OGG, FLAC) ou imagem (JPG, PNG, WEBP, GIF).' }, 415);
    const max = MAX_BYTES[type.kind];
    if (Number(c.req.header('content-length') ?? 0) > max) return c.json({ error: tooBig(type.kind) }, 413);
    const { count } = db.prepare('SELECT COUNT(*) AS count FROM song_files WHERE song_id = ?').get(song.id) as { count: number };
    if (count >= MAX_FILES_PER_SONG) throw new v.BadRequest(`Cada música guarda até ${MAX_FILES_PER_SONG} arquivos. Apague alguns antes de enviar mais.`);
    const body = c.req.raw.body;
    if (!body) throw new v.BadRequest('O arquivo está vazio');
    let saved: { file: string; size: number };
    try {
      saved = await files.save(body, type.ext, max);
    } catch (err) {
      if (err instanceof TooLarge) return c.json({ error: tooBig(type.kind) }, 413);
      throw err;
    }
    if (!saved.size || !getSong(song.id)) {
      files.remove(saved.file);
      if (!saved.size) throw new v.BadRequest('O arquivo está vazio');
      return c.json({ error: 'Essa música não existe mais' }, 404);
    }
    const id = randomUUID();
    const name = fileName(c.req.query('name') ?? '') || (type.kind === 'audio' ? 'Áudio' : 'Imagem');
    db.prepare('INSERT INTO song_files (id, song_id, kind, name, file, mime, size, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
      id, song.id, type.kind, name, saved.file, type.mime, saved.size, me(c), now(),
    );
    log(me(c), 'song.file', { songId: song.id, title: song.title, kind: type.kind, name });
    broadcast(c);
    return c.json({ id }, 201);
  });

  app.get('/api/files/:id', (c) => {
    const row = db.prepare('SELECT file, mime, name FROM song_files WHERE id = ?').get(c.req.param('id')) as
      | { file: string; mime: string; name: string }
      | undefined;
    if (!row) return c.json({ error: 'Não encontrado' }, 404);
    let out: ReturnType<Files['read']>;
    try {
      out = files.read(row.file, c.req.header('range'));
    } catch {
      return c.json({ error: 'Não encontrado' }, 404);
    }
    const ext = row.file.slice(row.file.lastIndexOf('.'));
    const headers: Record<string, string> = {
      'content-type': row.mime,
      'accept-ranges': 'bytes',
      // Ids are random and never reused, so the browser can keep the bytes forever.
      'cache-control': 'private, max-age=31536000, immutable',
      'content-disposition': `${c.req.query('download') === undefined ? 'inline' : 'attachment'}; filename*=UTF-8''${encodeURIComponent(row.name + ext)}`,
    };
    if (out.status === 416) return c.body(null, 416, { ...headers, 'content-range': `bytes */${out.size}` });
    headers['content-length'] = String(out.end - out.start + 1);
    if (out.status === 206) headers['content-range'] = `bytes ${out.start}-${out.end}/${out.size}`;
    return c.body(out.stream, out.status, headers);
  });

  app.patch('/api/files/:id', async (c) => {
    const name = fileName(v.str(v.obj(await c.req.json()), 'name', 120, { required: true })!);
    if (!name) throw new v.BadRequest('Preencha o campo nome');
    const res = db.prepare('UPDATE song_files SET name = ? WHERE id = ?').run(name, c.req.param('id'));
    if (!res.changes) return c.json({ error: 'Esse arquivo não existe mais' }, 404);
    broadcast(c);
    return c.json({ ok: true });
  });

  app.delete('/api/files/:id', (c) => {
    const row = db.prepare('SELECT file FROM song_files WHERE id = ?').get(c.req.param('id')) as { file: string } | undefined;
    if (!row) return c.json({ error: 'Esse arquivo não existe mais' }, 404);
    db.prepare('DELETE FROM song_files WHERE id = ?').run(c.req.param('id'));
    files.remove(row.file);
    broadcast(c);
    return c.json({ ok: true });
  });

  // ---- music lookup + artwork ----

  app.get('/api/lookup', async (c) => {
    const q = (c.req.query('q') ?? '').trim();
    if (q.length < 2) return c.json({ matches: [] });
    try {
      return c.json({ matches: await music.lookup(q) });
    } catch (err) {
      console.warn('lookup failed:', (err as Error).message);
      return c.json({ error: 'A busca de músicas está fora do ar agora.' }, 502);
    }
  });

  /** Proxies suggestion artwork so the page never loads third-party images directly. */
  app.get('/api/art', async (c) => {
    const url = c.req.query('u') ?? '';
    if (!isArtUrl(url)) return c.json({ error: 'Imagem não permitida' }, 400);
    try {
      const { bytes, type } = await music.fetchImage(url);
      return c.body(new Uint8Array(bytes), 200, { 'content-type': type, 'cache-control': 'private, max-age=86400' });
    } catch {
      return c.json({ error: 'Imagem indisponível' }, 502);
    }
  });

  app.get('/api/covers/:file', (c) => {
    const file = c.req.param('file');
    if (!isCoverFile(file)) return c.json({ error: 'Não encontrado' }, 404);
    try {
      const bytes = readFileSync(join(music.coversDir, file));
      // File names are random and never reused, so the browser can keep them forever.
      return c.body(new Uint8Array(bytes), 200, { 'content-type': coverType(file), 'cache-control': 'private, max-age=31536000, immutable' });
    } catch {
      return c.json({ error: 'Não encontrado' }, 404);
    }
  });

  // ---- setlists ----

  const setlistFields = (body: Record<string, unknown>, required: boolean) => ({
    kind: v.oneOf(body, 'kind', SETLIST_KINDS),
    name: v.str(body, 'name', 120, { required }),
    date: v.date(body, 'date'),
    time: v.time(body, 'time'),
    venue: v.str(body, 'venue', 120),
    notes: v.text(body, 'notes', 5_000),
  });

  const writeItems = (setlistId: string, raw: unknown) => {
    if (!Array.isArray(raw) || raw.length > 200) throw new v.BadRequest('Um setlist aceita até 200 itens');
    const items = raw.map((entry) => {
      const o = v.obj(entry);
      const type = v.oneOf(o, 'type', ITEM_TYPES) ?? 'song';
      const songId = type === 'song' ? v.str(o, 'songId', 64, { required: true })! : null;
      if (songId && !getSong(songId)) throw new v.BadRequest('Uma música deste setlist não existe mais. Recarregue a página e tente de novo.');
      const id = v.str(o, 'id', 64) || randomUUID();
      return { id, type, songId, text: v.str(o, 'text', 200) ?? '', done: v.bool(o, 'done') ?? false };
    });
    db.prepare('DELETE FROM setlist_items WHERE setlist_id = ?').run(setlistId);
    const insert = db.prepare('INSERT INTO setlist_items (id, setlist_id, position, type, song_id, text, done) VALUES (?, ?, ?, ?, ?, ?, ?)');
    items.forEach((item, position) => insert.run(item.id, setlistId, position, item.type, item.songId, item.text, item.done ? 1 : 0));
  };

  app.post('/api/setlists', async (c) => {
    const body = v.obj(await c.req.json());
    const f = setlistFields(body, true);
    const id = randomUUID();
    tx(db, () => {
      db.prepare('INSERT INTO setlists (id, kind, name, date, time, venue, notes, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(
        id, f.kind ?? 'show', f.name!, f.date ?? null, f.time ?? null, f.venue ?? '', f.notes ?? '', now(), now(),
      );
      if (body.items !== undefined) writeItems(id, body.items);
      log(me(c), 'setlist.created', { setlistId: id, name: f.name, kind: f.kind ?? 'show' });
    });
    broadcast(c);
    return c.json({ id }, 201);
  });

  app.patch('/api/setlists/:id', async (c) => {
    const id = c.req.param('id');
    const current = db.prepare('SELECT * FROM setlists WHERE id = ?').get(id) as Record<string, unknown> | undefined;
    if (!current) return c.json({ error: 'Esse setlist não existe mais' }, 404);
    const body = v.obj(await c.req.json());
    const f = setlistFields(body, false);
    const pick = <T,>(value: T | undefined, key: string) => (value === undefined ? current[key] : value) as string | null;
    tx(db, () => {
      db.prepare('UPDATE setlists SET kind = ?, name = ?, date = ?, time = ?, venue = ?, notes = ?, updated_at = ? WHERE id = ?').run(
        pick(f.kind, 'kind'), pick(f.name, 'name'), pick(f.date, 'date'), pick(f.time, 'time'), pick(f.venue, 'venue'), pick(f.notes, 'notes'), now(), id,
      );
      if (body.items !== undefined) writeItems(id, body.items);
    });
    broadcast(c);
    return c.json({ ok: true });
  });

  app.delete('/api/setlists/:id', (c) => {
    const current = db.prepare('SELECT name FROM setlists WHERE id = ?').get(c.req.param('id')) as { name: string } | undefined;
    if (!current) return c.json({ error: 'Esse setlist não existe mais' }, 404);
    db.prepare('DELETE FROM setlists WHERE id = ?').run(c.req.param('id'));
    log(me(c), 'setlist.deleted', { name: current.name });
    broadcast(c);
    return c.json({ ok: true });
  });

  app.all('/api/*', (c) => c.json({ error: 'Não encontrado' }, 404));

  return app;
}
