# Show Up

Group accountability pacts for up to 50 members. Set your own goal, check in once a day and see how the group is going.

## Deploy to Vercel from GitHub

1. **Apply the database schema.** In your existing Neon database, open the SQL Editor and run all of [server/schema.sql](server/schema.sql). You can rerun it safely. It backfills membership for the existing pacts and keeps their accounts, goals, check-ins and history. For a fresh install, create a Neon project first and run the same file.
2. **Upload the source.** Extract the ZIP and upload its contents to the root of your GitHub repository with **Add file → Upload files**. The repository root should contain `package.json`, `vercel.json`, `index.html`, `api/`, `src/` and `server/`.
3. **Deploy.** Connect the repository to the existing Vercel project to keep its URL, or import the repository into a new Vercel project. Use the repo root, the Vite preset and Node.js 24. Set **`DATABASE_URL`** in Vercel’s Production environment to the pooled connection string for the Neon database from step 1, then deploy. Keep this value in Vercel’s environment settings.
4. **Try the group flow.** Create a pact, add your goal and sign. Open the same invite link in two other browser profiles. Each member can join, add a different goal and sign. On Today, log a check-in and reopen it with **Edit**.

[Vercel’s GitHub guide](https://vercel.com/docs/git/vercel-for-github) · [Neon’s connection guide](https://neon.com/docs/connect/connect-from-any-app)

## Install it

- **iPhone or iPad.** In Safari, use **Share → Add to Home Screen**. Keep **Open as Web App** enabled when offered. Launch the app from its icon before enabling push reminders. [WebKit’s Home Screen push guide](https://webkit.org/blog/13878/web-push-for-web-apps-on-ios-and-ipados/) · [Safari’s Open as Web App behaviour](https://webkit.org/blog/17333/webkit-features-in-safari-26-0/)
- **Mac.** In Safari, choose **File → Add to Dock**. Chrome and Edge offer installation through their address bar or app menu. [Apple’s Mac web app guide](https://support.apple.com/en-us/104996) · [Chrome’s installation guide](https://developer.chrome.com/docs/modern-web-guidance/guides/pwa/install-web-app)
- **Android.** In Chrome, use **Add to Home screen → Install** in the browser menu or use **Install Show Up** inside the app. [Manifest and installation guidance](https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps/Guides/Making_PWAs_installable)

The app opens to Today. The service worker caches the offline screen and public app resources. Check-ins save when connected. If the connection drops during a check-in, keep the form open and retry when it returns.

## Optional notifications when the app is closed

In-app invites and reminders are included with the core deployment. To send push reminders as well, install the project dependencies on your computer, then generate a key pair and a cron secret once.

```sh
npm ci
npx --no-install web-push generate-vapid-keys
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

Set these in Vercel’s **Production** environment, then redeploy.

| Variable | Value |
| --- | --- |
| `VAPID_SUBJECT` | A real contact URI such as `mailto:you@example.com` with your actual address |
| `VAPID_PUBLIC_KEY` | The generated public key |
| `VAPID_PRIVATE_KEY` | The generated private key |
| `CRON_SECRET` | The generated random hex string |

After deploying, each member can use **Account settings → Push reminders → Turn on push reminders** on each device they want to notify. Keep the original key pair for future deploys. Vercel sends the cron secret to the included reminder job automatically. [Web Push key guide](https://github.com/web-push-libs/web-push#generatevapidkeys) · [Vercel cron authentication](https://vercel.com/docs/schedules/cron-jobs/manage-cron-jobs#securing-cron-jobs)

The included job runs once daily during the **08:00 UTC hour**. In Sydney that’s the 6 pm hour on standard time or 7 pm on daylight saving time. Vercel Hobby can run it anywhere in that hour. A device gets a reminder only if the account has a check-in still open and unlogged when the job runs. Change the UTC schedule in `vercel.json` if your group uses a different evening window. [Vercel Hobby cron timing](https://vercel.com/docs/schedules/cron-jobs/usage-and-pricing#hobby-scheduling-limits)

## How pacts work

- The organiser can share a reusable link or send an inbox invite to a Show Up username. Invite links last seven days and can be copied again, replaced or revoked.
- The organiser publishes the terms by signing. Members set their own goal and sign independently. A member who signs after the start date begins on the day they sign, or the next day if the cutoff has passed. For revisions, members who already signed the current agreement must sign the new one.
- New pacts have one check-in per member per day. A zero-progress check-in still records attendance. Members can choose a daily target or a target that totals across the week. Existing signed pacts retain their original schedules and scoring.
- The organiser writes a forfeit or randomises one and edits it before publishing. Checkpoints use the signed time zone, deadline, grace period and rule. Short weeks use the full weekly target. Another signed member can review late check-ins and agree to waive a forfeit.
- The calendar supports individual and group filters, private events and calendar export. Check-in notes are private unless their author shares them. Private fitness details are visible only to the author.

## Run locally

Use Node.js 24. With no `DATABASE_URL`, the app uses a local PostgreSQL-compatible database. Set `SHOWUP_MEMORY=1` for a disposable test database.

```sh
npm ci
npm run dev
npm test
```

Use the production preview for the install and offline checks. Run the following in one terminal.

```sh
npm run build
SHOWUP_MEMORY=1 npm run preview
```

Then run the browser tests in another terminal. Browser screenshots and accessibility checks are saved under `test-results/`.

```sh
npx --no-install playwright install chromium webkit
SHOWUP_EXPECT_PWA=1 npm run test:browser
SHOWUP_BROWSER=webkit SHOWUP_EXPECT_PWA=1 npm run test:browser
```
