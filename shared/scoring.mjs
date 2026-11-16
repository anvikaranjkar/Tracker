import { addDays, dayRange, earlier, later, localDay, startWeek, wallTime, weekday } from './time.mjs';

export const PRECISION = 100;
export const total = logs => Math.round(logs.reduce((sum, log) => sum + log.amount * PRECISION, 0)) / PRECISION;
export const targetText = goal => goal.unit === 'completion' ? 'Complete once' : goal.target + ' ' + goal.unit;
export const cadenceText = goal => ({ daily: 'Every day', scheduled: 'Selected days', weekly: 'Weekly total', deadline: 'One-off deadline' }[goal.cadence]);
function agreedEnd(pact, version) {
  const next = pact.versions.find(item => item.number > version.number);
  return next ? earlier(version.terms.end, addDays(next.terms.start, -1)) : version.terms.end;
}
export function periodEnd(pact, version) {
  const end = agreedEnd(pact, version);
  return pact.endedOn ? earlier(end, pact.endedOn) : end;
}
export function versionAt(pact, day) {
  return pact.versions.find(version => day >= version.terms.start && day <= periodEnd(pact, version));
}
export function windowFor(version, goal, day, end) {
  if (day < version.terms.start || day > end) return null;
  if (goal.cadence === 'scheduled' && !goal.days.includes(weekday(day))) return null;
  let first = day;
  let last = day;
  if (goal.cadence === 'weekly') {
    first = later(version.terms.start, startWeek(day));
    last = earlier(end, addDays(startWeek(day), 6));
  }
  if (goal.cadence === 'deadline') {
    last = goal.due;
    first = version.terms.start;
    if (last > end || day > last) return null;
  }
  const cutoff = wallTime(last, goal.cadence === 'deadline' ? goal.dueTime : version.terms.cutoff, version.terms.zone);
  return { first, last, cutoff, closes: cutoff + version.terms.grace * 60000 };
}
export function isExcused(pact, user, day) {
  return pact.requests.some(request => request.type === 'excuse' && request.status === 'approved'
    && request.owner === user && day >= request.first && day <= request.last);
}
export const logsFor = (pact, version, goal, first, last) => pact.logs.filter(log => log.version === version.number && log.goal === goal.id && log.day >= first && log.day <= last && !log.deleted);
export function progressFor(pact, version, goal, day, now) {
  const window = windowFor(version, goal, day, periodEnd(pact, version));
  if (!window) return { state: 'Rest day', amount: 0, checked: false, window: null };
  const amount = total(logsFor(pact, version, goal, window.first, window.last));
  const checked = logsFor(pact, version, goal, day, day).length > 0;
  if (isExcused(pact, goal.owner, day)) return { state: 'Excused', amount, checked, window };
  let state = 'Due today';
  const checkRequired = goal.cadence === 'weekly' && goal.dailyCheck;
  const checkCloses = wallTime(day, version.terms.cutoff, version.terms.zone) + version.terms.grace * 60000;
  if (checkRequired && !checked && now > checkCloses) state = 'Missed';
  else if (amount >= goal.target && (!checkRequired || checked)) state = 'Logged';
  else if (now > window.closes) state = 'Missed';
  else if (amount > 0 || checked) state = 'Partial';
  return { state, amount, checked, window };
}
function scheduledCheckDays(version, goal, first, last) {
  if (goal.cadence === 'weekly' && !goal.dailyCheck) return [last];
  if (goal.cadence === 'deadline') return goal.due >= first && goal.due <= last ? [goal.due] : [];
  return dayRange(first, last).filter(day => goal.cadence !== 'scheduled' || goal.days.includes(weekday(day)));
}
export function resultsAt(pact, version, owner, last) {
  const first = later(version.terms.start, startWeek(last));
  const goals = version.goals.filter(goal => goal.owner === owner && goal.counts);
  const misses = [];
  const missedCheckDays = new Set();
  for (const goal of goals) {
    const days = dayRange(first, last);
    const windows = new Map();
    for (const day of days) {
      const window = windowFor(version, goal, day, periodEnd(pact, version));
      if (window && window.last <= last) windows.set(window.last, window);
    }
    for (const window of windows.values()) {
      const eligible = dayRange(window.first, window.last).some(day => !isExcused(pact, owner, day));
      if (!eligible || ((goal.cadence === 'daily' || goal.cadence === 'scheduled' || goal.cadence === 'deadline')
        && isExcused(pact, owner, window.last))) continue;
      const amount = total(logsFor(pact, version, goal, window.first, window.last));
      if (amount < goal.target) misses.push(goal.name + ': ' + amount + ' of ' + goal.target + (goal.unit === 'completion' ? '' : ' ' + goal.unit));
    }
    for (const day of scheduledCheckDays(version, goal, first, last)) {
      if (isExcused(pact, owner, day)) continue;
      const window = windowFor(version, goal, day, periodEnd(pact, version));
      if (!window) continue;
      const wholeWindow = goal.cadence === 'deadline' || (goal.cadence === 'weekly' && !goal.dailyCheck);
      const logs = wholeWindow ? logsFor(pact, version, goal, window.first, window.last) : logsFor(pact, version, goal, day, day);
      if (!logs.length) missedCheckDays.add(day);
    }
  }
  const reasons = version.terms.rule === 'checkins'
    ? (missedCheckDays.size >= version.terms.missLimit ? [missedCheckDays.size + ' scheduled check-in days missed'] : [])
    : misses;
  return { misses, missedCheckDays: [...missedCheckDays], reasons };
}
export function checkpoints(pact, version, now) {
  const end = agreedEnd(pact, version);
  if (end < version.terms.start) return [];
  const result = [];
  const currentDay = localDay(now, version.terms.zone);
  for (let day = earlier(end, addDays(startWeek(version.terms.start), 6)); day <= end && day <= currentDay;) {
    const clock = version.terms.cutoff;
    const relevantDeadlines = version.goals.filter(goal => goal.cadence === 'deadline' && goal.due === day);
    const cutoff = Math.max(wallTime(day, clock, version.terms.zone), ...relevantDeadlines.map(goal => wallTime(day, goal.dueTime, version.terms.zone)));
    const closes = cutoff + version.terms.grace * 60000;
    if (now > closes && (!pact.endedAt || closes < pact.endedAt)) result.push({ day, cutoff });
    if (day === end) break;
    day = earlier(end, addDays(day, 7));
  }
  return result;
}
