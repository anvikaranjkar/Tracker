import { ArrowRight, Check, ChevronRight, ClipboardList, Flag, Users } from 'lucide-react';
import { labelDay, localDay } from '../shared/time.mjs';
import { targetText } from '../shared/scoring.mjs';
import { entriesFor, existingCheckIn, initials, pactName, pactStatus, pactZone, pendingCorrection } from './model.mjs';
import { Avatar, Button, CategoryIcon, Empty, PageTitle, SectionTitle } from './ui.jsx';

const stateClass = state => state === 'Checked in' ? 'logged' : state.toLowerCase().replaceAll(' ', '-');
export function StateLabel({ state }) {
  return <span className={'state ' + stateClass(state)}>
    {['Logged', 'Checked in'].includes(state) ? <Check size={13} aria-hidden="true" /> : <i aria-hidden="true" />}{state}
  </span>;
}
export function GoalRow({ entry, action, compact = false, sub }) {
  const { goal, progress, pact } = entry;
  const state = pact.dailyCheckIns && progress.checked && progress.state !== 'Excused' ? 'Checked in' : progress.state;
  const amount = goal.cadence === 'weekly'
    ? (goal.unit === 'completion' ? (progress.amount >= 1 ? 'Complete this week' : 'One completion this week') : progress.amount + ' / ' + targetText(goal) + ' this week')
    : targetText(goal);
  return <div className={'goal-row' + (compact ? ' compact' : '')}>
    <CategoryIcon category={goal.category} />
    <div className="goal-main">
      <strong>{goal.name}</strong>
      <div className="goal-caption"><span>{sub ?? pactName(pact)}</span><span aria-hidden="true">·</span><span>{amount}</span></div>
    </div>
    <StateLabel state={state} />
    {action}
  </div>;
}
export function CheckInButton({ entry, log, kind = 'outline' }) {
  const saved = existingCheckIn(entry);
  const pending = pendingCorrection(entry);
  const label = pending ? 'In review' : saved ? 'Edit' : entry.progress.state === 'Missed' ? 'Review' : 'Check in';
  return <Button kind={kind} className="log-button" disabled={pending} aria-label={label + ' for ' + entry.goal.name}
    onClick={() => log(entry, saved)}>{label}</Button>;
}

function GroupSummary({ pact, pacts, now, openPact }) {
  const date = localDay(now, pactZone(pact));
  const entries = entriesFor([pact], date, now).filter(entry => entry.progress.window && entry.progress.state !== 'Excused');
  const withCheckIns = new Set(entries.map(entry => entry.goal.owner));
  const checked = new Set(entries.filter(entry => entry.progress.checked).map(entry => entry.goal.owner));
  const preview = [...pact.members].sort((a, b) => Number(withCheckIns.has(b.id)) - Number(withCheckIns.has(a.id))).slice(0, 4);
  const status = pactStatus(pact, now);
  return <aside className="today-rail" aria-label="Group pacts">
    <section className="group-summary">
      <div className="group-summary-heading"><Users size={17} aria-hidden="true" /><h2>Your group</h2></div>
      <button className="board-name" onClick={() => openPact(pact.id)}>{pactName(pact)}<ChevronRight size={18} aria-hidden="true" /></button>
      {withCheckIns.size > 0
        ? <><div className="group-progress"><progress value={checked.size} max={withCheckIns.size} aria-label="Today’s group check-ins" />
          <span>{checked.size} of {withCheckIns.size} checked in</span></div>
          <ul className="group-preview">{preview.map(member => <li key={member.id}>
            <Avatar name={member.name} initials={initials(member.name)} />
            <span>{member.name}</span>
            {checked.has(member.id) && <Check size={17} aria-label="Checked in" />}
          </li>)}</ul></>
        : <p className="field-note">{status === 'Draft' ? 'Check-ins start after the organiser signs.' : 'No group check-ins today.'}</p>}
      <button className="group-link text-button" type="button" onClick={() => openPact(pact.id)}>View all {pact.members.length} {pact.members.length === 1 ? 'member' : 'members'} <ArrowRight size={16} aria-hidden="true" /></button>
    </section>
    {pacts.length > 1 && <section className="other-pacts"><SectionTitle>Other pacts</SectionTitle>{pacts.filter(item => item !== pact).map(item =>
      <button key={item.id} onClick={() => openPact(item.id)}><span>{pactName(item)}</span><ChevronRight size={17} aria-hidden="true" /></button>)}</section>}
  </aside>;
}

