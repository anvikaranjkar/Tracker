import { randomUUID } from 'node:crypto';
import { addDays, daysBetween, localClock, localDay, startWeek, wallTime } from '../shared/time.mjs';
import { checkpoints, isExcused, periodEnd, resultsAt, versionAt, windowFor } from '../shared/scoring.mjs';

export class AppError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}
export const requireThat = (test, message, status = 400) => {
  if (!test) throw new AppError(status, message);
};
export const clean = (value, limit) => typeof value === 'string' ? value.trim().slice(0, limit) : '';
export const validId = value => typeof value === 'string' && /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(value);
export const validDay = day => typeof day === 'string' && /^20\d\d-\d\d-\d\d$/.test(day)
  && Number.isFinite(Date.parse(day + 'T00:00Z')) && new Date(day + 'T00:00Z').toISOString().slice(0, 10) === day;
const harmfulForfeit = /\b(?:pay|payment|money|cash|venmo|paypal|fine|buy|skip meals?|skip breakfast|fasting|starve|weigh(?:-?in| yourself)|lose weight|gain weight|calories?|push[ -]?ups?|burpees?|public humiliation|post an embarrassing)\b|[$£€]\s*\d/i;
const validClock = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
function validZone(zone) {
  if (typeof zone !== 'string' || zone.length > 80) return false;
  try { new Intl.DateTimeFormat('en-AU', { timeZone: zone }); return true; } catch { return false; }
}

export function termsFrom(input) {
  const terms = {
    name: clean(input.name, 60),
    start: input.start,
    end: input.end,
    zone: input.zone,
    cutoff: input.cutoff,
    grace: Number(input.grace),
    rule: input.rule,
    missLimit: Number(input.missLimit || 2),
    forfeit: clean(input.forfeit, 140),
    forfeitDays: Number(input.forfeitDays || 3)
  };
  requireThat(terms.name.length >= 2, 'Give the pact a name.');
  requireThat(validDay(terms.start) && validDay(terms.end) && daysBetween(terms.start, terms.end) >= 0
    && daysBetween(terms.start, terms.end) <= 180, 'Choose a pact of 1 to 181 days.');
  requireThat(validClock(terms.cutoff) && validZone(terms.zone), 'Set a valid cutoff and time zone.');
  requireThat([0, 30, 60, 120, 720, 1440].includes(terms.grace), 'Pick one of the available grace periods.');
  requireThat(['target', 'checkins'].includes(terms.rule) && Number.isInteger(terms.missLimit)
    && terms.missLimit >= 1 && terms.missLimit <= 7, 'Choose a checkpoint rule.');
  requireThat(!harmfulForfeit.test(terms.forfeit), 'Choose a private, harmless forfeit, such as making a playlist.');
  requireThat(Number.isInteger(terms.forfeitDays) && terms.forfeitDays >= 1 && terms.forfeitDays <= 30, 'Choose between 1 and 30 days to finish the forfeit.');
  return terms;
}

function goalFrom(input, previous, owner, terms) {
  const category = input.category;
  const unit = clean(input.unit, 20);
  const target = unit === 'completion' ? 1 : Number(input.target);
  const goal = {
    id: previous?.id ?? randomUUID(), owner, category,
    focus: clean(input.focus, 48), topic: clean(input.topic, 80), name: clean(input.name, 70),
    unit, target, cadence: input.cadence,
    days: Array.isArray(input.days) ? [...new Set(input.days.filter(day => Number.isInteger(day) && day >= 0 && day <= 6))].sort() : [],
    due: input.cadence === 'deadline' ? input.due : null,
    dueTime: input.cadence === 'deadline' ? input.dueTime : null,
    dailyCheck: input.cadence === 'weekly' && Boolean(input.dailyCheck), counts: Boolean(input.counts)
  };
  requireThat(['Fitness', 'Study', 'Custom'].includes(category) && goal.focus && goal.name.length >= 2, 'Add a focus and a goal name.');
  requireThat(unit && Number.isFinite(target) && target > 0 && target <= 100000 && Math.abs(target * 100 - Math.round(target * 100)) < 0.000001, 'Enter a target with at most two decimal places.');
  requireThat(['daily', 'scheduled', 'weekly', 'deadline'].includes(goal.cadence), 'Choose a goal schedule.');
  requireThat(goal.cadence !== 'scheduled' || goal.days.length, 'Pick at least one scheduled day.');
  requireThat(goal.cadence !== 'deadline' || (validDay(goal.due) && goal.due >= terms.start && goal.due <= terms.end && validClock(goal.dueTime)), 'Choose a deadline within the pact dates.');
  return goal;
}

