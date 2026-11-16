# Show Up

A two-person accountability tracker. Each friend sets their own fitness, study or custom goals. Both sign the same match sheet, log progress and see the result at the agreed weekly checkpoint.

## Deploy from GitHub to Vercel

1. **Create the database.** Create a [Neon Postgres project](https://console.neon.tech/). In its SQL Editor, paste the whole contents of [server/schema.sql](server/schema.sql) and click **Run**. From **Connect**, copy the pooled Postgres connection string for the same branch and database.
2. **Upload the source to GitHub.** Extract the ZIP. Open the extracted folder and upload its contents to the root of a new GitHub repository using **Add file → Upload files**. Keep the folders intact. The GitHub root should show `package.json`, `vercel.json`, `index.html`, `api/`, `src/` and `server/`.
3. **Import and deploy.** In Vercel, choose **Add New → Project** and import the repo. The included configuration selects **Vite**, Node.js **24.x**, and the `dist` build output. Leave the root at the repo root. Add the environment variable **`DATABASE_URL`** with the Neon connection string in **Production** before clicking **Deploy**. If you already deployed, add the variable and redeploy.
4. **Test with a mate.** Open the production URL and create an account and pact. Add your first goal, create an invite link, and open it in a separate browser profile or on another phone. Create the second account, add its goal, then sign from both accounts. Use the production URL when sharing invites.

Enter the connection string in Vercel’s environment settings. Keep it out of GitHub and out of any variable with a `VITE_` prefix. A deployment without a database can open the read-only demo while the database is being set up. An ephemeral Vercel preview needs its own database variable if you want to use live accounts there.

[Vercel’s GitHub import guide](https://vercel.com/docs/git/vercel-for-github) · [Neon’s connection guide](https://neon.com/docs/connect/connect-from-any-app) · [Vercel’s Node runtime guide](https://vercel.com/docs/functions/runtimes/node-js)

## What’s in the app

- **Today** has check-ins, quick amounts, per-goal favourites, partner progress, cheers, nudges and an in-app inbox.
- **Calendar** has week, month and agenda views. Filter by pact and person, add personal events, view and correct logs, or export selected dates and the visible schedule as `.ics`.
- **Pacts** has one friend slot per pact, signed versions, a two-sided match sheet, effective dates for changes and an audit trail. Each account can join multiple pacts.
- **Checkpoints** use the signed time zone, cutoff, grace period and rule. A weekly check-in rule counts distinct days. A zero-amount log counts as a check-in but adds zero toward the outcome target. An excused day removes that day’s obligation. A weekly total uses the signed target unless the entire window is excused.
- **Forfeits** are optional and private. A result can be flagged. Both members can vote to waive a forfeit, and the partner can confirm completion. Late logs and corrections require the other member’s approval once the entry’s grace window closes.
- **Privacy** includes member-only pact access, personal calendar events, optional shared log notes and a separate private fitness detail field. The demo uses its own in-memory fixtures and creates zero database records.

Accounts use a username and password. The app has no email or SMS delivery and no self-service password reset. Reminders appear in the app. Open clients refresh when focused and about every 12 seconds while visible. The API settles closed checkpoints when a member next opens or uses the pact. A short first, last or revised week uses the full signed target and tells both friends on the match sheet.

## Run locally

Use Node.js 24. The app starts with a local Postgres-compatible database in `.local-db/` when `DATABASE_URL` is absent. You can create two accounts in separate browser profiles.

```sh
npm ci
npm run dev
```

Open the local URL printed in the terminal. Set `SHOWUP_MEMORY=1` before `npm run dev` for disposable sessions. To use a hosted database locally, put its connection string in `.env.local`, then run `npm run db:setup` once.

## Verification

```sh
npm run build
npm test
```

The delivered build and automated API tests passed. The tests use a real local PostgreSQL engine and separate authenticated sessions. They exercise invite expiry, revocation and repeat redemption, outsider access, both signatures, edited draft invalidation, future versions, private notes and calendar events, idempotent writes, partner permissions, partial progress, rest days, excused days, DST, a midnight grace period, a triggered forfeit and an approved correction.

The hosted Vercel and Neon path has a smoke test in step 4 above. This handoff did not run a live cloud deployment or a physical two-phone test. Local browser launch and preview were blocked in the build environment. A runnable browser check is included to test app interactions, two browser profiles, offline retry, calendar export, responsive screenshots and automated accessibility checks. With the disposable local server running in one terminal, run:

```sh
npx playwright install chromium
npm run test:browser
```

Screenshots are saved under `test-results/` for visual review. [DESIGN.md](DESIGN.md) records the design references and decisions.
