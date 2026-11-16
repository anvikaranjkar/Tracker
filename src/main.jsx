import { useCallback, useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Bell, CalendarDays, Check, ChevronDown, CircleAlert, Flag, LayoutDashboard, LogOut, Plus, Settings2, Users } from 'lucide-react';
import { browserZone, localDay, labelDay } from '../shared/time.mjs';
import { api, demoData, initials, pactName, pactZone } from './model.mjs';
import { Avatar, Brand, Button, Empty, ErrorNote, IconButton, Modal } from './ui.jsx';
import { GoalDialog, InviteDialog, LogDialog, SignDialog, SimpleDialog, TermsDialog } from './forms.jsx';
import Today from './Today.jsx';
import Calendar from './Calendar.jsx';
import { PactDetail, PactList } from './Pacts.jsx';
import './style.css';

const tabs = [
  { id: 'today', label: 'Today', Icon: LayoutDashboard },
  { id: 'calendar', label: 'Calendar', Icon: CalendarDays },
  { id: 'pacts', label: 'Pacts', Icon: Flag }
];
const findToken = () => new URL(location.href).searchParams.get('invite');
function clearInvite() {
  const url = new URL(location.href);
  url.searchParams.delete('invite');
  history.replaceState(null, '', url);
}
function inviteUrl(token) {
  const url = new URL('/', location.origin);
  url.searchParams.set('invite', token);
  return url.toString();
}

