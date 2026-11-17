import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { once } from 'node:events';
import { createServer, request as httpRequest } from 'node:http';
import { request as httpsRequest } from 'node:https';
import { chromium, devices, webkit } from 'playwright';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const base = process.env.SHOWUP_TEST_URL || 'http://127.0.0.1:5173';
const stamp = randomBytes(4).toString('hex');
const password = 'Browser-test-password!';
const engine = process.env.SHOWUP_BROWSER === 'webkit' ? webkit : chromium;
const output = 'test-results/' + engine.name();
await mkdir(output, { recursive: true });
const axe = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const browser = await engine.launch();
const errors = [];
const tab = async options => {
  const context = await browser.newContext({ acceptDownloads: true, timezoneId: 'Australia/Sydney', ...options });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  page.on('pageerror', error => errors.push(error.message));
  return page;
};
const button = (page, name) => page.getByRole('button', { name, exact: true });
const heading = (page, name) => page.getByRole('heading', { name, exact: true });
const phone = devices['iPhone 13'];

async function inspect(page, file) {
  await page.screenshot({ path: output + '/' + file + '.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, file + ' horizontal overflow');
  await page.evaluate(axe);
  const violations = await page.evaluate(async () => (await window.axe.run({
    runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] }
  })).violations);
  assert.deepEqual(violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], file + ' accessibility findings');
}
async function signup(page, username, name) {
  await heading(page, 'Create your account').waitFor();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Username', { exact: true }).fill(username);
  await page.getByLabel('Password').fill(password);
  await button(page, 'Create account').click();
  await heading(page, 'Today.').waitFor();
}
async function addGoal(page, name, measure) {
  await button(page, 'Add goal').click();
  await page.getByLabel('Goal name', { exact: true }).fill(name);
  if (measure) {
    await page.getByLabel('Measure', { exact: true }).selectOption('min');
    await page.getByLabel('Target', { exact: true }).fill('25');
  }
  await button(page, 'Save goal').click();
  await page.locator('.personal-goal').getByText(name, { exact: true }).waitFor();
}
async function sign(page) {
  await button(page, 'Sign pact').click();
  await button(page, 'Confirm signature').click();
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
}
async function pwa(page) {
  const manifest = await (await page.request.get(new URL('/manifest.webmanifest', base).href)).json();
  assert.equal(manifest.id, '/');
  assert.equal(manifest.start_url, '/');
  assert.equal(manifest.display, 'standalone');
  await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith('/sw.js'));
  if (engine === chromium) {
    const cdp = await page.context().newCDPSession(page);
    const { installabilityErrors } = await cdp.send('Page.getInstallabilityErrors');
    assert.deepEqual(installabilityErrors, []);
    const origin = new URL(base).origin;
    await page.context().grantPermissions(['notifications'], { origin });
    const registration = new Promise(resolve => {
      cdp.on('ServiceWorker.workerRegistrationUpdated', ({ registrations }) => {
        const found = registrations.find(item => item.scopeURL === origin + '/' && !item.isDeleted);
        if (found) resolve(found.registrationId);
      });
    });
    await cdp.send('ServiceWorker.enable');
    let timer;
    try {
      const registrationId = await Promise.race([registration, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error('Chromium did not report a service worker registration.')), 8000);
      })]);
      await cdp.send('ServiceWorker.deliverPushMessage', {
        origin, registrationId,
        data: JSON.stringify({ notification: { title: 'Show Up', body: 'Your daily check-in is still open.' } })
      });
      await page.waitForFunction(async () => (await (await navigator.serviceWorker.ready).getNotifications({ tag: 'daily-check-in' })).length === 1);
    } finally { clearTimeout(timer); }
    await cdp.detach();
  }
  await page.context().setOffline(true);
  await page.reload();
  await heading(page, 'You’re offline.').waitFor();
  await page.screenshot({ path: output + '/offline.png' });
  await page.context().setOffline(false);
  await heading(page, 'Today.').waitFor({ timeout: 16000 });
}

