import { cloneElement, useEffect, useId, useRef, useState } from 'react';
import { ArrowRight, Check, ClipboardCopy, Link2, Shuffle, Star } from 'lucide-react';
import { addDays, browserZone, labelDay, localDay, WEEKDAYS } from '../shared/time.mjs';
import { checkinCutoff, targetText } from '../shared/scoring.mjs';
import { defaultTerms, pactName } from './model.mjs';
import { Button, CategoryIcon, ErrorNote, FieldHelp, Modal } from './ui.jsx';

function Field({ label, help, hint, children }) {
  const id = useId();
  const hintId = id + '-hint';
  return <div className="field">
    <div className="field-head"><label htmlFor={id}>{label}</label>{help && <FieldHelp label={label}>{help}</FieldHelp>}</div>
    {cloneElement(children, { id, 'aria-describedby': hint ? hintId : undefined })}
    {hint && <small id={hintId}>{hint}</small>}
  </div>;
}
const CheckField = ({ children, ...props }) => <label className="check-field"><input type="checkbox" {...props} /><span>{children}</span></label>;
const patch = set => (key, value) => set(previous => ({ ...previous, [key]: value }));
const formError = error => error.message || 'Try again in a moment.';
const FITNESS = ['Workout consistency', 'Cutting / shredding', 'Bulking / muscle gain', 'Strength', 'Muscle group', 'Cardio', 'Mobility', 'Recovery', 'Other'];
const UNITS = { Fitness: ['sessions', 'min', 'sets', 'reps', 'km', 'completion'], Study: ['min', 'sessions', 'questions', 'pages', 'papers', 'tasks', 'completion'], Custom: ['min', 'sessions', 'pages', 'completion'] };
const OPTIONS = [['daily', 'Every day'], ['scheduled', 'Specific days'], ['weekly', 'Weekly total'], ['deadline', 'One-off deadline']];
const FORFEITS = [
  'Buy another member a Slushie.',
  'Treat another member to a small Yo-Chi.',
  'Give another member $5.',
  'Play an agreed prank by changing the group chat name for a day.',
  'Bring the snacks to the next group catch-up.',
  'Buy another member their coffee or hot chocolate.',
  'Make a five-song playlist for the group.',
  'Bring another member their favourite chocolate.',
  'Write a very formal thank-you note to another member.',
  'Let the group choose your background for the next video call.'
];

function useSubmit(callback) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const running = useRef(false);
  const run = async value => {
    if (running.current) return;
    running.current = true;
    setBusy(true);
    setError('');
    try { await callback(value); } catch (error) { setError(formError(error)); }
    finally { running.current = false; setBusy(false); }
  };
  return { busy, error, run, setError };
}

