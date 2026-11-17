import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { createServer, preview } from 'vite';
import { productionDb } from '../server/db.mjs';
import { makeHandler } from '../server/http.mjs';

let db = await productionDb();
if (!db) {
  const local = new PGlite(process.env.SHOWUP_MEMORY === '1' ? undefined : resolve('.local-db'));
  db = { query: (sql, parameters) => local.query(sql, parameters), transaction: work => local.transaction(work) };
  await local.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
}
const handle = makeHandler(db, { secure: false });
const settings = { host: '127.0.0.1', port: Number(process.env.PORT || 5173), strictPort: true };
function attachApi(app) {
  app.middlewares.use((req, res, next) => req.url?.split('?')[0] === '/api/showup' ? handle(req, res) : next());
}
const plugins = [{ name: 'show-up-local-api', configureServer: attachApi, configurePreviewServer: attachApi }];
const built = process.argv.includes('--preview');
const server = built ? await preview({ plugins, preview: settings }) : await createServer({ plugins, server: settings });
if (!built) await server.listen();
server.printUrls();
