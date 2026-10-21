import { DatabaseSync } from 'node:sqlite';
import { mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';

export const STATUSES = ['todo', 'learning', 'shaky', 'ready'] as const;
export type Status = (typeof STATUSES)[number];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS members (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  instrument TEXT NOT NULL DEFAULT '',
  color TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS songs (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  artist TEXT NOT NULL DEFAULT '',
  original INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'todo',
  position INTEGER NOT NULL DEFAULT 0,
  song_key TEXT NOT NULL DEFAULT '',
  bpm INTEGER,
  duration INTEGER,
  tuning TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  links TEXT NOT NULL DEFAULT '[]',
  last_rehearsed INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS confidence (
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  level INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (song_id, member_id)
);
CREATE TABLE IF NOT EXISTS parts (
  song_id TEXT NOT NULL REFERENCES songs(id) ON DELETE CASCADE,
  member_id TEXT NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  role TEXT NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (song_id, member_id)
);
CREATE TABLE IF NOT EXISTS setlists (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  date TEXT,
  time TEXT,
  venue TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS setlist_items (
  id TEXT PRIMARY KEY,
  setlist_id TEXT NOT NULL REFERENCES setlists(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  type TEXT NOT NULL,
  song_id TEXT REFERENCES songs(id) ON DELETE CASCADE,
  text TEXT NOT NULL DEFAULT '',
  done INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS setlist_items_by_setlist ON setlist_items(setlist_id, position);
CREATE TABLE IF NOT EXISTS activity (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id TEXT,
  kind TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  member_id TEXT,
  created_at INTEGER NOT NULL,
  last_seen INTEGER NOT NULL
);
`;

export function openDb(dataDir: string) {
  mkdirSync(dataDir, { recursive: true });
  const db = new DatabaseSync(join(dataDir, 'setlist.db'));
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 3000;');
  db.exec(SCHEMA);
  // Migrations for databases created by earlier versions.
  const songColumns = (db.prepare('PRAGMA table_info(songs)').all() as { name: string }[]).map((c) => c.name);
  if (!songColumns.includes('cover')) db.exec('ALTER TABLE songs ADD COLUMN cover TEXT');
  // When the song was last looked up online (cover, key, tuning); null = never tried.
  if (!songColumns.includes('enriched_at')) db.exec('ALTER TABLE songs ADD COLUMN enriched_at INTEGER');
  return db;
}

export type Db = ReturnType<typeof openDb>;

export function tx<T>(db: Db, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

/** Consistent copy for restores; the live file plus WAL is not safe to tar mid-write. */
export function snapshot(db: Db, dataDir: string, keep = 7) {
  const dir = join(dataDir, 'snapshots');
  mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().slice(0, 10);
  const target = join(dir, `setlist-${stamp}.db`);
  rmSync(target, { force: true });
  db.prepare('VACUUM INTO ?').run(target);
  const files = readdirSync(dir).filter((f) => f.startsWith('setlist-')).sort();
  for (const old of files.slice(0, Math.max(0, files.length - keep))) rmSync(join(dir, old));
}
