// Seeds a throwaway Sound Carvers instance with demo data for the tutorial video.
const BASE = process.argv[2] ?? 'http://127.0.0.1:18791';
let cookie = '';
async function call(method, path, body) {
  const res = await fetch(BASE + path, {
    method,
    headers: { 'content-type': 'application/json', origin: BASE, ...(cookie ? { cookie } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const data = res.headers.get('content-type')?.includes('json') ? await res.json() : null;
  if (!res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data)}`);
  return data;
}

await call('POST', '/api/login', { password: 'demo-ensaio-2026' });

const people = [
  { name: 'Vini', instrument: 'Guitarra solo', color: '#4f8ef7' },
  { name: 'Athos', instrument: 'Guitarra base e voz', color: '#e08a2c' },
  { name: 'Tassy', instrument: 'Teclado e voz', color: '#d9508f' },
  { name: 'Beca', instrument: 'Bateria e voz', color: '#3fb27f' },
  { name: 'Julio', instrument: 'Baixo', color: '#e3c341' },
];
const ids = {};
for (const p of people) ids[p.name] = (await call('POST', '/api/members', p)).id;

// [query, status, levels for Vini/Athos/Tassy/Beca/Julio (0 = not rated), parts]
const songs = [
  ['Zombie The Cranberries', 'ready', [3, 3, 3, 3, 3], { Vini: 'Guitarra solo e efeitos', Athos: 'Guitarra base', Tassy: 'Voz principal', Beca: 'Bateria', Julio: 'Baixo' }],
  ['Ainda É Cedo Legião Urbana', 'ready', [3, 3, 3, 3, 3], { Athos: 'Voz principal e violão', Tassy: 'Teclado e backing vocal' }],
  ['Seven Nation Army The White Stripes', 'ready', [3, 3, 3, 3, 2], { Julio: 'Riff no baixo com oitavador', Beca: 'Bateria e voz' }],
  ['Dani California Red Hot Chili Peppers', 'shaky', [3, 2, 3, 2, 3], { Vini: 'Guitarra solo', Athos: 'Voz principal', Tassy: 'Teclado e backing vocal', Beca: 'Bateria', Julio: 'Baixo' }],
  ['Everlong Foo Fighters', 'shaky', [3, 3, 3, 3, 0], { Vini: 'Guitarra solo (Drop D)', Athos: 'Voz e guitarra base (Drop D)', Tassy: 'Synth (pad)', Beca: 'Bateria', Julio: 'Baixo' }],
  ['Lanterna dos Afogados Os Paralamas do Sucesso', 'learning', [2, 1, 2, 2, 2], { Athos: 'Voz principal', Tassy: 'Teclado e metais' }],
  ['Come As You Are Nirvana', 'learning', [2, 2, 1, 2, 2], { Vini: 'Riff com chorus', Beca: 'Bateria e backing vocal' }],
  ['Mr. Brightside The Killers', 'learning', [1, 2, 1, 1, 2], { Tassy: 'Voz principal e synth da intro' }],
  ['Tempo Perdido Legião Urbana', 'todo', [0, 0, 0, 0, 0], {}],
  ['Wonderwall Oasis', 'todo', [0, 1, 0, 0, 0], {}],
  ['Pais e Filhos Legião Urbana', 'todo', [0, 0, 0, 0, 0], {}],
];

const songIds = {};
for (const [q, status, , ] of songs) {
  const { matches } = await call("GET", `/api/lookup?q=${encodeURIComponent(q)}`);
  const m = matches[0];
  const id = (await call('POST', '/api/songs', {
    title: m.title, artist: m.artist, duration: m.duration ?? undefined, coverUrl: m.cover ?? undefined, deezerId: m.deezerId ?? undefined, status,
  })).id;
  songIds[q] = id;
  console.log('added', m.title, '—', m.artist);
}
const original = (await call('POST', '/api/songs', { title: 'Serragem', artist: 'Sound Carvers', original: true, status: 'learning', key: 'Em', bpm: 128, duration: 214, tuning: 'Meio tom abaixo (E♭)' })).id;

for (const [i, p] of people.entries()) {
  await call('POST', '/api/whoami', { memberId: ids[p.name] });
  for (const [q, , levels] of songs) if (levels[i]) await call('PUT', `/api/songs/${songIds[q]}/confidence`, { level: levels[i] });
  await call('PUT', `/api/songs/${original}/confidence`, { level: [2, 2, 1, 2, 1][i] });
}
for (const [q, , , parts] of songs) for (const [who, role] of Object.entries(parts)) await call('PUT', `/api/songs/${songIds[q]}/parts/${ids[who]}`, { role });
await call('PUT', `/api/songs/${original}/parts/${ids.Vini}`, { role: 'Guitarra solo e composição' });
await call('PUT', `/api/songs/${original}/parts/${ids.Athos}`, { role: 'Voz e letra' });

await call('POST', '/api/whoami', { memberId: ids.Vini });
const s = (q) => ({ type: 'song', songId: songIds[q] });
await call('POST', '/api/setlists', {
  name: 'Show no Bar do Zé', kind: 'show', date: '2026-11-14', time: '21:30', venue: 'Bar do Zé, Pinheiros',
  items: [
    s('Ainda É Cedo Legião Urbana'), s('Zombie The Cranberries'), s('Dani California Red Hot Chili Peppers'), s('Seven Nation Army The White Stripes'),
    { type: 'break', text: 'Intervalo' },
    s('Everlong Foo Fighters'), { type: 'note', text: 'Athos apresenta a banda' }, s('Come As You Are Nirvana'), s('Lanterna dos Afogados Os Paralamas do Sucesso'),
  ],
});
await call('POST', '/api/setlists', {
  name: 'Ensaio de sábado', kind: 'rehearsal', date: '2026-10-24', time: '15:00', venue: 'Estúdio Garagem',
  items: [s('Mr. Brightside The Killers'), s('Come As You Are Nirvana'), { type: 'song', songId: original }, s('Lanterna dos Afogados Os Paralamas do Sucesso'), s('Dani California Red Hot Chili Peppers')],
});
await call('POST', '/api/whoami', { memberId: ids.Vini });
console.log('seeded; members', ids);
