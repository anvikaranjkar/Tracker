import assert from 'node:assert/strict';
import { mkdir, readFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { chromium, devices } from 'playwright';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const base = process.env.SHOWUP_TEST_URL || 'http://127.0.0.1:5173';
const stamp = randomBytes(4).toString('hex');
const password = 'Browser-test-password!';
const output = 'test-results';
await mkdir(output, { recursive: true });
const axe = await readFile(require.resolve('axe-core/axe.min.js'), 'utf8');
const browser = await chromium.launch();
const errors = [];

const tab = async options => {
  const context = await browser.newContext({ acceptDownloads: true, ...options });
  const page = await context.newPage();
  page.on('pageerror', error => errors.push(error.message));
  return page;
};
const button = (page, name) => page.getByRole('button', { name, exact: true });
async function inspect(page, file) {
  await page.screenshot({ path: output + '/' + file + '.png', fullPage: true });
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), true, file + ' horizontal overflow');
  await page.evaluate(axe);
  const violations = await page.evaluate(async () => (await window.axe.run({ runOnly: { type: 'tag', values: ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'] } })).violations);
  assert.deepEqual(violations.map(item => ({ id: item.id, nodes: item.nodes.map(node => node.target) })), [], file + ' accessibility findings');
}
async function signup(page, username, name) {
  await page.getByRole('heading', { name: 'Create your account' }).waitFor();
  await page.getByLabel('Name', { exact: true }).fill(name);
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await button(page, 'Create account').click();
}
async function addGoal(page, name, subject) {
  await button(page, 'Add goal').click();
  await page.getByLabel('Subject', { exact: true }).fill(subject);
  await page.getByLabel('Goal name').fill(name);
  await button(page, 'Continue').click();
  await button(page, 'Continue').click();
  await button(page, 'Save goal').click();
  await page.getByText(name, { exact: true }).waitFor();
}
async function signature(page, hold) {
  await button(page, 'Sign pact').click();
  if (hold) await button(page, 'Hold to sign').click({ delay: 950 });
  else await button(page, 'Confirm signature').click();
}
try {
  for (const [name, width, height] of [['desktop', 1440, 1000], ['phone', 390, 844]]) {
    const page = await tab({ viewport: { width, height }, reducedMotion: name === 'phone' ? 'reduce' : 'no-preference' });
    await page.goto(base);
    await button(page, 'Explore the demo').click();
    await page.keyboard.press('Tab');
    assert.equal(await page.evaluate(() => document.activeElement.textContent.trim()), 'Skip to content');
    await inspect(page, name + '-today');
    await button(page, 'Calendar').click();
    await inspect(page, name + '-calendar');
    await button(page, 'Month').click();
    assert.equal(await page.locator('.month .day-cell').count(), 42);
    await button(page, 'Agenda').click();
    await button(page, 'Pacts').click();
    await page.locator('.pact-index-row').first().click();
    await page.getByText('Both signatures on file').waitFor();
    await inspect(page, name + '-match-sheet');
    await page.context().close();
  }

  const alex = await tab({ ...devices['iPhone 13'], defaultBrowserType: 'chromium' });
  const sam = await tab({ viewport: { width: 1280, height: 900 } });
  await alex.goto(base);
  await button(alex, 'Create an account').click();
  await signup(alex, 'alex_' + stamp, 'Alex QA');
  await alex.getByRole('heading', { name: 'Today.' }).waitFor();
  await button(alex, 'Make a pact').click();
  await alex.getByLabel('Pact name').fill('Browser check pact');
  await alex.getByLabel('Cutoff time').fill('23:59');
  await button(alex, 'Create pact').click();
  await addGoal(alex, 'Review an essay', 'English');
  await button(alex, 'Invite a friend').click();
  await button(alex, 'Create invite link').click();
  const invite = await alex.getByLabel('Shareable invite link').inputValue();
  assert.match(invite, new RegExp('^' + new URL(base).origin.replace(/[.*+?^{}()|[\]\\]/g, '\\$&')));
  await button(alex, 'Close dialog').click();
  await sam.goto(invite);
  await sam.getByText('Alex QA invited you to Browser check pact.').waitFor();
  await signup(sam, 'sam_' + stamp, 'Sam QA');
  await button(sam, 'Join pact').click();
  await addGoal(sam, 'Chemistry revision', 'Chemistry');
  await alex.bringToFront();
  await button(alex, 'Sign pact').waitFor({ timeout: 22000 });
  await signature(alex, true);
  await alex.getByText('Signed by you. Waiting for Sam.').waitFor();
  await sam.bringToFront();
  await signature(sam, false);
  await sam.getByText('Both signatures on file').waitFor();
  await button(sam, 'Today').click();
  await button(sam, 'Log check-in').click();
  await sam.context().setOffline(true);
  await button(sam, 'Save check-in').click();
  await sam.getByText('Couldn’t reach Show Up. Check your connection and try again.').waitFor();
  assert.equal(await sam.getByLabel('Amount (min)').inputValue(), '25');
  await sam.context().setOffline(false);
  await button(sam, 'Save check-in').click();
  await sam.getByText('Check-in saved.').waitFor();
  await alex.bringToFront();
  await button(alex, 'Today').click();
  await alex.getByText('25 / 120 min', { exact: true }).waitFor({ timeout: 22000 });
  await button(sam, 'Calendar').click();
  const download = sam.waitForEvent('download');
  await button(sam, 'Export visible schedule (.ics)').click();
  const calendar = await download;
  assert.equal(calendar.suggestedFilename(), 'show-up-calendar.ics');
  assert.match(await readFile(await calendar.path(), 'utf8'), /BEGIN:VCALENDAR\r\n/);
  assert.deepEqual(errors, []);
  console.log('Two browser sessions, offline retry, calendar export, and responsive accessibility checks passed.');
} finally {
  await browser.close();
}
