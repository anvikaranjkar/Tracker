import { timingSafeEqual } from 'node:crypto';
import webpush from 'web-push';
import { pendingCheckIn } from '../shared/scoring.mjs';
import { isoDay } from '../shared/time.mjs';
import { requireThat } from './pacts.mjs';

export function pushConfig(env = process.env) {
  const { VAPID_SUBJECT: subject, VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, CRON_SECRET: secret } = env;
  if (!subject || !publicKey || !privateKey || !secret) return null;
  return { subject, publicKey, privateKey };
}

function pushEndpoint(value) {
  if (typeof value !== 'string' || value.length > 2000) return null;
  try {
    const url = new URL(value);
    // Push endpoints come from the browser. Restrict outbound requests to browser push services.
    const allowed = ['fcm.googleapis.com', 'updates.push.services.mozilla.com', 'push.apple.com', 'notify.windows.com', 'push.services.mozilla.com'];
    if (url.protocol === 'https:' && !url.port && !url.username && !url.password && !url.hash
      && allowed.some(host => url.hostname === host || url.hostname.endsWith('.' + host))) return url.href;
  } catch {}
  return null;
}

function hasKey(value, bytes) {
  return typeof value === 'string' && /^[\w-]{20,90}$/.test(value) && Buffer.from(value, 'base64url').length === bytes;
}

export async function pushAction(db, user, data) {
  const config = pushConfig();
  const endpoint = pushEndpoint(data.endpoint ?? data.subscription?.endpoint);
  if (data.action === 'pushStatus') {
    const enabled = endpoint && (await db.query('SELECT 1 FROM showup_push_subscriptions WHERE account_id=$1 AND endpoint=$2', [user, endpoint])).rows.length > 0;
    return { publicKey: config?.publicKey ?? null, enabled: Boolean(enabled) };
  }
  requireThat(endpoint, 'This browser’s push service isn’t supported.');
  if (data.action === 'pushDisable') {
    await db.query('DELETE FROM showup_push_subscriptions WHERE endpoint=$1 AND account_id=$2', [endpoint, user]);
    return { enabled: false };
  }
  requireThat(config, 'Push reminders haven’t been configured on this deployment.', 503);
  const { p256dh, auth } = data.subscription?.keys ?? {};
  requireThat(hasKey(p256dh, 65) && hasKey(auth, 16), 'This device didn’t return valid notification keys.');
  const subscription = { endpoint, keys: { p256dh, auth } };
  await db.query(`INSERT INTO showup_push_subscriptions(endpoint,account_id,subscription) VALUES($1,$2,$3::text::jsonb)
    ON CONFLICT(endpoint) DO UPDATE SET account_id=excluded.account_id, subscription=excluded.subscription,
      last_reminder=CASE WHEN showup_push_subscriptions.account_id=excluded.account_id THEN showup_push_subscriptions.last_reminder ELSE NULL END`,
  [endpoint, user, JSON.stringify(subscription)]);
  return { enabled: true };
}

export async function sendReminders(db, { now, origin, config, send = webpush.sendNotification.bind(webpush) }) {
  const day = isoDay(new Date(now));
  const candidates = (await db.query(`SELECT endpoint,account_id,subscription FROM showup_push_subscriptions
    WHERE last_reminder IS DISTINCT FROM $1::date`, [day])).rows;
  const stats = { sent: 0, expired: 0, failed: 0 };
  if (!candidates.length) return stats;
  const { rows } = await db.query(`SELECT p.document, json_agg(m.account_id) AS accounts
    FROM showup_pacts p JOIN showup_pact_members m ON m.pact_id=p.id
    WHERE p.document->>'endedOn' IS NULL AND EXISTS (
      SELECT 1 FROM showup_push_subscriptions s WHERE s.account_id=m.account_id AND s.last_reminder IS DISTINCT FROM $1::date
    )
    GROUP BY p.id`, [day]);
  const due = new Set();
  for (const { accounts, document } of rows) {
    for (const id of accounts) if (!due.has(id) && pendingCheckIn(document, id, now)) due.add(id);
  }
  const devices = candidates.filter(device => due.has(device.account_id));
  const payload = JSON.stringify({
    web_push: 8030,
    notification: {
      title: 'Show Up',
      body: 'Your daily check-in is still open.',
      navigate: new URL('/?view=today', origin).href,
      icon: new URL('/icons/app-192.png', origin).href,
      tag: 'daily-check-in'
    }
  });
  async function deliver({ endpoint, account_id: user, subscription }) {
    if (!pushEndpoint(endpoint) || subscription?.endpoint !== endpoint) return;
    const claim = await db.query(`UPDATE showup_push_subscriptions SET last_reminder=$3::date
      WHERE endpoint=$1 AND account_id=$2 AND last_reminder IS DISTINCT FROM $3::date RETURNING endpoint`, [endpoint, user, day]);
    if (!claim.rows.length) return;
    try {
      await send(subscription, payload, { vapidDetails: config, TTL: 3600, timeout: 4500, topic: 'daily-check-in' });
      stats.sent += 1;
    } catch (error) {
      if ([404, 410].includes(error.statusCode)) {
        await db.query('DELETE FROM showup_push_subscriptions WHERE endpoint=$1 AND account_id=$2 AND last_reminder=$3::date', [endpoint, user, day]);
        stats.expired += 1;
      } else {
        // Keep the claim after ambiguous delivery failures. A later scheduled day can try again.
        stats.failed += 1;
      }
    }
  }
  for (let offset = 0; offset < devices.length; offset += 16) {
    await Promise.all(devices.slice(offset, offset + 16).map(deliver));
  }
  return stats;
}

export function reminderHandler(db, { env = process.env, clock = Date.now, send } = {}) {
  return async request => {
    const respond = (data, status = 200) => Response.json(data, { status, headers: { 'Cache-Control': 'no-store' } });
    if (request.method !== 'GET') return respond({ error: 'Use GET.' }, 405);
    if (!env.CRON_SECRET) return respond({ enabled: false });
    const expected = Buffer.from('Bearer ' + env.CRON_SECRET);
    const header = Buffer.from(request.headers.get('authorization') ?? '');
    if (header.length !== expected.length || !timingSafeEqual(header, expected)) return respond({ error: 'Unauthorized.' }, 401);
    const config = pushConfig(env);
    if (!db || !config) return respond({ enabled: false });
    try {
      const stats = await sendReminders(db, { now: clock(), origin: new URL(request.url).origin, config, send });
      return respond(stats, stats.failed ? 502 : 200);
    } catch (error) {
      console.error('Show Up reminder job:', error.code || error.name);
      return respond({ error: 'The reminder job could not finish.' }, 500);
    }
  };
}
