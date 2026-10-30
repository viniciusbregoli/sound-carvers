import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { createApp } from './app.ts';
import { openDb } from './db.ts';
import { createMusic } from './music.ts';
import { createFiles } from './files.ts';

const TOKEN = 'a'.repeat(64);

async function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'setlist-mcp-'));
  const tokenFile = join(dir, 'token');
  writeFileSync(tokenFile, `${TOKEN}\n`, { mode: 0o600 });
  const db = openDb(dir);
  const app = createApp(db, {
    bandPassword: 'correct horse', secureCookies: false, bandName: 'Test', enrichOnAdd: false, mcpTokenFile: tokenFile,
    music: createMusic(join(dir, 'covers')), files: createFiles(join(dir, 'files')),
  });
  const fetchApp = (url: string | URL | Request, init?: RequestInit) => app.request(url instanceof Request ? url : String(url), init);
  const client = new Client({ name: 'test', version: '1.0.0' });
  await client.connect(
    new StreamableHTTPClientTransport(new URL('http://localhost/mcp'), { fetch: fetchApp as typeof fetch, requestInit: { headers: { authorization: `Bearer ${TOKEN}` } } }),
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const call = async (name: string, args: Record<string, unknown> = {}): Promise<any> => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as { text: string }[])[0].text;
    if (res.isError) throw new Error(text);
    return JSON.parse(text);
  };
  return { app, db, tokenFile, client, call, cleanup: async () => { await client.close(); db.close(); rmSync(dir, { recursive: true }); } };
}

