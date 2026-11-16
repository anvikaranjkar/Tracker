import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, Check, ClipboardCopy, Link2, PenLine, Star } from 'lucide-react';
import { addDays, browserZone, labelClock, labelDay, localDay, wallTime, WEEKDAYS } from '../shared/time.mjs';
import { targetText } from '../shared/scoring.mjs';
import { defaultTerms, pactName } from './model.mjs';
import { Button, CategoryIcon, ErrorNote, Modal } from './ui.jsx';

const Field = ({ label, hint, children }) => <label className="field"><span>{label}</span>{children}{hint && <small>{hint}</small>}</label>;
const CheckField = ({ children, ...props }) => <label className="check-field"><input type="checkbox" {...props} /><span>{children}</span></label>;
const patch = set => (key, value) => set(previous => ({ ...previous, [key]: value }));
const formError = error => error.message || 'Try again in a moment.';
const FITNESS = ['Workout consistency', 'Cutting / shredding', 'Bulking / muscle gain', 'Strength', 'Muscle group', 'Cardio', 'Mobility', 'Recovery', 'Other'];
const UNITS = { Fitness: ['sessions', 'min', 'sets', 'reps', 'km', 'completion'], Study: ['min', 'sessions', 'questions', 'pages', 'papers', 'tasks', 'completion'], Custom: ['min', 'sessions', 'pages', 'completion'] };
const OPTIONS = [['daily', 'Every day'], ['scheduled', 'Specific days'], ['weekly', 'Weekly total'], ['deadline', 'One-off deadline']];
const FORFEITS = ['Pick the next study spot', 'Make the shared playlist', 'Write a ridiculously formal congratulations note'];

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

export function TermsDialog({ draft, now, close, save }) {
  const [form, setForm] = useState(() => draft ? { ...draft.terms } : defaultTerms(now));
  const [choice, setChoice] = useState(() => !form.forfeit ? 'none' : FORFEITS.includes(form.forfeit) ? form.forfeit : 'custom');
  const set = patch(setForm);
  const create = !draft;
  const { busy, error, run } = useSubmit(save);
  return <Modal title={create ? 'Make a pact' : 'Set the terms'} label={create ? 'Pacts' : 'Version ' + draft.number + ' · Draft'} close={() => !busy && close()} wide>
    <form onSubmit={event => { event.preventDefault(); run(form); }} className="form">
      <Field label="Pact name"><input data-first required maxLength={60} value={form.name} onChange={e => set('name', e.target.value)} placeholder="e.g. The Sunday reset" /></Field>
      <div className="form-grid">
        <Field label={draft?.number > 1 ? 'Effective from' : 'Start date'}><input type="date" required value={form.start} onChange={e => {
          const start = e.target.value;
          setForm(old => ({ ...old, start, end: create && start ? addDays(start, 27) : old.end }));
        }} /></Field>
        <Field label="End date"><input type="date" min={form.start} required value={form.end} onChange={e => set('end', e.target.value)} /></Field>
        <Field label="Cutoff time"><input type="time" value={form.cutoff} required onChange={e => set('cutoff', e.target.value)} /></Field>
        <Field label="Pact time zone"><input list="timezones" required value={form.zone} disabled={draft?.number > 1} onChange={e => set('zone', e.target.value)} /><datalist id="timezones">{[...new Set([browserZone(), 'Australia/Sydney', ...(Intl.supportedValuesOf?.('timeZone') ?? [])])].map(zone => <option key={zone} value={zone} />)}</datalist></Field>
        <Field label="Grace period"><select value={form.grace} onChange={e => set('grace', Number(e.target.value))}>{[[0, 'None'], [30, '30 minutes'], [60, '1 hour'], [120, '2 hours'], [720, '12 hours'], [1440, '24 hours']].map(([n, text]) => <option key={n} value={n}>{text}</option>)}</select></Field>
        <Field label="Weekly checkpoint rule"><select value={form.rule} onChange={e => set('rule', e.target.value)}><option value="target">Miss any agreed target</option><option value="checkins">Miss scheduled check-in days</option></select></Field>
      </div>
      {form.rule === 'checkins' && <Field label="Number of missed days that triggers the rule" hint="Multiple missed goals on the same date count as one day."><input type="number" value={form.missLimit} min="1" max="7" required onChange={e => set('missLimit', Number(e.target.value))} /></Field>}
      <Field label="Forfeit" hint="Keep it harmless, voluntary and private."><select value={choice} onChange={e => { setChoice(e.target.value); set('forfeit', e.target.value === 'none' || e.target.value === 'custom' ? '' : e.target.value); }}>
        <option value="none">No forfeit</option>{FORFEITS.map(item => <option key={item}>{item}</option>)}<option value="custom">Write your own</option>
      </select></Field>
      {choice === 'custom' && <Field label="Agreed forfeit"><input required maxLength={140} value={form.forfeit} onChange={e => set('forfeit', e.target.value)} /></Field>}
      {choice !== 'none' && <Field label="Days to complete it"><input type="number" min="1" max="30" required value={form.forfeitDays} onChange={e => set('forfeitDays', Number(e.target.value))} /></Field>}
      <ErrorNote error={error} />
      <footer className="form-actions"><Button kind="outline" onClick={close} disabled={busy}>Cancel</Button><Button type="submit" busy={busy} right={<ArrowRight size={17} />}>{create ? 'Create pact' : 'Save terms'}</Button></footer>
    </form>
  </Modal>;
}

