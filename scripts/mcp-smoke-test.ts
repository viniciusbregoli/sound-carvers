// Smoke test for the deployed MCP endpoint, using the official MCP client SDK.
// Usage: node scripts/mcp-smoke-test.ts [url]
//   url defaults to https://setlist.soundcarvers.com.br/mcp; the token is read from MCP_TOKEN_FILE
//   (default ~/.config/soundcarvers-setlist-mcp/token) and never printed.
import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const url = new URL(process.argv[2] ?? 'https://setlist.soundcarvers.com.br/mcp');
const token = readFileSync(process.env.MCP_TOKEN_FILE ?? join(homedir(), '.config/soundcarvers-setlist-mcp/token'), 'utf8').trim();
const TITLE = 'MCP SMOKE TEST - delete me';

let failed = false;
const check = (ok: boolean, what: string) => {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${what}`);
  if (!ok) failed = true;
};

// 1. No token, and a wrong token: 401 with a Bearer challenge.
const probe = (auth?: string) =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream', ...(auth ? { authorization: auth } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'tools/list' }),
  });
const anon = await probe();
check(anon.status === 401 && /^Bearer/.test(anon.headers.get('www-authenticate') ?? ''), `no token -> HTTP ${anon.status}, WWW-Authenticate: ${anon.headers.get('www-authenticate')}`);
const wrong = await probe(`Bearer ${'0'.repeat(64)}`);
check(wrong.status === 401, `wrong token -> HTTP ${wrong.status}`);

// 2. initialize
const client = new Client({ name: 'sound-carvers-smoke-test', version: '1.0.0' });
await client.connect(new StreamableHTTPClientTransport(url, { requestInit: { headers: { authorization: `Bearer ${token}` } } }));
const info = client.getServerVersion();
check(info?.name === 'sound-carvers-setlist', `initialize -> ${info?.name} ${info?.version}, protocol ok`);

// 3. tools/list
const { tools } = await client.listTools();
console.log(`      ${tools.length} tools: ${tools.map((t) => `${t.name}${t.annotations?.destructiveHint ? ' (destructive)' : ''}`).join(', ')}`);
check(tools.length >= 17, 'tools/list');

const call = async (name: string, args: Record<string, unknown> = {}) => {
  const res = await client.callTool({ name, arguments: args });
  const text = (res.content as { text: string }[])[0].text;
  if (res.isError) throw new Error(`${name}: ${text}`);
  return JSON.parse(text);
};

// 4. A read call.
const songs = await call('list_songs', { limit: 500 });
check(typeof songs.count === 'number', `list_songs -> ${songs.count} songs`);
const setlists = await call('list_setlists');
check(Array.isArray(setlists), `list_setlists -> ${setlists.length} setlists`);

// 5. Create + delete round trip on a clearly named record (original: no online lookups).
let createdId: string | undefined;
try {
  const created = await call('create_song', { title: TITLE, original: true, status: 'todo', notes: 'Created by scripts/mcp-smoke-test.ts' });
  createdId = created.id;
  check(created.title === TITLE, `create_song -> ${created.id}`);
  const fetched = await call('get_song', { songId: created.id });
  check(fetched.notes.includes('smoke-test'), 'get_song reads it back');
  const updated = await call('update_song', { songId: created.id, key: 'E', lyrics: 'la la la' });
  check(updated.key === 'E' && updated.lyrics === 'la la la', 'update_song');
} finally {
  if (createdId) {
    const deleted = await call('delete_song', { songId: createdId });
    check(deleted.deleted === true, 'delete_song');
    const gone = await client.callTool({ name: 'get_song', arguments: { songId: createdId } });
    check(!!gone.isError, 'deleted song is gone');
  }
}
const leftovers = await call('list_songs', { query: TITLE });
check(leftovers.count === 0, 'no smoke-test records left behind');

await client.close();
console.log(failed ? 'SMOKE TEST FAILED' : 'SMOKE TEST PASSED');
process.exit(failed ? 1 : 0);