function audit(pact, type, user, now, description) {
  pact.history.push({ id: randomUUID(), type, user, at: now, description });
}
function reviseDraft(pact, owner, now, description) {
  pact.draft.revision += 1;
  pact.draft.signatures = {};
  pact.draft.change = description;
  audit(pact, 'draft', owner, now, description);
}
export function newPact(owner, name, input, now) {
  const terms = termsFrom(input);
  requireThat(terms.start >= localDay(now, terms.zone), 'Choose today or a future start date.');
  return {
    id: randomUUID(), serial: 0, owner, members: [{ id: owner, name }],
    draft: { number: 1, revision: 1, terms, goals: [], signatures: {}, change: 'Pact created.' },
    versions: [], logs: [], requests: [], outcomes: [], signals: [], history: [], endedOn: null, endedAt: null
  };
}

function resultRecord(pact, version, owner, day, cutoff, previous, now) {
  const { misses, missedCheckDays, reasons } = resultsAt(pact, version, owner, day);
  const forfeited = Boolean(reasons.length && version.terms.forfeit);
  return {
    id: previous?.id ?? randomUUID(), version: version.number, day, owner, cutoff, misses, missedCheckDays, reasons,
    flag: previous?.flag ?? '', flagBy: previous?.flagBy ?? null,
    forfeit: forfeited ? version.terms.forfeit : '',
    status: forfeited ? (previous?.forfeit ? previous.status : 'triggered') : (previous?.forfeit ? 'void' : 'closed'),
    waiverBy: forfeited && previous?.forfeit ? previous.waiverBy : [],
    due: forfeited ? addDays(previous?.forfeit ? previous.due : (previous ? localDay(now, version.terms.zone) : localDay(cutoff + version.terms.grace * 60000, version.terms.zone)), version.terms.forfeitDays * (previous?.forfeit ? 0 : 1)) : null
  };
}
export function settle(pact, now) {
  let changed = false;
  for (const version of pact.versions) {
    for (const { day, cutoff } of checkpoints(pact, version, now)) {
      for (const { id: owner } of pact.members) {
        if (pact.outcomes.some(outcome => outcome.owner === owner && outcome.version === version.number && outcome.day === day)) continue;
        pact.outcomes.push(resultRecord(pact, version, owner, day, cutoff, null, now));
        changed = true;
      }
    }
  }
  return changed;
}

