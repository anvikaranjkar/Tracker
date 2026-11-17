import { createHash, randomBytes, randomUUID, scrypt, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { localDay } from '../shared/time.mjs';
import { AppError, addMember, applyAction, clean, GROUP_LIMIT, newPact, requireThat, settle, validDay, validId, visiblePact } from './pacts.mjs';
import { pushAction } from './push.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const token = () => randomBytes(32).toString('base64url');
const passwordDerive = promisify(scrypt);
const sessionSeconds = 30 * 24 * 60 * 60;
const inviteMs = 7 * 86400000;
const clocks = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
const tokenPattern = /^[A-Za-z0-9_-]{43}$/;
const settingsDefault = { zone: 'Australia/Sydney' };
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
  requireThat(!signup || display.length >= 2, 'Enter the name your group will see.');
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
      const zone = clean(data.settings?.zone, 80);
      try { new Intl.DateTimeFormat('en', { timeZone: zone }); } catch { throw new AppError(400, 'Choose a valid time zone.'); }
      p.settings = { zone };
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
  await client.query(`UPDATE showup_pacts SET invite_token=$1,invite_hash=$2,invite_expires_at=$3,document=$4::text::jsonb,edited_at=$5 WHERE id=$6`,
    [row.invite_token ?? null, row.invite_hash, row.invite_expires_at, JSON.stringify(row.document), iso(now), row.id]);
}
async function pactList(db, id, now) {
  const { rows } = await db.query(`SELECT p.* FROM showup_pacts p JOIN showup_pact_members m ON m.pact_id=p.id
    WHERE m.account_id=$1 ORDER BY p.edited_at DESC`, [id]);
  return Promise.all(rows.map(async row => {
    if (!settle(row.document, now)) return visiblePact(row, id);
    return db.transaction(async client => {
      const latest = await one(client, 'SELECT * FROM showup_pacts WHERE id=$1 FOR UPDATE', [row.id]);
      if (settle(latest.document, now)) await updatePact(client, latest, now);
      return visiblePact(latest, id);
    });
  }));
}

function openForJoining(pact, now) {
  const terms = (pact.draft ?? pact.versions.at(-1))?.terms;
  return !pact.endedOn && terms && localDay(now, terms.zone) <= terms.end;
}
async function checkPactLimit(client, user) {
  await client.query('SELECT id FROM showup_accounts WHERE id=$1 FOR NO KEY UPDATE', [user]);
  const { count } = await one(client, 'SELECT count(*)::int AS count FROM showup_pact_members WHERE account_id=$1', [user]);
  requireThat(count < 50, 'This account has reached its 50-pact limit.', 409);
}
async function pendingInvites(db, user, now) {
  const { rows } = await db.query(`SELECT i.pact_id AS id, i.created_at, i.expires_at, p.document
    FROM showup_pact_invites i JOIN showup_pacts p ON p.id=i.pact_id
    WHERE i.account_id=$1 AND i.expires_at>$2
    ORDER BY i.created_at DESC LIMIT 100`, [user, iso(now)]);
  return rows.filter(row => openForJoining(row.document, now)).map(({ id, created_at, expires_at, document }) => ({
    id, at: +new Date(created_at), expires: +new Date(expires_at),
    name: (document.draft ?? document.versions.at(-1)).terms.name, from: document.members[0].name
  }));
}
async function join(db, user, name, data, now) {
  const viaLink = data.token !== undefined;
  requireThat(viaLink ? typeof data.token === 'string' && tokenPattern.test(data.token) : validId(data.pactId), 'This invitation is invalid.', 404);
  return db.transaction(async client => {
    // Serialize joins by account and by pact so both capacity limits hold on simultaneous requests.
    await client.query('SELECT id FROM showup_accounts WHERE id=$1 FOR NO KEY UPDATE', [user]);
    const row = viaLink
      ? await one(client, 'SELECT * FROM showup_pacts WHERE invite_hash=$1 AND invite_expires_at>$2 FOR UPDATE', [hash(data.token), iso(now)])
      : await one(client, 'SELECT * FROM showup_pacts WHERE id=$1 FOR UPDATE', [data.pactId]);
    const expired = 'This invitation has expired or was replaced. Ask the organiser for a fresh invite.';
    requireThat(row, expired, 404);
    if (row.document.members.some(member => member.id === user)) return { pact: visiblePact(row, user) };
    requireThat(openForJoining(row.document, now), 'This pact has closed to new members.', 409);
    if (!viaLink) {
      const direct = await one(client, 'SELECT 1 FROM showup_pact_invites WHERE pact_id=$1 AND account_id=$2 AND expires_at>$3 FOR UPDATE',
        [row.id, user, iso(now)]);
      requireThat(direct, expired, 404);
    }
    await checkPactLimit(client, user);
    addMember(row.document, user, name, now);
    await client.query('INSERT INTO showup_pact_members(pact_id,account_id) VALUES($1,$2)', [row.id, user]);
    await client.query('DELETE FROM showup_pact_invites WHERE pact_id=$1 AND account_id=$2', [row.id, user]);
    await updatePact(client, row, now);
    return { pact: visiblePact(row, user) };
  });
}
async function inviteAction(client, row, user, data, now) {
  requireThat(user === row.owner_id, 'Only the organiser can manage invitations.', 403);
  if (data.action === 'inviteLink') {
    return { inviteToken: +new Date(row.invite_expires_at) > now ? row.invite_token : null };
  }
  if (data.action === 'revoke') {
    row.invite_token = row.invite_hash = row.invite_expires_at = null;
    await updatePact(client, row, now);
    return { pact: visiblePact(row, user) };
  }
  requireThat(openForJoining(row.document, now) && row.document.members.length < GROUP_LIMIT, 'This pact is closed to new invitations.', 409);
  if (data.action === 'inviteAccount') {
    const handle = clean(data.handle, 24).toLowerCase();
    const target = await one(client, 'SELECT id FROM showup_accounts WHERE handle=$1', [handle]);
    requireThat(target, 'No account found with that username.', 404);
    requireThat(!row.document.members.some(member => member.id === target.id), 'That account is already in the pact.', 409);
    await authLimit(client, 'invites:' + user, now, 60);
    await client.query(`INSERT INTO showup_pact_invites(pact_id,account_id,created_at,expires_at) VALUES($1,$2,$3,$4)
      ON CONFLICT(pact_id,account_id) DO UPDATE SET created_at=excluded.created_at, expires_at=excluded.expires_at`,
    [row.id, target.id, iso(now), iso(now + inviteMs)]);
    return {};
  }
  row.invite_token = token();
  row.invite_hash = hash(row.invite_token);
  row.invite_expires_at = iso(now + inviteMs);
  await updatePact(client, row, now);
  return { pact: visiblePact(row, user), inviteToken: row.invite_token };
}

