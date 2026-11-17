import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { ArrowRight, Bell, CalendarDays, Check, ChevronDown, CircleAlert, Download, Flag, LayoutDashboard, LogOut, Settings2, WifiOff } from 'lucide-react';
import { browserZone, localDay, labelDay } from '../shared/time.mjs';
import { api, demoData, initials, pactName, pactNotices, pactZone } from './model.mjs';
import { Avatar, Brand, Button, Credit, Empty, ErrorNote, IconButton, Modal } from './ui.jsx';
import { GoalDialog, InviteDialog, LogDialog, SignDialog, SimpleDialog, TermsDialog } from './forms.jsx';
import { deviceSubscription, InstallDialog, isInstalled, PushSettings, updateBadge } from './pwa.jsx';
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
const initialInbox = () => new URL(location.href).searchParams.get('view') === 'inbox';
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
  const [install, setInstall] = useState(false);
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
  return <><main className="guest">
    <div className="guest-copy">
      <Brand />
      <div className="guest-message">
        <h1>Show up<span>.</span><br />Together<span>.</span></h1>
        <p>Set your own goal, share a group pact and check in every day.</p>
        <Button kind="white" onClick={tryDemo} right={<ArrowRight size={18} />}>Explore the demo</Button>
      </div>
    </div>
    <div className="guest-side">
      <div className="guest-form">
        {invite && <div className="invite-banner"><Flag size={21} aria-hidden="true" /><div><strong>{invite.from} invited you to {invite.name}.</strong><span>Sign in or create an account to join the group.</span></div></div>}
        {inviteError && <ErrorNote error={inviteError} />}
        {setup && <div className="setup-note"><CircleAlert size={18} /><div><strong>Connect a database to start.</strong><span>The demo is available while you complete the deployment guide.</span></div></div>}
        {loadError && <ErrorNote error={loadError} />}
        <div className="eyebrow">{invite ? 'Pact invitation' : 'Your account'}</div>
        <h2>{signup ? 'Create your account' : 'Welcome back.'}</h2>
        <p>{signup ? 'Choose a username and the name your group will see.' : 'Sign in to see your pacts and check-ins.'}</p>
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
        {!isInstalled() && <button className="text-button install-link" type="button" onClick={() => setInstall(true)}><Download size={16} aria-hidden="true" /> Install Show Up</button>}
      </div>
    </div>
  </main><Credit />{install && <InstallDialog close={() => setInstall(false)} />}</>;
}

function Inbox({ invites, notices, unread, user, loading, close, inviteAction, markRead, openNotice, settings }) {
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  async function run(key, work) {
    setBusy(key);
    setError('');
    try { await work(); }
    catch (error) { setError(error.message); }
    finally { setBusy(''); }
  }
  return <Modal title="Inbox" close={close}><div className="form inbox">
    {invites.map(item => <article className="inbox-invite" key={item.id}>
      <div><strong>{item.name}</strong><p>{item.from} invited you to join.</p></div>
      <div className="quick-actions">
        <Button busy={busy === item.id} disabled={Boolean(busy)} onClick={() => run(item.id, () => inviteAction(item.id, 'join'))}>Join pact</Button>
        <Button kind="outline" disabled={Boolean(busy)} onClick={() => run(item.id, () => inviteAction(item.id, 'declineInvite'))}>Decline</Button>
      </div>
    </article>)}
    {notices.slice(0, 40).map(notice => <button className="inbox-row" key={notice.id} onClick={() => openNotice(notice)}>
      <span>{pactName(notice.pact)}<strong>{notice.message}</strong></span><time>{labelDay(localDay(notice.at, user.settings.zone))}</time>
    </button>)}
    {!invites.length && !notices.length && (loading ? <p role="status" className="field-note">Loading your inbox…</p>
      : <Empty icon={Bell} title="You’re caught up">Invites and check-in reminders appear here.</Empty>)}
    <ErrorNote error={error} />
    <footer className="form-actions">
      <button className="text-button" type="button" onClick={settings}>Push reminders</button>
      {unread > 0 && <Button kind="outline" busy={busy === 'read'} disabled={Boolean(busy)} onClick={() => run('read', markRead)}>Mark all as read</Button>}
    </footer>
  </div></Modal>;
}