function logEntry(pact, user, data, now, edit) {
  const existing = edit ? pact.logs.find(log => log.id === data.logId && log.owner === user && !log.deleted) : null;
  if (edit) requireThat(existing, 'This log is unavailable.', 404);
  if (!edit) {
    requireThat(validId(data.key), 'This check-in needs a fresh request key.');
    if (pact.logs.some(log => log.id === data.key && log.owner === user)) return;
    requireThat(!pact.logs.some(log => log.id === data.key), 'That check-in key is in use.', 409);
  }
  const day = existing?.day ?? data.day;
  requireThat(validDay(day), 'Choose a date for this check-in.');
  const version = existing ? pact.versions.find(item => item.number === existing.version) : versionAt(pact, day);
  requireThat(version && day <= localDay(now, version.terms.zone), 'The pact must be active on the log date.');
  const goal = version.goals.find(item => item.id === (existing?.goal ?? data.goalId) && item.owner === user);
  requireThat(goal, 'Only the owner can log this goal.', 403);
  const window = windowFor(version, goal, day, periodEnd(pact, version));
  requireThat(window, 'There is no check-in planned for this date.');
  requireThat(!isExcused(pact, user, day) || edit, 'This date has been excused.');
  const amount = data.remove ? 0 : Number(data.amount);
  requireThat(Number.isFinite(amount) && amount >= 0 && amount <= 100000 && Math.abs(amount * 100 - Math.round(amount * 100)) < 0.000001
    && (goal.unit !== 'completion' || [0, 1].includes(amount)), 'Enter a valid amount with at most two decimal places.');
  const cutoff = goal.cadence === 'weekly' && goal.dailyCheck
    ? Math.min(window.cutoff, wallTime(day, version.terms.cutoff, version.terms.zone)) : window.cutoff;
  const closes = Math.min(window.closes, cutoff + version.terms.grace * 60000);
  const entry = {
    id: existing?.id ?? data.key, owner: user, goal: goal.id, version: version.number, day, amount,
    note: data.remove ? '' : clean(data.note, 280), privateDetail: data.remove ? '' : clean(data.privateDetail, 280), shareNote: Boolean(data.shareNote),
    at: existing?.at ?? now, editedAt: edit ? now : null, late: Boolean(existing?.late || now > cutoff), deleted: Boolean(data.remove)
  };
  if (now > closes) {
    requireThat(edit, 'That check-in window has closed. Ask your friend to approve a late entry.', 409);
    const pending = pact.requests.find(req => req.type === 'correction' && req.status === 'pending' && req.entry.id === entry.id);
    requireThat(!pending, 'This log already has a correction awaiting approval.', 409);
    pact.requests.push({ id: randomUUID(), owner: user, type: 'correction', entry, status: 'pending', at: now });
    audit(pact, 'correction', user, now, 'Requested a correction to ' + goal.name + ' on ' + day + '.');
    return;
  }
  if (edit) {
    pact.logs[pact.logs.indexOf(existing)] = entry;
    audit(pact, 'log', user, now, 'Updated ' + goal.name + ' on ' + day + ' (' + existing.amount + ' → ' + amount + ').');
  } else {
    requireThat(pact.logs.length < 25000, 'This pact has reached its check-in limit.', 409);
    pact.logs.push(entry);
  }
}

function decideRequest(pact, user, data, now) {
  const request = pact.requests.find(item => item.id === data.id && item.status === 'pending');
  requireThat(request && request.owner !== user, 'Only the other member can decide this request.', 403);
  requireThat(['approved', 'declined'].includes(data.decision), 'Choose approve or decline.');
  if (data.decision === 'approved') {
    if (request.type === 'excuse') {
      requireThat(!pact.outcomes.some(outcome => outcome.owner === request.owner && outcome.day >= request.first
        && startWeek(outcome.day) <= request.last), 'A checkpoint in that period has already closed.', 409);
    } else {
      const existing = pact.logs.find(log => log.id === request.entry.id && log.owner === request.owner);
      if (existing) pact.logs[pact.logs.indexOf(existing)] = { ...request.entry, editedAt: now };
      else pact.logs.push({ ...request.entry, editedAt: now });
      for (const [index, outcome] of pact.outcomes.entries()) {
        if (outcome.version !== request.entry.version || outcome.owner !== request.owner) continue;
        const version = pact.versions.find(item => item.number === outcome.version);
        const goal = version.goals.find(item => item.id === request.entry.goal);
        const window = windowFor(version, goal, request.entry.day, periodEnd(pact, version));
        if (!window || window.last > outcome.day || window.last < startWeek(outcome.day)) continue;
        const updated = resultRecord(pact, version, outcome.owner, outcome.day, outcome.cutoff, outcome, now);
        pact.outcomes[index] = updated;
        audit(pact, 'rescore', user, now, 'Rechecked ' + outcome.day + ': ' + (outcome.reasons.join(', ') || 'met')
          + ' → ' + (updated.reasons.join(', ') || 'met') + '.');
      }
    }
  }
  request.status = data.decision;
  request.decidedAt = now;
  audit(pact, request.type, user, now, (data.decision === 'approved' ? 'Approved' : 'Declined') + ' ' + (request.type === 'correction' ? 'a log correction.' : 'excused days.'));
}

