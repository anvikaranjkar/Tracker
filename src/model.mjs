import { addDays, browserZone, labelDay, localDay, startWeek, wallTime, weekday } from '../shared/time.mjs';
import { pendingCheckIn, periodEnd, progressFor, versionAt } from '../shared/scoring.mjs';

export async function api(action, data = {}) {
  let res;
  try {
    res = await fetch('/api/showup', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Show-Up': '1' },
      body: JSON.stringify({ ...data, action }),
      signal: AbortSignal.timeout(14000)
    });
  } catch {
    throw Object.assign(new Error('Couldn’t reach Show Up. Check your connection and try again.'), { connection: true });
  }
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(result.error ?? 'The app couldn’t complete that request.'), { status: res.status });
  return result;
}
export const latestTerms = pact => (pact.draft ?? pact.versions.at(-1))?.terms;
export const pactName = pact => latestTerms(pact)?.name ?? 'Pact history';
export const pactZone = pact => latestTerms(pact)?.zone ?? browserZone();
export const initials = name => name.split(/\s+/).slice(0, 2).map(part => [...part][0]).join('').toLocaleUpperCase() || '?';
export function pactStatus(pact, now) {
  if (pact.endedOn) return 'Ended';
  if (!pact.versions.length) return 'Draft';
  const today = localDay(now, pactZone(pact));
  if (today > pact.versions.at(-1).terms.end) return 'Finished';
  if (!versionAt(pact, today)) return 'Starts soon';
  return 'Active';
}
export function entriesFor(pacts, day, now) {
  return pacts.flatMap(pact => {
    const version = versionAt(pact, day);
    if (!version) return [];
    return version.goals.filter(goal => !version.memberStarts?.[goal.owner] || day >= version.memberStarts[goal.owner])
      .map(goal => ({ pact, version, goal, day, progress: progressFor(pact, version, goal, day, now) }));
  });
}
export function existingCheckIn(entry) {
  if (!entry.pact.dailyCheckIns) return null;
  return entry.pact.logs.find(log => !log.deleted && log.owner === entry.goal.owner && log.version === entry.version.number && log.day === entry.day) ?? null;
}
export function pendingCorrection(entry) {
  return entry.pact.requests.some(request => request.type === 'correction' && request.owner === entry.goal.owner
    && request.status === 'pending' && request.entry.goal === entry.goal.id && request.entry.day === entry.day
    && request.entry.version === entry.version.number);
}
export function pactNotices(pacts, user, now) {
  return pacts.flatMap(pact => {
    if (pact.endedOn) return [];
    const latest = pact.versions.at(-1);
    const latestSign = user.id === pact.owner ? [...pact.history].reverse().find(event => event.type === 'join') : null;
    const notices = pact.requests.filter(req => req.owner !== user.id && req.status === 'pending'
      && (req.entry ? pact.versions.find(item => item.number === req.entry.version) : latest)?.signatures[user.id])
      .map(req => ({ id: req.id, at: req.at, pact, message: req.type === 'excuse' ? 'Review an excused-days request.' : 'Review a proposed check-in change.' }));
    for (const result of pact.outcomes.filter(result => result.owner === user.id && ['triggered', 'flagged'].includes(result.status))) {
      notices.push({ id: result.id, at: result.cutoff, pact, message: 'Forfeit due ' + labelDay(result.due) + '.' });
    }
    if (latestSign) notices.push({ id: latestSign.id, at: latestSign.at, pact, message: latestSign.description });
    const due = pendingCheckIn(pact, user.id, now);
    if (due) notices.push({ id: pact.id + '-' + due.day, at: due.at, pact, today: true, message: 'Your check-in is still open.' });
    return notices;
  }).sort((a, b) => b.at - a.at);
}
export function defaultTerms(now) {
  const zone = browserZone();
  const today = localDay(now, zone);
  return { name: '', start: today, end: addDays(today, 27), cutoff: '23:59', zone, grace: 60, rule: 'checkins', missLimit: 2, forfeit: '', forfeitDays: 3 };
}
export const monthStart = day => day.slice(0, 7) + '-01';
export function moveMonth(day, difference) {
  const date = new Date(monthStart(day) + 'T12:00Z');
  date.setUTCMonth(date.getUTCMonth() + difference);
  return date.toISOString().slice(0, 10);
}
export function scheduledEvent(entry) {
  const { day, goal, version, pact, progress } = entry;
  if (!progress.window || progress.state === 'Excused') return null;
  if (goal.cadence === 'deadline' && day !== goal.due) return null;
  if (goal.cadence === 'weekly' && !goal.dailyCheck && day !== progress.window.last) return null;
  return {
    id: pact.id + goal.id + day, title: goal.name, day,
    time: goal.cadence === 'deadline' ? goal.dueTime : version.terms.cutoff, zone: version.terms.zone,
    note: pactName(pact) + ' · ' + goal.target + ' ' + goal.unit
  };
}
export function isCheckpoint(pact, day) {
  const version = versionAt(pact, day);
  return version && (weekday(day) === 6 || day === periodEnd(pact, version));
}
export function downloadCalendar(events) {
  if (!events.length) return;
  const escape = value => String(value).replaceAll('\\', '\\\\').replaceAll(/\r?\n/g, '\\n').replaceAll(',', '\\,').replaceAll(';', '\\;');
  const stamp = date => date.toISOString().replace(/[-:]|\.\d{3}/g, '');
  const fold = value => {
  const lines = [''];
  const encoder = new TextEncoder();
  let used = 0;
  for (const char of value) {
    const size = encoder.encode(char).length;
    if (used + size > 75) { lines.push(' '); used = 1; }
    lines[lines.length - 1] += char;
    used += size;
  }
  return lines.join('\r\n');
};
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Show Up//Pact Calendar//EN', 'CALSCALE:GREGORIAN'];
  for (const event of events) {
    const time = event.time ? 'DTSTART:' + stamp(new Date(wallTime(event.day, event.time, event.zone || browserZone())))
      : 'DTSTART;VALUE=DATE:' + event.day.replaceAll('-', '');
    lines.push('BEGIN:VEVENT', 'UID:' + event.id + '@showup', 'DTSTAMP:' + stamp(new Date()), time,
      'SUMMARY:' + escape(event.title), 'DESCRIPTION:' + escape(event.note || ''), 'END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  const url = URL.createObjectURL(new Blob([lines.map(fold).join('\r\n') + '\r\n'], { type: 'text/calendar;charset=utf-8' }));
  const link = Object.assign(document.createElement('a'), { href: url, download: 'show-up-calendar.ics' });
  document.body.append(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);

}

export function demoData(now) {
  const zone = browserZone();
  const today = localDay(now, zone);
  const start = startWeek(today);
  const cutoff = '23:59';
  const you = { id: 'demo-alex', name: 'Alex Park', handle: 'alex', settings: { zone }, events: [], favourites: {}, inboxSince: 0 };
  const members = [you, { id: 'demo-sam', name: 'Sam Taylor' }, { id: 'demo-morgan', name: 'Morgan Lee' },
    { id: 'demo-jules', name: 'Jules Chen' }, { id: 'demo-riley', name: 'Riley Singh' }];
  const makeGoal = (properties) => ({ target: 1, unit: 'sessions', topic: '', days: [], due: null, dueTime: null, dailyCheck: false, counts: true, ...properties });
  const goals = [
    makeGoal({ id: 'd-study', category: 'Study', focus: 'Chemistry', topic: 'Module 4 · Practice questions', name: 'Chemistry revision', unit: 'min', target: 25, cadence: 'daily', owner: you.id }),
    makeGoal({ id: 'd-run', category: 'Fitness', focus: 'Cardio', name: 'Run 10 km this week', unit: 'km', target: 10, cadence: 'weekly', dailyCheck: true, owner: members[1].id }),
    makeGoal({ id: 'd-read', category: 'Custom', focus: 'Reading', name: 'Read before bed', unit: 'pages', target: 15, cadence: 'daily', owner: members[2].id }),
    makeGoal({ id: 'd-paper', category: 'Study', focus: 'Maths', name: 'Practice maths', unit: 'completion', cadence: 'daily', owner: members[3].id }),
    makeGoal({ id: 'd-walk', category: 'Fitness', focus: 'Cardio', name: 'Take a lunch break walk', unit: 'min', target: 15, cadence: 'daily', owner: members[4].id })
  ];
  const terms = { name: 'The evening reset', start, end: addDays(start, 27), cutoff, zone, grace: 60, rule: 'checkins', missLimit: 2, forfeit: 'Buy another member a Slushie.', forfeitDays: 3 };
  const version = { number: 1, revision: 3, terms, goals, signatures: Object.fromEntries(members.map(member => [member.id, now - 240000])), change: 'The group set their goals.' };
  const log = (id, goal, amount, owner, offset) => ({ id, goal, amount, owner, version: 1, day: today, at: now - offset, late: false, deleted: false });
  const pact = { id: 'demo', owner: you.id, members, draft: null, versions: [version], dailyCheckIns: true,
    logs: [log('a', 'd-run', 2, members[1].id, 2400000), log('b', 'd-read', 15, members[2].id, 1800000)],
    history: [], requests: [], outcomes: [], endedOn: null };
  const reading = makeGoal({ id: 'd-personal', category: 'Custom', focus: 'Reading', name: 'Read for 20 minutes', unit: 'min', target: 20, cadence: 'daily', owner: you.id });
  const other = { ...pact, id: 'demo-reading', members: [you, members[2]], versions: [{
    ...version, terms: { ...terms, name: 'Reading group' }, goals: [reading, goals[2]]
  }], logs: [log('c', reading.id, 20, you.id, 900000)] };
  return { user: you, invites: [], pacts: [pact, other] };
}
