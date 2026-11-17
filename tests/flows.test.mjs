import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { addDays, localDay, wallTime } from '../shared/time.mjs';
import { pendingCheckIn, progressFor, versionAt } from '../shared/scoring.mjs';
import { reminderHandler } from '../server/push.mjs';
import { harness } from './harness.mjs';

const zone = 'Australia/Sydney';
const at = (day, time) => wallTime(day, time, zone);
const password = 'example-long-test-password';
const wanted = (category, name, overrides = {}) => ({
  name, category, focus: category === 'Study' ? 'Chemistry' : 'Muscle group', unit: 'sessions', target: 2,
  cadence: 'weekly', days: [], dailyCheck: false, counts: true, ...overrides
});
const terms = {
  name: 'The reset', start: '2026-10-19', end: '2026-11-08', cutoff: '23:50', zone, grace: 30,
  forfeit: 'Make the shared playlist', forfeitDays: 3, rule: 'target', missLimit: 2
};
async function ok(result) {
  const response = await result;
  assert.equal(response.status, 200, response.body.error);
  return response.body;
}
async function err(result, code, message) {
  const response = await result;
  assert.equal(response.status, code, JSON.stringify(response.body));
  if (message) assert.match(response.body.error, message);
  return response.body;
}

test('Sydney day boundaries, repeated clock times and DST gap', () => {
  assert.equal(new Date(at('2026-10-04', '01:30')).toISOString(), '2026-10-03T15:30:00.000Z');
  assert.equal(new Date(at('2026-10-04', '02:30')).toISOString(), '2026-10-03T16:30:00.000Z');
  assert.equal(new Date(at('2026-04-05', '02:30')).toISOString(), '2026-04-04T15:30:00.000Z');
  assert.equal(localDay(at('2026-10-25', '23:50') + 30 * 60000, zone), '2026-10-26');
});