export function GoalDialog({ goal, draft, close, save }) {
  const [step, setStep] = useState(0);
  const [form, setForm] = useState(() => goal ? { ...goal } : { category: 'Study', focus: '', topic: '', name: '', unit: 'min', target: '120', cadence: 'weekly', days: [], due: draft.terms.end, dueTime: draft.terms.cutoff, dailyCheck: false, counts: true });
  const [customUnit, setCustomUnit] = useState(goal ? !UNITS[goal.category].includes(goal.unit) : false);
  const set = patch(setForm);
  const { busy, error, run } = useSubmit(save);
  const target = targetText({ ...form, target: Number(form.target) });
  return <Modal title={goal ? 'Edit your goal' : 'Add your goal'} label={['1 / 3 · Focus', '2 / 3 · Measure', '3 / 3 · Schedule'][step]} close={() => !busy && close()}>
    <form className="form" onSubmit={event => { event.preventDefault(); if (step === 2) run(form); else setStep(step + 1); }} key={step}>
      {step === 0 && <>
        <fieldset className="category-pick"><legend>Category</legend>{Object.keys(UNITS).map(category => <label key={category}><input type="radio" name="category" checked={form.category === category} onChange={() => {
          setCustomUnit(false);
          setForm(old => ({ ...old, category, focus: category === 'Fitness' ? FITNESS[0] : '', unit: category === 'Fitness' ? 'sessions' : 'min', target: category === 'Fitness' ? '3' : '120' }));
        }} /><span><CategoryIcon category={category} small />{category}</span></label>)}</fieldset>
        {form.category === 'Fitness' ? <Field label="Fitness focus"><select value={form.focus || FITNESS[0]} onChange={e => set('focus', e.target.value)} onBlur={() => { if (!form.focus) set('focus', FITNESS[0]); }}>{FITNESS.map(item => <option key={item}>{item}</option>)}</select></Field>
          : <Field label={form.category === 'Study' ? 'Subject' : 'Category name'}><input data-first required maxLength={48} value={form.focus} onChange={e => set('focus', e.target.value)} placeholder={form.category === 'Study' ? 'e.g. Chemistry' : 'e.g. Reading'} /></Field>}
        <Field label={form.category === 'Study' ? 'Topic or assessment (optional)' : 'Details (optional)'} hint="These details appear on the signed sheet."><input maxLength={80} value={form.topic} onChange={e => set('topic', e.target.value)} placeholder={form.category === 'Fitness' ? 'e.g. Quads and hamstrings' : 'e.g. Module 4 practice questions'} /></Field>
        <Field label="Goal name"><input required minLength={2} maxLength={70} value={form.name} onChange={e => set('name', e.target.value)} placeholder={form.category === 'Fitness' ? 'e.g. Train lower body' : form.category === 'Study' ? 'e.g. Revise for trials' : 'e.g. Read before bed'} /></Field>
      </>}
      {step === 1 && <>
        <Field label="How will you measure it?"><select value={customUnit ? 'other-unit' : form.unit} onChange={e => { setCustomUnit(e.target.value === 'other-unit'); set('unit', e.target.value === 'other-unit' ? '' : e.target.value); }}>{UNITS[form.category].map(unit => <option key={unit} value={unit}>{unit === 'min' ? 'Minutes' : unit === 'completion' ? 'Done / not done' : unit}</option>)}<option value="other-unit">Custom unit</option></select></Field>
        {customUnit && <Field label="Custom unit"><input maxLength={20} required value={form.unit} onChange={e => set('unit', e.target.value)} placeholder="e.g. kilometres" /></Field>}
        {form.unit !== 'completion' && <Field label="Target"><input type="number" inputMode="decimal" step=".01" min=".01" max="100000" required value={form.target} onChange={e => set('target', e.target.value)} /></Field>}
        <p className="field-note">You can log progress in pieces. For example, two 25-minute study sessions add 50 minutes toward the target.</p>
      </>}
      {step === 2 && <>
        <Field label="When do you want to check in?"><select value={form.cadence} onChange={e => setForm(old => ({ ...old, cadence: e.target.value, due: old.due || draft.terms.end, dueTime: old.dueTime || draft.terms.cutoff }))}>{OPTIONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></Field>
        {form.cadence === 'scheduled' && <fieldset className="day-select"><legend>Scheduled days</legend>{WEEKDAYS.map((day, index) => <label key={day}><input type="checkbox" checked={form.days.includes(index)} onChange={e => set('days', e.target.checked ? [...form.days, index] : form.days.filter(number => number !== index))} /><span>{day}</span></label>)}</fieldset>}
        {form.cadence === 'weekly' && <CheckField checked={form.dailyCheck} onChange={e => set('dailyCheck', e.target.checked)}>Require a daily check-in as well, including zero-progress days</CheckField>}
        {form.cadence === 'deadline' && <div className="form-grid">
          <Field label="Deadline date"><input type="date" min={draft.terms.start} max={draft.terms.end} required value={form.due ?? ''} onChange={e => set('due', e.target.value)} /></Field>
          <Field label="Deadline time"><input type="time" required value={form.dueTime ?? ''} onChange={e => set('dueTime', e.target.value)} /></Field>
        </div>}
        <CheckField checked={form.counts} onChange={e => set('counts', e.target.checked)}>Count this goal toward the pact’s checkpoint rule</CheckField>
        <div className="goal-preview"><span className="eyebrow">On the match sheet</span><strong>{form.name}</strong><span>{target} · {form.cadence === 'scheduled' ? form.days.map(day => WEEKDAYS[day]).join(', ') || 'Choose your days' : form.cadence === 'deadline' ? (form.due ? labelDay(form.due) : 'Set a date') : OPTIONS.find(([cadence]) => cadence === form.cadence)[1]}</span></div>
      </>}
      <ErrorNote error={error} />
      <footer className="form-actions"><Button kind="outline" icon={step ? <ArrowLeft size={16} /> : null} onClick={() => step ? setStep(step - 1) : close()} disabled={busy}>{step ? 'Back' : 'Cancel'}</Button>
        <Button type="submit" busy={busy} right={<ArrowRight size={17} />} disabled={step === 2 && form.cadence === 'scheduled' && !form.days.length}
          onClick={() => { if (step === 0 && form.category === 'Fitness' && !form.focus) set('focus', FITNESS[0]); }}>{step === 2 ? 'Save goal' : 'Continue'}</Button></footer>
    </form>
  </Modal>;
}

export function LogDialog({ entry, existing, favourite, now, close, save }) {
  const { goal, pact, day, progress } = entry;
  const cutoff = goal.cadence === 'weekly' && goal.dailyCheck ? Math.min(progress.window.cutoff, wallTime(day, entry.version.terms.cutoff, entry.version.terms.zone)) : progress.window.cutoff;
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
  const quick = [...new Set([...(favourite === undefined ? [] : [favourite]), ...(goal.unit === 'min' ? [25, 45, 60] : goal.unit === 'completion' ? [1] : [1, 2, 5])])];
  return <Modal title={existing ? 'Edit check-in' : 'Log check-in'} label={pactName(pact) + ' · ' + labelDay(day)} close={() => !busy && close()} sheet>
    <div className="log-goal"><CategoryIcon category={goal.category} /><div><strong>{goal.name}</strong><div>{targetText(goal)} · {entry.version.terms.zone.replaceAll('_', ' ')}</div></div></div>
    <form className="form" onSubmit={event => { event.preventDefault(); run(false); }}>
      <Field label={goal.unit === 'completion' ? 'Completion' : 'Amount (' + goal.unit + ')'}>
        {goal.unit === 'completion' ? <select data-first value={amount} onChange={e => setAmount(e.target.value)}><option value="1">Mark complete</option><option value="0">Check in without completing</option></select>
          : <input data-first type="number" inputMode="decimal" min="0" max="100000" step=".01" required value={amount} onChange={e => setAmount(e.target.value)} />}
      </Field>
      <div className="quick-actions" aria-label="Quick amounts">{quick.map(value => <Button key={value} kind={Number(amount) === value ? 'tint' : 'outline'} onClick={() => setAmount(value)} icon={value === favourite ? <Star size={14} /> : null}>{goal.unit === 'completion' ? 'Mark complete' : value + ' ' + goal.unit}</Button>)}</div>
      <Field label="Note (optional)"><textarea maxLength={280} rows={2} value={note} onChange={e => setNote(e.target.value)} placeholder="How did it go?" /></Field>
      {note.trim() && <CheckField checked={shareNote} onChange={e => setSharing(e.target.checked)}>Share this note with my pact partner</CheckField>}
      {goal.category === 'Fitness' && <details className="private-detail"><summary>Private measurements or training details</summary><Field label="Only you can see this field"><textarea maxLength={280} rows={2} value={privateDetail} onChange={e => setPrivateDetail(e.target.value)} /></Field></details>}
      {!existing && <CheckField checked={pin} onChange={e => setPin(e.target.checked)}>Save this amount as a favourite</CheckField>}
      {approval && <p className="field-note">The check-in window closed at {labelClock(goal.cadence === 'deadline' ? goal.dueTime : entry.version.terms.cutoff)} plus any grace period. Your friend will review this request.</p>}
      <ErrorNote error={error} />
      <footer className="form-actions">
        {existing ? <Button kind="danger" disabled={busy} onClick={() => run(true)}>{approval ? 'Request removal' : 'Remove log'}</Button> : <Button kind="outline" disabled={busy} onClick={close}>Cancel</Button>}
        <Button type="submit" busy={busy} icon={<Check size={17} />}>{approval ? 'Request approval' : existing ? 'Save changes' : 'Save check-in'}</Button>
      </footer>
    </form>
  </Modal>;
}

export function InviteDialog({ pact, signedNow, initialUrl, close, renew, revoke, notify }) {
  const [url, setUrl] = useState(initialUrl);
  const { run, busy, error } = useSubmit(async operation => {
    if (operation === 'revoke') { await revoke(); setUrl(''); }
    else if (operation === 'renew') setUrl(await renew());
    else if (operation === 'copy') { await navigator.clipboard.writeText(url); notify('Invite link copied.'); }
    else if (operation === 'share') {
      try { await navigator.share({ title: 'Join my pact on Show Up', url }); }
      catch (error) { if (error.name !== 'AbortError') throw error; }
    }
  });
  return <Modal title="Invite a friend" label={pactName(pact)} close={close}>
    <div className="form">
      <p className="field-note">Anyone with this link can claim the one friend slot. The invitation expires after seven days.</p>
      {url && <Field label="Shareable invite link"><input data-first readOnly value={url} onFocus={e => e.target.select()} /></Field>}
      <div className="quick-actions">
        {url ? <><Button busy={busy} icon={<ClipboardCopy size={17} />} onClick={() => run('copy')}>Copy invite link</Button>{navigator.share && <Button kind="outline" disabled={busy} onClick={() => run('share')}>Share</Button>}</>
          : <Button busy={busy} icon={<Link2 size={17} />} onClick={() => run('renew')}>Create invite link</Button>}
      </div>
      {(pact.inviteExpires > signedNow || url) && <div className="quick-actions"><Button kind="outline" disabled={busy} onClick={() => run('renew')}>Replace link</Button><Button kind="danger" disabled={busy} onClick={() => run('revoke')}>Revoke link</Button></div>}
      <ErrorNote error={error} />
    </div>
  </Modal>;
}

export function SignDialog({ draft, close, save }) {
  const timer = useRef(null);
  const [holding, setHolding] = useState(false);
  const { busy, error, run } = useSubmit(save);
  const stop = () => { clearTimeout(timer.current); setHolding(false); };
  useEffect(() => () => clearTimeout(timer.current), []);
  return <Modal title="Sign the match sheet" label={'Version ' + draft.number + ' · ' + draft.terms.name} close={() => !busy && close()}>
    <div className="form"><p className="field-note">Your signature applies to the goals and terms you just reviewed. A change to this draft clears both signatures.</p>
      <button type="button" className={'hold-button' + (holding ? ' holding' : '')} disabled={busy}
        onPointerDown={event => { if (event.button !== 0) return; event.currentTarget.setPointerCapture(event.pointerId); setHolding(true); timer.current = setTimeout(() => { setHolding(false); run(); }, 850); }}
        onPointerUp={stop} onPointerCancel={stop} onLostPointerCapture={stop} onContextMenu={event => event.preventDefault()}
        onClick={event => { if (event.detail === 0) run(); }}><PenLine size={19} /> Hold to sign</button>
      <ErrorNote error={error} />
      <footer className="form-actions"><Button kind="outline" onClick={close} disabled={busy}>Cancel</Button><Button type="button" kind="outline" onClick={() => run()} busy={busy}>Confirm signature</Button></footer>
    </div>
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
