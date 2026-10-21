import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createApp } from './app.ts';
import { openDb } from './db.ts';
import { bestMatch, createMusic, tuningName } from './music.ts';

function setup() {
  const dir = mkdtempSync(join(tmpdir(), 'setlist-'));
  const db = openDb(dir);
  const app = createApp(db, { bandPassword: 'correct horse', secureCookies: false, bandName: 'Test', music: createMusic(join(dir, 'covers')), enrichOnAdd: false });
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
  return { call, cleanup: () => { db.close(); rmSync(dir, { recursive: true }); } };
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