async function webkitOffline() {
  // WebKit's context-wide offline emulation stops navigation before the service worker can handle it.
  // Cut the actual upstream connection and keep the browser online so its fetch reaches the worker.
  let connected = true;
  const upstream = new URL(base);
  const request = upstream.protocol === 'https:' ? httpsRequest : httpRequest;
  const proxy = createServer((req, res) => {
    if (!connected) { res.destroy(); return; }
    const requestToApp = request(upstream, { path: req.url, method: req.method, headers: req.headers }, response => {
      res.writeHead(response.statusCode, response.headers);
      response.pipe(res);
    });
    requestToApp.on('error', () => res.destroy());
    req.pipe(requestToApp);
  });
  proxy.listen(0, '127.0.0.1');
  await once(proxy, 'listening');
  const page = await tab(phone);
  try {
    await page.goto('http://127.0.0.1:' + proxy.address().port);
    await heading(page, 'Welcome back.').waitFor();
    await page.waitForFunction(() => navigator.serviceWorker.controller?.scriptURL.endsWith('/sw.js'));
    connected = false;
    await page.reload();
    await heading(page, 'You’re offline.').waitFor();
    await page.screenshot({ path: output + '/offline.png' });
    connected = true;
    await button(page, 'Try again').tap();
    await heading(page, 'Welcome back.').waitFor();
  } finally {
    await page.context().close();
    proxy.close();
  }
}

