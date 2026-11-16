import { readFile } from 'node:fs/promises';
import { productionDb } from '../server/db.mjs';
const db = await productionDb();
if (!db) throw new Error('Set DATABASE_URL to run against hosted Postgres.');
await db.query(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
await db.close();
console.log('Show Up database is ready.');