export function TermsDialog({ draft, dailyCheckIns = true, now, close, save }) {
  const [form, setForm] = useState(() => draft ? { ...draft.terms } : defaultTerms(now));
  const [suggestion, setSuggestion] = useState('');
  const forfeitInput = useRef(null);
  const zonesId = useId();
  const set = patch(setForm);
  const create = !draft;
  const { busy, error, run } = useSubmit(save);
  function randomise() {
    const choices = FORFEITS.filter(value => value !== suggestion && value !== form.forfeit.trim());
    const value = choices[Math.floor(Math.random() * choices.length)];
    setSuggestion(value);
    set('forfeit', value);
  }
  return <Modal title={create ? 'Create a group pact' : 'Edit group terms'} label={draft ? 'Version ' + draft.number + ' draft' : null} close={() => !busy && close()} wide>
    <form onSubmit={event => { event.preventDefault(); run(form); }} className="form">
      <Field label="Pact name" help="Members see this name in their invite, on Today and in the calendar."><input data-first required minLength={2} maxLength={60} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. The Sunday reset" /></Field>
      <div className="form-grid">
        <Field label={draft?.number > 1 ? 'Effective from' : 'Start date'} help={draft?.number > 1
          ? 'The first date these revised terms can apply once the group has signed.'
          : 'The first day the group can check in once the agreement is published. Members who sign later start when they sign.'}>
          <input type="date" required value={form.start} onChange={e => {
          const start = e.target.value;
          setForm(old => ({ ...old, start, end: create && start && (!old.end || old.end === addDays(old.start || start, 27) || old.end < start) ? addDays(start, 27) : old.end }));
        }} /></Field>
        <Field label="End date" help="The last day for check-ins. The final checkpoint runs after this day’s cutoff and grace period.">
          <input type="date" min={form.start} max={form.start ? addDays(form.start, 180) : undefined} required value={form.end} onChange={e => set('end', e.target.value)} /></Field>
        <Field label="Cutoff time" help="The usual daily deadline in the pact’s time zone. Check-ins during the grace period still count and are marked late.">
          <input type="time" value={form.cutoff} required onChange={e => set('cutoff', e.target.value)} /></Field>
        <Field label="Pact time zone" help="Use one shared time zone so every member sees the same dates, cutoffs and checkpoints.">
          <input list={zonesId} required value={form.zone} disabled={draft?.number > 1} onChange={e => set('zone', e.target.value)} autoCapitalize="none" spellCheck={false} /></Field>
        <Field label="Grace period" help="Extra time to save a check-in after the cutoff. Choose None to close check-ins at the cutoff.">
          <select value={form.grace} onChange={e => set('grace', Number(e.target.value))}>{[[0, 'None'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [720, '12 hours'], [1440, '24 hours']].map(([n, text]) => <option key={n} value={n}>{text}</option>)}</select></Field>
        <Field label="Weekly checkpoint rule" help="Miss an agreed target looks at each member’s goal. Miss check-in days looks at how often they checked in, even with zero progress. The app reviews this each Sunday and on the final day.">
          <select value={form.rule} onChange={e => set('rule', e.target.value)}><option value="checkins">Miss check-in days</option><option value="target">Miss an agreed target</option></select></Field>
      </div>
      <datalist id={zonesId}>{[...new Set([browserZone(), 'Australia/Sydney', ...(Intl.supportedValuesOf?.('timeZone') ?? [])])].map(zone => <option key={zone} value={zone} />)}</datalist>
      {form.rule === 'checkins' && <Field label="Missed days before a forfeit" help="For example, 2 means a member owes the forfeit after missing at least two check-in days within a checkpoint.">
        <input type="number" inputMode="numeric" value={form.missLimit} min="1" max="7" required onChange={e => set('missLimit', e.target.value)} /></Field>}
      <fieldset className="forfeit-fields">
        <legend>Forfeit</legend>
        <div className="forfeit-options">
          <div className="forfeit-option"><Button kind="outline" onClick={() => forfeitInput.current.focus()}>Write your own</Button>
            <FieldHelp label="Write your own">Enter an agreed forfeit in your own words. Every member sees it before they sign.</FieldHelp></div>
          <div className="forfeit-option"><Button kind="tint" icon={<Shuffle size={15} aria-hidden="true" />} onClick={randomise}>Randomise</Button>
            <FieldHelp label="Randomise">Fills the forfeit box with a new idea. Edit it to suit your group, or tap again for another suggestion.</FieldHelp></div>
        </div>
        <Field label="Agreed forfeit" help="This is what a member agrees to do if they miss the weekly checkpoint rule. Keep it small and agreed.">
          <textarea ref={forfeitInput} required={dailyCheckIns} rows={2} maxLength={140} value={form.forfeit}
            placeholder="e.g. Buy another member a Slushie." onChange={e => set('forfeit', e.target.value)} /></Field>
        <span className="sr-only" role="status">{suggestion && 'Suggested forfeit. ' + suggestion}</span>
        <Field label="Days to finish the forfeit" help="How many calendar days a member has to do the agreed forfeit after the checkpoint closes.">
          <input type="number" inputMode="numeric" min="1" max="30" required value={form.forfeitDays} onChange={e => set('forfeitDays', e.target.value)} /></Field>
      </fieldset>
      <ErrorNote error={error} />
      <footer className="form-actions"><Button kind="outline" onClick={close} disabled={busy}>Cancel</Button><Button type="submit" busy={busy} right={<ArrowRight size={17} />}>{create ? 'Create pact' : 'Save terms'}</Button></footer>
    </form>
  </Modal>;
}

export function GoalDialog({ goal, draft, dailyCheckIns, close, save }) {
  const [form, setForm] = useState(() => goal ? { ...goal } : { category: 'Custom', focus: 'Habit', topic: '', name: '', unit: 'completion', target: '1', cadence: 'daily', days: [], due: draft.terms.end, dueTime: draft.terms.cutoff, dailyCheck: Boolean(dailyCheckIns), counts: true });
  const [customUnit, setCustomUnit] = useState(goal ? !UNITS[goal.category].includes(goal.unit) : false);
  const set = patch(setForm);
  const { busy, error, run } = useSubmit(save);
  const schedules = dailyCheckIns ? OPTIONS.filter(([value]) => ['daily', 'weekly'].includes(value)) : OPTIONS;
  return <Modal title={goal ? 'Edit your goal' : 'Add your goal'} close={() => !busy && close()} wide>
    <form className="form" onSubmit={event => { event.preventDefault(); run(form); }}>
      <Field label="Goal name" help="Describe the goal you want the group to see.">
        <input data-first required minLength={2} maxLength={70} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. Read before bed" /></Field>
      <div className="form-grid">
        <Field label="Category" help="Pick the best fit for your goal. This also suggests units for measuring it.">
          <select value={form.category} onChange={event => {
          const category = event.target.value;
          setCustomUnit(false);
          setForm(old => ({ ...old, category, focus: category === 'Fitness' ? FITNESS[0] : category === 'Custom' ? 'Habit' : '', unit: UNITS[category][0], target: '1' }));
        }}>{Object.keys(UNITS).map(category => <option key={category}>{category}</option>)}</select></Field>
        {form.category === 'Fitness' ? <Field label="Fitness focus" help="Choose which part of your training this goal is about.">
          <select value={form.focus} onChange={e => set('focus', e.target.value)}>{FITNESS.map(item => <option key={item}>{item}</option>)}</select></Field>
          : <Field label={form.category === 'Study' ? 'Subject' : 'Focus'} help="A short label for what you’re working on.">
            <input required maxLength={48} value={form.focus} onChange={e => set('focus', e.target.value)} placeholder={form.category === 'Study' ? 'e.g. Chemistry' : 'e.g. Reading'} /></Field>}
        <Field label="Measure" help="Choose Done / not done for a yes-or-no goal, or record a number such as minutes or pages.">
          <select value={customUnit ? 'other-unit' : form.unit} onChange={e => { setCustomUnit(e.target.value === 'other-unit'); set('unit', e.target.value === 'other-unit' ? '' : e.target.value); }}>
            {UNITS[form.category].map(unit => <option key={unit} value={unit}>{unit === 'min' ? 'Minutes' : unit === 'completion' ? 'Done / not done' : unit}</option>)}
            <option value="other-unit">Custom unit</option></select></Field>
        {customUnit && <Field label="Custom unit" help="Enter a short unit you can count.">
          <input maxLength={20} required value={form.unit} onChange={e => set('unit', e.target.value)} placeholder="e.g. kilometres" /></Field>}
        {form.unit !== 'completion' && <Field label="Target" help="The amount you aim to reach each day or week, depending on the schedule below.">
          <input type="number" inputMode="decimal" step=".01" min=".01" max="100000" required value={form.target} onChange={e => set('target', e.target.value)} /></Field>}
        <Field label="Target schedule" help={dailyCheckIns ? 'Check in once each day, even if you did zero. Choose whether your target resets each day or adds up across the week.' : 'Choose how often the target repeats, which days it applies to, or a single deadline.'}>
          <select value={form.cadence} onChange={e => setForm(old => ({ ...old, cadence: e.target.value, due: old.due || draft.terms.end, dueTime: old.dueTime || draft.terms.cutoff }))}>
            {schedules.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
      </div>
      {form.cadence === 'scheduled' && <fieldset className="day-select"><legend>Scheduled days</legend>{WEEKDAYS.map((day, index) => <label key={day}>
        <input type="checkbox" checked={form.days.includes(index)} onChange={e => set('days', e.target.checked ? [...form.days, index] : form.days.filter(number => number !== index))} /><span>{day}</span></label>)}</fieldset>}
      {!dailyCheckIns && form.cadence === 'weekly' && <CheckField checked={form.dailyCheck} onChange={e => set('dailyCheck', e.target.checked)}>Require a daily check-in, including zero-progress days</CheckField>}
      {form.cadence === 'deadline' && <div className="form-grid">
        <Field label="Deadline date" help="The date this goal must be finished."><input type="date" min={draft.terms.start} max={draft.terms.end} required value={form.due ?? ''} onChange={e => set('due', e.target.value)} /></Field>
        <Field label="Deadline time" help="The deadline in your group’s time zone."><input type="time" required value={form.dueTime ?? ''} onChange={e => set('dueTime', e.target.value)} /></Field>
      </div>}
      {!dailyCheckIns && <CheckField checked={form.counts} onChange={e => set('counts', e.target.checked)}>Count this goal toward the checkpoint rule</CheckField>}
      <Field label="Details (optional)" help="Anything the group should know when they read your goal.">
        <input maxLength={80} value={form.topic} onChange={e => set('topic', e.target.value)} /></Field>
      <ErrorNote error={error} />
      <footer className="form-actions"><Button kind="outline" onClick={close} disabled={busy}>Cancel</Button>
        <Button type="submit" busy={busy} disabled={form.cadence === 'scheduled' && !form.days.length}>Save goal</Button></footer>
    </form>
  </Modal>;
}

export function LogDialog({ entry, existing, favourite, now, close, save }) {
  const { goal, pact, day, progress } = entry;
  const cutoff = checkinCutoff(entry.version, goal, day, progress.window);
  const [approval, setApproval] = useState(now > cutoff + entry.version.terms.grace * 60000);
  const [amount, setAmount] = useState(existing?.amount ?? (goal.unit === 'completion' ? 1 : goal.unit === 'min' ? 25 : 1));
  const [note, setNote] = useState(existing?.note ?? '');
  const [privateDetail, setPrivateDetail] = useState(existing?.privateDetail ?? '');
  const [shareNote, setSharing] = useState(existing?.shareNote ?? false);
  const [pin, setPin] = useState(false);
  const [key] = useState(() => crypto.randomUUID());
  const { busy, error, run } = useSubmit(async remove => {
    const data = { goalId: goal.id, key, day, amount: Number(amount), note, privateDetail, shareNote, logId: existing?.id, remove };
    try {
      await save(existing ? 'editLog' : approval ? 'lateLog' : 'log', data, approval, pin);
    } catch (error) {
      if (!existing && !approval && error.status === 409 && error.message.includes('window has closed')) setApproval(true);
      throw error;
    }
  });
  const quick = goal.unit === 'completion' ? [] : [...new Set([...(favourite === undefined ? [] : [favourite]), ...(goal.unit === 'min' ? [0, 25, 45, 60] : [0, 1, 2, 5])])];
  return <Modal title={existing ? 'Edit check-in' : 'Log check-in'} label={pactName(pact) + ' · ' + labelDay(day)} close={() => !busy && close()} sheet>
    <div className="log-goal"><CategoryIcon category={goal.category} /><div><strong>{goal.name}</strong><div>{targetText(goal)} · {entry.version.terms.zone.replaceAll('_', ' ')}</div></div></div>
    <form className="form" onSubmit={event => { event.preventDefault(); run(false); }}>
      <Field label={goal.unit === 'completion' ? 'Completion' : 'Amount (' + goal.unit + ')'}>
        {goal.unit === 'completion' ? <select data-first value={amount} onChange={e => setAmount(e.target.value)}><option value="1">Mark complete</option><option value="0">Check in without completing</option></select>
          : <input data-first type="number" inputMode="decimal" min="0" max="100000" step=".01" required value={amount} onChange={e => setAmount(e.target.value)} />}
      </Field>
      {quick.length > 0 && <div className="quick-actions" aria-label="Quick amounts">{quick.map(value => <Button key={value} kind={Number(amount) === value ? 'tint' : 'outline'} onClick={() => setAmount(value)} icon={value === favourite ? <Star size={14} /> : null}>{value + ' ' + goal.unit}</Button>)}</div>}
      <Field label="Note (optional)"><textarea maxLength={280} rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="How did it go?" /></Field>
      {note.trim() && <CheckField checked={shareNote} onChange={e => setSharing(e.target.checked)}>Share this note with the group</CheckField>}
      {goal.category === 'Fitness' && <details className="private-detail"><summary>Private measurements or training details</summary><Field label="Only you can see this field"><textarea maxLength={280} rows={2} value={privateDetail} onChange={e => setPrivateDetail(e.target.value)} /></Field></details>}
      {!existing && <CheckField checked={pin} onChange={e => setPin(e.target.checked)}>Save this amount as a favourite</CheckField>}
      {approval && <p className="field-note">The check-in window has closed. Another signed member can review your request.</p>}
      <ErrorNote error={error} />
      <footer className="form-actions">
        {existing ? <Button kind="danger" disabled={busy} onClick={() => run(true)}>{approval ? 'Request removal' : 'Remove log'}</Button> : <Button kind="outline" disabled={busy} onClick={close}>Cancel</Button>}
        <Button type="submit" busy={busy} icon={<Check size={17} />}>{approval ? 'Request approval' : existing ? 'Save changes' : 'Save check-in'}</Button>
      </footer>
    </form>
  </Modal>;
}

export function InviteDialog({ pact, now, close, read, renew, revoke, inviteAccount, notify }) {
  const [url, setUrl] = useState('');
  const [handle, setHandle] = useState('');
  const [loading, setLoading] = useState(pact.inviteExpires > now);
  const link = useRef(null);
  const { run: send, busy: sending, error: sendError } = useSubmit(async value => {
    await inviteAccount(value);
    notify('Invite sent to @' + value + '’s inbox.');
    setHandle('');
  });
  useEffect(() => {
    let mounted = true;
    if (pact.inviteExpires > now) read().then(value => { if (mounted) setUrl(value); })
      .catch(error => { if (mounted) notify(error.message, true); })
      .finally(() => { if (mounted) setLoading(false); });
    return () => { mounted = false; };
  }, []);
  const { run, busy, error } = useSubmit(async operation => {
    if (operation === 'revoke') { await revoke(); setUrl(''); }
    else if (operation === 'renew') setUrl(await renew());
    else if (operation === 'copy') {
      try { await navigator.clipboard.writeText(url); notify('Invite link copied.'); }
      catch { link.current.focus(); link.current.select(); notify('Select Copy to copy the link.'); }
    }
    else if (operation === 'share') {
      try { await navigator.share({ title: 'Join my pact on Show Up', url }); }
      catch (error) { if (error.name !== 'AbortError') throw error; }
    }
  });
  return <Modal title="Invite members" label={pactName(pact)} close={close}>
    <div className="form">
      <h3 className="form-section-title">Share a link</h3>
      <p className="field-note">Anyone with this link can join. Share it with as many people as you like, up to 50 members total. Links expire after seven days.</p>
      {url && <Field label="Shareable invite link"><input ref={link} readOnly value={url} onFocus={e => e.target.select()} /></Field>}
      <div className="quick-actions">
        {url ? <><Button busy={busy} icon={<ClipboardCopy size={17} />} onClick={() => run('copy')}>Copy invite link</Button>{navigator.share && <Button kind="outline" disabled={busy} onClick={() => run('share')}>Share</Button>}</>
          : <Button busy={busy || loading} icon={<Link2 size={17} />} onClick={() => run('renew')}>{pact.inviteExpires > now ? 'Replace invite link' : 'Create invite link'}</Button>}
      </div>
      {!loading && pact.inviteExpires > now && <div className="quick-actions">
        {url && <Button kind="outline" disabled={busy} onClick={() => run('renew')}>Replace link</Button>}
        <Button kind="danger" disabled={busy} onClick={() => run('revoke')}>Revoke link</Button>
      </div>}
      <ErrorNote error={error} />
    </div>
    <form className="form invite-account" onSubmit={event => { event.preventDefault(); send(handle.trim().replace(/^@/, '').toLowerCase()); }}>
      <h3 className="form-section-title">Send an inbox invite</h3>
      <Field label="Show Up username"><input required minLength={3} maxLength={25} value={handle} placeholder="@alex_park"
        autoCapitalize="none" spellCheck={false} onChange={event => setHandle(event.target.value)} /></Field>
      <ErrorNote error={sendError} />
      <div className="quick-actions"><Button kind="outline" type="submit" busy={sending}>Send invite</Button></div>
    </form>
  </Modal>;
}

export function SignDialog({ draft, close, save }) {
  const { busy, error, run } = useSubmit(save);
  return <Modal title="Sign the pact" label={draft.terms.name} close={() => !busy && close()}>
    <form className="form" onSubmit={event => { event.preventDefault(); run(); }}>
      <p className="field-note">You’re agreeing to your goal, the check-in schedule and the group terms.</p>
      <ErrorNote error={error} />
      <footer className="form-actions"><Button kind="outline" onClick={close} disabled={busy}>Cancel</Button><Button type="submit" busy={busy}>Confirm signature</Button></footer>
    </form>
  </Modal>;
}
export function SimpleDialog({ title, label, close, fields, save, submit = 'Save', description, confirm = false, extra }) {
  const [values, setValues] = useState(() => Object.fromEntries(fields.map(field => [field.name, field.value ?? ''])));
  const set = patch(setValues);
  const { busy, error, run } = useSubmit(save);
  return <Modal title={title} label={label} close={() => !busy && close()}>
    <form className="form" onSubmit={e => { e.preventDefault(); run(values); }}>
      {description && <p className="field-note">{description}</p>}
      {fields.map(field => field.type === 'checkbox' ? <CheckField key={field.name} checked={Boolean(values[field.name])} onChange={e => set(field.name, e.target.checked)}>{field.label}</CheckField>
        : <Field key={field.name} label={field.label}>
          <input type={field.type || 'text'} value={values[field.name]} onChange={e => set(field.name, e.target.value)} maxLength={field.max ?? 140} required={field.required} />
        </Field>)}
      <ErrorNote error={error} />
      {extra}
      <footer className="form-actions"><Button kind="outline" disabled={busy} onClick={close}>Cancel</Button><Button type="submit" busy={busy} kind={confirm ? 'danger-solid' : 'primary'}>{submit}</Button></footer>
    </form>
  </Modal>;
}
