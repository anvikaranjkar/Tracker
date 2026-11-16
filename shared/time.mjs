const dayMs = 86400000;
const cache = new Map();
export const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
export const isoDay = date => date.toISOString().slice(0, 10);
export const asDay = value => new Date(value + 'T00:00:00.000Z');
export const addDays = (day, count) => isoDay(new Date(+asDay(day) + dayMs * count));
export const daysBetween = (first, last) => Math.round((+asDay(last) - +asDay(first)) / dayMs);
export const weekday = day => (asDay(day).getUTCDay() + 6) % 7;
export const startWeek = day => addDays(day, -weekday(day));
export const earlier = (a, b) => a < b ? a : b;
export const later = (a, b) => a > b ? a : b;
export function dayRange(first, last) {
  const length = Math.min(367, daysBetween(first, last) + 1);
  return Array.from({ length: Math.max(0, length) }, (_, index) => addDays(first, index));
}
function parts(time, zone) {
  if (!cache.has(zone)) {
    cache.set(zone, new Intl.DateTimeFormat('en-GB', {
      timeZone: zone, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }));
  }
  return Object.fromEntries(cache.get(zone).formatToParts(time).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
}
export function localDay(time, zone) {
  const p = parts(time, zone);
  return p.year + '-' + p.month + '-' + p.day;
}
export function localClock(time, zone) {
  const p = parts(time, zone);
  return p.hour + ':' + p.minute;
}
export function wallTime(day, clock, zone) {
  const expected = Date.parse(day + 'T' + clock + ':00Z');
  const offsets = new Set();
  for (const delta of [-dayMs, 0, dayMs]) {
    const sample = expected + delta;
    const p = parts(sample, zone);
    const utc = Date.parse(p.year + '-' + p.month + '-' + p.day + 'T' + p.hour + ':' + p.minute + ':' + p.second + 'Z');
    offsets.add(utc - sample);
  }
  const options = [...offsets].map(offset => expected - offset).sort((a, b) => a - b);
  return options.find(time => localDay(time, zone) === day && localClock(time, zone) === clock) ?? options.at(-1);
}
export function labelDay(day, options = { day: 'numeric', month: 'short' }) {
  return asDay(day).toLocaleDateString('en-AU', { timeZone: 'UTC', ...options });
}
export function labelClock(clock) {
  const [hour, minutes] = clock.split(':').map(Number);
  return (hour % 12 || 12) + ':' + String(minutes).padStart(2, '0') + (hour >= 12 ? ' pm' : ' am');
}
export const browserZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone || 'Australia/Sydney';