export default function Today({ user, pacts, now, log, demo, openPact, create, syncError, retry, loading }) {
  const today = localDay(now, user.settings.zone);
  const ordered = [...pacts].sort((a, b) => Number(pactStatus(b, now) === 'Active') - Number(pactStatus(a, now) === 'Active'));
  const mine = ordered.filter(pact => !pact.endedOn).flatMap(pact => entriesFor([pact], localDay(now, pactZone(pact)), now)
    .filter(entry => entry.goal.owner === user.id && entry.progress.window && entry.progress.state !== 'Excused'));
  const complete = entry => entry.pact.dailyCheckIns ? entry.progress.checked : entry.progress.state === 'Logged';
  const count = mine.filter(complete).length;
  const setup = ordered.filter(pact => !pact.endedOn && pactStatus(pact, now) !== 'Finished'
    && (!pact.versions.length || !pact.versions.at(-1).signatures[user.id]));
  const grouped = [...mine].sort((a, b) => Number(complete(a)) - Number(complete(b)));
  const group = ordered.find(pact => !pact.endedOn) ?? ordered[0];
  return <>
    <PageTitle label={labelDay(today, { weekday: 'long', day: 'numeric', month: 'long' })} title={<>Today<span className="title-period">.</span></>} />
    {syncError && <div className="sync-banner" role="status"><span>{syncError}</span><Button kind="outline" onClick={retry}>Retry</Button></div>}
    <div className="today-grid">
      <div className="main-stack">
        <section className="today-list" aria-labelledby="check-in-heading">
          <div className="section-heading"><h2 id="check-in-heading">Today’s check-ins</h2>{mine.length > 0 && <span className="section-count">{count} of {mine.length} logged</span>}</div>
          {mine.length ? <div className="goal-list">{grouped.map(entry =>
            <GoalRow key={entry.pact.id + entry.goal.id} entry={entry} sub={entry.day !== today ? pactName(entry.pact) + ' · ' + labelDay(entry.day) : undefined}
              action={demo ? <Button kind="outline" onClick={() => openPact(entry.pact.id)}>View pact</Button> : <CheckInButton entry={entry} log={log}
                kind={complete(entry) || entry.progress.state === 'Missed' ? 'outline' : 'primary'} />} />)}</div>
            : loading ? <p className="field-note" role="status">Loading check-ins…</p>
            : pacts.length ? <Empty icon={ClipboardList} title="Nothing due today">{setup.length ? 'Add your goal and sign a pact to start checking in.' : 'Your scheduled check-ins appear here on the day.'}</Empty>
            : <div className="new-pact"><Flag size={24} aria-hidden="true" /><div><h3>Start a group pact</h3><p>Invite your group, set a goal each and check in daily.</p></div>
              <Button onClick={create} kind="white" right={<ArrowRight size={17} />}>Create a pact</Button></div>}
        </section>
        {setup.length > 0 && <section className="other-pacts"><SectionTitle>Finish setting up</SectionTitle>{setup.map(item =>
          <button key={item.id} onClick={() => openPact(item.id)}><span>{pactName(item)}</span><ChevronRight size={17} aria-hidden="true" /></button>)}</section>}
      </div>
      {group && <GroupSummary pact={group} pacts={ordered} now={now} openPact={openPact} />}
    </div>
  </>;
}
