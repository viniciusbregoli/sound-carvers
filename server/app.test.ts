import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chmodSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.ts';
import { openDb } from './db.ts';
import { bestMatch, createMusic, tuningName } from './music.ts';
import { createFiles } from './files.ts';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'setlist-'));
  const db = openDb(dir);
  const app = createApp(db, { bandPassword: 'correct horse', secureCookies: false, bandName: 'Test', music: createMusic(join(dir, 'covers')), files: createFiles(join(dir, 'files')), enrichOnAdd: false });
  let cookie = '';
  const call = async (method: string, path: string, body?: unknown, headers: Record<string, string> = {}) => {
    const res = await app.request(path, {
      method,
      headers: { 'content-type': 'application/json', host: 'localhost', ...(cookie ? { cookie } : {}), ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) cookie = setCookie.split(';')[0];
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const data: any = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
    return { status: res.status, body: data };
  };
  /** Raw upload, the way the browser sends it: the file's own type, same-origin. */
  const upload = (path: string, bytes: Uint8Array, type: string, headers: Record<string, string> = {}) =>
    app.request(path, { method: 'POST', headers: { 'content-type': type, host: 'localhost', origin: 'http://localhost', cookie, ...headers }, body: bytes });
  const raw = (path: string, headers: Record<string, string> = {}) => app.request(path, { headers: { host: 'localhost', cookie, ...headers } });
  return { call, upload, raw, dir, cleanup: () => { db.close(); rmSync(dir, { recursive: true }); } };
}

test('rejects everything without the band password', async () => {
  const { call, cleanup } = setup();
  assert.equal((await call('GET', '/api/state')).status, 401);
  assert.equal((await call('POST', '/api/login', { password: 'nope' })).status, 401);
  assert.equal((await call('GET', '/api/state')).status, 401);
  cleanup();
});

test('rate-limits repeated wrong passwords', async () => {
  const { call, cleanup } = setup();
  for (let i = 0; i < 8; i++) await call('POST', '/api/login', { password: 'nope' }, { 'x-forwarded-for': '203.0.113.9' });
  const res = await call('POST', '/api/login', { password: 'correct horse' }, { 'x-forwarded-for': '203.0.113.9' });
  assert.equal(res.status, 429);
  cleanup();
});

test('refuses cross-site and non-JSON mutations', async () => {
  const { call, cleanup } = setup();
  await call('POST', '/api/login', { password: 'correct horse' });
  assert.equal((await call('POST', '/api/songs', { title: 'X' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await call('POST', '/api/songs', { title: 'X' }, { 'content-type': 'text/plain' })).status, 415);
  cleanup();
});

test('board flow: add, move, confidence, setlist', async () => {
  const { call, cleanup } = setup();
  assert.equal((await call('POST', '/api/login', { password: 'correct horse' })).status, 200);
  const member = await call('POST', '/api/members', { name: 'Ana', instrument: 'Drums', color: '#3366ff' });
  assert.equal((await call('POST', '/api/whoami', { memberId: member.body.id })).status, 200);

  const a = (await call('POST', '/api/songs', { title: 'Song A', bpm: 120, duration: 200 })).body.id;
  const b = (await call('POST', '/api/songs', { title: 'Song B' })).body.id;
  const c = (await call('POST', '/api/songs', { title: 'Song C' })).body.id;

  assert.equal((await call('POST', `/api/songs/${c}/move`, { status: 'todo', index: 0 })).status, 200);
  assert.equal((await call('POST', `/api/songs/${a}/move`, { status: 'ready', index: 0 })).status, 200);
  assert.equal((await call('PUT', `/api/songs/${a}/confidence`, { level: 3 })).status, 200);
  assert.equal((await call('PUT', `/api/songs/${a}/parts/${member.body.id}`, { role: 'Bateria e backing vocal' })).status, 200);

  const bad = await call('PATCH', `/api/songs/${b}`, { links: [{ label: 'x', url: 'javascript:alert(1)' }] });
  assert.equal(bad.status, 400);

  const setlist = await call('POST', '/api/setlists', {
    name: 'First gig', kind: 'show', date: '2026-11-01',
    items: [{ type: 'song', songId: a }, { type: 'break', text: 'Set 2' }, { type: 'song', songId: c }],
  });
  assert.equal(setlist.status, 201);

  const state = (await call('GET', '/api/state')).body;
  const todo = state.songs.filter((s: { status: string }) => s.status === 'todo').map((s: { title: string }) => s.title);
  assert.deepEqual(todo, ['Song C', 'Song B']);
  assert.equal(state.songs.find((s: { id: string }) => s.id === a).status, 'ready');
  assert.deepEqual(state.confidence.map((x: { level: number }) => x.level), [3]);
  assert.deepEqual(state.parts.map((x: { role: string }) => x.role), ['Bateria e backing vocal']);
  assert.equal(state.setlists[0].items.length, 3);
  assert.ok(state.activity.some((x: { kind: string }) => x.kind === 'song.moved'));

  assert.equal((await call('DELETE', `/api/songs/${c}`, {})).status, 200);
  const after = (await call('GET', '/api/state')).body;
  assert.equal(after.setlists[0].items.length, 2, 'deleting a song drops it from setlists');
  cleanup();
});

test('a song moves to "ready" once every member says Domino', async () => {
  const { call, cleanup } = setup();
  await call('POST', '/api/login', { password: 'correct horse' });
  const ana = (await call('POST', '/api/members', { name: 'Ana', instrument: 'Drums', color: '#3366ff' })).body.id;
  const bia = (await call('POST', '/api/members', { name: 'Bia', instrument: 'Bass', color: '#ff6633' })).body.id;
  const song = (await call('POST', '/api/songs', { title: 'Song A' })).body.id;
  const statusOf = async () => (await call('GET', '/api/state')).body.songs.find((s: { id: string }) => s.id === song).status;

  await call('POST', '/api/whoami', { memberId: ana });
  assert.equal((await call('PUT', `/api/songs/${song}/confidence`, { level: 3 })).body.promoted, false);
  await call('POST', '/api/whoami', { memberId: bia });
  assert.equal((await call('PUT', `/api/songs/${song}/confidence`, { level: 2 })).body.promoted, false);
  assert.equal(await statusOf(), 'todo');
  assert.equal((await call('PUT', `/api/songs/${song}/confidence`, { level: 3 })).body.promoted, true);
  assert.equal(await statusOf(), 'ready');
  cleanup();
});

test('only accepts artwork from known music CDNs', async () => {
  const { call, cleanup } = setup();
  await call('POST', '/api/login', { password: 'correct horse' });
  assert.equal((await call('POST', '/api/songs', { title: 'X', coverUrl: 'http://169.254.169.254/latest' })).status, 400);
  assert.equal((await call('POST', '/api/songs', { title: 'X', coverUrl: 'https://evil.example/a.jpg' })).status, 400);
  assert.equal((await call('GET', '/api/art?u=https%3A%2F%2Fevil.example%2Fa.jpg')).status, 400);
  assert.equal((await call('GET', '/api/covers/..%2Fsetlist.db')).status, 404);
  cleanup();
});

test('lyrics, chords and tabs: save, list, clear', async () => {
  const { call, cleanup } = setup();
  await call('POST', '/api/login', { password: 'correct horse' });
  const song = (await call('POST', '/api/songs', { title: 'Song A' })).body.id;
  const lyrics = '[Verso]\nLife is a wheel\n\n[Refrão]\nEverything and everyone';
  assert.equal((await call('PUT', `/api/songs/${song}/texts/lyrics`, { body: lyrics })).status, 200);
  assert.equal((await call('PUT', `/api/songs/${song}/texts/chords`, { body: 'B  D#m  E' })).status, 200);
  assert.equal((await call('PUT', `/api/songs/${song}/texts/sheet`, { body: 'x' })).status, 404);
  assert.deepEqual((await call('GET', `/api/songs/${song}/texts`)).body, { lyrics, chords: 'B  D#m  E', tab: '' });

  let state = (await call('GET', '/api/state')).body;
  assert.deepEqual(Object.keys(state.songs[0].texts).sort(), ['chords', 'lyrics']);
  assert.equal(state.activity.filter((a: { kind: string }) => a.kind === 'song.text').length, 2);

  // Saving again doesn't log again; clearing removes the sheet.
  await call('PUT', `/api/songs/${song}/texts/lyrics`, { body: `${lyrics}\nMore` });
  await call('PUT', `/api/songs/${song}/texts/chords`, { body: '  ' });
  state = (await call('GET', '/api/state')).body;
  assert.deepEqual(Object.keys(state.songs[0].texts), ['lyrics']);
  assert.equal(state.activity.filter((a: { kind: string }) => a.kind === 'song.text').length, 2);
  assert.equal((await call('PUT', `/api/songs/${song}/texts/tab`, { body: 'e|'.repeat(60_000) })).status, 400);
  cleanup();
});

test('audio and image uploads: type and origin checks, ranges, rename, delete', async () => {
  const { call, upload, raw, dir, cleanup } = setup();
  await call('POST', '/api/login', { password: 'correct horse' });
  const song = (await call('POST', '/api/songs', { title: 'Song A' })).body.id;
  const bytes = new Uint8Array(1000).map((_, i) => i % 256);

  assert.equal((await upload(`/api/songs/${song}/files?name=x`, bytes, 'image/svg+xml')).status, 415);
  assert.equal((await upload(`/api/songs/${song}/files?name=x`, bytes, 'text/html')).status, 415);
  assert.equal((await upload(`/api/songs/${song}/files`, bytes, 'audio/mpeg', { origin: 'https://evil.example' })).status, 403);
  assert.equal((await upload(`/api/songs/${song}/files`, new Uint8Array(0), 'audio/mpeg')).status, 400);
  assert.equal((await upload(`/api/songs/${song}/files`, new Uint8Array(16_000_000), 'image/png')).status, 413);
  assert.deepEqual(readdirSync(join(dir, 'files')), [], 'refused uploads leave nothing on disk');

  const res = await upload(`/api/songs/${song}/files?name=${encodeURIComponent('Ensaio 21/10')}`, bytes, 'audio/mpeg');
  assert.equal(res.status, 201);
  const { id } = (await res.json()) as { id: string };
  await upload(`/api/songs/${song}/files?name=chart`, bytes, 'image/jpeg');

  const state = (await call('GET', '/api/state')).body;
  assert.deepEqual(
    state.files.map((f: { kind: string; name: string; size: number }) => [f.kind, f.name, f.size]),
    [['audio', 'Ensaio 21/10', 1000], ['image', 'chart', 1000]],
  );
  assert.equal(state.files[0].url, `/api/files/${id}`);

  const whole = await raw(`/api/files/${id}`);
  assert.equal(whole.status, 200);
  assert.equal(whole.headers.get('content-type'), 'audio/mpeg');
  assert.equal(whole.headers.get('accept-ranges'), 'bytes');
  assert.equal((await whole.arrayBuffer()).byteLength, 1000);
  const part = await raw(`/api/files/${id}`, { range: 'bytes=10-19' });
  assert.equal(part.status, 206);
  assert.equal(part.headers.get('content-range'), 'bytes 10-19/1000');
  assert.deepEqual([...new Uint8Array(await part.arrayBuffer())], [10, 11, 12, 13, 14, 15, 16, 17, 18, 19]);
  assert.equal((await raw(`/api/files/${id}`, { range: 'bytes=-5' })).headers.get('content-range'), 'bytes 995-999/1000');
  assert.equal((await raw(`/api/files/${id}`, { range: 'bytes=5000-' })).status, 416);
  assert.match((await raw(`/api/files/${id}?download`)).headers.get('content-disposition') ?? '', /^attachment; filename\*=UTF-8''Ensaio%2021%2F10\.mp3$/);

  assert.equal((await call('PATCH', `/api/files/${id}`, { name: 'Take 2' })).status, 200);
  assert.equal((await call('GET', '/api/state')).body.files[0].name, 'Take 2');
  assert.equal((await call('DELETE', `/api/files/${id}`, {})).status, 200);
  assert.equal((await raw(`/api/files/${id}`)).status, 404);
  assert.equal(readdirSync(join(dir, 'files')).length, 1);

  // Deleting the song takes its files along.
  await call('DELETE', `/api/songs/${song}`, {});
  assert.deepEqual(readdirSync(join(dir, 'files')), []);
  assert.equal((await call('GET', '/api/state')).body.files.length, 0);
  assert.ok(existsSync(join(dir, 'files')));
  cleanup();
});

test('a failed disk write rejects the upload instead of crashing or hanging', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'setlist-files-'));
  const files = createFiles(dir);
  chmodSync(dir, 0o500); // the file can't be created: the write stream errors while the body is still streaming
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      await new Promise((r) => setTimeout(r, 20));
      controller.enqueue(new Uint8Array(1000));
      if (Math.random() < 0.2) controller.close();
    },
  });
  await assert.rejects(files.save(body, 'mp3', 1_000_000), /EACCES|permission/i);
  chmodSync(dir, 0o700);
  assert.deepEqual(readdirSync(dir), []);
  rmSync(dir, { recursive: true });
});

test('matches covers to the right song, skipping live versions', () => {
  const m = (title: string, artist: string, album = '') => ({ id: title, title, artist, album, duration: 1, art: 'a', cover: 'c', deezerId: 1 });
  const results = [m('Tempo Perdido (Ao Vivo)', 'Legião Urbana'), m('Tempo Perdido', 'Legião Urbana', 'Dois'), m('Tempo Perdido', 'Zezé')];
  assert.equal(bestMatch(results, 'Tempo perdido', 'Legiao Urbana')?.album, 'Dois');
  assert.equal(bestMatch(results, 'Outra Música', ''), null);
  assert.equal(bestMatch([m('Mr. Brightside', 'The Killers')], 'Mr Brightside', 'Killers')?.title, 'Mr. Brightside');
});

test('names guitar tunings from Songsterr MIDI notes', () => {
  assert.equal(tuningName([64, 59, 55, 50, 45, 40]), 'Padrão');
  assert.equal(tuningName([64, 59, 55, 50, 45, 38]), 'Drop D');
  assert.equal(tuningName([63, 58, 54, 49, 44, 39]), 'Meio tom abaixo (E♭)');
  assert.equal(tuningName([64, 59, 55, 50, 45, 40, 35]), 'B E A D G B E');
});
