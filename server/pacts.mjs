import { randomUUID } from 'node:crypto';
import { addDays, daysBetween, later, localDay, startWeek, wallTime } from '../shared/time.mjs';
import { checkinCutoff, checkpoints, isExcused, periodEnd, resultsAt, versionAt, windowFor } from '../shared/scoring.mjs';

export const GROUP_LIMIT = 50;

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
const validClock = value => typeof value === 'string' && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
function validZone(zone) {
  if (typeof zone !== 'string' || zone.length > 80) return false;
  try { new Intl.DateTimeFormat('en-AU', { timeZone: zone }); return true; } catch { return false; }
}

export function termsFrom(input, dailyCheckIns) {
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
  requireThat(!dailyCheckIns || terms.forfeit, 'Write or randomise a forfeit.');
  requireThat(Number.isInteger(terms.forfeitDays) && terms.forfeitDays >= 1 && terms.forfeitDays <= 30, 'Choose between 1 and 30 days to finish the forfeit.');
  return terms;
}

function goalFrom(input, previous, owner, terms, dailyCheckIns) {
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
    dailyCheck: input.cadence === 'weekly' && (dailyCheckIns || Boolean(input.dailyCheck)), counts: dailyCheckIns || Boolean(input.counts)
  };
  requireThat(['Fitness', 'Study', 'Custom'].includes(category) && goal.focus && goal.name.length >= 2, 'Add a focus and a goal name.');
  requireThat(unit && Number.isFinite(target) && target > 0 && target <= 100000 && Math.abs(target * 100 - Math.round(target * 100)) < 0.000001, 'Enter a target with at most two decimal places.');
  requireThat(['daily', 'scheduled', 'weekly', 'deadline'].includes(goal.cadence), 'Choose a goal schedule.');
  requireThat(!dailyCheckIns || ['daily', 'weekly'].includes(goal.cadence), 'Choose a daily or weekly target. You’ll check in each day.');
  requireThat(goal.cadence !== 'scheduled' || goal.days.length, 'Pick at least one scheduled day.');
  requireThat(goal.cadence !== 'deadline' || (validDay(goal.due) && goal.due >= terms.start && goal.due <= terms.end && validClock(goal.dueTime)), 'Choose a deadline within the pact dates.');
  return goal;
}

function audit(pact, type, user, now, description) {
  pact.history.push({ id: randomUUID(), type, user, at: now, description });
}
function reviseDraft(pact, owner, now, description, changedTerms = false) {
  pact.draft.revision += 1;
  if (changedTerms) pact.draft.signatures = {};
  else delete pact.draft.signatures[owner];
  pact.draft.change = description;
  audit(pact, 'draft', owner, now, description);
}
export function newPact(owner, name, input, now) {
  const terms = termsFrom(input, true);
  requireThat(terms.start >= localDay(now, terms.zone), 'Choose today or a future start date.');
  return {
    id: randomUUID(), serial: 0, owner, dailyCheckIns: true, members: [{ id: owner, name }],
    draft: { number: 1, revision: 1, terms, goals: [], signatures: {}, change: 'Pact created.' },
    versions: [], pendingGoals: [], logs: [], requests: [], outcomes: [], history: [], endedOn: null, endedAt: null
  };
}

