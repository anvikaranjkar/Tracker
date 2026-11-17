import { useMemo, useState } from 'react';
import { CalendarDays, ChevronLeft, ChevronRight, Download, Flag, Plus, Trash2 } from 'lucide-react';
import { addDays, dayRange, labelClock, labelDay, localDay, startWeek, WEEKDAYS } from '../shared/time.mjs';
import { periodEnd } from '../shared/scoring.mjs';
import { downloadCalendar, entriesFor, isCheckpoint, monthStart, moveMonth, pactName, pactZone } from './model.mjs';
import { scheduledEvent } from './model.mjs';
import { Button, Empty, IconButton, PageTitle, SectionTitle } from './ui.jsx';
import { CheckInButton, GoalRow } from './Today.jsx';

function eventsFor(pacts, all, person, day, now, user) {
  const allowed = entry => !person || entry.goal.owner === person;
  const entries = entriesFor(pacts, day, now).filter(allowed).filter(entry => entry.goal.cadence !== 'deadline' || entry.goal.due === day
    || entry.pact.logs.some(log => !log.deleted && log.day === day && log.goal === entry.goal.id && log.version === entry.version.number));
  const planned = entries.filter(entry => entry.progress.state === 'Excused' || scheduledEvent(entry)
    || entry.pact.logs.some(log => !log.deleted && log.day === day && log.goal === entry.goal.id && log.version === entry.version.number));
  const own = (!person || person === user.id) && all ? user.events.filter(event => event.day === day) : [];
  const milestones = pacts.filter(pact => isCheckpoint(pact, day)).map(pact => {
    const ending = pact.versions.some(version => periodEnd(pact, version) === day);
    return { pact, title: ending ? 'Version ends · checkpoint' : 'Weekly checkpoint' };
  });
  return { entries, planned, own, milestones, count: planned.length + own.length + milestones.length };
}
export default function Calendar({ user, pacts, now, day, setDay, demo, log, personEvent, removeEvent }) {
  const [view, setView] = useState('Week');
  const [filter, setFilter] = useState('');
  const [person, setPerson] = useState('');
  const today = localDay(now, user.settings.zone);
  const selectedPacts = filter ? pacts.filter(pact => pact.id === filter) : pacts;
  const people = [...new Map(selectedPacts.flatMap(pact => pact.members.map(member => [member.id, member]))).values()]
    .filter(member => member.id !== user.id).sort((a, b) => a.name.localeCompare(b.name));
  const first = view === 'Month' ? startWeek(monthStart(day)) : view === 'Week' ? startWeek(day) : day;
  const count = view === 'Month' ? 42 : view === 'Week' ? 7 : 14;
  const range = dayRange(first, addDays(first, count - 1));
  const dateInfo = useMemo(() => new Map([...new Set([...range, day])].map(date => [date, eventsFor(selectedPacts, !filter, person, date, now, user)])),
    [first, count, day, filter, person, pacts, now, user]);
  const jump = amount => setDay(view === 'Month' ? moveMonth(day, amount) : addDays(day, count * amount));
  const exportDate = date => {
    const info = dateInfo.get(date);
    const own = info.own.map(event => ({ ...event, zone: user.settings.zone }));
    return [...info.planned.map(scheduledEvent).filter(Boolean), ...own];
  };
  const gridDates = view === 'Agenda' ? range : [day];
  const hasExport = range.some(date => exportDate(date).length);
  const calendarLabel = view === 'Month' ? labelDay(day, { month: 'long', year: 'numeric' })
    : labelDay(first) + ' – ' + labelDay(addDays(first, count - 1), { day: 'numeric', month: 'short', year: 'numeric' });
  return <>
    <PageTitle label="Schedule" title={<>Calendar<span className="title-period">.</span></>} action={!demo && <Button onClick={() => personEvent(day)} icon={<Plus size={18} />}>Personal event</Button>}>
      Sessions, deadlines and check-ins in one place.
    </PageTitle>
    <div className="calendar-filters">
      <div className="segmented" aria-label="Calendar view">{['Week', 'Month', 'Agenda'].map(mode => <button key={mode} aria-pressed={view === mode} onClick={() => setView(mode)}>{mode}</button>)}</div>
      <label><span className="sr-only">Filter by pact</span><select value={filter} onChange={e => { setFilter(e.target.value); setPerson(''); }}><option value="">All pacts</option>{pacts.map(pact => <option key={pact.id} value={pact.id}>{pactName(pact)}</option>)}</select></label>
      <label><span className="sr-only">Filter by person</span><select value={person} onChange={e => setPerson(e.target.value)}><option value="">Everyone</option>
        <option value={user.id}>Me</option>{people.map(member => <option key={member.id} value={member.id}>{member.name}</option>)}</select></label>
    </div>
    <div className={'calendar-layout ' + (view === 'Agenda' ? ' agenda-layout' : '')}>
      <section className="calendar-surface" aria-label={view + ' calendar'}>
        <div className="calendar-head"><div><div className="eyebrow">{view === 'Agenda' ? 'Next 14 days' : view + ' view'}</div><h2>{calendarLabel}</h2></div><div className="quick-actions">
          <IconButton title={'Previous ' + (view === 'Agenda' ? 'two weeks' : view.toLowerCase())} onClick={() => jump(-1)}><ChevronLeft size={19} /></IconButton>
          <Button kind="outline" onClick={() => setDay(today)}>Today</Button>
          <IconButton title={'Next ' + (view === 'Agenda' ? 'two weeks' : view.toLowerCase())} onClick={() => jump(1)}><ChevronRight size={19} /></IconButton>
        </div></div>
        {view !== 'Agenda' && <>
          <div className="calendar-grid calendar-labels" aria-hidden="true">{WEEKDAYS.map(label => <div key={label}>{label}</div>)}</div>
          <div className={'calendar-grid ' + view.toLowerCase()}>{range.map(date => {
            const info = dateInfo.get(date);
            return <button type="button" className={'day-cell' + (date === day ? ' selected' : '') + (date === today ? ' today-cell' : '') + (view === 'Month' && date.slice(0, 7) !== day.slice(0, 7) ? ' outside' : '')}
              key={date} aria-pressed={date === day} aria-current={date === today ? 'date' : undefined}
              aria-label={labelDay(date, { weekday: 'long', day: 'numeric', month: 'long' }) + ', ' + info.count + ' items'} onClick={() => setDay(date)}>
              <span className="cell-number">{Number(date.slice(-2))}</span>
              {info.count > 0 && <span className="cell-events">
                {info.planned.slice(0, view === 'Month' ? 1 : 2).map(entry => <span className={'calendar-tag ' + entry.goal.category.toLowerCase()} key={entry.pact.id + entry.goal.id}>{entry.goal.name}</span>)}
                {info.own.length > 0 && <span className="calendar-tag personal">{info.own[0].title}</span>}
                {info.milestones.length > 0 && <span className="calendar-tag checkpoint">Checkpoint</span>}
                <span className="cell-count">{info.count}</span>
              </span>}
            </button>;
          })}</div>
        </>}
      </section>
      <section className="day-agenda">
        {gridDates.map(date => {
          const info = dateInfo.get(date);
          if (view === 'Agenda' && !info.count) return null;
          return <div className="agenda-date" key={date}><SectionTitle action={exportDate(date).length > 0 && <IconButton title={'Export ' + labelDay(date)} onClick={() => downloadCalendar(exportDate(date))}><Download size={17} /></IconButton>}>
            {labelDay(date, { weekday: 'long', day: 'numeric', month: 'short' })}
          </SectionTitle>
          {info.entries.map(entry => <div className="agenda-entry" key={entry.pact.id + entry.goal.id}>
            <GoalRow entry={entry} compact sub={(entry.goal.owner === user.id ? 'You' : entry.pact.members.find(member => member.id === entry.goal.owner)?.name ?? 'Member') + ' · ' + pactName(entry.pact)}
              action={!demo && !entry.pact.endedOn && entry.goal.owner === user.id && entry.progress.window && entry.progress.state !== 'Excused' && date <= localDay(now, pactZone(entry.pact))
                ? <CheckInButton entry={entry} log={log} /> : null} />
            {(entry.pact.logs.filter(item => item.goal === entry.goal.id && item.day === date && item.version === entry.version.number && !item.deleted)).map(item => <div className="agenda-log" key={item.id}>
              <span>{item.amount} {entry.goal.unit === 'completion' ? 'completion' : entry.goal.unit}{item.late ? ' · late' : ''}{item.note ? ' · ' + item.note : ''}{item.privateDetail ? ' · Private detail: ' + item.privateDetail : ''}</span>
              {!demo && !entry.pact.endedOn && !entry.pact.dailyCheckIns && item.owner === user.id && <button className="text-button" onClick={() => log(entry, item)}>Edit</button>}
            </div>)}
          </div>)}
          {info.own.map(event => <div className="calendar-event" key={event.id}><CalendarDays size={20} /><div><strong>{event.title}</strong><small>{[event.time && labelClock(event.time), 'Private', event.note].filter(Boolean).join(' · ')}</small></div>{!demo && <IconButton title={'Remove ' + event.title} onClick={() => removeEvent(event)}><Trash2 size={16} /></IconButton>}</div>)}
          {info.milestones.map(({ pact, title }) => <div key={pact.id} className="calendar-event"><Flag size={20} /><div><strong>{title}</strong><small>{pactName(pact)} · {labelClock(pact.versions.find(version => date >= version.terms.start && date <= periodEnd(pact, version)).terms.cutoff)} · {pactZone(pact)}</small></div></div>)}
          {!info.entries.length && !info.count && <Empty icon={CalendarDays} title="Clear for the day">No check-ins or events match these filters.</Empty>}
          </div>;
        })}
        {view === 'Agenda' && !range.some(date => dateInfo.get(date).count) && <Empty icon={CalendarDays} title="Nothing in this range">Move to another fortnight or change the filters.</Empty>}
      </section>
    </div>
    {hasExport && <div className="calendar-export"><Button kind="outline" icon={<Download size={17} />} onClick={() => downloadCalendar(range.flatMap(exportDate))}>Export visible schedule (.ics)</Button></div>}
  </>;
}
