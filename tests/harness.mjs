import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { makeHandler } from '../server/http.mjs';

export async function harness(clock, { secure = false } = {}) {
  const store = new PGlite();
  const db = { query: (sql, parameters) => store.query(sql, parameters), transaction: work => store.transaction(work) };
  await store.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  const handle = makeHandler(db, { secure, clock });
  async function request(body, cookie, extra = {}) {
    const headers = new Map();
    const req = {
      method: 'POST', body, socket: { remoteAddress: '127.0.0.1' },
      headers: { host: 'showup.test', 'content-type': 'application/json', 'x-show-up': '1', cookie, ...extra }
    };
    const res = { statusCode: 200, setHeader: (name, value) => headers.set(name, value), end(output) { this.body = output; } };
    await handle(req, res);
    return { status: res.statusCode, body: JSON.parse(res.body), headers };
  }
  function session() {
    let cookie = '';
    return async (action, data = {}) => {
      const result = await request({ action, ...data }, cookie);
      if (result.headers.has('Set-Cookie')) cookie = result.headers.get('Set-Cookie').split(';')[0];
      return result;
    };
  }
  return { db, request, session, exec: statement => store.exec(statement), close: () => store.close() };
}