function Guest({ signIn, tryDemo, setup, invite, inviteError, loadError }) {
  const [signup, setSignup] = useState(Boolean(findToken()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({ name: '', handle: '', password: '' });
  const change = key => event => setForm(old => ({ ...old, [key]: event.target.value }));
  async function submit(event) {
    event.preventDefault();
    setBusy(true);
    setError('');
    try { await signIn(signup ? 'signup' : 'login', { ...form, zone: browserZone() }); }
    catch (error) { setError(error.message); }
    finally { setBusy(false); }
  }
  return <main className="guest">
    <div className="guest-copy">
      <Brand />
      <div className="guest-message">
        <div className="eyebrow"><Users size={16} aria-hidden="true" /> Two-person pacts</div>
        <h1>Show up<span>.</span><br />Together<span>.</span></h1>
        <p>Make a pact with a mate. Set your own goals, check in, and give each other a reason to keep going.</p>
        <Button kind="white" onClick={tryDemo} right={<ArrowRight size={18} />}>Explore the demo</Button>
      </div>
      <div className="guest-track" aria-hidden="true"><i /><i /><i /><i /><i /></div>
      <div className="guest-bottom"><span>Fitness</span><span>Study</span><span>Your goals</span></div>
    </div>
    <div className="guest-side">
      <div className="guest-form">
        {invite && <div className="invite-banner"><Flag size={21} /><div><strong>{invite.from} invited you to {invite.name}.</strong><span>Continue to claim the friend slot.</span></div></div>}
        {inviteError && <ErrorNote error={inviteError} />}
        {setup && <div className="setup-note"><CircleAlert size={18} /><div><strong>Connect a database to start.</strong><span>The demo is available while you complete the deployment guide.</span></div></div>}
        {loadError && <ErrorNote error={loadError} />}
        <div className="eyebrow">{invite ? 'Pact invitation' : 'Your account'}</div>
        <h2>{signup ? 'Create your account' : 'Welcome back.'}</h2>
        <p>{signup ? 'Choose a username and the name your mates will see.' : 'Sign in to see your pacts and check-ins.'}</p>
        <form onSubmit={submit} className="form">
          {signup && <label className="field"><span>Name</span><input required minLength={2} maxLength={40} autoComplete="name" placeholder="Alex Park" value={form.name} onChange={change('name')} /></label>}
          <label className="field"><span>Username</span><input required minLength={3} maxLength={24} autoCapitalize="none" spellCheck={false}
            autoComplete="username" placeholder="alex_park" value={form.handle} onChange={change('handle')} /></label>
          <label className="field"><span>Password</span><input required type="password" minLength={10} maxLength={128} placeholder={signup ? 'At least 10 characters' : 'Your password'}
            autoComplete={signup ? 'new-password' : 'current-password'} value={form.password} onChange={change('password')} /></label>
          <ErrorNote error={error} />
          <Button busy={busy} disabled={setup} type="submit" right={<ArrowRight size={17} />}>{signup ? 'Create account' : 'Sign in'}</Button>
        </form>
        <p className="guest-switch">{signup ? 'Already have an account?' : 'First time here?'} <button className="text-button" type="button" onClick={() => { setSignup(!signup); setError(''); }}>{signup ? 'Sign in' : 'Create an account'}</button></p>
      </div>
    </div>
  </main>;
}

function reminders(pacts, user) {
  return pacts.flatMap(pact => {
    const partner = pact.members.find(member => member.id !== user.id);
    const otherSignature = partner && pact.draft?.signatures[partner.id];
    const signals = pact.signals.filter(signal => signal.to === user.id).map(signal => ({
      id: signal.id, at: signal.at, pact,
      message: signal.type === 'cheer' ? 'Your mate sent a cheer.' : 'Your mate sent a nudge.'
    }));
    if (pact.endedOn) return signals;
    const requests = pact.requests.filter(req => req.owner !== user.id && req.status === 'pending').map(req => ({
      id: req.id, at: req.at, pact, message: req.type === 'excuse' ? 'Review an excused-days request.' : 'Review a proposed log change.'
    }));
    const forfeits = pact.outcomes.filter(result => result.owner === user.id && ['triggered', 'flagged'].includes(result.status)).map(result => ({
      id: result.id, at: result.cutoff, pact, message: 'Forfeit due ' + labelDay(result.due) + '.'
    }));
    if (otherSignature && !pact.draft.signatures[user.id]) requests.push({
      id: pact.id + '-' + otherSignature, at: otherSignature, pact, message: partner.name.split(' ')[0] + ' signed. Review the match sheet.'
    });
    return [...signals, ...requests, ...forfeits];
  }).sort((a, b) => b.at - a.at);
}

function Workspace({ live, demo, token, invite, inviteError, onDemoExit, applyInvite, dismissInvite, sync, syncError, mutate, accountAction, logout }) {
  const { user, pacts, now } = live;
  const [page, setPage] = useState('today');
  const [pactId, setPactId] = useState(null);
  const [day, setDay] = useState(() => localDay(now, user.settings.zone));
  const [dialog, setDialog] = useState(null);
  const [toast, setToast] = useState(null);
  const inviteUrls = useRef({});
  const pact = pacts.find(entry => entry.id === pactId);
  const notices = reminders(pacts, user);
  const noticeCount = notices.filter(signal => signal.at > user.inboxSince).length;
  const close = () => setDialog(null);
  const open = (kind, payload) => setDialog({ kind, payload });
  const navigate = (newPage, id = null) => {
    setPage(newPage);
    setPactId(id);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const openPact = id => navigate('pacts', id);
  useEffect(() => {
    if (toast) { const timer = setTimeout(() => setToast(null), toast.error ? 7000 : 4000); return () => clearTimeout(timer); }
  }, [toast]);
  const notify = (message, error = false) => setToast({ message, error });
  async function pactAction(action, data, message, target = pactId) {
    const response = await mutate(action, { ...data, pactId: target });
    if (message) notify(typeof message === 'function' ? message(response) : message);
    return response;
  }
  const guarded = (action, data, message, target) => pactAction(action, data, message, target).catch(error => notify(error.message, true));
  const log = (entry, existing) => open('log', { entry, existing });
  const activeDraft = pact?.draft;
  const draftForDialog = dialog?.draft ?? activeDraft;
  const openPactDialog = (kind, payload) => setDialog({ kind, payload, draft: activeDraft });
  const payload = dialog?.payload;
  return <div className="app-shell">
    <a className="skip" href="#main">Skip to content</a>
    <aside className="sidebar">
      <button className="brand-button" onClick={() => navigate('today')} aria-label="Show Up home"><Brand /></button>
      <div className="nav-list" aria-label="Main navigation" role="navigation">
        {tabs.map(({ id, label, Icon }) => <button key={id} type="button" aria-current={page === id ? 'page' : undefined} className={'nav-item' + (page === id ? ' active' : '')} onClick={() => navigate(id)}><Icon size={21} strokeWidth={1.85} aria-hidden="true" /><span>{label}</span></button>)}
      </div>
      <div className="sidebar-foot">
        {demo ? <Button kind="outline" onClick={onDemoExit}>Exit demo</Button> : <button className="profile-button" onClick={() => open('settings')}>
          <Avatar name={user.name} initials={initials(user.name)} /><span><strong>{user.name}</strong><small>Account settings</small></span><ChevronDown size={16} aria-hidden="true" />
        </button>}
      </div>
    </aside>
    <header className="mobile-head">
      <button className="brand-button" onClick={() => navigate('today')} aria-label="Show Up home"><Brand /></button>
      {demo ? <Button kind="outline" onClick={onDemoExit}>Exit demo</Button> : <button className="mobile-profile" onClick={() => open('settings')} aria-label="Account settings"><Avatar name={user.name} initials={initials(user.name)} /></button>}
    </header>
    <main id="main" className="workspace" tabIndex={-1}>
      <div className="workspace-inner">
        <div className="workspace-top"><span>{demo ? <span className="demo-label">Demo · Sample data</span> : <span className="workspace-title">{page === 'pacts' && pact ? 'Pacts / Match sheet' : tabs.find(tab => tab.id === page).label}</span>}</span>
          {!demo && <IconButton title={'Inbox' + (noticeCount ? ', ' + noticeCount + ' unread' : '')} onClick={() => open('inbox')}><Bell size={19} />{noticeCount > 0 && <i className="unread-dot" />}</IconButton>}
        </div>
        {page !== 'today' && syncError && <div className="sync-banner"><span>{syncError}</span><Button kind="outline" onClick={sync}>Retry</Button></div>}
        {page === 'today' && <Today user={user} pacts={pacts} now={now} demo={demo} log={log} openPact={openPact} create={() => open('create')}
          openCalendar={() => navigate('calendar')} react={(id, action) => guarded(action, {}, action === 'cheer' ? 'Cheer sent.' : 'Nudge sent.', id)} syncError={syncError} retry={sync} />}
        {page === 'calendar' && <Calendar user={user} pacts={pacts} now={now} demo={demo} day={day} setDay={setDay} log={log}
          personEvent={date => open('event', date)} removeEvent={event => open('removeEvent', event)} />}
        {page === 'pacts' && (pact ? <PactDetail key={pact.id} pact={pact} user={user} now={now} demo={demo} goBack={() => navigate('pacts')} modal={openPactDialog} action={guarded} />
          : <PactList user={user} pacts={pacts} now={now} demo={demo} open={openPact} create={() => open('create')} />)}
      </div>
    </main>
    {toast && <div className={'toast' + (toast.error ? ' toast-error' : '')} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleAlert size={19} /> : <Check size={19} />}{toast.message}</div>}
    {token && !demo && <SimpleDialog title={invite ? 'Join ' + invite.name : 'Join a pact'} close={dismissInvite} label="Pact invitation" fields={[]} submit={inviteError ? 'Go to my pacts' : 'Join pact'}
      description={inviteError || (invite ? invite.from + ' left one friend slot for you. You’re signed in as @' + user.handle + '.' : 'Checking the invitation.')}
      extra={!inviteError && <Button kind="outline" onClick={() => logout().catch(error => notify(error.message, true))}>Switch account</Button>}
      save={async () => { if (inviteError) { dismissInvite(); navigate('pacts'); return; } const result = await applyInvite(); openPact(result.pact.id); notify('You joined the pact.'); }} />}
    {dialog?.kind === 'create' && <TermsDialog now={now} close={close} save={async terms => {
      const result = await mutate('create', { terms }); close(); openPact(result.pact.id); notify('Pact created. Add your first goal.');
    }} />}
    {dialog?.kind === 'terms' && draftForDialog && <TermsDialog draft={draftForDialog} now={now} close={close} save={async terms => {
      await pactAction('terms', { terms, revision: draftForDialog.revision }, 'Terms saved.'); close();
    }} />}
    {dialog?.kind === 'goal' && draftForDialog && <GoalDialog goal={payload} draft={draftForDialog} close={close} save={async goal => {
      await pactAction('saveGoal', { goal, revision: draftForDialog.revision }, 'Goal saved.'); close();
    }} />}
    {dialog?.kind === 'removeGoal' && draftForDialog && <SimpleDialog title={'Remove ' + payload.name + '?'} description="This changes the draft and clears any signatures on it." fields={[]} close={close} confirm submit="Remove goal" save={async () => {
      await pactAction('deleteGoal', { goal: payload, revision: draftForDialog.revision }, 'Goal removed.'); close();
    }} />}
    {dialog?.kind === 'sign' && draftForDialog && <SignDialog draft={draftForDialog} close={close} save={async () => {
      await pactAction('sign', { revision: draftForDialog.revision }, response => response.pact.draft ? 'Signed. Waiting for your mate.' : 'Both signed. The pact is sealed.'); close();
    }} />}
    {dialog?.kind === 'invite' && pact && <InviteDialog pact={pact} signedNow={now} initialUrl={pact.inviteExpires > now ? inviteUrls.current[pact.id] ?? '' : ''} close={close} notify={notify} renew={async () => {
      const result = await pactAction('invite', {});
      const url = inviteUrl(result.inviteToken);
      inviteUrls.current[pact.id] = url;
      return url;
    }} revoke={async () => { await pactAction('revoke', {}, 'Invite revoked.'); delete inviteUrls.current[pact.id]; }} />}
    {dialog?.kind === 'log' && <LogDialog entry={payload.entry} existing={payload.existing} favourite={user.favourites[payload.entry.goal.id]} now={now} close={close}
      save={async (action, data, approval, pin) => {
        const result = await pactAction(action, data, null, payload.entry.pact.id);
        const requested = result.pact.requests.some(request => request.status === 'pending' && request.entry?.id === (data.logId || data.key));
        if (pin && !data.remove) {
          try { await accountAction('favourite', { goalId: data.goalId, amount: data.amount }); }
          catch { notify('Check-in saved. The favourite couldn’t be saved.', true); close(); return; }
        }
        notify(approval || requested ? 'Request sent to your friend.' : data.remove ? 'Check-in removed.' : 'Check-in saved.');
        close();
      }} />}
    {dialog?.kind === 'excuse' && <SimpleDialog title="Request excused days" label={pactName(pact)} close={close} submit="Send request"
      description="Your friend needs to approve this before the checkpoint closes. Only you will be excused for these dates."
      fields={[{ name: 'first', type: 'date', label: 'First date', value: localDay(now, pactZone(pact)), required: true }, { name: 'last', type: 'date', label: 'Last date', value: localDay(now, pactZone(pact)), required: true }, { name: 'reason', label: 'Reason to share (optional)' }]}
      save={async data => { await pactAction('excuse', data, 'Request sent.'); close(); }} />}
    {dialog?.kind === 'flag' && <SimpleDialog title="Flag this result" close={close} fields={[{ name: 'reason', label: 'What should your friend review?', max: 160 }]} submit="Flag result"
      save={async data => { await pactAction('flagOutcome', { id: payload.id, ...data }, 'Flag added.'); close(); }} />}
    {dialog?.kind === 'leave' && <SimpleDialog title="Leave this pact?" close={close} confirm fields={[]} submit="Leave pact"
      description="This ends future check-ins for both of you. You can both still see the signed terms and history."
      save={async () => { await pactAction('leave', {}, 'Pact ended.'); close(); }} />}
    {dialog?.kind === 'discardRevision' && <SimpleDialog title="Discard this draft?" close={close} confirm fields={[]} submit="Discard draft"
      description="The current signed version will continue." save={async () => { await pactAction('discardRevision', { revision: draftForDialog.revision }, 'Draft discarded.'); close(); }} />}
    {dialog?.kind === 'event' && <SimpleDialog title="Add a personal event" close={close} description="This event only appears in your calendar."
      fields={[{ name: 'title', label: 'Event name', max: 80, required: true }, { name: 'day', label: 'Date', type: 'date', value: payload, required: true }, { name: 'time', label: 'Time (optional)', type: 'time' }, { name: 'note', label: 'Private note (optional)', max: 280 }]}
      save={async data => { await accountAction('event', data); close(); notify('Personal event added.'); }} />}
    {dialog?.kind === 'removeEvent' && <SimpleDialog title={'Remove ' + payload.title + '?'} fields={[]} close={close} confirm submit="Remove event"
      save={async () => { await accountAction('removeEvent', { id: payload.id }); close(); notify('Event removed.'); }} />}
    {dialog?.kind === 'settings' && <Modal title="Account settings" close={close}><div className="form settings-pane">
      <div className="account-row"><Avatar name={user.name} initials={initials(user.name)} /><div><strong>{user.name}</strong><span>@{user.handle}</span></div></div>
      <Button kind="outline" icon={<Settings2 size={17} />} onClick={() => open('quiet')}>Nudges and quiet hours</Button>
      <Button kind="outline" icon={<LogOut size={17} />} onClick={() => logout().catch(error => notify(error.message, true))}>Sign out</Button>
    </div></Modal>}
    {dialog?.kind === 'quiet' && <SimpleDialog title="Nudges and quiet hours" close={close} description="Reminders appear in the app. Your quiet hours use the time zone below."
      fields={[{ name: 'mute', type: 'checkbox', label: 'Mute partner nudges', value: user.settings.mute }, { name: 'quiet', type: 'checkbox', label: 'Use quiet hours', value: user.settings.quiet },
        { name: 'quietStart', type: 'time', label: 'Quiet from', value: user.settings.quietStart, required: true }, { name: 'quietEnd', type: 'time', label: 'Quiet until', value: user.settings.quietEnd, required: true },
        { name: 'zone', label: 'My time zone', value: user.settings.zone, required: true }]}
      save={async settings => { await accountAction('settings', { settings }); close(); notify('Reminder settings saved.'); }} />}
    {dialog?.kind === 'inbox' && <Modal title="Inbox" close={close}><div className="form inbox">
      {notices.length ? notices.slice(0, 30).map(signal => <button className="inbox-row" key={signal.id} onClick={() => { close(); openPact(signal.pact.id); }}>
        <span>{pactName(signal.pact)}<strong>{signal.message}</strong></span><time>{labelDay(localDay(signal.at, user.settings.zone))}</time></button>)
        : <Empty icon={Bell} title="You’re caught up">Pact reminders, cheers and nudges appear here.</Empty>}
      {noticeCount > 0 && <Button kind="outline" onClick={() => accountAction('inboxRead', {}).catch(error => notify(error.message, true))}>Mark all as read</Button>}
    </div></Modal>}
  </div>;
}

function App() {
  const [live, setLive] = useState(null);
  const [ready, setReady] = useState(false);
  const [setup, setSetup] = useState(false);
  const [demo, setDemo] = useState(null);
  const [token, setToken] = useState(findToken);
  const [invite, setInvite] = useState(null);
  const [inviteError, setInviteError] = useState('');
  const [syncError, setSyncError] = useState('');
  const epoch = useRef(0);
  const syncing = useRef(false);
  const writing = useRef(0);
  const signedIn = Boolean(live?.user);
  const sync = useCallback(async () => {
    if (syncing.current || writing.current) return;
    const snapshot = epoch.current;
    syncing.current = true;
    try {
      const result = await api('sync');
      if (snapshot === epoch.current) { setLive(result); setSyncError(''); }
    } catch (error) {
      if (snapshot !== epoch.current) return;
      if (error.status === 401) setLive(null);
      else setSyncError(error.message);
    } finally { syncing.current = false; }
  }, []);
  useEffect(() => {
    let active = true;
    api('session').then(result => {
      if (!active) return;
      setSetup(Boolean(result.setupNeeded));
      if (result.user) { setLive({ user: result.user, pacts: [], now: Date.now() }); sync(); }
    }).catch(error => { if (active) setSyncError(error.message); }).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [sync]);
  useEffect(() => {
    if (!token) return;
    let active = true;
    api('invitePreview', { token }).then(response => { if (active) setInvite(response.invite); })
      .catch(error => { if (active) setInviteError(error.message); });
    return () => { active = false; };
  }, [token]);
  useEffect(() => {
    if (!signedIn) return;
    const interval = setInterval(() => { if (!document.hidden) sync(); }, 12000);
    window.addEventListener('focus', sync);
    return () => { clearInterval(interval); window.removeEventListener('focus', sync); };
  }, [signedIn, sync]);
  async function mutate(action, data) {
    epoch.current += 1;
    writing.current += 1;
    try {
      const result = await api(action, data);
      setLive(old => {
        if (!old) return old;
        const current = result.pact && old.pacts.find(pact => pact.id === result.pact.id);
        const pacts = result.pact && (!current || current.serial <= result.pact.serial)
          ? [result.pact, ...old.pacts.filter(pact => pact.id !== result.pact.id)] : old.pacts;
        return { ...old, pacts, user: result.user ?? old.user, now: result.now ?? old.now };
      });
      setSyncError('');
      return result;
    } catch (error) {
      if (error.status === 401) setLive(null);
      if (error.status === 409) setTimeout(sync, 0);
      throw error;
    } finally {
      writing.current -= 1;
      epoch.current += 1;
    }
  }
  async function signIn(action, data) {
    const result = await api(action, data);
    setLive({ user: result.user, pacts: [], now: Date.now() });
    sync();
  }
  function dismissInvite() { clearInvite(); setToken(null); setInvite(null); setInviteError(''); }
  async function applyInvite() {
    const result = await mutate('join', { token });
    dismissInvite();
    return result;
  }
  async function logout() {
    epoch.current += 1;
    await api('logout');
    setLive(null);
  }
  if (!ready) return <main className="loading"><Brand /><p role="status">Loading your workspace…</p></main>;
  if (demo) return <Workspace key="demo" live={demo} demo onDemoExit={() => setDemo(null)} />;
  if (!signedIn) return <Guest setup={setup} signIn={signIn} tryDemo={() => { const now = Date.now(); setDemo({ ...demoData(now), now }); }} invite={invite} inviteError={inviteError} loadError={syncError} />;
  return <Workspace key={live.user.id} live={live} token={token} invite={invite} inviteError={inviteError} applyInvite={applyInvite} dismissInvite={dismissInvite}
    sync={sync} syncError={syncError} mutate={mutate} accountAction={mutate} logout={logout} />;
}

createRoot(document.getElementById('root')).render(<App />);