test('legacy scoring and history survive the group migration', async t => {
  let now = at('2026-10-10', '12:00');
  const app = await harness(() => now, { secure: true });
  t.after(() => app.close());
  const alice = app.session();
  const sam = app.session();
  const stranger = app.session();
  const accounts = await Promise.all([
    alice('signup', { handle: 'alex_park', name: 'Alex Park', password, zone }),
    sam('signup', { handle: 'sam_taylor', name: 'Sam Taylor', password, zone: 'Pacific/Auckland' }),
    stranger('signup', { handle: 'casey', name: 'Casey', password, zone })
  ]);
  const users = await Promise.all(accounts.map(ok));
  const ownerId = users[0].user.id;
  const friendId = users[1].user.id;
  assert.match(accounts[0].headers.get('Set-Cookie'), /^__Host-showup=.*HttpOnly.*SameSite=Lax.*Secure$/);
  assert.equal(users[1].user.settings.zone, 'Pacific/Auckland');
  await err(app.request({ action: 'session' }, '', { origin: 'https://elsewhere.test' }), 403);
  const created = await ok(alice('create', { terms }));
  const pactId = created.pact.id;
  const call = (session, action, data = {}) => session(action, { pactId, ...data });
  await app.db.query("UPDATE showup_pacts SET document=document-'dailyCheckIns' WHERE id=$1", [pactId]);
  const first = await ok(call(alice, 'invite'));
  now = at('2026-10-18', '12:00');
  await err(sam('invitePreview', { token: first.inviteToken }), 404, /expired/);
  await err(sam('join', { token: first.inviteToken }), 404);
  const second = await ok(call(alice, 'invite'));
  await ok(call(alice, 'revoke'));
  await err(sam('invitePreview', { token: second.inviteToken }), 404);
  const third = await ok(call(alice, 'invite'));
  const inviteKey = third.inviteToken;
  const { invite } = await ok(sam('invitePreview', { token: inviteKey }));
  assert.deepEqual(Object.keys(invite).sort(), ['expires', 'from', 'name']);
  assert.equal((await ok(alice('join', { token: inviteKey }))).pact.members.length, 1);
  const joined = await Promise.all([sam('join', { token: inviteKey }), sam('join', { token: inviteKey })]);
  const joinedPact = (await ok(joined[0])).pact;
  assert.equal((await ok(joined[1])).pact.members.length, 2);
  assert.equal(joinedPact.members[1].id, friendId);
  await app.db.query('UPDATE showup_pacts SET friend_id=$1 WHERE id=$2', [friendId, pactId]);
  await app.db.query('DELETE FROM showup_pact_members WHERE pact_id=$1', [pactId]);
  await app.exec(await readFile(new URL('../server/schema.sql', import.meta.url), 'utf8'));
  assert.equal((await ok(sam('sync'))).pacts[0].id, pactId);
  assert.equal((await ok(stranger('sync'))).pacts.length, 0);
  await err(call(stranger, 'log', { key: randomUUID() }), 404);
  await err(call(alice, 'sign', { revision: 1 }), 400, /Add your goal/);

  let pact = (await ok(call(alice, 'saveGoal', { revision: 1, goal: wanted('Study', 'Chemistry revision', { unit: 'min', target: 120, dailyCheck: true }) }))).pact;
  const study = pact.draft.goals[0];
  pact = (await ok(call(alice, 'saveGoal', { revision: 2, goal: wanted('Fitness', 'Legs', { cadence: 'scheduled', days: [0, 3], target: 1 }) }))).pact;
  const legs = pact.draft.goals.find(goal => goal.name === 'Legs');
  pact = (await ok(call(sam, 'saveGoal', { revision: 3, goal: wanted('Fitness', 'Train twice') }))).pact;
  const train = pact.draft.goals.find(goal => goal.owner === friendId);
  pact = (await ok(call(sam, 'sign', { revision: 4 }))).pact;
  assert.equal(pact.draft.signatures[friendId], now);
  await err(call(sam, 'terms', { revision: 4, terms }), 403);
  pact = (await ok(call(alice, 'terms', { revision: 4, terms: { ...terms, forfeit: 'Pick the next study spot' } }))).pact;
  assert.deepEqual(pact.draft.signatures, {});
  await err(call(alice, 'sign', { revision: 4 }), 409, /draft changed/);
  await ok(call(sam, 'sign', { revision: 5 }));
  const { pact: sealed } = await ok(call(alice, 'sign', { revision: 5 }));
  assert.equal(Object.keys(sealed.versions[0].signatures).length, 2);
  now = at('2026-10-19', '10:00');
  const key = randomUUID();
  await err(call(sam, 'log', { key: randomUUID(), goalId: study.id, day: terms.start, amount: 25 }), 403);
  const logged = await Promise.all([1, 2].map(() => call(alice, 'log', { key, goalId: study.id, day: terms.start, amount: 55, note: 'Private study strategy' })));
  await Promise.all(logged.map(ok));
  pact = (await ok(sam('sync'))).pacts[0];
  assert.equal(pact.logs.length, 1);
  assert.equal(pact.logs[0].note, undefined);
  await err(call(sam, 'editLog', { logId: key, amount: 0 }), 404);
  await ok(call(alice, 'log', { key: randomUUID(), goalId: study.id, day: terms.start, amount: 65, note: 'Worked on questions', shareNote: true }));
  await ok(call(alice, 'log', { key: randomUUID(), goalId: legs.id, day: terms.start, amount: 1 }));
  await ok(call(sam, 'log', { key: randomUUID(), goalId: train.id, day: terms.start, amount: 1 }));
  pact = (await ok(sam('sync'))).pacts[0];
  assert.equal(pact.logs.find(log => log.amount === 65).note, 'Worked on questions');
  assert.equal(progressFor(pact, versionAt(pact, terms.start), study, terms.start, now).amount, 120);
  const tue = addDays(terms.start, 1);
  assert.equal(progressFor(pact, versionAt(pact, tue), legs, tue, now).state, 'Rest day');
  await ok(alice('event', { title: 'Private assessment', day: tue, note: 'Only mine' }));
  assert.equal((await ok(sam('sync'))).user.events.length, 0);
  assert.equal((await ok(alice('sync'))).user.events[0].title, 'Private assessment');

  now = at('2026-10-22', '09:00');
  pact = (await ok(call(alice, 'excuse', { first: '2026-10-22', last: '2026-10-22', reason: 'Exam' }))).pact;
  await err(call(alice, 'decision', { id: pact.requests[0].id, decision: 'approved' }), 403);
  pact = (await ok(call(sam, 'decision', { id: pact.requests[0].id, decision: 'approved' }))).pact;
  assert.equal(progressFor(pact, versionAt(pact, '2026-10-22'), legs, '2026-10-22', now).state, 'Excused');

  now = at('2026-10-26', '00:10');
  assert.equal((await ok(alice('sync'))).pacts[0].outcomes.length, 0);
  const lateKey = randomUUID();
  await ok(call(sam, 'log', { key: lateKey, goalId: train.id, day: '2026-10-25', amount: 0, note: 'Late note' }));
  now = at('2026-10-26', '00:21');
  pact = (await ok(sam('sync'))).pacts[0];
  const forfeit = pact.outcomes.find(item => item.owner === friendId);
  assert.equal(forfeit.status, 'triggered');
  assert.equal(forfeit.forfeit, 'Pick the next study spot');
  assert.equal(forfeit.due, '2026-10-29');
  assert.match(forfeit.reasons[0], /1 of 2/);
  assert.equal(pact.logs.find(log => log.id === lateKey).late, true);
  assert.equal(pact.outcomes.find(item => item.owner === ownerId).reasons.length, 0);
  await ok(call(sam, 'forfeit', { id: forfeit.id, mode: 'done' }));
  pact = (await ok(call(alice, 'forfeit', { id: forfeit.id, mode: 'confirm' }))).pact;
  assert.equal(pact.outcomes.find(item => item.id === forfeit.id).status, 'confirmed');

  pact = (await ok(call(sam, 'editLog', { logId: lateKey, amount: 1, note: 'Private correction' }))).pact;
  const correction = pact.requests.find(req => req.type === 'correction');
  const seen = (await ok(alice('sync'))).pacts[0];
  assert.equal(seen.requests.find(req => req.id === correction.id).entry.note, undefined);
  assert.equal(seen.logs.find(log => log.id === lateKey).amount, 0);
  pact = (await ok(call(alice, 'decision', { id: correction.id, decision: 'approved' }))).pact;
  assert.equal(pact.logs.find(log => log.id === lateKey).amount, 1);
  assert.equal(pact.outcomes.find(item => item.id === forfeit.id).status, 'void');

  pact = (await ok(call(alice, 'revision'))).pact;
  assert.equal(pact.draft.number, 2);
  await ok(call(alice, 'saveGoal', { revision: 1, goal: { ...study, target: 90 } }));
  pact = (await ok(alice('sync'))).pacts[0];
  assert.equal(versionAt(pact, '2026-10-27').goals.find(goal => goal.id === study.id).target, 120);
  await ok(call(alice, 'sign', { revision: 2 }));
  pact = (await ok(call(sam, 'sign', { revision: 2 }))).pact;
  assert.equal(versionAt(pact, '2026-10-26').number, 1);
  assert.equal(versionAt(pact, '2026-10-27').goals.find(goal => goal.id === study.id).target, 90);
  assert.equal(pact.outcomes.find(item => item.id === forfeit.id).status, 'void');

  await ok(sam('settings', { settings: { zone } }));
  await err(call(sam, 'endPact'), 403);
  await ok(call(alice, 'endPact'));
  await err(call(sam, 'revision'), 409);
  pact = (await ok(alice('sync'))).pacts[0];
  assert.equal(pact.versions.length, 2);
  assert.equal(pact.endedOn, '2026-10-26');
  await ok(sam('logout'));
  await err(sam('sync'), 401);
  await ok(sam('login', { handle: 'sam_taylor', password }));
  assert.equal((await ok(sam('sync'))).pacts.length, 1);
});

