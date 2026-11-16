import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { AppError, applyAction, clean, newPact, requireThat, settle, validDay, validId, visiblePact } from './pacts.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const passwordDerive = promisify(scrypt);
const sessionSeconds = 30 * 24 * 60 * 60;
const inviteMs = 7 * 86400000;
const clocks = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const settingsDefault = { mute: false, quiet: false, quietStart: '22:00', quietEnd: '07:00', zone: 'Australia/Sydney' };
function accountZone(value) {
  try {
    const zone = clean(value, 80);
    if (zone) return new Intl.DateTimeFormat('en', { timeZone: zone }).resolvedOptions().timeZone;
  } catch {}
  return settingsDefault.zone;
}
const baseProfile = (name, zone) => ({ name, settings: { ...settingsDefault, zone: accountZone(zone) }, events: [], favourites: {}, inboxSince: 0 });
const one = async (db, sql, params) => (await db.query(sql, params)).rows[0];
const iso = ms => new Date(ms).toISOString();
const userView = row => ({ id: row.id, handle: row.handle, ...row.profile });

async function getBody(req) {
  if (req.body !== undefined) {
    const value = typeof req.body === 'string' || Buffer.isBuffer(req.body) ? JSON.parse(req.body.toString()) : req.body;
    requireThat(value && !Array.isArray(value) && typeof value === 'object' && Buffer.byteLength(JSON.stringify(value)) <= 16000, 'This request is too large or invalid.', 413);
    return value;
  }
  const buffers = [];
  let bytes = 0;
  for await (const chunk of req) {
    bytes += chunk.length;
    requireThat(bytes <= 16000, 'This request is too large.', 413);
    buffers.push(chunk);
  }
  const value = JSON.parse(Buffer.concat(buffers).toString());
  requireThat(value && !Array.isArray(value) && typeof value === 'object', 'Invalid request.');
  return value;
}

