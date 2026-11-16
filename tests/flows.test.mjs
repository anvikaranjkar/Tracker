import { test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { addDays, localDay, wallTime } from '../shared/time.mjs';
import { progressFor, versionAt } from '../shared/scoring.mjs';
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

test('two-account pact lifecycle with expired/revoked links, versioning, check-ins, privacy and checkpoints', async t => {
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
  await err(alice('join', { token: inviteKey }), 409, /your invitation/);
  const joined = await Promise.all([sam('join', { token: inviteKey }), sam('join', { token: inviteKey })]);
  const joinedPact = (await ok(joined[0])).pact;
  assert.equal((await ok(joined[1])).pact.members.length, 2);
  assert.equal(joinedPact.members[1].id, friendId);
  await err(stranger('join', { token: inviteKey }), 409);
  assert.equal((await ok(stranger('sync'))).pacts.length, 0);
  await err(call(stranger, 'log', { key: randomUUID() }), 404);
  await err(call(alice, 'sign', { revision: 1 }), 400, /need at least one goal/);

  let pact = (await ok(call(alice, 'saveGoal', { revision: 1, goal: wanted('Study', 'Chemistry revision', { unit: 'min', target: 120, dailyCheck: true }) }))).pact;
  const study = pact.draft.goals[0];
  pact = (await ok(call(alice, 'saveGoal', { revision: 2, goal: wanted('Fitness', 'Legs', { cadence: 'scheduled', days: [0, 3], target: 1 }) }))).pact;
  const legs = pact.draft.goals.find(goal => goal.name === 'Legs');
  pact = (await ok(call(sam, 'saveGoal', { revision: 3, goal: wanted('Fitness', 'Train twice') }))).pact;
  const train = pact.draft.goals.find(goal => goal.owner === friendId);
  pact = (await ok(call(alice, 'sign', { revision: 4 }))).pact;
  assert.equal(pact.draft.signatures[ownerId], now);
  pact = (await ok(call(sam, 'terms', { revision: 4, terms: { ...terms, forfeit: 'Pick the next study spot' } }))).pact;
  assert.deepEqual(pact.draft.signatures, {});
  await err(call(alice, 'sign', { revision: 4 }), 409, /terms changed/);
  const signed = await Promise.all([call(alice, 'sign', { revision: 5 }), call(sam, 'sign', { revision: 5 })]);
  const sealed = await Promise.all(signed.map(ok));
  assert.equal(sealed.filter(item => item.pact.versions.length === 1).length, 1);
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

  await ok(sam('settings', { settings: { mute: true, quiet: false, quietStart: '22:00', quietEnd: '07:00', zone } }));
  await err(call(alice, 'nudge'), 409, /muted/);
  await ok(call(alice, 'cheer'));
  await err(call(alice, 'cheer'), 429);
  await ok(call(sam, 'leave'));
  await err(call(alice, 'cheer'), 409);
  pact = (await ok(alice('sync'))).pacts[0];
  assert.equal(pact.versions.length, 2);
  assert.equal(pact.endedOn, '2026-10-26');
  await ok(sam('logout'));
  await err(sam('sync'), 401);
  await ok(sam('login', { handle: 'sam_taylor', password }));
  assert.equal((await ok(sam('sync'))).pacts.length, 1);
});
