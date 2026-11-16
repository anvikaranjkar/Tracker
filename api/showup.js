import { productionDb } from '../server/db.mjs';
import { makeHandler } from '../server/http.mjs';

const handle = makeHandler(await productionDb(), { secure: true });

export default {
  async fetch(request) {
    const req = {
      method: request.method,
      headers: Object.fromEntries(request.headers),
      [Symbol.asyncIterator]: () => (request.body ?? [])[Symbol.asyncIterator]?.() ?? [][Symbol.iterator]()
    };
    req.headers.host ||= new URL(request.url).host;
    const headers = new Headers();
    const res = {
      statusCode: 200,
      setHeader: (name, value) => headers.set(name, value),
      end(body) { this.body = body; }
    };
    await handle(req, res);
    return new Response(res.body, { status: res.statusCode, headers });
  }
};
