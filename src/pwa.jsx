import { useEffect, useState } from 'react';
import { Download } from 'lucide-react';
import { api } from './model.mjs';
import { Button, ErrorNote, Modal } from './ui.jsx';

let prompt;
const appMode = matchMedia('(display-mode: standalone)');
export const isInstalled = () => appMode.matches || navigator.standalone === true;
const applePhone = /iPhone|iPad|iPod/i.test(navigator.userAgent)
  || (/Macintosh/i.test(navigator.userAgent) && navigator.maxTouchPoints > 1);

window.addEventListener('beforeinstallprompt', event => {
  event.preventDefault();
  prompt = event;
  window.dispatchEvent(new Event('show-up:install-ready'));
});
window.addEventListener('appinstalled', () => {
  prompt = null;
  window.dispatchEvent(new Event('show-up:install-ready'));
});

const registered = import.meta.env.PROD && 'serviceWorker' in navigator
  ? navigator.serviceWorker.register('/sw.js', { updateViaCache: 'none' }).then(() => navigator.serviceWorker.ready).catch(() => null)
  : Promise.resolve(null);

export async function deviceSubscription() {
  if (!('serviceWorker' in navigator)) return null;
  const registration = await navigator.serviceWorker.getRegistration();
  return await registration?.pushManager?.getSubscription() ?? null;
}

export function updateBadge(count) {
  if (!isInstalled()) return;
  if (count > 0) navigator.setAppBadge?.(count).catch(() => {});
  else navigator.clearAppBadge?.().catch(() => {});
}

export function InstallDialog({ close }) {
  const [available, setAvailable] = useState(() => Boolean(prompt || navigator.install));
  const [installed, setInstalled] = useState(isInstalled);
  const [error, setError] = useState('');
  useEffect(() => {
    const update = () => { setAvailable(Boolean(prompt || navigator.install)); setInstalled(isInstalled()); };
    const complete = () => { setInstalled(true); setAvailable(false); };
    appMode.addEventListener('change', update);
    window.addEventListener('show-up:install-ready', update);
    window.addEventListener('appinstalled', complete);
    return () => {
      appMode.removeEventListener('change', update);
      window.removeEventListener('show-up:install-ready', update);
      window.removeEventListener('appinstalled', complete);
    };
  }, []);
  async function install() {
    setError('');
    try {
      if (prompt) {
        const event = prompt;
        prompt = null;
        const result = await event.prompt();
        if (result.outcome === 'accepted') setInstalled(true);
        else setAvailable(Boolean(navigator.install));
      } else {
        await navigator.install();
        setInstalled(true);
      }
    } catch (error) {
      if (error.name !== 'AbortError') setError('Use your browser’s install menu to add Show Up.');
    }
  }
  const mac = /Macintosh/i.test(navigator.userAgent) && !applePhone;
  const android = /Android/i.test(navigator.userAgent);
  return <Modal title="Install Show Up" close={close}><div className="form">
    {installed ? <p className="field-note">Show Up is installed on this device.</p> : <>
      {available && <div className="quick-actions"><Button onClick={install} icon={<Download size={17} />}>Install app</Button></div>}
      {applePhone ? <><p className="field-note">In Safari, tap <strong>Share</strong>, then <strong>Add to Home Screen</strong>. Keep <strong>Open as Web App</strong> on if you see it.</p>
        <p className="field-note">Open Show Up from your Home Screen to sign in and enable push reminders.</p></>
        : mac ? <p className="field-note">In Safari, choose <strong>File → Add to Dock</strong>. In Chrome or Edge, use the install icon in the address bar or the browser’s app menu.</p>
        : android ? <p className="field-note">In Chrome, open the menu and choose <strong>Add to Home screen → Install</strong>.</p>
        : <p className="field-note">In Chrome or Edge, use the install icon in the address bar or the browser’s app menu.</p>}
    </>}
    <ErrorNote error={error} />
  </div></Modal>;
}

export function PushSettings({ close, openInstall }) {
  const supported = 'PushManager' in window && 'Notification' in window;
  const needsInstall = applePhone && !isInstalled();
  const [device, setDevice] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [blocked, setBlocked] = useState(() => supported && Notification.permission === 'denied');
  useEffect(() => {
    if (!supported || needsInstall) return;
    let active = true;
    let timer;
    (async () => {
      try {
        const registration = await Promise.race([registered, new Promise(resolve => { timer = setTimeout(resolve, 8000, null); })]);
        const subscription = await registration?.pushManager?.getSubscription();
        const status = await api('pushStatus', { endpoint: subscription?.endpoint });
        if (active) setDevice({ registration, subscription, ...status });
      } catch (error) {
        if (active) setError(error.message);
      } finally {
        clearTimeout(timer);
      }
    })();
    return () => { active = false; clearTimeout(timer); };
  }, [supported, needsInstall]);
  async function toggle() {
    setError('');
    setBusy(true);
    try {
      if (device.enabled && device.subscription) {
        await api('pushDisable', { endpoint: device.subscription.endpoint });
        await device.subscription.unsubscribe().catch(() => {});
        setDevice({ ...device, enabled: false, subscription: null });
        return;
      }
      let subscription = device.subscription;
      if (!subscription) {
        const applicationServerKey = Uint8Array.from(atob(device.publicKey.replaceAll('-', '+').replaceAll('_', '/')), ch => ch.charCodeAt(0));
        subscription = await device.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey });
      }
      await api('pushEnable', { subscription: subscription.toJSON() });
      setDevice({ ...device, enabled: true, subscription });
    } catch (error) {
      const denied = Notification.permission === 'denied';
      setBlocked(denied);
      setError(denied || error.name === 'NotAllowedError' ? 'Notification permission wasn’t granted.' : error.message);
    } finally { setBusy(false); }
  }
  return <Modal title="Push reminders" close={close}><div className="form">
    <p className="field-note">Get a reminder on this device when you still have a check-in to do. You’ll get at most one reminder a day.</p>
    {needsInstall ? <div className="quick-actions"><Button onClick={openInstall} kind="outline">Add to Home Screen first</Button></div>
      : !supported ? <p className="field-note">This browser doesn’t support push reminders. Reminders still appear in the inbox.</p>
      : blocked && !device?.enabled ? <p className="field-note">Allow Show Up notifications in your device or browser settings, then reopen this screen.</p>
      : device?.enabled || (device?.publicKey && device.registration) ? <div className="quick-actions">
        <Button onClick={toggle} busy={busy} kind={device.enabled ? 'outline' : 'primary'}>{device.enabled ? 'Turn off on this device' : 'Turn on push reminders'}</Button>
      </div>
      : device ? <p className="field-note">Push reminders are unavailable on this deployment. Your inbox still works.</p>
      : !error && <p className="field-note" role="status">Checking this device…</p>}
    <ErrorNote error={error} />
  </div></Modal>;
}