async function run(db, req, res, data, now, cookieName, secure) {
  const action = data.action;
  if (['signup', 'login'].includes(action)) return authenticate(db, req, res, cookieName, secure, data, now);
  if (action === 'invitePreview') {
    requireThat(typeof data.token === 'string' && tokenPattern.test(data.token), 'This invitation link is invalid.', 404);
    const row = await one(db, 'SELECT document,invite_expires_at FROM showup_pacts WHERE invite_hash=$1', [hash(data.token)]);
    requireThat(row && openForJoining(row.document, now) && +new Date(row.invite_expires_at) > now, 'This link has expired or was replaced. Ask the organiser for a fresh link.', 404);
    return { invite: { name: (row.document.draft ?? row.document.versions.at(-1)).terms.name, from: row.document.members[0].name, expires: +new Date(row.invite_expires_at) } };
  }
  const account = await session(db, req, cookieName, now);
  if (action === 'session') return { user: account ? userView(account) : null };
  requireThat(account, 'Sign in to continue.', 401);
  const user = account.id;
  if (action === 'logout') {
    await db.transaction(async client => {
      if (typeof data.endpoint === 'string') await client.query('DELETE FROM showup_push_subscriptions WHERE account_id=$1 AND endpoint=$2', [user, data.endpoint]);
      await client.query('DELETE FROM showup_sessions WHERE token_hash=$1', [hash(readCookie(req, cookieName))]);
    });
    writeCookie(res, cookieName, '', secure, 0);
    return {};
  }
  if (action === 'sync') {
    const [pacts, invites] = await Promise.all([pactList(db, user, now), pendingInvites(db, user, now)]);
    return { user: userView(account), pacts, invites, now };
  }
  if (['pushStatus', 'pushEnable', 'pushDisable'].includes(action)) return pushAction(db, user, data);
  if (['settings', 'event', 'removeEvent', 'inboxRead', 'favourite'].includes(action)) return updateProfile(db, account, data, now);
  if (action === 'create') {
    const pact = newPact(user, account.profile.name, data.terms || {}, now);
    await db.transaction(async client => {
      await checkPactLimit(client, user);
      await client.query('INSERT INTO showup_pacts(id,owner_id,document,edited_at) VALUES($1,$2,$3::text::jsonb,$4)', [pact.id, user, JSON.stringify(pact), iso(now)]);
      await client.query('INSERT INTO showup_pact_members(pact_id,account_id) VALUES($1,$2)', [pact.id, user]);
    });
    return { pact: visiblePact({ document: pact }, user) };
  }
  if (action === 'join') return join(db, user, account.profile.name, data, now);
  requireThat(validId(data.pactId), 'Choose a pact.');
  if (action === 'declineInvite') {
    await db.query('DELETE FROM showup_pact_invites WHERE pact_id=$1 AND account_id=$2', [data.pactId, user]);
    return {};
  }
  return db.transaction(async client => {
    const row = await one(client, `SELECT p.* FROM showup_pacts p JOIN showup_pact_members m ON m.pact_id=p.id
      WHERE p.id=$1 AND m.account_id=$2 FOR UPDATE OF p`, [data.pactId, user]);
    requireThat(row, 'This pact is unavailable.', 404);
    if (['invite', 'inviteLink', 'inviteAccount', 'revoke'].includes(action)) return inviteAction(client, row, user, data, now);
    settle(row.document, now);
    applyAction(row.document, user, data, now);
    if (action === 'endPact') {
      row.invite_token = row.invite_hash = row.invite_expires_at = null;
      await client.query('DELETE FROM showup_pact_invites WHERE pact_id=$1', [row.id]);
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
      if (['42P01', '42703'].includes(error.code)) return respond(503, { error: 'Run the updated server/schema.sql in your database, then retry.' });
      console.error('Show Up server error:', error.code || error.name);
      return respond(500, { error: 'The server couldn’t save or load this. Try again in a moment.' });
    }
  };
}
