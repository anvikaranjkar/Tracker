import { useState } from 'react';
import { ArrowLeft, Check, ChevronRight, ClipboardList, Flag, Link2, PenLine, Plus, Trash2 } from 'lucide-react';
import { labelClock, labelDay, localDay, WEEKDAYS } from '../shared/time.mjs';
import { cadenceText, isExcused, periodEnd, targetText, versionAt, windowFor } from '../shared/scoring.mjs';
import { initials, pactName, pactStatus } from './model.mjs';
import { Avatar, Button, CategoryIcon, Empty, IconButton, PageTitle, SectionTitle } from './ui.jsx';

const prettyDate = (at, zone) => new Date(at).toLocaleString('en-AU', { timeZone: zone, day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' });
const statusColor = status => status === 'Active' ? 'good' : ['Ended', 'Finished'].includes(status) ? 'muted' : 'pending';

export function PactList({ pacts, now, open, create, demo }) {
  return <>
    <PageTitle title={<>Pacts<span className="title-period">.</span></>} action={!demo && <Button icon={<Plus size={18} />} onClick={create}>Create a pact</Button>} />
    {pacts.length ? <div className="pact-index">{pacts.map(pact => {
      const version = pact.versions.at(-1) || pact.draft;
      const status = pactStatus(pact, now);
      return <button key={pact.id} className="pact-index-row" onClick={() => open(pact.id)}>
        <span className="pact-icon"><Flag size={24} /></span>
        <span className="pact-list-main"><strong>{pactName(pact)}</strong><span>{version ? labelDay(version.terms.start) + ' – ' + labelDay(version.terms.end) + ' · ' : ''}{pact.members.length} {pact.members.length === 1 ? 'member' : 'members'}</span></span>
        <span className={'pact-status ' + statusColor(status)}>{status}</span><ChevronRight size={21} aria-hidden="true" />
      </button>;
    })}</div> : <Empty icon={Flag} title="Start your first group pact" action={<Button onClick={create} icon={<Plus size={17} />}>Create a pact</Button>}>Share a group invite and set a goal each.</Empty>}
  </>;
}

function cadence(goal) {
  if (goal.cadence === 'scheduled') return goal.days.map(day => WEEKDAYS[day]).join(', ');
  if (goal.cadence === 'deadline') return 'Due ' + labelDay(goal.due) + ' at ' + labelClock(goal.dueTime);
  if (goal.dailyCheck) return 'Weekly total + daily check-ins';
  return cadenceText(goal);
}
function PersonalGoal({ user, version, editable, dailyCheckIns, editGoal, removeGoal }) {
  const goals = version.goals.filter(goal => goal.owner === user.id);
  const canAdd = editable && (!dailyCheckIns || !goals.length);
  return <section className="personal-goal">
    <SectionTitle action={canAdd && <Button kind="outline" onClick={() => editGoal()} icon={<Plus size={17} />}>Add goal</Button>}>Your goal{goals.length > 1 ? 's' : ''}</SectionTitle>
    {goals.map(goal => <div className="match-goal" key={goal.id}>
      <CategoryIcon category={goal.category} small />
      <div><strong>{goal.name}</strong><small>{goal.focus}{goal.topic ? ' · ' + goal.topic : ''}</small>
        <p>{targetText(goal)} · {cadence(goal)}</p></div>
      {editable && <div className="goal-edit">
        <IconButton title={'Edit ' + goal.name} onClick={() => editGoal(goal)}><PenLine size={17} /></IconButton>
        <IconButton title={'Remove ' + goal.name} onClick={() => removeGoal(goal)}><Trash2 size={17} /></IconButton>
      </div>}
    </div>)}
    {!goals.length && <p className="field-note">{editable ? 'Add the goal you’ll check in on.' : 'You had no goal in this version.'}</p>}
  </section>;
}

function MemberRoster({ pact, user, version, now, historical }) {
  const [showAll, setShowAll] = useState(false);
  const day = version ? localDay(now, version.terms.zone) : null;
  const active = day && !pact.endedOn ? versionAt(pact, day) : null;
  const todayGoals = new Set(active?.goals.filter(goal => windowFor(active, goal, day, periodEnd(pact, active))
    && !isExcused(pact, goal.owner, day)).map(goal => goal.owner));
  const checked = new Set(pact.logs.filter(log => log.version === active?.number && log.day === day && !log.deleted).map(log => log.owner));
  const members = historical ? pact.members.filter(member => version.signatures[member.id]) : pact.members;
  const listed = showAll ? members : members.slice(0, 8);
  return <section className="detail-section roster">
    <SectionTitle action={<span className="section-count">{members.length} {members.length === 1 ? 'member' : 'members'}</span>}>Group members</SectionTitle>
    <ul className="member-list">{listed.map(member => {
      const goals = version?.goals.filter(goal => goal.owner === member.id) ?? [];
      const signedAt = version?.signatures[member.id];
      const status = !signedAt ? 'Awaiting signature' : !historical && todayGoals.has(member.id) ? checked.has(member.id) ? 'Checked in' : 'Due today' : 'Signed';
      return <li className="member-row" key={member.id}>
        <Avatar name={member.name} initials={initials(member.name)} />
        <div><strong>{member.name}{member.id === user.id ? ' (you)' : ''}</strong>
          <span>{[member.id === pact.owner && 'Organiser', ...goals.map(goal => goal.name + ' · ' + targetText(goal))].filter(Boolean).join(' · ') || 'Setting up a goal'}</span></div>
        <span className={'member-status' + (status === 'Checked in' ? ' checked' : '')}>
          {status === 'Checked in' && <Check size={15} aria-hidden="true" />}{status}
        </span>
      </li>;
    })}</ul>
    {members.length > 8 && <Button kind="outline" aria-expanded={showAll} onClick={() => setShowAll(!showAll)}>
      {showAll ? 'Show fewer members' : 'Show all ' + members.length + ' members'}
    </Button>}
  </section>;
}
function AgreementTerms({ terms }) {
  return <div className="agreement-terms">
    <div><span>Dates</span><strong>{labelDay(terms.start)} – {labelDay(terms.end, { day: 'numeric', month: 'short', year: 'numeric' })}</strong></div>
    <div><span>Cutoff</span><strong>{labelClock(terms.cutoff)} · {terms.zone.replaceAll('_', ' ')}</strong><small>{terms.grace ? terms.grace + ' min grace' : 'No grace period'}</small></div>
    <div><span>Weekly checkpoint</span><strong>{terms.rule === 'target' ? 'Miss any counted target' : 'Miss ' + terms.missLimit + ' check-in days'}</strong><small>Sunday or the final day of this version. A partial week uses the full target.</small></div>
    <div><span>Forfeit</span><strong>{terms.forfeit || 'None agreed'}</strong>{terms.forfeit && <small>Due within {terms.forfeitDays} {terms.forfeitDays === 1 ? 'day' : 'days'} of the checkpoint closing</small>}</div>
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
    const canReview = (version ?? pact.versions.at(-1))?.signatures[user.id];
    return <article className="result-row" key={req.id}><div>
      <strong>{req.type === 'excuse' ? 'Excuse days' : 'Log correction'} · {mine ? 'You' : member?.name}</strong>
      <p>{req.type === 'excuse' ? labelDay(req.first) + ' – ' + labelDay(req.last) + (req.reason ? ' · ' + req.reason : '')
        : (goal?.name ?? 'Goal') + ' · ' + labelDay(req.entry.day) + ' · ' + (req.entry.deleted ? 'Remove log' : req.entry.amount + ' ' + (goal?.unit ?? ''))}</p>
      {req.entry?.note && <p>{req.entry.note}</p>}
    </div>{mine ? <span className="pact-status pending">Awaiting approval</span> : !demo && canReview && <div className="quick-actions">
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
        const version = pact.versions.find(ver => ver.number === result.version);
        const canReview = version?.signatures[user.id];
        const zone = version.terms.zone;
        const overdue = active && result.due < localDay(now, zone);
        const badges = { triggered: 'Triggered', done: 'Marked done', flagged: 'Flagged for review', waived: 'Waived', confirmed: 'Confirmed', void: 'Revised' };
        const title = result.forfeit ? (overdue && result.status === 'triggered' ? 'Overdue' : badges[result.status]) : result.reasons.length ? 'Target missed' : 'Met';
        return <article className="result-row outcome" key={result.id}>
          <div><div className="eyebrow">{labelDay(result.day)} · {mine ? 'You' : theirName}</div><strong>{result.forfeit || (result.reasons.length ? 'Missed checkpoint' : 'Checkpoint met')}</strong>
            {result.reasons.length > 0 && <p>{result.reasons.join(' · ')}</p>}
            {result.due && <small>Due {labelDay(result.due)} · {zone.replaceAll('_', ' ')}</small>}
            {result.flag && <small>Review note · {result.flag}</small>}
            {result.waiverBy.length === 1 && <small>{result.waiverBy.includes(user.id) ? 'Waiting for another member to agree' : 'Waiver requested'}</small>}
          </div><span className={'pact-status ' + (active || result.reasons.length ? 'pending' : 'good')}>{title}</span>
          {active && !demo && canReview && <div className="quick-actions outcome-actions">
            {mine && ['triggered', 'flagged'].includes(result.status) && <Button onClick={() => action('forfeit', { id: result.id, mode: 'done' }, 'Forfeit marked done.')}>Mark done</Button>}
            {!mine && result.status === 'done' && <Button onClick={() => action('forfeit', { id: result.id, mode: 'confirm' }, 'Forfeit confirmed.')}>Confirm</Button>}
            {(mine || result.waiverBy.includes(result.owner)) && !result.waiverBy.includes(user.id) && <Button kind="outline" onClick={() => action('forfeit', { id: result.id, mode: 'waive' }, 'Waiver vote saved.')}>{result.waiverBy.length ? 'Agree to waive' : 'Request waiver'}</Button>}
          </div>}
          {!demo && canReview && !pact.endedOn && !result.flagBy && <Button kind="outline" onClick={() => modal('flag', result)}>Flag result</Button>}
        </article>;
      })}
    {outcomes.length > 4 && <Button kind="outline" onClick={() => setAll(!showAll)}>{showAll ? 'Show fewer' : 'View all results'}</Button>}
  </section>;
}
export function PactDetail({ pact, user, now, demo, goBack, modal, action }) {
  const [selected, setSelected] = useState('latest');
  const { versions, draft } = pact;
  const published = versions.at(-1);
  const version = selected === 'latest' ? draft ?? published : versions.find(item => item.number === selected) ?? draft ?? published;
  const isDraft = Boolean(draft && version === draft);
  const historical = version !== (draft ?? published);
  const status = pactStatus(pact, now);
  const open = !demo && !pact.endedOn;
  const organiser = user.id === pact.owner;
  const canInvite = open && organiser && pact.members.length < 50 && status !== 'Finished';
  const enrol = open && selected === 'latest' && !draft && published && !published.signatures[user.id] && status !== 'Finished';
  const canEdit = open && (isDraft || enrol);
  const editableVersion = enrol ? { ...published, enrolVersion: published.number, goals: pact.pendingGoals ?? [] } : version;
  const canSign = editableVersion?.goals.some(goal => goal.owner === user.id && (!editableVersion.terms.forfeit || goal.counts));
  const signedByMe = Boolean(editableVersion?.signatures[user.id]);
  const remaining = published && draft
    ? Object.keys(published.signatures).filter(id => !draft.signatures[id]).length : 0;
  const edit = (kind, value) => modal(kind, value, editableVersion);
  const signedMessage = isDraft
    ? published ? remaining + (remaining === 1 ? ' signature needed' : ' signatures needed') : 'Waiting for the organiser'
    : 'Signed';
  return <>
    <button className="back-link" onClick={goBack}><ArrowLeft size={17} aria-hidden="true" /> All pacts</button>
    <PageTitle title={<>{pactName(pact)}<span className="title-period">.</span></>} action={<span className={'pact-status page-status ' + statusColor(status)}>{status}</span>}>
      {pact.members.length} {pact.members.length === 1 ? 'member' : 'members'}
    </PageTitle>
    {!version && <Empty icon={Flag} title="This pact ended in draft">You can still view its history below.</Empty>}
    {version && <section className="group-agreement" aria-label="Group agreement">
      <header className="agreement-top">
        <div><h2>Agreement</h2><span>Version {version.number} · {isDraft ? 'Draft' : 'Published'}</span></div>
        <div className="agreement-actions">
          {canInvite && <Button kind="outline" icon={<Link2 size={17} />} onClick={() => modal('invite')}>Invite members</Button>}
          {open && organiser && isDraft && <Button kind="outline" icon={<PenLine size={16} />} onClick={() => edit('terms')}>Edit terms</Button>}
        </div>
      </header>
      {(versions.length > 1 || (published && draft)) && <div className="version-select"><label>View version
        <select value={selected} onChange={event => setSelected(event.target.value === 'latest' ? 'latest' : Number(event.target.value))}>
          <option value="latest">{draft ? 'Current draft' : 'Latest signed version'}</option>
          {[...versions].reverse().filter(item => draft || item !== published).map(item => <option key={item.number} value={item.number}>Signed version {item.number}</option>)}
        </select></label></div>}
      <AgreementTerms terms={version.terms} />
      <PersonalGoal user={user} version={editableVersion} editable={canEdit} dailyCheckIns={pact.dailyCheckIns}
        editGoal={goal => edit('goal', goal)} removeGoal={goal => edit('removeGoal', goal)} />
      {canEdit && <div className="agreement-footer">
        <div><strong>{signedByMe ? signedMessage : canSign ? 'Ready to sign' : 'Add your goal to sign'}</strong>
          <span>{enrol ? 'Your check-ins start when you sign, or on the start date if it’s later.'
            : published ? 'The revision takes effect once everyone already signed up has signed it.'
            : 'The organiser publishes the pact by signing. Members can sign as they join.'}</span></div>
        <Button disabled={!canSign || signedByMe} icon={<PenLine size={17} />} onClick={() => edit('sign')}>Sign pact</Button>
      </div>}
      {open && organiser && !draft && !historical && <div className="agreement-footer">
        <div><strong>{status === 'Finished' ? 'Check-ins have closed' : 'Terms are published'}</strong>
          <span>{status === 'Finished' ? labelDay(published.terms.end) : 'You can propose changes for future check-ins.'}</span></div>
        {status !== 'Finished' && <Button kind="outline" onClick={() => action('revision', {}, 'Revision opened.')}>Propose revision</Button>}
      </div>}
    </section>}
    <MemberRoster pact={pact} user={user} version={version} now={now} historical={historical} />
    {open && <div className="pact-options">
      {published?.signatures[user.id] && status !== 'Finished' && <Button kind="outline" onClick={() => modal('excuse')}>Request excused days</Button>}
      {organiser && published && draft && <Button kind="outline" onClick={() => modal('discardRevision', undefined, draft)}>Discard revision</Button>}
      {organiser && <Button kind="danger" onClick={() => modal('endPact')}>End pact</Button>}
    </div>}
    <RequestList pact={pact} user={user} action={action} demo={!open} />
    <Checkpoints pact={pact} user={user} action={action} modal={modal} demo={demo} now={now} />
    {pact.history.length > 0 && <details className="history detail-section"><summary>View pact history</summary>
      {[...pact.history].reverse().map(event => <p key={event.id}><span>{prettyDate(event.at, version?.terms.zone || user.settings.zone)}</span><strong>{event.description}</strong></p>)}
    </details>}
  </>;
}