async function passwordHash(password, salt) {
  return Buffer.from(await passwordDerive(password, salt, 64, { N: 32768, maxmem: 64 * 1024 * 1024 })).toString('hex');
}
function writeCookie(res, name, value, secure, seconds) {
  res.setHeader('Set-Cookie', [name + '=' + value, 'Path=/', 'HttpOnly', 'SameSite=Lax', 'Max-Age=' + seconds, ...(secure ? ['Secure'] : [])].join('; '));
}
function readCookie(req, name) {
  return (req.headers.cookie || '').split(';').map(item => item.trim()).find(item => item.startsWith(name + '='))?.slice(name.length + 1);
}
async function authLimit(db, key, now, max) {
  const bucket = Math.floor(now / (15 * 60000));
  const count = await one(db, `INSERT INTO showup_auth_limits(key, bucket) VALUES ($1, $2)
    ON CONFLICT(key,bucket) DO UPDATE SET attempts = LEAST(showup_auth_limits.attempts + 1, 100000)
    RETURNING attempts`, [hash(key), bucket]);
  requireThat(count.attempts <= max, 'Too many attempts. Try again in 15 minutes.', 429);
}
async function authenticate(db, req, res, name, secure, data, now) {
  const handle = clean(data.handle, 25).toLowerCase();
  const password = typeof data.password === 'string' ? data.password : '';
  const signup = data.action === 'signup';
  const display = clean(data.name, 40);
  requireThat(typeof data.handle === 'string' && data.handle.trim().length <= 24 && /^[a-z0-9_]{3,24}$/.test(handle),
    'Use 3–24 letters, numbers or underscores for your username.');
  requireThat(password.length >= 10 && password.length <= 128, 'Use a password between 10 and 128 characters.');
  requireThat(!signup || display.length >= 2, 'Enter the name your friend will see.');
  const source = String(req.headers['x-vercel-forwarded-for'] || req.socket?.remoteAddress || 'local').split(',')[0].slice(0, 120);
  await authLimit(db, 'ip:' + source, now, signup ? 18 : 45);
  await authLimit(db, 'handle:' + handle, now, 18);

  let account = await one(db, 'SELECT id, handle, password_hash, profile FROM showup_accounts WHERE handle = $1', [handle]);
  if (signup) {
    requireThat(!account, 'That username is taken. Choose another or sign in.', 409);
    const salt = randomBytes(16).toString('hex');
    const secret = salt + ':' + await passwordHash(password, salt);
    account = await one(db, `INSERT INTO showup_accounts(id, handle, password_hash, profile) VALUES ($1,$2,$3,$4::text::jsonb)
      ON CONFLICT(handle) DO NOTHING RETURNING id,handle,profile`, [randomUUID(), handle, secret, JSON.stringify(baseProfile(display, data.zone))]);
    requireThat(account, 'That username is taken. Choose another or sign in.', 409);
  } else {
    const [salt, stored] = account?.password_hash.split(':') ?? ['d91ae9ba070a8fadbc53877551f29612', '0'.repeat(128)];
    const found = await passwordHash(password, salt);
    requireThat(timingSafeEqual(Buffer.from(found, 'hex'), Buffer.from(stored, 'hex')) && account, 'Check your username and password.', 401);
  }
  const raw = token();
  const old = readCookie(req, name);
  await db.transaction(async client => {
    if (old && tokenPattern.test(old)) await client.query('DELETE FROM showup_sessions WHERE token_hash=$1', [hash(old)]);
    await client.query('DELETE FROM showup_sessions WHERE expires_at < $1', [iso(now)]);
    await client.query('DELETE FROM showup_auth_limits WHERE bucket < $1', [Math.floor(now / (15 * 60000)) - 2]);
    await client.query('INSERT INTO showup_sessions(token_hash, account_id, expires_at) VALUES($1,$2,$3)', [hash(raw), account.id, iso(now + sessionSeconds * 1000)]);
  });
  writeCookie(res, name, raw, secure, sessionSeconds);
  return { user: userView(account) };
}
async function session(db, req, name, now) {
  const raw = readCookie(req, name);
  if (!raw || !tokenPattern.test(raw)) return null;
  return one(db, `SELECT a.id,a.handle,a.profile FROM showup_accounts a
    JOIN showup_sessions s ON a.id=s.account_id WHERE s.token_hash=$1 AND s.expires_at>$2`, [hash(raw), iso(now)]);
}
async function updateProfile(db, account, data, now) {
  return db.transaction(async client => {
    const row = await one(client, 'SELECT id,handle,profile FROM showup_accounts WHERE id=$1 FOR UPDATE', [account.id]);
    const p = row.profile;
    if (data.action === 'settings') {
      const { zone, quietStart, quietEnd } = data.settings ?? {};
      requireThat(typeof zone === 'string' && zone.length <= 80 && clocks.test(quietStart) && clocks.test(quietEnd), 'Check the quiet hours and time zone.');
      try { new Intl.DateTimeFormat('en', { timeZone: zone }); } catch { throw new AppError(400, 'Choose a valid time zone.'); }
      p.settings = { zone, quietStart, quietEnd, mute: Boolean(data.settings.mute), quiet: Boolean(data.settings.quiet) };
    } else if (data.action === 'inboxRead') {
      p.inboxSince = now;
    } else if (data.action === 'favourite') {
      const amount = Number(data.amount);
      requireThat(validId(data.goalId) && Number.isFinite(amount) && amount >= 0 && amount <= 100000, 'Invalid favourite.');
      const key = data.goalId;
      if (data.remove) delete p.favourites[key];
      else {
        requireThat(p.favourites[key] !== undefined || Object.keys(p.favourites).length < 250, 'Remove a favourite to add another.');
        p.favourites[key] = amount;
      }
    } else if (data.action === 'event') {
      const title = clean(data.title, 80);
      requireThat(title && validDay(data.day) && (!data.time || clocks.test(data.time)), 'Choose a date, title and optional time.');
      requireThat(p.events.length < 500, 'Remove an event to add another.');
      p.events.push({ id: randomUUID(), title, day: data.day, time: data.time || '', note: clean(data.note, 280) });
    } else {
      p.events = p.events.filter(event => event.id !== data.id);
    }
    await client.query('UPDATE showup_accounts SET profile=$1::text::jsonb WHERE id=$2', [JSON.stringify(p), account.id]);
    return { user: userView(row) };
  });
}
async function updatePact(client, row, now) {
  row.document.serial = (row.document.serial || 0) + 1;
  await client.query(`UPDATE showup_pacts SET friend_id=$1,invite_hash=$2,invite_expires_at=$3,document=$4::text::jsonb,edited_at=$5 WHERE id=$6`,
    [row.friend_id, row.invite_hash, row.invite_expires_at, JSON.stringify(row.document), iso(now), row.id]);
}
async function pactList(db, id, now) {
  const { rows } = await db.query('SELECT * FROM showup_pacts WHERE owner_id=$1 OR friend_id=$1 ORDER BY edited_at DESC', [id]);
  return Promise.all(rows.map(async row => {
    if (!settle(row.document, now)) return visiblePact(row, id);
    return db.transaction(async client => {
      const latest = await one(client, 'SELECT * FROM showup_pacts WHERE id=$1 FOR UPDATE', [row.id]);
      if (settle(latest.document, now)) await updatePact(client, latest, now);
      return visiblePact(latest, id);
    });
  }));
}

