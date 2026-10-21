import { serve } from '@hono/node-server';
import { serveStatic } from '@hono/node-server/serve-static';
import { readFileSync } from 'node:fs';
import { createApp } from './app.ts';
import { openDb, snapshot } from './db.ts';
import { createMusic } from './music.ts';

const dataDir = process.env.DATA_DIR ?? './data';
const staticDir = process.env.STATIC_DIR ?? './dist';
const port = Number(process.env.PORT ?? 8787);
const bandPassword = process.env.BAND_PASSWORD;

if (!bandPassword || bandPassword.length < 8) {
  console.error('BAND_PASSWORD must be set (at least 8 characters).');
  process.exit(1);
}

const db = openDb(dataDir);
const app = createApp(db, {
  bandPassword,
  secureCookies: process.env.SECURE_COOKIES !== 'false',
  bandName: process.env.BAND_NAME ?? 'Sound Carvers',
  music: createMusic(`${dataDir}/covers`),
});

// Hashed build assets never change; the HTML shell always revalidates.
app.use('/assets/*', async (c, next) => {
  await next();
  if (c.res.status === 200) c.header('Cache-Control', 'public, max-age=31536000, immutable');
});
app.use('*', serveStatic({ root: staticDir }));
app.get('*', (c) => {
  c.header('Cache-Control', 'no-cache');
  try {
    return c.html(readFileSync(`${staticDir}/index.html`, 'utf8'));
  } catch {
    return c.text('Frontend not built. Run npm run build.', 503);
  }
});

const takeSnapshot = () => {
  try {
    snapshot(db, dataDir);
  } catch (err) {
    console.error('snapshot failed', err);
  }
};
takeSnapshot();
setInterval(takeSnapshot, 6 * 3_600_000).unref();

const server = serve({ fetch: app.fetch, port, hostname: process.env.HOST ?? '127.0.0.1' }, (info) => {
  console.log(`Setlist listening on http://${info.address}:${info.port}`);
});

const shutdown = () => {
  server.close();
  db.close();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