function Workspace({ live, demo, token, invite, inviteError, onDemoExit, applyInvite, dismissInvite, sync, syncError, mutate, accountAction, logout }) {
  const { user, pacts, now, invites = [], loading } = live;
  const [page, setPage] = useState('today');
  const [pactId, setPactId] = useState(null);
  const [day, setDay] = useState(() => localDay(now, user.settings.zone));
  const [dialog, setDialog] = useState(() => !demo && !token && initialInbox() ? { kind: 'inbox' } : null);
  const [toast, setToast] = useState(null);
  const pact = pacts.find(entry => entry.id === pactId);
  const notices = useMemo(() => pactNotices(pacts, user, now), [pacts, user, now]);
  const noticeCount = [...notices, ...invites].filter(notice => notice.at > (user.inboxSince || 0)).length;
  const close = () => setDialog(null);
  const open = (kind, payload) => setDialog({ kind, payload });
  const navigate = (newPage, id = null) => {
    setPage(newPage);
    setPactId(id);
    window.scrollTo({ top: 0, behavior: 'instant' });
  };
  const openPact = id => navigate('pacts', id);
  useEffect(() => { if (!demo) updateBadge(noticeCount); }, [demo, noticeCount]);
  useEffect(() => {
    const received = event => {
      if (event.data?.type !== 'show-up:today' || (dialog && dialog.kind !== 'inbox')) return;
      setDialog(null);
      setPage('today');
      setPactId(null);
      window.scrollTo({ top: 0, behavior: 'instant' });
      sync?.();
    };
    navigator.serviceWorker?.addEventListener('message', received);
    return () => navigator.serviceWorker?.removeEventListener('message', received);
  }, [dialog, sync]);
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
  const draftForDialog = dialog?.draft;
  const openPactDialog = (kind, payload, draft) => setDialog({ kind, payload, draft });
  const signature = draftForDialog?.enrolVersion ? { enrolVersion: draftForDialog.enrolVersion } : { revision: draftForDialog?.revision };
  const payload = dialog?.payload;
  const bell = !demo && <IconButton title={'Inbox' + (noticeCount ? ', ' + noticeCount + ' unread' : '')}
    onClick={() => open('inbox')}><Bell size={19} aria-hidden="true" />{noticeCount > 0 && <i className="unread-dot" />}</IconButton>;
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
      {demo ? <Button kind="outline" onClick={onDemoExit}>Exit demo</Button> : <div className="mobile-actions">
        {bell}<button className="mobile-profile" onClick={() => open('settings')} aria-label="Account settings"><Avatar name={user.name} initials={initials(user.name)} /></button>
      </div>}
    </header>
    <main id="main" className="workspace" tabIndex={-1}>
      <div className="workspace-inner">
        <div className={'workspace-top' + (demo ? ' demo-top' : '')}><span>{demo ? <span className="demo-label">Demo · Sample data</span> : <span className="workspace-title">{page === 'pacts' && pact ? 'Group pact' : tabs.find(tab => tab.id === page).label}</span>}</span>
          {bell}
        </div>
        {page !== 'today' && syncError && <div className="sync-banner"><span>{syncError}</span><Button kind="outline" onClick={sync}>Retry</Button></div>}
        {page === 'today' && <Today user={user} pacts={pacts} now={now} demo={demo} log={log} openPact={openPact} create={() => open('create')}
          loading={loading} syncError={syncError} retry={sync} />}
        {page === 'calendar' && <Calendar user={user} pacts={pacts} now={now} demo={demo} day={day} setDay={setDay} log={log}
          personEvent={date => open('event', date)} removeEvent={event => open('removeEvent', event)} />}
        {page === 'pacts' && (pact ? <PactDetail key={pact.id} pact={pact} user={user} now={now} demo={demo} goBack={() => navigate('pacts')} modal={openPactDialog} action={guarded} />
          : <PactList pacts={pacts} now={now} demo={demo} open={openPact} create={() => open('create')} />)}
        <Credit />
      </div>
    </main>
    {toast && <div className={'toast' + (toast.error ? ' toast-error' : '')} role={toast.error ? 'alert' : 'status'}>{toast.error ? <CircleAlert size={19} /> : <Check size={19} />}{toast.message}</div>}
    {token && !demo && <SimpleDialog title={invite ? 'Join ' + invite.name : 'Join a pact'} close={dismissInvite} label="Pact invitation" fields={[]} submit={inviteError ? 'Go to my pacts' : 'Join pact'}
      description={inviteError || (invite ? invite.from + ' invited you to join this group. You’re signed in as @' + user.handle + '.' : 'Checking the invitation…')}
      extra={!inviteError && <Button kind="outline" onClick={() => logout().catch(error => notify(error.message, true))}>Switch account</Button>}
      save={async () => { if (inviteError) { dismissInvite(); navigate('pacts'); return; } const result = await applyInvite(); openPact(result.pact.id); notify('You joined the pact.'); }} />}
    {dialog?.kind === 'create' && <TermsDialog now={now} close={close} save={async terms => {
      const result = await mutate('create', { terms }); close(); openPact(result.pact.id); notify('Pact created. Add your first goal.');
    }} />}
    {dialog?.kind === 'terms' && draftForDialog && <TermsDialog draft={draftForDialog} dailyCheckIns={pact.dailyCheckIns} now={now} close={close} save={async terms => {
      await pactAction('terms', { terms, revision: draftForDialog.revision }, 'Terms saved.'); close();
    }} />}
    {dialog?.kind === 'goal' && draftForDialog && <GoalDialog goal={payload} draft={draftForDialog} dailyCheckIns={pact.dailyCheckIns} close={close} save={async goal => {
      await pactAction('saveGoal', { goal, ...signature }, 'Goal saved.'); close();
    }} />}
    {dialog?.kind === 'removeGoal' && draftForDialog && <SimpleDialog title={'Remove ' + payload.name + '?'} description="Add another goal before signing." fields={[]} close={close} confirm submit="Remove goal" save={async () => {
      await pactAction('deleteGoal', { goal: payload, ...signature }, 'Goal removed.'); close();
    }} />}
    {dialog?.kind === 'sign' && draftForDialog && <SignDialog draft={draftForDialog} close={close} save={async () => {
      await pactAction('sign', signature, response => response.pact.draft ? 'Your signature was saved.' : 'Pact signed.'); close();
    }} />}
    {dialog?.kind === 'invite' && pact && <InviteDialog pact={pact} now={now} close={close} notify={notify}
      read={async () => { const result = await pactAction('inviteLink', {}); return result.inviteToken ? inviteUrl(result.inviteToken) : ''; }}
      renew={async () => inviteUrl((await pactAction('invite', {})).inviteToken)}
      revoke={() => pactAction('revoke', {}, 'Link revoked.')}
      inviteAccount={handle => pactAction('inviteAccount', { handle })} />}
    {dialog?.kind === 'log' && <LogDialog entry={payload.entry} existing={payload.existing} favourite={user.favourites[payload.entry.goal.id]} now={now} close={close}
      save={async (action, data, approval, pin) => {
        const result = await pactAction(action, data, null, payload.entry.pact.id);
        const requested = result.pact.requests.some(request => request.status === 'pending' && request.entry?.id === (data.logId || data.key));
        if (pin && !data.remove) {
          try { await accountAction('favourite', { goalId: data.goalId, amount: data.amount }); }
          catch { notify('Check-in saved. The favourite couldn’t be saved.', true); close(); return; }
        }
        notify(approval || requested ? 'Check-in sent for review.' : data.remove ? 'Check-in removed.' : 'Check-in saved.');
        close();
      }} />}
    {dialog?.kind === 'excuse' && <SimpleDialog title="Request excused days" label={pactName(pact)} close={close} submit="Send request"
      description="Another signed member can approve these dates before the checkpoint closes."
      fields={[{ name: 'first', type: 'date', label: 'First date', value: localDay(now, pactZone(pact)), required: true }, { name: 'last', type: 'date', label: 'Last date', value: localDay(now, pactZone(pact)), required: true }, { name: 'reason', label: 'Reason to share (optional)' }]}
      save={async data => { await pactAction('excuse', data, 'Request sent.'); close(); }} />}
    {dialog?.kind === 'flag' && <SimpleDialog title="Flag this result" close={close} fields={[{ name: 'reason', label: 'What should the group review?', max: 160 }]} submit="Flag result"
      save={async data => { await pactAction('flagOutcome', { id: payload.id, ...data }, 'Flag added.'); close(); }} />}
    {dialog?.kind === 'endPact' && <SimpleDialog title="End this group pact?" close={close} confirm fields={[]} submit="End pact"
      description="Future check-ins close for the whole group. Members can still view their history."
      save={async () => { await pactAction('endPact', {}, 'Pact ended.'); close(); }} />}
    {dialog?.kind === 'discardRevision' && <SimpleDialog title="Discard this draft?" close={close} confirm fields={[]} submit="Discard draft"
      description="The current signed version will continue." save={async () => { await pactAction('discardRevision', { revision: draftForDialog.revision }, 'Draft discarded.'); close(); }} />}
    {dialog?.kind === 'event' && <SimpleDialog title="Add a personal event" close={close} description="This event only appears in your calendar."
      fields={[{ name: 'title', label: 'Event name', max: 80, required: true }, { name: 'day', label: 'Date', type: 'date', value: payload, required: true }, { name: 'time', label: 'Time (optional)', type: 'time' }, { name: 'note', label: 'Private note (optional)', max: 280 }]}
      save={async data => { await accountAction('event', data); close(); notify('Personal event added.'); }} />}
    {dialog?.kind === 'removeEvent' && <SimpleDialog title={'Remove ' + payload.title + '?'} fields={[]} close={close} confirm submit="Remove event"
      save={async () => { await accountAction('removeEvent', { id: payload.id }); close(); notify('Event removed.'); }} />}
    {dialog?.kind === 'settings' && <Modal title="Account settings" close={close}><div className="form settings-pane">
      <div className="account-row"><Avatar name={user.name} initials={initials(user.name)} /><div><strong>{user.name}</strong><span>@{user.handle}</span></div></div>
      <Button kind="outline" icon={<Bell size={17} />} onClick={() => open('push')}>Push reminders</Button>
      <Button kind="outline" icon={<Download size={17} />} onClick={() => open('install')}>Install Show Up</Button>
      <Button kind="outline" icon={<Settings2 size={17} />} onClick={() => open('zone')}>Time zone</Button>
      <Button kind="outline" icon={<LogOut size={17} />} onClick={() => logout().catch(error => notify(error.message, true))}>Sign out</Button>
    </div></Modal>}
    {dialog?.kind === 'zone' && <SimpleDialog title="My time zone" close={close} description="This sets the date on Today and in your personal calendar. Use a name such as Australia/Sydney."
      fields={[{ name: 'zone', label: 'Time zone', value: user.settings.zone, required: true }]}
      save={async settings => { await accountAction('settings', { settings }); close(); notify('Time zone saved.'); }} />}
    {dialog?.kind === 'install' && <InstallDialog close={close} />}
    {dialog?.kind === 'push' && <PushSettings close={close} openInstall={() => open('install')} />}
    {dialog?.kind === 'inbox' && <Inbox invites={invites} notices={notices} user={user} unread={noticeCount} loading={loading} close={close}
      settings={() => open('push')} markRead={() => accountAction('inboxRead', {})} inviteAction={async (id, action) => {
        const result = await mutate(action, { pactId: id });
        if (result.pact) { close(); openPact(result.pact.id); notify('You joined the pact.'); }
      }} openNotice={notice => { close(); if (notice.today) navigate('today'); else openPact(notice.pact.id); }} />}
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
  const [offline, setOffline] = useState(false);
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
      if (error.status === 401) {
        updateBadge(0);
        setLive(null);
      } else {
        setSyncError(error.message);
        setLive(old => old ? { ...old, loading: false } : old);
      }
    } finally { syncing.current = false; }
  }, []);
  useEffect(() => {
    let active = true;
    api('session').then(result => {
      if (!active) return;
      setSetup(Boolean(result.setupNeeded));
      if (result.user) { setLive({ user: result.user, pacts: [], now: result.now, loading: true }); sync(); }
    }).catch(error => {
      if (active) { setOffline(Boolean(error.connection)); setSyncError(error.message); }
    }).finally(() => { if (active) setReady(true); });
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
    const interval = setInterval(() => { if (!document.hidden) sync(); }, 25000);
    const visible = () => { if (!document.hidden) sync(); };
    window.addEventListener('focus', sync);
    window.addEventListener('online', sync);
    document.addEventListener('visibilitychange', visible);
    return () => {
      clearInterval(interval);
      window.removeEventListener('focus', sync);
      window.removeEventListener('online', sync);
      document.removeEventListener('visibilitychange', visible);
    };
  }, [signedIn, sync]);
  useEffect(() => {
    if (!offline || signedIn) return;
    const reconnect = () => window.location.reload();
    window.addEventListener('online', reconnect);
    return () => window.removeEventListener('online', reconnect);
  }, [offline, signedIn]);
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
        const joinedId = action === 'join' ? result.pact?.id : action === 'declineInvite' ? data.pactId : undefined;
        const invites = joinedId ? old.invites?.filter(invite => invite.id !== joinedId) : old.invites;
        return { ...old, pacts, invites, user: result.user ?? old.user, now: result.now ?? old.now };
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
    setLive({ user: result.user, pacts: [], now: result.now, loading: true });
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
    const subscription = await deviceSubscription().catch(() => null);
    await api('logout', { endpoint: subscription?.endpoint });
    if (subscription) await subscription.unsubscribe().catch(() => {});
    updateBadge(0);
    setLive(null);
  }
  if (!ready) return <main className="loading"><Brand /><p role="status">Loading your workspace…</p></main>;
  if (demo) return <Workspace key="demo" live={demo} demo onDemoExit={() => setDemo(null)} />;
  if (offline && !signedIn) return <div className="offline-layout">
    <main className="offline-content"><Brand /><h1><WifiOff size={29} aria-hidden="true" /> Can’t connect to Show Up.</h1>
      <p>Reconnect to open your pacts and check in.</p>
      <Button onClick={() => window.location.reload()}>Try again</Button>
    </main><Credit />
  </div>;
  if (!signedIn) return <Guest setup={setup} signIn={signIn} tryDemo={() => { const now = Date.now(); setDemo({ ...demoData(now), now }); }} invite={invite} inviteError={inviteError} loadError={syncError} />;
  return <Workspace key={live.user.id} live={live} token={token} invite={invite} inviteError={inviteError} applyInvite={applyInvite} dismissInvite={dismissInvite}
    sync={sync} syncError={syncError} mutate={mutate} accountAction={mutate} logout={logout} />;
}

createRoot(document.getElementById('root')).render(<App />);