async function run(db, req, res, data, now, cookieName, secure) {
  const action = data.action;
  if (['signup', 'login'].includes(action)) return authenticate(db, req, res, cookieName, secure, data, now);
  if (action === 'invitePreview') {
    requireThat(typeof data.token === 'string' && tokenPattern.test(data.token), 'This invitation link is invalid.', 404);
    const row = await one(db, 'SELECT document,friend_id,invite_expires_at FROM showup_pacts WHERE invite_hash=$1', [hash(data.token)]);
    requireThat(row && !row.document.endedOn && +new Date(row.invite_expires_at) > now, 'This link has expired or was replaced. Ask your friend for a fresh link.', 404);
    requireThat(!row.friend_id, 'This invitation has already been used. Sign in to see your pacts.', 409);
    return { invite: { name: row.document.draft.terms.name, from: row.document.members[0].name, expires: +new Date(row.invite_expires_at) } };
  }
  const account = await session(db, req, cookieName, now);
  if (action === 'session') return { user: account ? userView(account) : null };
  requireThat(account, 'Sign in to continue.', 401);
  const user = account.id;
  if (action === 'logout') {
    await db.query('DELETE FROM showup_sessions WHERE token_hash=$1', [hash(readCookie(req, cookieName))]);
    writeCookie(res, cookieName, '', secure, 0);
    return {};
  }
  if (action === 'sync') return { user: userView(account), pacts: await pactList(db, user, now), now };
  if (['settings', 'event', 'removeEvent', 'inboxRead', 'favourite'].includes(action)) return updateProfile(db, account, data, now);
  if (action === 'create') {
    const pact = newPact(user, account.profile.name, data.terms || {}, now);
    await db.transaction(async client => {
      await client.query('SELECT id FROM showup_accounts WHERE id=$1 FOR UPDATE', [user]);
      const { count } = await one(client, 'SELECT count(*)::int AS count FROM showup_pacts WHERE owner_id=$1 OR friend_id=$1', [user]);
      requireThat(count < 50, 'This account has reached its pact limit.');
      await client.query('INSERT INTO showup_pacts(id,owner_id,document,edited_at) VALUES($1,$2,$3::text::jsonb,$4)', [pact.id, user, JSON.stringify(pact), iso(now)]);
    });
    return { pact: visiblePact({ document: pact }, user) };
  }
  if (action === 'join') {
    requireThat(typeof data.token === 'string' && tokenPattern.test(data.token), 'This invitation link is invalid.', 404);
    return db.transaction(async client => {
      await client.query('SELECT id FROM showup_accounts WHERE id=$1 FOR UPDATE', [user]);
      const row = await one(client, 'SELECT * FROM showup_pacts WHERE invite_hash=$1 FOR UPDATE', [hash(data.token)]);
      requireThat(row && !row.document.endedOn && +new Date(row.invite_expires_at) > now, 'This link has expired or was replaced. Ask for a fresh link.', 404);
      requireThat(user !== row.owner_id, 'This is your invitation. Open it under a different account to join.', 409);
      if (row.friend_id === user) return { pact: visiblePact(row, user) };
      requireThat(!row.friend_id, 'Another friend has already joined this pact.', 409);
      const { count } = await one(client, 'SELECT count(*)::int AS count FROM showup_pacts WHERE owner_id=$1 OR friend_id=$1', [user]);
      requireThat(count < 50, 'This account has reached its pact limit.');
      row.friend_id = user;
      row.document.members.push({ id: user, name: account.profile.name });
      row.document.history.push({ id: randomUUID(), at: now, user, type: 'join', description: account.profile.name + ' joined the pact.' });
      await updatePact(client, row, now);
      return { pact: visiblePact(row, user) };
    });
  }
  requireThat(validId(data.pactId), 'Choose a pact.');
  return db.transaction(async client => {
    const row = await one(client, 'SELECT * FROM showup_pacts WHERE id=$1 AND (owner_id=$2 OR friend_id=$2) FOR UPDATE', [data.pactId, user]);
    requireThat(row, 'This pact is unavailable.', 404);
    if (['invite', 'revoke'].includes(action)) {
      requireThat(user === row.owner_id && !row.friend_id && !row.document.endedOn, 'Only the creator can invite a friend to this open slot.', 403);
      const raw = action === 'invite' ? token() : null;
      row.invite_hash = raw ? hash(raw) : null;
      row.invite_expires_at = raw ? iso(now + inviteMs) : null;
      await updatePact(client, row, now);
      return { pact: visiblePact(row, user), inviteToken: raw };
    }
    settle(row.document, now);
    const friend = row.document.members.find(member => member.id !== user);
    const friendRow = action === 'nudge' && friend ? await one(client, 'SELECT profile FROM showup_accounts WHERE id=$1', [friend.id]) : null;
    applyAction(row.document, user, data, now, friendRow?.profile.settings);
    if (action === 'leave') {
      row.invite_hash = null;
      row.invite_expires_at = null;
    }
    await updatePact(client, row, now);
    return { pact: visiblePact(row, user) };
  });
}

