import { addDays, browserZone, localDay, startWeek, wallTime, weekday } from '../shared/time.mjs';
import { periodEnd, progressFor, versionAt } from '../shared/scoring.mjs';

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
    throw new Error('Couldn’t reach Show Up. Check your connection and try again.');
  }
  const result = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(result.error ?? 'The app couldn’t complete that request.'), { status: res.status });
  return result;
}
export const latestTerms = pact => (pact.draft ?? pact.versions.at(-1))?.terms;
export const pactName = pact => latestTerms(pact)?.name ?? 'Pact history';
export const pactZone = pact => latestTerms(pact)?.zone ?? browserZone();
export const partner = (pact, user) => pact.members.find(member => member.id !== user);
export const initials = name => name.split(/\s+/).slice(0, 2).map(part => [...part][0]).join('').toLocaleUpperCase() || '?';
export function pactStatus(pact, now) {
  if (pact.endedOn) return 'Ended';
  if (pact.members.length === 1) return 'Invite a friend';
  if (!pact.versions.length) return 'Awaiting signatures';
  const today = localDay(now, pactZone(pact));
  if (today > pact.versions.at(-1).terms.end) return 'Finished';
  if (!versionAt(pact, today)) return 'Starts soon';
  return 'Active';
}
export function entriesFor(pacts, day, now) {
  return pacts.flatMap(pact => {
    const version = versionAt(pact, day);
    if (!version) return [];
    return version.goals.map(goal => ({ pact, version, goal, day, progress: progressFor(pact, version, goal, day, now) }));
  });
}
export function defaultTerms(now) {
  const zone = browserZone();
  const today = localDay(now, zone);
  return { name: '', start: today, end: addDays(today, 27), cutoff: '23:59', zone, grace: 60, rule: 'target', missLimit: 2, forfeit: '', forfeitDays: 3 };
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
  const you = { id: 'demo-me', name: 'Alex Park', handle: 'alex', settings: { zone }, events: [], favourites: {} };
  const mate = { id: 'demo-mate', name: 'Sam Taylor' };
  const makeGoal = (properties) => ({ target: 1, unit: 'sessions', topic: '', days: [], due: null, dueTime: null, dailyCheck: false, counts: true, ...properties });
  const goals = [
    makeGoal({ id: 'd-study', category: 'Study', focus: 'Chemistry', topic: 'Module 4 · Practice questions', name: 'Chemistry revision', unit: 'min', target: 120, cadence: 'weekly', dailyCheck: true, owner: you.id }),
    makeGoal({ id: 'd-legs', category: 'Fitness', focus: 'Muscle group', topic: 'Quads & hamstrings', name: 'Lower-body session', cadence: 'scheduled', days: [...new Set([weekday(today), (weekday(today) + 3) % 7])], owner: you.id }),
    makeGoal({ id: 'd-read', category: 'Custom', focus: 'Reading', name: 'Read before bed', unit: 'pages', target: 15, cadence: 'daily', owner: you.id }),
    makeGoal({ id: 'd-mate', category: 'Fitness', focus: 'Workout consistency', name: 'Upper-body sessions', target: 3, cadence: 'weekly', owner: mate.id }),
    makeGoal({ id: 'd-paper', category: 'Study', focus: 'Maths', name: 'Finish a practice paper', unit: 'completion', cadence: 'deadline', due: addDays(start, 6), dueTime: '18:00', owner: mate.id })
  ];
  const terms = { name: 'The November reset', start, end: addDays(start, 27), cutoff, zone, grace: 60, rule: 'target', missLimit: 2, forfeit: 'Make next week’s shared playlist', forfeitDays: 3 };
  const version = { number: 1, revision: 3, terms, goals, signatures: { [you.id]: now - 240000, [mate.id]: now - 180000 }, change: 'Both friends set their goals.' };
  const log = (id, goal, amount, owner, offset) => ({ id, goal, amount, owner, version: 1, day: today, at: now - offset, late: false, deleted: false });
  return { user: you, pacts: [{ id: 'demo', owner: you.id, members: [you, mate], draft: null, versions: [version],
    logs: [log('a', 'd-study', 85, you.id, 8700000), log('b', 'd-mate', 2, mate.id, 2400000), log('c', 'd-read', 15, you.id, 1800000)],
    history: [], requests: [], outcomes: [], signals: [], endedOn: null }] };
}
