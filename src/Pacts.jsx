import { useState } from 'react';
import { ArrowLeft, CheckCheck, ChevronRight, CircleAlert, ClipboardList, Flag, Link2, PenLine, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { labelClock, labelDay, localDay, WEEKDAYS } from '../shared/time.mjs';
import { cadenceText, targetText } from '../shared/scoring.mjs';
import { initials, pactName, pactStatus, partner } from './model.mjs';
import { Avatar, Button, CategoryIcon, Empty, IconButton, PageTitle, SectionTitle } from './ui.jsx';

const prettyDate = (at, zone) => new Date(at).toLocaleString('en-AU', { timeZone: zone, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const statusColor = status => status === 'Active' ? 'good' : ['Ended', 'Finished'].includes(status) ? 'muted' : 'pending';

export function PactList({ pacts, user, now, open, create, demo }) {
  return <>
    <PageTitle label="Your commitments" title={<>Pacts<span className="title-period">.</span></>} action={!demo && <Button icon={<Plus size={18} />} onClick={create}>Make a pact</Button>}>
      Your goals, your mate and the terms you agreed to.
    </PageTitle>
    {pacts.length ? <div className="pact-index">{pacts.map(pact => {
      const version = pact.versions.at(-1) || pact.draft;
      const mate = partner(pact, user.id);
      const status = pactStatus(pact, now);
      return <button key={pact.id} className="pact-index-row" onClick={() => open(pact.id)}>
        <span className="pact-icon"><Flag size={24} /></span>
        <span className="pact-list-main"><strong>{pactName(pact)}</strong><span>{version ? labelDay(version.terms.start) + ' – ' + labelDay(version.terms.end) + ' · ' : ''}{mate?.name ?? 'One open friend slot'}</span></span>
        <span className={'pact-status ' + statusColor(status)}>{status}</span><ChevronRight size={21} aria-hidden="true" />
      </button>;
    })}</div> : <Empty icon={Flag} title="Make your first pact" action={<Button onClick={create} icon={<Plus size={17} />}>Make a pact</Button>}>Invite one friend and set a goal each.</Empty>}
  </>;
}

function cadence(goal) {
  if (goal.cadence === 'scheduled') return goal.days.map(day => WEEKDAYS[day]).join(', ');
  if (goal.cadence === 'deadline') return 'Due ' + labelDay(goal.due) + ' at ' + labelClock(goal.dueTime);
  if (goal.dailyCheck) return 'Weekly total + daily check-ins';
  return cadenceText(goal);
}
function MemberSide({ member, version, mine, editable, editGoal, removeGoal }) {
  const goals = version.goals.filter(goal => goal.owner === member?.id);
  const time = member && version.signatures[member.id];
  const name = member?.name || 'Friend slot';
  return <section className="match-side">
    <div className="side-top"><Avatar name={name} initials={member ? initials(name) : '?'} secondary={!mine} /><div><div className="eyebrow">{mine ? 'YOU' : 'PACT PARTNER'}</div><h3>{name}</h3></div></div>
    <div className="match-goals">
      {goals.map(goal => <div className="match-goal" key={goal.id}>
        <CategoryIcon category={goal.category} small /><div><strong>{goal.name}</strong><small>{goal.focus}{goal.topic ? ' · ' + goal.topic : ''}</small>
          <p>{targetText(goal)} · {cadence(goal)}</p>
          {goal.counts && <small className="counts-label">Counts toward the checkpoint rule</small>}</div>
        {editable && mine && <div className="goal-edit"><IconButton title={'Edit ' + goal.name} onClick={() => editGoal(goal)}><PenLine size={15} /></IconButton><IconButton title={'Remove ' + goal.name} onClick={() => removeGoal(goal)}><Trash2 size={15} /></IconButton></div>}
      </div>)}
      {!goals.length && <p className="empty-side">{mine ? 'Your goals go on this side.' : member ? 'Waiting for ' + name.split(' ')[0] + ' to add a goal.' : 'Invite a mate to claim this side.'}</p>}
      {editable && mine && <Button kind="outline" onClick={() => editGoal()} icon={<Plus size={17} />}>Add goal</Button>}
    </div>
    <div className={'signature ' + (time ? 'signed' : '')}>{time ? <><div className="signed-stamp"><CheckCheck size={18} /> Signed</div><span>{prettyDate(time, version.terms.zone)}</span></> : <><span className="signature-line" /><span>{member ? 'Awaiting signature' : 'Open slot'}</span></>}</div>
  </section>;
}
function MatchTerms({ terms }) {
  return <div className="match-terms">
    <div><span>Dates</span><strong>{labelDay(terms.start)} – {labelDay(terms.end, { day: 'numeric', month: 'short', year: 'numeric' })}</strong></div>
    <div><span>Cutoff</span><strong>{labelClock(terms.cutoff)} · {terms.zone.replaceAll('_', ' ')}</strong><small>{terms.grace ? terms.grace + ' min grace' : 'No grace period'}</small></div>
    <div><span>Weekly checkpoint</span><strong>{terms.rule === 'target' ? 'Miss any counted target' : 'Miss ' + terms.missLimit + ' scheduled check-in days'}</strong><small>Sunday or the final day of this version. A partial week uses the same target.</small></div>
    <div><span>Forfeit</span><strong>{terms.forfeit || 'No forfeit'}</strong>{terms.forfeit && <small>Due within {terms.forfeitDays} {terms.forfeitDays === 1 ? 'day' : 'days'} of the checkpoint closing</small>}</div>
  </div>;
}
function RequestList({ pact, user, action, demo }) {
  const pending = pact.requests.filter(req => req.status === 'pending');
  if (!pending.length) return null;
  return <section className="detail-section"><SectionTitle>Requests</SectionTitle>{pending.map(req => {
    const member = pact.members.find(item => item.id === req.owner);
    const mine = req.owner === user.id;
    const version = pact.versions.find(ver => ver.number === req.entry?.version);
    const goal = version?.goals.find(goal => goal.id === req.entry?.goal);
    return <article className="result-row" key={req.id}><div>
      <strong>{req.type === 'excuse' ? 'Excuse days' : 'Log correction'} · {mine ? 'You' : member?.name}</strong>
      <p>{req.type === 'excuse' ? labelDay(req.first) + ' – ' + labelDay(req.last) + (req.reason ? ' · ' + req.reason : '')
        : (goal?.name ?? 'Goal') + ' · ' + labelDay(req.entry.day) + ' · ' + (req.entry.deleted ? 'Remove log' : req.entry.amount + ' ' + (goal?.unit ?? ''))}</p>
      {req.entry?.note && <p>{req.entry.note}</p>}
    </div>{mine ? <span className="pact-status pending">Awaiting approval</span> : !demo && <div className="quick-actions">
      <Button kind="outline" onClick={() => action('decision', { id: req.id, decision: 'declined' }, 'Request declined.')}>Decline</Button>
      <Button onClick={() => action('decision', { id: req.id, decision: 'approved' }, 'Request approved.')}>Approve</Button>
    </div>}</article>;
  })}</section>;
}
function Checkpoints({ pact, user, action, modal, demo, now }) {
  const [showAll, setAll] = useState(false);
  const outcomes = [...pact.outcomes].sort((a, b) => b.day.localeCompare(a.day));
  if (!pact.versions.length) return null;
  return <section className="detail-section"><SectionTitle>Checkpoint results</SectionTitle>
    {outcomes.length === 0 ? <Empty icon={ClipboardList} title="No closed checkpoints yet">The app settles each result after the pact’s cutoff and grace period.</Empty>
      : (showAll ? outcomes : outcomes.slice(0, 4)).map(result => {
        const mine = user.id === result.owner;
        const active = result.forfeit && !pact.endedOn && !['void', 'waived', 'confirmed'].includes(result.status);
        const theirName = pact.members.find(member => member.id === result.owner)?.name;
        const zone = pact.versions.find(ver => ver.number === result.version).terms.zone;
        const overdue = active && result.due < localDay(now, zone);
        const badges = { triggered: 'Triggered', done: 'Marked done', flagged: 'Flagged for review', waived: 'Waived', confirmed: 'Confirmed', void: 'Revised' };
        const title = result.forfeit ? (overdue && result.status === 'triggered' ? 'Overdue' : badges[result.status]) : result.reasons.length ? 'Target missed' : 'Met';
        return <article className="result-row outcome" key={result.id}>
          <div><div className="eyebrow">{labelDay(result.day)} · {mine ? 'You' : theirName}</div><strong>{result.forfeit || (result.reasons.length ? 'Missed checkpoint' : 'Checkpoint met')}</strong>
            {result.reasons.length > 0 && <p>{result.reasons.join(' · ')}</p>}
            {result.due && <small>Due {labelDay(result.due)} · {zone.replaceAll('_', ' ')}</small>}
            {result.flag && <small>Review note · {result.flag}</small>}
            {result.waiverBy.length === 1 && <small>{result.waiverBy.includes(user.id) ? 'Waiver sent to your friend' : 'Your friend requested a waiver'}</small>}
          </div><span className={'pact-status ' + (active || result.reasons.length ? 'pending' : 'good')}>{title}</span>
          {active && !demo && <div className="quick-actions outcome-actions">
            {mine && ['triggered', 'flagged'].includes(result.status) && <Button onClick={() => action('forfeit', { id: result.id, mode: 'done' }, 'Forfeit marked done.')}>Mark done</Button>}
            {!mine && result.status === 'done' && <Button onClick={() => action('forfeit', { id: result.id, mode: 'confirm' }, 'Forfeit confirmed.')}>Confirm</Button>}
            {!result.waiverBy.includes(user.id) && <Button kind="outline" onClick={() => action('forfeit', { id: result.id, mode: 'waive' }, 'Waiver vote saved.')}>{result.waiverBy.length ? 'Agree to waive' : 'Request waiver'}</Button>}
          </div>}
          {!demo && !pact.endedOn && !result.flagBy && <Button kind="outline" onClick={() => modal('flag', result)}>Flag result</Button>}
        </article>;
      })}
    {outcomes.length > 4 && <Button kind="outline" onClick={() => setAll(!showAll)}>{showAll ? 'Show fewer' : 'View all results'}</Button>}
  </section>;
}
export function PactDetail({ pact, user, now, demo, goBack, modal, action }) {
  const [selected, setSelected] = useState('latest');
  const versions = pact.versions;
  const draft = pact.draft;
  const version = selected === 'latest' ? draft ?? versions.at(-1) : versions.find(item => item.number === selected) ?? draft;
  const isDraft = draft === version && Boolean(version);
  const canEdit = isDraft && !demo && !pact.endedOn;
  const mate = partner(pact, user.id);
  const status = pactStatus(pact, now);
  const ready = pact.members.length === 2 && pact.members.every(member => draft?.goals.some(goal => goal.owner === member.id));
  const signedByMe = Boolean(draft?.signatures[user.id]);
  const firstName = mate?.name.split(' ')[0];
  const versionLabel = version ? 'VERSION ' + version.number + (isDraft ? ' · DRAFT' : ' · SIGNED') : null;
  const incoming = pact.signals.filter(signal => signal.to === user.id).slice(-3).reverse();
  return <>
    <button className="back-link" onClick={goBack}><ArrowLeft size={17} /> All pacts</button>
    <PageTitle label="The match sheet" title={<>{pactName(pact)}<span className="title-period">.</span></>}
      action={<span className={'pact-status page-status ' + statusColor(status)}>{status}</span>}>
      {mate ? 'A pact between you and ' + firstName + '.' : 'Set your goals, then invite one mate.'}
    </PageTitle>
    {!version && <Empty icon={Flag} title="This pact ended before it was signed">The audit history is below.</Empty>}
    {version && <section className="match-sheet" aria-label="Match sheet">
      <header className="match-top"><div><span className="eyebrow">{versionLabel}</span><h2>{version.terms.name}</h2></div>
        <div className="match-top-actions">
          {!mate && !demo && !pact.endedOn && <Button kind="white" icon={<Link2 size={17} />} onClick={() => modal('invite')}>Invite a friend</Button>}
          {canEdit && <Button kind="match-outline" icon={<PenLine size={16} />} onClick={() => modal('terms')}>Edit terms</Button>}
        </div>
      </header>
      {(versions.length > 1 || (versions.length && draft)) && <div className="version-select"><label>View match sheet <select value={selected} onChange={event => setSelected(event.target.value === 'latest' ? 'latest' : Number(event.target.value))}>
        <option value="latest">{draft ? 'Current draft' : 'Latest signed version'}</option>
        {[...versions].reverse().filter(item => item !== (!draft && versions.at(-1))).map(item => <option key={item.number} value={item.number}>Signed version {item.number}</option>)}</select></label></div>}
      {isDraft && <div className="match-changes"><CircleAlert size={16} aria-hidden="true" />{version.change} {Object.keys(version.signatures).length === 0 && version.revision > 1 ? 'Both friends review this draft before signing.' : ''}</div>}
      <div className="match-sides">
        <MemberSide member={pact.members.find(member => member.id === user.id)} version={version} mine editable={canEdit} editGoal={goal => modal('goal', goal)} removeGoal={goal => modal('removeGoal', goal)} />
        <MemberSide member={mate} version={version} editable={canEdit} />
      </div>
      <MatchTerms terms={version.terms} />
      <footer className="match-footer">
        {canEdit ? <><div><strong>{signedByMe ? 'Signed by you. Waiting for ' + firstName + '.' : ready ? 'Ready to sign' : 'Both friends need a goal.'}</strong>
          <span>{signedByMe ? 'The start date applies once both signatures are in.' : 'Read the goals and terms before signing.'}</span></div>
          <Button disabled={!ready || signedByMe} icon={<PenLine size={17} />} onClick={() => modal('sign')}>Sign pact</Button></>
          : <><div className="sealed"><ShieldCheck size={23} /><div><strong>Both signatures on file</strong><span>Effective {labelDay(version.terms.start, { weekday: 'long', day: 'numeric', month: 'short' })}</span></div></div>
            {!demo && !draft && !pact.endedOn && <Button kind="outline" onClick={() => action('revision', {}, 'New draft opened.')}>Propose a revision</Button>}</>}
      </footer>
    </section>}
    {!demo && !pact.endedOn && <div className="pact-options">
      {versions.length > 0 && <Button kind="outline" onClick={() => modal('excuse')}>Request excused days</Button>}
      {versions.length > 0 && draft && <Button kind="outline" onClick={() => modal('discardRevision')}>Discard draft</Button>}
      <Button kind="danger" onClick={() => modal('leave')}>Leave pact</Button>
    </div>}
    {incoming.length > 0 && <section className="detail-section"><SectionTitle>From {firstName}</SectionTitle>{incoming.map(signal => <div className="signal-row" key={signal.id}><span>{signal.type === 'cheer' ? 'Sent you a cheer.' : 'Sent you a nudge to check in.'}</span><time>{prettyDate(signal.at, version?.terms.zone || user.settings.zone)}</time></div>)}</section>}
    <RequestList pact={pact} user={user} action={action} demo={demo || Boolean(pact.endedOn)} />
    <Checkpoints pact={pact} user={user} action={action} modal={modal} demo={demo} now={now} />
    {pact.history.length > 0 && <details className="history detail-section"><summary>View pact history</summary>
      {[...pact.history].reverse().map(event => <p key={event.id}><span>{prettyDate(event.at, version?.terms.zone || user.settings.zone)}</span><strong>{event.description}</strong></p>)}
    </details>}
  </>;
}