export function makeHandler(db, { secure = true, clock = Date.now } = {}) {
  const cookieName = secure ? '__Host-showup' : 'showup_local';
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    const respond = (status, data) => {
      res.statusCode = status;
      res.end(JSON.stringify(data));
    };
    try {
      requireThat(req.method === 'POST', 'Use POST for this endpoint.', 405);
      requireThat(req.headers['x-show-up'] === '1' && /^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || ''), 'This request must come from Show Up.', 403);
      const origin = req.headers.origin;
      if (origin) requireThat(origin === (secure ? 'https://' : 'http://') + req.headers.host, 'This request came from a different site.', 403);
      const data = await getBody(req);
      if (!db && data.action === 'session') return respond(200, { user: null, setupNeeded: true });
      requireThat(db, 'Production database setup is required. See the deployment guide.', 503);
      const now = clock();
      return respond(200, { ...await run(db, req, res, data, now, cookieName, secure), now });
    } catch (error) {
      if (error instanceof AppError) return respond(error.status, { error: error.message });
      if (error instanceof SyntaxError) return respond(400, { error: 'Invalid request data.' });
      if (error.code === '42P01') return respond(503, { error: 'Run server/schema.sql in your database, then retry.' });
      console.error('Show Up server error:', error.code || error.name);
      return respond(500, { error: 'The server couldn’t save or load this. Try again in a moment.' });
    }
  };
}