let current;
try {
  for (const [name, width, height] of [['desktop', 1440, 1000], ['phone', 390, 844], ['small-phone', 320, 700]]) {
    const page = current = await tab({ ...(name.includes('phone') ? phone : {}), viewport: { width, height }, reducedMotion: 'reduce' });
    await page.goto(base);
    if (name === 'phone') {
      await inspect(page, 'phone-signin');
      await button(page, 'Install Show Up').tap();
      await page.getByRole('dialog').getByText(/Add to Home Screen/).first().waitFor();
      await button(page, 'Close dialog').tap();
    }
    await button(page, 'Explore the demo').click();
    await page.keyboard.press(engine === webkit ? 'Alt+Tab' : 'Tab');
    if (engine === webkit && !await page.locator('.skip').evaluate(node => node === document.activeElement)) {
      await page.getByRole('link', { name: 'Skip to content' }).focus();
    }
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Skip to content');
    await page.keyboard.press('Enter');
    await inspect(page, name + '-today');
    await button(page, 'Calendar').click();
    await inspect(page, name + '-calendar');
    await button(page, 'Month').click();
    assert.equal(await page.locator('.month .day-cell').count(), 42);
    await button(page, 'Agenda').click();
    await button(page, 'Pacts').click();
    await page.locator('.pact-index-row').first().click();
    await heading(page, 'Group members').waitFor();
    assert.equal(await page.locator('.member-row').count(), 5);
    await inspect(page, name + '-group');
    await page.context().close();
  }
  console.log(engine.name() + ' viewport and accessibility checks passed.');

  const alex = current = await tab({ viewport: { width: 1280, height: 900 } });
  const sam = await tab(phone);
  const casey = await tab({ ...phone, viewport: { width: 320, height: 690 } });
  await alex.goto(base);
  await button(alex, 'Create an account').click();
  await signup(alex, 'alex_' + stamp, 'Alex QA');
  await button(alex, 'Create a pact').click();
  await alex.getByLabel('Pact name', { exact: true }).fill('Browser check pact');
  const helper = button(alex, 'About Pact name');
  await helper.hover();
  await alex.getByRole('tooltip').waitFor();
  await alex.getByRole('tooltip').hover();
  assert.equal(await alex.getByRole('tooltip').isVisible(), true);
  await alex.keyboard.press('Escape');
  await alex.getByRole('tooltip').waitFor({ state: 'hidden' });
  assert.equal(await alex.getByRole('dialog').isVisible(), true);
  await alex.getByLabel('Pact name', { exact: true }).focus();
  await alex.keyboard.press(engine === webkit ? 'Alt+Shift+Tab' : 'Shift+Tab');
  if (engine === webkit && !await helper.evaluate(node => node === document.activeElement)) await helper.focus();
  assert.equal(await helper.evaluate(node => node === document.activeElement), true);
  await alex.getByRole('tooltip').waitFor();
  await alex.keyboard.press('Escape');
  await alex.getByRole('tooltip').waitFor({ state: 'hidden' });
  await button(alex, 'Randomise').click();
  const forfeit = alex.getByLabel('Agreed forfeit', { exact: true });
  const first = await forfeit.inputValue();
  assert.ok(first.length > 10);
  await button(alex, 'Randomise').click();
  assert.notEqual(await forfeit.inputValue(), first);
  await button(alex, 'Write your own').click();
  await forfeit.fill('Buy another member a Slushie or give them $5.');
  await button(alex, 'Create pact').click();
  await heading(alex, 'Agreement').waitFor();
  await addGoal(alex, 'Review an essay', true);
  await sign(alex);
  await button(alex, 'Invite members').click();
  await button(alex, 'Create invite link').click();
  const field = alex.getByLabel('Shareable invite link', { exact: true });
  await field.waitFor();
  const invite = await field.inputValue();
  assert.equal(new URL(invite).origin, new URL(base).origin);
  await button(alex, 'Close dialog').click();
  await button(alex, 'Invite members').click();
  await field.waitFor();
  assert.equal(await field.inputValue(), invite);

  current = casey;
  await casey.goto(base);
  await button(casey, 'Create an account').click();
  await signup(casey, 'casey_' + stamp, 'Casey QA');
  await button(casey, 'Create a pact').tap();
  const tapHelp = button(casey, 'About Weekly checkpoint rule');
  const box = await tapHelp.boundingBox();
  assert.ok(box.width >= 43 && box.height >= 43, 'Help button has room to tap');
  await tapHelp.tap();
  await casey.getByRole('tooltip').waitFor();
  await inspect(casey, 'small-phone-setup');
  await tapHelp.tap();
  await casey.getByRole('tooltip').waitFor({ state: 'hidden' });
  await button(casey, 'Close dialog').tap();
  await alex.getByLabel('Show Up username', { exact: true }).fill('@casey_' + stamp);
  const sent = alex.waitForResponse(response => response.url().endsWith('/api/showup') && response.request().postDataJSON()?.action === 'inviteAccount');
  await button(alex, 'Send invite').click();
  assert.ok((await sent).ok());
  await button(alex, 'Close dialog').click();
  await casey.reload();
  await casey.getByRole('button', { name: 'Inbox, 1 unread' }).tap();
  await casey.getByText('Alex QA invited you to join.').waitFor();
  await button(casey, 'Join pact').click();
  await addGoal(casey, 'Take a walk', false);
  await sign(casey);

  current = sam;
  await sam.goto(invite);
  await sam.getByText('Alex QA invited you to Browser check pact.').waitFor();
  await signup(sam, 'sam_' + stamp, 'Sam QA');
  await button(sam, 'Join pact').click();
  await addGoal(sam, 'Chemistry revision', true);
  await sign(sam);
  await sam.getByText('3 members', { exact: true }).first().waitFor();
  await button(sam, 'Today').tap();
  await sam.getByRole('button', { name: /Inbox/ }).tap();
  await sam.getByText('Your check-in is still open.', { exact: true }).tap();
  await button(sam, 'Check in for Chemistry revision').tap();
  if (engine === chromium) {
    await sam.context().setOffline(true);
    await button(sam, 'Save check-in').click();
    await sam.getByText('Couldn’t reach Show Up. Check your connection and try again.', { exact: true }).last().waitFor();
    assert.equal(await sam.getByLabel('Amount (min)').inputValue(), '25');
    await sam.context().setOffline(false);
  }
  await button(sam, 'Save check-in').click();
  await sam.getByText('Check-in saved.', { exact: true }).waitFor();
  await button(sam, 'Edit for Chemistry revision').click();
  await sam.getByLabel('Amount (min)').fill('30');
  await button(sam, 'Save changes').click();
  await sam.getByRole('dialog').waitFor({ state: 'hidden' });
  if (process.env.SHOWUP_EXPECT_PWA === '1') {
    if (engine === webkit) await webkitOffline();
    else await pwa(sam);
  }
  await button(sam, 'Calendar').click();
  const download = sam.waitForEvent('download');
  await button(sam, 'Export visible schedule (.ics)').click();
  const calendar = await download;
  assert.equal(calendar.suggestedFilename(), 'show-up-calendar.ics');
  assert.match(await readFile(await calendar.path(), 'utf8'), /BEGIN:VCALENDAR\r\n/);
  assert.deepEqual(errors, []);
  console.log(engine.name() + ' group, invite, help, daily check-in, and calendar flows passed.');
} catch (error) {
  await current?.screenshot({ path: output + '/failure.png', timeout: 3000 }).catch(() => {});
  throw error;
} finally {
  await browser.close();
}