test('mcp refuses requests without the right bearer token', async () => {
  const { app, tokenFile, cleanup } = await setup();
  const init = { method: 'POST', headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' }, body: '{}' };
  const none = await app.request('/mcp', init);
  assert.equal(none.status, 401);
  assert.match(none.headers.get('www-authenticate') ?? '', /^Bearer/);
  const wrong = await app.request('/mcp', { ...init, headers: { ...init.headers, authorization: `Bearer ${'b'.repeat(64)}` } });
  assert.equal(wrong.status, 401);
  // Rotation: the file is read per request, so the old token stops working at once.
  writeFileSync(tokenFile, 'c'.repeat(64));
  const old = await app.request('/mcp', { ...init, headers: { ...init.headers, authorization: `Bearer ${TOKEN}` } });
  assert.equal(old.status, 401);
  await cleanup();
});

test('mcp lists tools with the right annotations', async () => {
  const { client, cleanup } = await setup();
  const { tools } = await client.listTools();
  const byName = new Map(tools.map((t) => [t.name, t]));
  for (const name of ['list_songs', 'get_song', 'create_song', 'update_song', 'delete_song', 'list_setlists', 'get_setlist', 'create_setlist',
    'update_setlist', 'reorder_setlist', 'delete_setlist', 'list_rehearsals', 'get_rehearsal', 'create_rehearsal', 'update_rehearsal', 'delete_rehearsal', 'list_members']) {
    assert.ok(byName.has(name), `missing ${name}`);
  }
  for (const t of tools) {
    const read = t.name.startsWith('list_') || t.name.startsWith('get_');
    assert.equal(t.annotations?.readOnlyHint, read, t.name);
    assert.equal(t.annotations?.destructiveHint, t.name.startsWith('delete_'), t.name);
  }
  await cleanup();
});

test('mcp song round trip with sheets and filters', async () => {
  const { call, cleanup } = await setup();
  const song = await call('create_song', { title: 'Wonderwall', artist: 'Oasis', key: 'F#m', durationSeconds: 258, lyrics: 'Today is gonna be the day', status: 'learning' });
  assert.equal(song.status, 'learning');
  assert.equal(song.lyrics, 'Today is gonna be the day');
  await call('create_song', { title: 'Nossa Música', original: true });

  assert.equal((await call('list_songs', { original: false })).count, 1);
  assert.equal((await call('list_songs', { query: 'wonder' })).songs[0].id, song.id);
  assert.equal((await call('list_songs', { key: 'f#M' })).count, 1);
  assert.equal((await call('list_songs', { hasSheet: 'lyrics' })).count, 1);

  const updated = await call('update_song', { songId: song.id, status: 'ready', chords: 'Em7 G Dsus4 A7sus4', lyrics: '' });
  assert.equal(updated.status, 'ready');
  assert.equal(updated.lyrics, '');
  assert.deepEqual(updated.sheets, ['chords']);
  assert.equal(updated.key, 'F#m');

  await assert.rejects(call('update_song', { songId: song.id, links: [{ url: 'javascript:alert(1)' }] }));
  assert.deepEqual(await call('delete_song', { songId: song.id }), { deleted: true, songId: song.id, title: 'Wonderwall' });
  await assert.rejects(call('get_song', { songId: song.id }), /No song/);
  await cleanup();
});

test('mcp setlists: create, reorder, update keeps done flags', async () => {
  const { call, cleanup } = await setup();
  const a = (await call('create_song', { title: 'A', durationSeconds: 100 })).id;
  const b = (await call('create_song', { title: 'B', durationSeconds: 200 })).id;
  const show = await call('create_setlist', {
    name: 'Gig', date: '2026-11-20', time: '21:00', venue: 'Bar',
    items: [{ type: 'song', songId: a }, { type: 'break', text: 'Set 2' }, { type: 'song', songId: b }],
  });
  assert.equal(show.kind, 'show');
  assert.equal(show.totalDurationSeconds, 300);
  const ids = show.items.map((i: { itemId: string }) => i.itemId);

  const reordered = await call('reorder_setlist', { setlistId: show.id, itemIds: [ids[2], ids[1], ids[0]] });
  assert.deepEqual(reordered.items.map((i: { title?: string; text?: string }) => i.title ?? i.text), ['B', 'Set 2', 'A']);
  await assert.rejects(call('reorder_setlist', { setlistId: show.id, itemIds: [ids[0]] }), /exactly once/);

  assert.equal((await call('list_setlists', { kind: 'show', from: '2026-11-01' })).length, 1);
  assert.equal((await call('list_setlists', { kind: 'rehearsal' })).length, 0);
  await assert.rejects(call('create_setlist', { name: 'X', items: [{ type: 'song', songId: 'nope' }] }), /No song/);

  const renamed = await call('update_setlist', { setlistId: show.id, name: 'Gig 2', time: null });
  assert.equal(renamed.name, 'Gig 2');
  assert.equal(renamed.time, null);
  assert.equal(renamed.items.length, 3);
  assert.deepEqual(await call('delete_setlist', { setlistId: show.id }), { deleted: true, setlistId: show.id, name: 'Gig 2' });
  await cleanup();
});

test('mcp rehearsals: plan, tick off, last rehearsed', async () => {
  const { call, db, cleanup } = await setup();
  const a = (await call('create_song', { title: 'A' })).id;
  const b = (await call('create_song', { title: 'B' })).id;
  const r = await call('create_rehearsal', { date: '2026-10-25', place: 'Estúdio', songIds: [a, b] });
  assert.equal(r.name, 'Ensaio 25/10');
  assert.equal(r.place, 'Estúdio');
  assert.equal(r.songCount, 2);

  const done = await call('update_rehearsal', { rehearsalId: r.id, doneSongIds: [a] });
  assert.deepEqual(done.items.map((i: { done: boolean }) => i.done), [true, false]);
  const { last_rehearsed } = db.prepare('SELECT last_rehearsed FROM songs WHERE id = ?').get(a) as { last_rehearsed: number };
  assert.equal(new Date(last_rehearsed).toISOString().slice(0, 10), '2026-10-25');

  // Reordering via songIds keeps the done flag of a song that stays.
  const swapped = await call('update_rehearsal', { rehearsalId: r.id, songIds: [b, a], notes: 'Focar nas viradas' });
  assert.deepEqual(swapped.items.map((i: { songId: string; done: boolean }) => [i.songId, i.done]), [[b, false], [a, true]]);
  await assert.rejects(call('update_rehearsal', { rehearsalId: r.id, doneSongIds: ['other'] }), /not in this rehearsal/);

  const show = await call('create_setlist', { name: 'Show' });
  await assert.rejects(call('get_rehearsal', { rehearsalId: show.id }), /not a rehearsal/);
  assert.equal((await call('list_rehearsals')).length, 1);
  assert.equal((await call('delete_rehearsal', { rehearsalId: r.id })).deleted, true);
  await cleanup();
});