test('shared group invites, late enrolment, one check-in per member per day and reminder delivery', async t => {
  let now = at('2026-10-19', '09:00');
  const app = await harness(() => now);
  t.after(() => app.close());
  const [host, lee, sam, casey, outsider] = Array.from({ length: 5 }, () => app.session());
  const people = [
    [host, 'host', 'Taylor Host'], [lee, 'lee', 'Lee Chan'], [sam, 'sam', 'Sam Taylor'],
    [casey, 'casey', 'Casey Smith'], [outsider, 'outsider', 'Uninvited User']
  ];
  const [hostId, leeId, samId, caseyId] = await Promise.all(people.map(async ([session, handle, name]) =>
    (await ok(session('signup', { handle, name, password, zone }))).user.id));
  const groupTerms = { ...terms, forfeit: 'Give another member $5 or buy them a Yo-Chi.', rule: 'checkins' };
  await err(host('create', { terms: { ...groupTerms, forfeit: '' } }), 400, /Write or randomise/);
  const { pact: created } = await ok(host('create', { terms: groupTerms }));
  const call = (session, action, data = {}) => session(action, { pactId: created.id, ...data });
  const { inviteToken } = await ok(call(host, 'invite'));
  assert.equal((await ok(call(host, 'inviteLink'))).inviteToken, inviteToken);
  await err(call(outsider, 'join'), 404);
  await Promise.all([lee, sam].map(session => ok(session('join', { token: inviteToken }))));
  let pact = (await ok(host('sync'))).pacts[0];
  assert.equal(pact.members.length, 3);
  assert.equal(JSON.stringify(pact).includes(inviteToken), false);
  await err(call(lee, 'inviteLink'), 403);
  await ok(call(host, 'inviteAccount', { handle: 'casey' }));
  assert.equal((await ok(outsider('sync'))).invites.length, 0);
  assert.equal((await ok(casey('sync'))).invites[0].name, groupTerms.name);
  await ok(call(casey, 'declineInvite'));
  assert.equal((await ok(casey('sync'))).invites.length, 0);
  await ok(call(host, 'inviteAccount', { handle: 'casey' }));
  assert.equal((await ok(call(casey, 'join'))).pact.members.length, 4);
  assert.equal((await ok(casey('sync'))).invites.length, 0);

  const goal = wanted('Custom', 'Read twenty pages', { cadence: 'daily', unit: 'pages', target: 20 });
  pact = (await ok(call(host, 'saveGoal', { revision: 1, goal }))).pact;
  await err(call(host, 'saveGoal', { revision: pact.draft.revision, goal }), 400, /existing goal/);
  pact = (await ok(call(host, 'sign', { revision: pact.draft.revision }))).pact;
  assert.deepEqual(Object.keys(pact.versions[0].signatures), [hostId]);
  assert.equal(pact.versions[0].terms.forfeit, groupTerms.forfeit);
  assert.ok(pendingCheckIn(pact, hostId, now));
  assert.equal(pendingCheckIn(pact, leeId, now), null);
  const hostGoal = pact.versions[0].goals[0];
  const log = { goalId: hostGoal.id, day: terms.start, amount: 0, note: 'A personal note' };
  const firstKey = randomUUID();
  const results = await Promise.all([call(host, 'log', { ...log, key: firstKey }), call(host, 'log', { ...log, key: randomUUID() })]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
  const saved = results.find(result => result.status === 200).body.pact.logs[0];
  await ok(call(host, 'log', { ...log, key: saved.id }));
  await ok(call(host, 'editLog', { logId: saved.id, amount: 6 }));
  pact = (await ok(lee('sync'))).pacts[0];
  assert.equal(pact.logs.length, 1);
  assert.equal(pact.logs[0].note, undefined);
  assert.equal(pendingCheckIn(pact, hostId, now), null);
  assert.equal(progressFor(pact, pact.versions[0], hostGoal, terms.start, now).checked, true);

  now = at('2026-10-26', '09:00');
  for (const session of [lee, sam, casey]) {
    const pending = (await ok(call(session, 'saveGoal', { enrolVersion: 1, goal: { ...goal, cadence: 'weekly' } }))).pact;
    assert.equal(pending.pendingGoals.length, 1);
    pact = (await ok(call(session, 'sign', { enrolVersion: 1 }))).pact;
  }
  const signed = pact.versions[0];
  assert.equal(signed.goals.find(goal => goal.owner === leeId).dailyCheck, true);
  assert.equal(signed.memberStarts[caseyId], '2026-10-26');
  assert.deepEqual(pact.outcomes.map(result => result.owner), [hostId]);
  await err(call(lee, 'lateLog', { key: randomUUID(), goalId: signed.goals.find(goal => goal.owner === leeId).id, day: terms.start, amount: 1 }), 400);
  await ok(call(host, 'log', { key: randomUUID(), goalId: hostGoal.id, day: '2026-10-26', amount: 20 }));

  const subscriptions = [[hostId, 'host'], [leeId, 'lee'], [samId, 'sam']];
  for (const [id, handle] of subscriptions) {
    const endpoint = 'https://fcm.googleapis.com/fcm/send/' + handle;
    await app.db.query('INSERT INTO showup_push_subscriptions(endpoint,account_id,subscription) VALUES($1,$2,$3::text::jsonb)',
      [endpoint, id, JSON.stringify({ endpoint })]);
  }
  const env = { CRON_SECRET: 'test-only-sample', VAPID_SUBJECT: 'mailto:qa@example.com', VAPID_PUBLIC_KEY: 'test-public', VAPID_PRIVATE_KEY: 'test-private' };
  const sent = [];
  const handler = reminderHandler(app.db, { env, clock: () => now, send: async (subscription, payload) => {
    sent.push(subscription.endpoint.split('/').at(-1));
    assert.equal(JSON.parse(payload).notification.navigate, 'https://showup.test/?view=today');
    if (subscription.endpoint.endsWith('/sam')) throw Object.assign(new Error('expired subscription'), { statusCode: 410 });
  } });
  const request = headers => new Request('https://showup.test/api/reminders', { headers });
  assert.equal((await handler(request())).status, 401);
  const authorized = () => request({ authorization: 'Bearer ' + env.CRON_SECRET });
  assert.deepEqual(await (await handler(authorized())).json(), { sent: 1, expired: 1, failed: 0 });
  assert.deepEqual(await (await handler(authorized())).json(), { sent: 0, expired: 0, failed: 0 });
  assert.deepEqual(sent.sort(), ['lee', 'sam']);
  assert.equal((await app.db.query('SELECT endpoint FROM showup_push_subscriptions ORDER BY endpoint')).rows.length, 2);
});