function changeGoal(pact, goals, terms, user, data) {
  const old = goals.find(goal => goal.id === data.goal?.id);
  requireThat(!data.goal?.id || (old && old.owner === user), 'Only the owner can change this goal.', 403);
  if (data.action === 'deleteGoal') {
    requireThat(old, 'That goal is unavailable.', 404);
    return { goals: goals.filter(goal => goal !== old), description: 'Removed ' + old.name + '.' };
  }
  const limit = pact.dailyCheckIns ? 1 : 12;
  requireThat(old || goals.filter(goal => goal.owner === user).length < limit,
    pact.dailyCheckIns ? 'Edit your existing goal to change it.' : 'Each member can have up to 12 goals per version.');
  const goal = goalFrom(data.goal || {}, old, user, terms, pact.dailyCheckIns);
  if (old && JSON.stringify(old) === JSON.stringify(goal)) return null;
  return { goals: [...goals.filter(item => item !== old), goal], description: (old ? 'Updated ' : 'Added ') + goal.name + '.' };
}
function requireGoal(goals, terms, user) {
  requireThat(goals.some(goal => goal.owner === user), 'Add your goal before signing.');
  requireThat(!terms.forfeit || goals.some(goal => goal.owner === user && goal.counts), 'You need a goal that counts toward the forfeit.');
}
function publishDraft(pact, user, now) {
  const { draft } = pact;
  const signed = goal => Boolean(draft.signatures[goal.owner]);
  pact.pendingGoals = draft.goals.filter(goal => !signed(goal));
  draft.goals = draft.goals.filter(signed);
  pact.versions.push(draft);
  pact.draft = null;
  audit(pact, 'sealed', user, now, 'Published version ' + draft.number + '.');
}
function enrolMember(pact, version, user, data, now) {
  requireThat(version && !pact.draft && data.enrolVersion === version.number && !version.signatures[user],
    'The group agreement changed. Open the pact to review the latest terms.', 409);
  const goals = pact.pendingGoals ?? [];
  const terms = version.terms;
  const today = localDay(now, terms.zone);
  if (data.action !== 'sign') {
    requireThat(today <= terms.end, 'This pact has finished.', 409);
    const changed = changeGoal(pact, goals, terms, user, data);
    if (changed) pact.pendingGoals = changed.goals;
    return;
  }
  requireGoal(goals, terms, user);
  const starts = later(terms.start, now >= wallTime(today, terms.cutoff, terms.zone) ? addDays(today, 1) : today);
  requireThat(starts <= terms.end, 'There are no check-in days left in this pact.', 409);
  const own = goals.filter(goal => goal.owner === user && (!goal.due || goal.due >= starts));
  requireGoal(own, terms, user);
  version.memberStarts ??= {};
  version.memberStarts[user] = starts;
  version.goals.push(...own);
  version.signatures[user] = now;
  pact.pendingGoals = goals.filter(goal => goal.owner !== user);
  audit(pact, 'signed', user, now, 'Joined version ' + version.number + ' with a check-in start of ' + starts + '.');
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
  const settled = new Set(pact.outcomes.map(outcome => [outcome.version, outcome.day, outcome.owner].join('/')));
  for (const version of pact.versions) {
    const owners = new Set(version.goals.map(goal => goal.owner));
    for (const { day, cutoff } of checkpoints(pact, version, now)) {
      for (const owner of owners) {
        if (day < version.memberStarts?.[owner] || settled.has([version.number, day, owner].join('/'))) continue;
        pact.outcomes.push(resultRecord(pact, version, owner, day, cutoff, null, now));
        changed = true;
      }
    }
  }
  return changed;
}

