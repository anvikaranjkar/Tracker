import { ArrowDownRight, ArrowRight, BellRing, Check, ChevronRight, CircleCheck, ClipboardList, Flag, Hand, Plus } from 'lucide-react';
import { addDays, labelDay, localClock, localDay, labelClock, startWeek } from '../shared/time.mjs';
import { targetText } from '../shared/scoring.mjs';
import { entriesFor, initials, partner, pactName, pactStatus, pactZone } from './model.mjs';
import { Avatar, Button, CategoryIcon, Empty, Forward, PageTitle, SectionTitle } from './ui.jsx';

const stateClass = state => state.toLowerCase().replaceAll(' ', '-');
export function StateLabel({ state }) {
  return <span className={'state ' + stateClass(state)}>{state === 'Logged' ? <Check size={13} aria-hidden="true" /> : <i aria-hidden="true" />}{state}</span>;
}
export function Progress({ entry, flat = false }) {
  const { goal, progress } = entry;
  const percent = Math.min(100, Math.round(progress.amount / goal.target * 100));
  const amount = goal.unit === 'completion' ? (percent >= 100 ? 'Complete' : 'Ready when you are') : progress.amount + ' / ' + goal.target + ' ' + goal.unit;
  return <div className={'progress' + (flat ? ' flat' : '')}>
    <div className="progress-meta"><span>{amount}</span>{goal.cadence === 'weekly' && <span>This week</span>}</div>
    <div role="progressbar" aria-label={goal.name} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={amount} className="progress-track"><span style={{ width: percent + '%' }} /></div>
  </div>;
}
export function GoalRow({ entry, action, onPact, compact = false, sub }) {
  const { goal, progress, pact } = entry;
  return <div className={'goal-row' + (compact ? ' compact' : '')}>
    <CategoryIcon category={goal.category} />
    <div className="goal-main">
      <strong>{goal.name}</strong>
      <div className="goal-caption">{onPact ? <button onClick={onPact}>{pactName(pact)}</button> : <span>{sub ?? goal.focus}</span>}<span aria-hidden="true">·</span><span>{targetText(goal)}</span></div>
    </div>
    <StateLabel state={progress.state} />
    {action}
  </div>;
}
function Scoreboard({ pa, pacts, user, now, demo, openPact, react }) {
  const mate = partner(pa, user.id);
  const today = localDay(now, pactZone(pa));
  const beginning = startWeek(today);
  const their = entriesFor([pa], today, now).filter(entry => entry.goal.owner === mate?.id && entry.progress.window);
  const logs = pa.logs.filter(log => log.owner === mate?.id && !log.deleted).sort((a, b) => b.at - a.at);
  const last = logs[0];
  const lastGoal = last && pa.versions.find(version => version.number === last.version)?.goals.find(goal => goal.id === last.goal);
  const status = pactStatus(pa, now);
  return <aside className="today-rail">
    <div className="scoreboard">
      <div className="board-top"><span className="eyebrow">Pact scoreboard</span><Flag size={17} aria-hidden="true" /></div>
      <button className="board-name" onClick={() => openPact(pa.id)}>{pactName(pa)}<ChevronRight size={17} /></button>
      <div className="board-people">
        <div><Avatar name={user.name} initials={initials(user.name)} /><span>You</span></div><span className="board-plus">+</span>
        <div><Avatar name={mate?.name || 'Open slot'} initials={mate ? initials(mate.name) : '?'} secondary /><span>{mate?.name.split(' ')[0] || 'Open slot'}</span></div>
      </div>
      {their.length ? <div className="board-progress"><div className="score-heading">{mate.name.split(' ')[0]}’s progress</div>{their.slice(0, 3).map(entry => <div key={entry.goal.id} className="friend-progress"><strong>{entry.goal.name}</strong><Progress entry={entry} flat /></div>)}</div>
        : <p className="board-status">{status === 'Invite a friend' ? 'One friend slot is open.' : status === 'Awaiting signatures' ? 'Review the match sheet together.' : status === 'Starts soon' ? 'Check-ins open on the start date.' : 'No partner check-ins on this date.'}</p>}
      {last && lastGoal && <div className="latest-log"><span className="status-dot" /> <span>{mate.name.split(' ')[0]} logged {lastGoal.name.toLowerCase()} <span className="mono">{localDay(last.at, pactZone(pa)) === today ? labelClock(localClock(last.at, pactZone(pa))) : labelDay(localDay(last.at, pactZone(pa)))}</span></span></div>}
      {mate && !demo && !pa.endedOn && <div className="board-actions"><Button kind="outline" icon={<Hand size={16} />} onClick={() => react(pa.id, 'cheer')}>Cheer</Button><Button kind="outline" icon={<BellRing size={16} />} onClick={() => react(pa.id, 'nudge')}>Nudge</Button></div>}
    </div>
    {pacts.length > 1 && <div className="other-pacts"><SectionTitle>Other pacts</SectionTitle>{pacts.filter(pact => pact.id !== pa.id).map(pact => <button key={pact.id} onClick={() => openPact(pact.id)}><span>{pactName(pact)}</span><ChevronRight size={17} /></button>)}</div>}
    {demo && <div className="next-checkpoint"><div className="eyebrow">This week</div><strong>Next checkpoint</strong><span>{labelDay(addDays(beginning, 6), { weekday: 'long', day: 'numeric', month: 'short' })}</span></div>}
  </aside>;
}
export default function Today({ user, pacts, now, log, demo, openPact, create, openCalendar, react, syncError, retry }) {
  const today = localDay(now, user.settings.zone);
  const ordered = [...pacts].sort((a, b) => (pactStatus(b, now) === 'Active') - (pactStatus(a, now) === 'Active'));
  const mine = ordered.filter(pact => !pact.endedOn).flatMap(pact => entriesFor([pact], localDay(now, pactZone(pact)), now).filter(entry => entry.goal.owner === user.id && entry.progress.window && entry.progress.state !== 'Excused'));
  const outstanding = mine.filter(entry => entry.progress.state !== 'Logged');
  const next = outstanding.find(entry => entry.progress.state !== 'Missed') || outstanding[0];
  const tasks = mine.length ? mine.filter(entry => entry.progress.state !== 'Missed') : [];
  const firstName = user.name.split(' ')[0];
  const pending = pacts.filter(pact => !pact.versions.length && !pact.endedOn);
  return <>
    <PageTitle label={labelDay(today, { weekday: 'long', day: 'numeric', month: 'long' })} title={<>Today<span className="title-period">.</span></>}
      action={<Button kind="outline" className="calendar-quick" onClick={openCalendar} right={<ArrowRight size={17} />}>Open calendar</Button>}>
      {pending.length && !mine.length ? 'Good to see you, ' + firstName + '. Pick up where you left off.' : 'Good to see you, ' + firstName + '.'}
    </PageTitle>
    {syncError && <div className="sync-banner"><span>{syncError}</span><Button kind="outline" onClick={retry}>Retry</Button></div>}
    <div className="today-grid">
      <div className="main-stack">
        {next ? <div className="next-move">
          <div className="lane-lines" aria-hidden="true"><i /><i /><i /><i /></div>
          <div className="hero-content"><div className="eyebrow"><ArrowDownRight size={17} aria-hidden="true" /> Your next move</div>
            <h2>{next.goal.name}</h2>
            <p>{next.goal.unit !== 'completion' && next.progress.amount < next.goal.target
              ? Math.round((next.goal.target - next.progress.amount) * 100) / 100 + ' ' + next.goal.unit + ' to go' + (next.goal.cadence === 'weekly' ? ' this week' : '')
              : next.progress.state === 'Missed' ? 'Review this check-in' : 'Your goal is ready to check in'}<span> · {pactName(next.pact)}</span></p>
            <Button kind="white" icon={<Plus size={18} />} onClick={() => demo ? openPact(next.pact.id) : log(next)}>{demo ? 'View sample pact' : next.progress.state === 'Missed' ? 'Review check-in' : 'Log check-in'}</Button>
          </div>
        </div> : !pending.length && !pacts.length ? <div className="next-move empty-move"><div className="lane-lines" aria-hidden="true"><i /><i /><i /><i /></div>
          <div className="hero-content"><div className="eyebrow"><Flag size={16} aria-hidden="true" /> Your next move</div><h2>Make a pact with a mate.</h2><p>Choose your own goals and check in as you go.</p><Button kind="white" icon={<Plus size={18} />} onClick={create}>Make a pact</Button></div></div>
          : pending.length ? <div className="next-move compact-move"><div className="lane-lines" aria-hidden="true"><i /><i /><i /><i /></div><div className="hero-content"><div className="eyebrow"><Flag size={16} aria-hidden="true" /> Set up your pact</div><h2>{pactName(pending[0])}</h2><p>{pending[0].members.length < 2 ? 'Invite a mate to your match sheet.' : 'Review your goals and sign together.'}</p><Button kind="white" right={<ArrowRight size={17} />} onClick={() => openPact(pending[0].id)}>Open match sheet</Button></div></div>
          : mine.length ? <div className="all-done"><CircleCheck size={27} /><div><h2>Check-ins complete.</h2><p>You’ve met your targets for today.</p></div></div> : null}
        <section className="today-list">
          <SectionTitle action={mine.length > 0 && <span className="section-count">{mine.filter(entry => entry.progress.state === 'Logged').length}/{mine.length} logged</span>}>Your check-ins</SectionTitle>
          {mine.length ? <div className="goal-list">{mine.map(entry => <GoalRow key={entry.pact.id + entry.goal.id} entry={entry} onPact={() => openPact(entry.pact.id)}
            action={demo ? null : <Button kind="outline" className="log-button" icon={<Plus size={15} />} onClick={() => log(entry)}>{entry.progress.state === 'Missed' ? 'Review' : 'Log'}</Button>} />)}</div>
            : <Empty icon={ClipboardList} title={pacts.length ? 'Nothing due today' : 'Your first check-in goes here'}>{pacts.length ? 'Check your calendar for upcoming sessions and deadlines.' : 'A goal will appear here once both friends sign the pact and its start date arrives.'}</Empty>}
        </section>
        {mine.length > 0 && <section className="today-progress"><SectionTitle action={<Forward onClick={openCalendar}>View schedule</Forward>}>In progress</SectionTitle>
          {(outstanding.length ? outstanding : tasks).slice(0, 3).map(entry => <div className="progress-row" key={entry.pact.id + entry.goal.id}><strong>{entry.goal.name}</strong><Progress entry={entry} /></div>)}
        </section>}
      </div>
      {ordered[0] && <Scoreboard pa={ordered[0]} pacts={ordered} user={user} now={now} demo={demo} openPact={openPact} react={react} />}
    </div>
  </>;
}