export function applyAction(pact, user, data, now, friendSettings) {
  const action = data.action;
  requireThat(!pact.endedOn, 'This pact has ended. Its history is available to both members.', 409);
  const draft = pact.draft;
  const signed = pact.versions.at(-1);
  if (['terms', 'saveGoal', 'deleteGoal', 'sign'].includes(action)) {
    requireThat(draft, 'Start a revision to change signed terms.', 409);
    requireThat(data.revision === draft.revision, 'The terms changed. Review the latest version before trying again.', 409);
  }
  if (action === 'terms') {
    const next = termsFrom(data.terms || {});
    const first = localDay(now, next.zone);
    requireThat(next.start >= first && (!signed || (next.zone === signed.terms.zone && next.start > first && next.start > signed.terms.start
      && next.start <= addDays(signed.terms.end, 1))), 'Choose an effective date within the pact or immediately after it. Keep the signed time zone.');
    requireThat(draft.goals.every(goal => !goal.due || (goal.due >= next.start && goal.due <= next.end)), 'Move or remove any goals with deadlines outside the new pact dates first.');
    const labels = { name: 'name', start: 'start date', end: 'end date', zone: 'time zone', cutoff: 'cutoff time', grace: 'grace period', rule: 'checkpoint rule', missLimit: 'miss threshold', forfeit: 'forfeit', forfeitDays: 'forfeit due period' };
    const changes = Object.keys(labels).filter(key => draft.terms[key] !== next[key]).map(key => labels[key]);
    if (changes.length) {
      draft.terms = next;
      reviseDraft(pact, user, now, 'Updated the ' + changes.join(', ') + '.');
    }
  } else if (action === 'saveGoal' || action === 'deleteGoal') {
    const old = draft.goals.find(goal => goal.id === data.goal?.id);
    requireThat(!data.goal?.id || (old && old.owner === user), 'Only the owner can change this goal.', 403);
    if (action === 'saveGoal') {
      requireThat(old || draft.goals.filter(goal => goal.owner === user).length < 12, 'Each person can have up to 12 goals per version.');
      const goal = goalFrom(data.goal || {}, old, user, draft.terms);
      if (old && JSON.stringify(old) === JSON.stringify(goal)) return;
      draft.goals = [...draft.goals.filter(item => item.id !== goal.id), goal];
      reviseDraft(pact, user, now, (old ? 'Updated ' : 'Added ') + goal.name + '.');
    } else {
      requireThat(old, 'That goal is unavailable.', 404);
      draft.goals = draft.goals.filter(goal => goal.id !== old.id);
      reviseDraft(pact, user, now, 'Removed ' + old.name + '.');
    }
  } else if (action === 'sign') {
    requireThat(pact.members.length === 2 && pact.members.every(member => draft.goals.some(goal => goal.owner === member.id)), 'Both friends need at least one goal before signing.');
    requireThat(!draft.terms.forfeit || pact.members.every(member => draft.goals.some(goal => goal.owner === member.id && goal.counts)), 'Each friend needs a goal that counts toward the forfeit.');
    const day = localDay(now, draft.terms.zone);
    requireThat(draft.terms.start >= day && (!signed || draft.terms.start > day)
      && (draft.terms.start !== day || (now < wallTime(day, draft.terms.cutoff, draft.terms.zone)
        && draft.goals.every(goal => goal.due !== day || now < wallTime(day, goal.dueTime, draft.terms.zone)))), 'Update the start date before signing.');
    if (!draft.signatures[user]) {
      draft.signatures[user] = now;
      audit(pact, 'signed', user, now, 'Signed pact version ' + draft.number + '.');
    }
    if (pact.members.every(member => draft.signatures[member.id])) {
      pact.versions.push(draft);
      pact.draft = null;
      audit(pact, 'sealed', user, now, 'Both signatures received for version ' + draft.number + '.');
    }
  } else if (action === 'revision') {
    requireThat(signed && !draft, 'There is already an open version or the pact is unsigned.', 409);
    const start = addDays([localDay(now, signed.terms.zone), signed.terms.start].sort().at(-1), 1);
    requireThat(start <= addDays(signed.terms.end, 1), 'This pact has ended. Create a new pact to go again.', 409);
    const goals = signed.goals.filter(goal => !goal.due || goal.due >= start);
    pact.draft = { number: signed.number + 1, revision: 1, terms: { ...signed.terms, start, end: signed.terms.end >= start ? signed.terms.end : start }, goals, signatures: {}, change: 'Opened a draft for future dates.' };
    audit(pact, 'draft', user, now, pact.draft.change);
  } else if (action === 'discardRevision') {
    requireThat(signed && draft && data.revision === draft.revision, 'This revision changed or was already signed.', 409);
    pact.draft = null;
    audit(pact, 'draft', user, now, 'Discarded the unsigned revision.');
  } else if (action === 'log' || action === 'editLog') {
    logEntry(pact, user, data, now, action === 'editLog');
  } else if (action === 'lateLog') {
    requireThat(validId(data.key), 'This check-in needs a fresh request key.');
    if (pact.requests.some(req => req.type === 'correction' && req.owner === user && req.entry.id === data.key)) return;
    requireThat(!pact.logs.some(log => log.id === data.key) && !pact.requests.some(req => req.entry?.id === data.key), 'That check-in key is in use.', 409);
    requireThat(pact.logs.length + pact.requests.filter(req => req.type === 'correction' && req.status === 'pending').length < 25000, 'This pact has reached its check-in limit.', 409);
    // Validate the same fields and ownership as an ordinary log while retaining the true submission time.
    requireThat(validDay(data.day), 'Choose a date for this check-in.');
    const version = versionAt(pact, data.day);
    const goal = version?.goals.find(item => item.id === data.goalId && item.owner === user);
    requireThat(goal && data.day <= localDay(now, version.terms.zone), 'This goal or date is unavailable.');
    const window = windowFor(version, goal, data.day, periodEnd(pact, version));
    requireThat(window && !isExcused(pact, user, data.day), 'There is no check-in planned for this date.');
    const cutoff = goal.cadence === 'weekly' && goal.dailyCheck ? Math.min(window.cutoff, wallTime(data.day, version.terms.cutoff, version.terms.zone)) : window.cutoff;
    requireThat(now > cutoff + version.terms.grace * 60000, 'This check-in is still open. Save it directly.');
    const amount = Number(data.amount);
    requireThat(Number.isFinite(amount) && amount >= 0 && amount <= 100000 && Math.abs(amount * 100 - Math.round(amount * 100)) < 0.000001
      && (goal.unit !== 'completion' || [0, 1].includes(amount)), 'Enter a valid amount.');
    const entry = { id: data.key, owner: user, goal: goal.id, version: version.number, day: data.day, amount, note: clean(data.note, 280), privateDetail: clean(data.privateDetail, 280),
      shareNote: Boolean(data.shareNote), at: now, editedAt: null, late: true, deleted: false };
    pact.requests.push({ id: randomUUID(), owner: user, type: 'correction', entry, status: 'pending', at: now });
    audit(pact, 'correction', user, now, 'Requested a late entry for ' + goal.name + ' on ' + data.day + '.');
  } else if (action === 'excuse') {
    requireThat(signed && validDay(data.first) && validDay(data.last) && data.first <= data.last, 'Choose the dates you want excused.');
    requireThat(data.first >= pact.versions[0].terms.start && data.last <= signed.terms.end, 'Excuse dates must be inside signed pact dates.');
    requireThat(!pact.outcomes.some(outcome => outcome.owner === user && outcome.day >= data.first && startWeek(outcome.day) <= data.last), 'A checkpoint in that period has already closed.', 409);
    requireThat(!pact.requests.some(req => req.type === 'excuse' && req.owner === user && req.status === 'pending'), 'You already have a request awaiting your friend.', 409);
    pact.requests.push({ id: randomUUID(), owner: user, type: 'excuse', first: data.first, last: data.last, reason: clean(data.reason, 140), status: 'pending', at: now });
    audit(pact, 'excuse', user, now, 'Requested excused days.');
  } else if (action === 'decision') {
    decideRequest(pact, user, data, now);
  } else if (action === 'flagOutcome') {
    const item = pact.outcomes.find(result => result.id === data.id);
    requireThat(item, 'This checkpoint is unavailable.', 404);
    requireThat(!item.flagBy, 'This result is already flagged.', 409);
    item.flag = clean(data.reason, 160) || 'Please review the saved logs.';
    item.flagBy = user;
    if (item.forfeit && ['triggered', 'done'].includes(item.status)) item.status = 'flagged';
    audit(pact, 'review', user, now, 'Flagged the result for ' + item.day + '.');
  } else if (action === 'forfeit') {
    const item = pact.outcomes.find(result => result.id === data.id && result.forfeit);
    requireThat(item, 'This forfeit is unavailable.', 404);
    requireThat(!['confirmed', 'waived', 'void'].includes(item.status), 'This forfeit is already closed.', 409);
    if (data.mode === 'done' && item.owner === user && ['triggered', 'flagged'].includes(item.status)) item.status = 'done';
    else if (data.mode === 'confirm' && item.owner !== user && item.status === 'done') item.status = 'confirmed';
    else if (data.mode === 'waive') {
      item.waiverBy = [...new Set([...item.waiverBy, user])];
      if (item.waiverBy.length === 2) item.status = 'waived';
    } else throw new AppError(409, 'That action is unavailable for this forfeit.');
    audit(pact, 'forfeit', user, now, 'Forfeit for ' + item.day + ' · ' + (data.mode === 'waive' && item.status !== 'waived' ? 'waiver requested' : item.status) + '.');
  } else if (action === 'cheer' || action === 'nudge') {
    requireThat(pact.members.length === 2, 'Invite a friend first.');
    const friend = pact.members.find(member => member.id !== user);
    if (action === 'nudge') {
      requireThat(!friendSettings?.mute, 'Your friend has muted nudges.', 409);
      if (friendSettings?.quiet && friendSettings.quietStart !== friendSettings.quietEnd) {
        const clock = localClock(now, friendSettings.zone);
        const { quietStart, quietEnd } = friendSettings;
        const quiet = quietStart < quietEnd ? clock >= quietStart && clock < quietEnd : clock >= quietStart || clock < quietEnd;
        requireThat(!quiet, 'Your friend is in quiet hours.', 409);
      }
    }
    const interval = action === 'nudge' ? 8 * 3600000 : 3600000;
    requireThat(!pact.signals.some(signal => signal.type === action && signal.from === user && now - signal.at < interval),
      action === 'nudge' ? 'You can send another nudge in eight hours from your last one.' : 'You already cheered in the past hour.', 429);
    pact.signals = [...pact.signals.slice(-99), { id: randomUUID(), type: action, from: user, to: friend.id, at: now }];
  } else if (action === 'leave') {
    const zone = signed?.terms.zone ?? draft.terms.zone;
    pact.endedOn = localDay(now, zone);
    pact.endedAt = now;
    pact.draft = null;
    audit(pact, 'left', user, now, 'Ended this pact. Signed terms and history have been kept.');
  } else throw new AppError(400, 'Unknown pact action.');
}

function visibleLog(log, user) {
  const { note, privateDetail, shareNote, ...rest } = log;
  if (log.owner === user) return { ...rest, note, privateDetail, shareNote };
  return shareNote ? { ...rest, note, shareNote } : rest;
}
export function visiblePact(row, user) {
  const { document: pact } = row;
  return {
    ...pact,
    inviteExpires: row.invite_hash && row.invite_expires_at ? +new Date(row.invite_expires_at) : null,
    logs: pact.logs.map(log => visibleLog(log, user)),
    requests: pact.requests.map(request => request.entry ? { ...request, entry: visibleLog(request.entry, user) } : request)
  };
}