function requireOpenCheckIn(pact, user, version, day) {
  if (!pact.dailyCheckIns) return;
  requireThat(!pact.logs.some(log => !log.deleted && log.owner === user && log.version === version && log.day === day)
    && !pact.requests.some(request => request.type === 'correction' && request.status === 'pending'
      && request.owner === user && request.entry.version === version && request.entry.day === day && !request.entry.deleted),
  'A check-in already exists for this day. Open it to edit or review it.', 409);
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
  if (!edit) requireOpenCheckIn(pact, user, version.number, day);
  requireThat(!isExcused(pact, user, day) || edit, 'This date has been excused.');
  const amount = data.remove ? 0 : Number(data.amount);
  requireThat(Number.isFinite(amount) && amount >= 0 && amount <= 100000 && Math.abs(amount * 100 - Math.round(amount * 100)) < 0.000001
    && (goal.unit !== 'completion' || [0, 1].includes(amount)), 'Enter a valid amount with at most two decimal places.');
  const cutoff = checkinCutoff(version, goal, day, window);
  const closes = Math.min(window.closes, cutoff + version.terms.grace * 60000);
  const entry = {
    id: existing?.id ?? data.key, owner: user, goal: goal.id, version: version.number, day, amount,
    note: data.remove ? '' : clean(data.note, 280), privateDetail: data.remove ? '' : clean(data.privateDetail, 280), shareNote: Boolean(data.shareNote),
    at: existing?.at ?? now, editedAt: edit ? now : null, late: Boolean(existing?.late || now > cutoff), deleted: Boolean(data.remove)
  };
  if (now > closes) {
    requireThat(edit, 'That check-in window has closed. Ask another member to approve a late entry.', 409);
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
  const version = request?.entry
    ? pact.versions.find(item => item.number === request.entry.version) : pact.versions.at(-1);
  requireThat(request && request.owner !== user && version?.signatures[user], 'Another signed member must review this request.', 403);
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

export function addMember(pact, user, name, now) {
  requireThat(pact.members.length < GROUP_LIMIT, 'This group already has ' + GROUP_LIMIT + ' members.', 409);
  pact.members.push({ id: user, name });
  audit(pact, 'join', user, now, name + ' joined the pact.');
}

export function applyAction(pact, user, data, now) {
  const action = data.action;
  requireThat(!pact.endedOn, 'This pact has ended. The group can still view its history.', 409);
  const draft = pact.draft;
  const signed = pact.versions.at(-1);
  if (['saveGoal', 'deleteGoal', 'sign'].includes(action) && data.enrolVersion !== undefined) {
    enrolMember(pact, signed, user, data, now);
    return;
  }
  if (['terms', 'saveGoal', 'deleteGoal', 'sign'].includes(action)) {
    requireThat(draft, 'This draft has closed. Review the current agreement.', 409);
    requireThat(data.revision === draft.revision, 'The draft changed. Review the latest version before trying again.', 409);
  }
  if (action === 'terms') {
    requireThat(user === pact.owner, 'Only the organiser can edit the group terms.', 403);
    const next = termsFrom(data.terms || {}, pact.dailyCheckIns);
    const first = localDay(now, next.zone);
    requireThat(next.start >= first && (!signed || (next.zone === signed.terms.zone && next.start > first && next.start > signed.terms.start
      && next.start <= addDays(signed.terms.end, 1))), 'Choose an effective date within the pact or immediately after it. Keep the signed time zone.');
    requireThat(draft.goals.every(goal => !goal.due || (goal.due >= next.start && goal.due <= next.end)), 'Move or remove any goals with deadlines outside the new pact dates first.');
    const labels = { name: 'name', start: 'start date', end: 'end date', zone: 'time zone', cutoff: 'cutoff time', grace: 'grace period', rule: 'checkpoint rule', missLimit: 'miss threshold', forfeit: 'forfeit', forfeitDays: 'forfeit due period' };
    const changes = Object.keys(labels).filter(key => draft.terms[key] !== next[key]).map(key => labels[key]);
    if (changes.length) {
      draft.terms = next;
      reviseDraft(pact, user, now, 'Updated the ' + changes.join(', ') + '.', true);
    }
  } else if (action === 'saveGoal' || action === 'deleteGoal') {
    const changed = changeGoal(pact, draft.goals, draft.terms, user, data);
    if (changed) {
      draft.goals = changed.goals;
      reviseDraft(pact, user, now, changed.description);
    }
  } else if (action === 'sign') {
    requireGoal(draft.goals, draft.terms, user);
    const day = localDay(now, draft.terms.zone);
    requireThat(draft.terms.start >= day && (!signed || draft.terms.start > day)
      && (draft.terms.start !== day || (now < wallTime(day, draft.terms.cutoff, draft.terms.zone)
        && draft.goals.every(goal => goal.due !== day || now < wallTime(day, goal.dueTime, draft.terms.zone)))), 'Update the start date before signing.');
    if (!draft.signatures[user]) {
      draft.signatures[user] = now;
      audit(pact, 'signed', user, now, 'Signed pact version ' + draft.number + '.');
    }
    const required = signed ? Object.keys(signed.signatures) : [pact.owner];
    if (required.every(memberId => draft.signatures[memberId])) publishDraft(pact, user, now);
  } else if (action === 'revision') {
    requireThat(user === pact.owner, 'Only the organiser can open a revision.', 403);
    requireThat(signed && !draft, 'There is already an open version or the pact is unsigned.', 409);
    const start = addDays([localDay(now, signed.terms.zone), signed.terms.start].sort().at(-1), 1);
    requireThat(start <= addDays(signed.terms.end, 1), 'This pact has ended. Create a new pact to go again.', 409);
    const goals = [...signed.goals, ...(pact.pendingGoals ?? [])].filter(goal => !goal.due || goal.due >= start);
    pact.draft = { number: signed.number + 1, revision: 1, terms: { ...signed.terms, start, end: signed.terms.end >= start ? signed.terms.end : start }, goals, signatures: {}, change: 'Opened a draft for future dates.' };
    audit(pact, 'draft', user, now, pact.draft.change);
  } else if (action === 'discardRevision') {
    requireThat(user === pact.owner, 'Only the organiser can discard a revision.', 403);
    requireThat(signed && draft && data.revision === draft.revision, 'This revision changed or was already signed.', 409);
    pact.pendingGoals = draft.goals.filter(goal => !signed.signatures[goal.owner] && (!goal.due || goal.due <= signed.terms.end));
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
    requireOpenCheckIn(pact, user, version.number, data.day);
    const cutoff = checkinCutoff(version, goal, data.day, window);
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
    requireThat(signed.signatures[user], 'Sign the agreement before requesting excused days.', 403);
    requireThat(data.first >= pact.versions[0].terms.start && data.last <= signed.terms.end, 'Excuse dates must be inside signed pact dates.');
    requireThat(!pact.outcomes.some(outcome => outcome.owner === user && outcome.day >= data.first && startWeek(outcome.day) <= data.last), 'A checkpoint in that period has already closed.', 409);
    requireThat(!pact.requests.some(req => req.type === 'excuse' && req.owner === user && req.status === 'pending'), 'You already have a pending request.', 409);
    pact.requests.push({ id: randomUUID(), owner: user, type: 'excuse', first: data.first, last: data.last, reason: clean(data.reason, 140), status: 'pending', at: now });
    audit(pact, 'excuse', user, now, 'Requested excused days.');
  } else if (action === 'decision') {
    decideRequest(pact, user, data, now);
  } else if (action === 'flagOutcome') {
    const item = pact.outcomes.find(result => result.id === data.id);
    requireThat(item, 'This checkpoint is unavailable.', 404);
    requireThat(pact.versions.find(version => version.number === item.version)?.signatures[user], 'Only signed members can flag this result.', 403);
    requireThat(!item.flagBy, 'This result is already flagged.', 409);
    item.flag = clean(data.reason, 160) || 'Please review the saved logs.';
    item.flagBy = user;
    if (item.forfeit && ['triggered', 'done'].includes(item.status)) item.status = 'flagged';
    audit(pact, 'review', user, now, 'Flagged the result for ' + item.day + '.');
  } else if (action === 'forfeit') {
    const item = pact.outcomes.find(result => result.id === data.id && result.forfeit);
    requireThat(item, 'This forfeit is unavailable.', 404);
    requireThat(pact.versions.find(version => version.number === item.version)?.signatures[user], 'Only signed members can review this forfeit.', 403);
    requireThat(!['confirmed', 'waived', 'void'].includes(item.status), 'This forfeit is already closed.', 409);
    if (data.mode === 'done' && item.owner === user && ['triggered', 'flagged'].includes(item.status)) item.status = 'done';
    else if (data.mode === 'confirm' && item.owner !== user && item.status === 'done') item.status = 'confirmed';
    else if (data.mode === 'waive' && (user === item.owner || item.waiverBy.includes(item.owner))) {
      item.waiverBy = [...new Set([...item.waiverBy, user])];
      if (item.waiverBy.length > 1) item.status = 'waived';
    } else throw new AppError(409, 'That action is unavailable for this forfeit.');
    audit(pact, 'forfeit', user, now, 'Forfeit for ' + item.day + ' · ' + (data.mode === 'waive' && item.status !== 'waived' ? 'waiver requested' : item.status) + '.');
  } else if (action === 'endPact') {
    requireThat(user === pact.owner, 'Only the organiser can end the group pact.', 403);
    const zone = signed?.terms.zone ?? draft.terms.zone;
    pact.endedOn = localDay(now, zone);
    pact.endedAt = now;
    pact.draft = null;
    pact.pendingGoals = [];
    audit(pact, 'ended', user, now, 'Ended this pact.');
  } else throw new AppError(400, 'Unknown pact action.');
}

function visibleLog(log, user) {
  const { note, privateDetail, shareNote, ...rest } = log;
  if (log.owner === user) return { ...rest, note, privateDetail, shareNote };
  return shareNote ? { ...rest, note, shareNote } : rest;
}
export function visiblePact(row, user) {
  const { signals, ...pact } = row.document;
  return {
    ...pact,
    pendingGoals: (pact.pendingGoals ?? []).filter(goal => goal.owner === user),
    inviteExpires: row.invite_hash && row.invite_expires_at ? +new Date(row.invite_expires_at) : null,
    logs: pact.logs.map(log => visibleLog(log, user)),
    requests: pact.requests.map(request => request.entry ? { ...request, entry: visibleLog(request.entry, user) } : request)
  };
}
