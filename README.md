# Email Machine

Desktop app that sends personalized emails **one by one** from your own accounts, with delays, daily caps, human review, and threaded follow-ups.

**Stack:** Electron, React, TypeScript, Vite (electron-vite), SQLite (better-sqlite3), Nodemailer, Gmail API (OAuth), lucide-react icons.

## Run

```bash
npm install     # also rebuilds better-sqlite3 for Electron
npm run dev
```

Requires Node 20+. Build installers with `npm run dist`.

## First-time setup (inside the app)

The **Dashboard** shows a setup checklist until these are done:

1. **Settings > Gmail** (recommended): click **Connect Gmail**. Release builds ship with a built-in Google client (see *Releasing* below); a build without one shows a one-time setup guide where you paste your own client ID and secret. Alternatively add an SMTP account under **Email accounts** (for Gmail over SMTP, use an app password).
2. **Templates**: write a template using `{{name}} {{firstName}} {{company}} {{role}} {{email}}`. Click a variable to insert it, and watch the live preview as you type.
3. **Contacts**: add contacts, or import a `.csv` / `.xlsx` file (for Google Sheets, download as one of those) and match its columns to name, email, company, role and notes (only email is required). Search by name, email, or company.
4. **Outbox > New batch**: creates one draft per contact. Filter by status or search, click a row to review/edit, select, *Add to send queue*, then *Start sending*. The review drawer shows the sender, attachments and any duplicate warning, with next/previous arrows. Emails to an address you already emailed within the **Duplicate window** (Settings > Sending, default 30 days, 0 = off) are held as drafts with a *Duplicate* tag until you choose *Send anyway*.
5. **Jobs**: track roles you're applying to. *Create draft* on a job renders a template with the job's title and company and drops the draft in the Outbox for review.
6. **Settings > Follow-ups**: turn on follow-ups and pick a template for follow-up 1 (and optionally 2) with delays in days. Due follow-ups appear in the Outbox as drafts, threaded as replies (the template's body is used; the subject is always `Re: <original subject>` so Gmail keeps the thread). Deleting a follow-up draft stops follow-ups for that email. They stop automatically when a reply or bounce is detected (Gmail accounts), or when you select emails and click *Mark replied* / *Stop follow-ups*. Only emails sent after you turn follow-ups on are followed up.

## Structure

```
src/main/        Electron main process
  db.ts          SQLite connection, settings, encrypted secrets (OS keychain)
  migrations.ts  Versioned schema migrations (PRAGMA user_version)
  mailer.ts      Sending via SMTP or the Gmail API, account verification, CV attachment
  mime.ts        MIME composition with reply threading headers
  queue.ts       Send queue: random delays, per-account daily cap, resumable
  queue-select.ts  Picks the next eligible queued email
  google/        OAuth (loopback + PKCE) and Gmail API client
  followups/     Follow-up rules, engine (reply/bounce checks, drafts), scheduler
  server.ts      127.0.0.1:47821 endpoint for the future browser extension
  ipc.ts         All renderer <-> main handlers
src/preload/     Safe bridge (contextIsolation on)
src/renderer/    React UI (Dashboard, Outbox, Contacts, Templates, Jobs, Settings)
src/shared/      Types and template rendering shared by both sides
tests/           Vitest unit tests
```

## Tests

```bash
npm test
```

Tests run with vitest on Electron's own Node (`ELECTRON_RUN_AS_NODE`), because better-sqlite3 is compiled for Electron. Database code is tested against in-memory SQLite.

## Extension API (ready for the next step)

```
POST http://127.0.0.1:47821/jobs
Authorization: Bearer <token shown in Settings>
{ "title": "", "company": "", "url": "", "description": "", "contactEmail": "" }
```

## Roadmap

- [x] Desktop app, queue, templates, CSV import
- [x] Dashboard, search and filters, live template preview
- [x] Gmail API (OAuth) instead of SMTP app password
- [x] Reply tracking and follow-up reminders
- [ ] Chrome/Edge extension that posts to `/jobs`

## Releasing with built-in Gmail sign-in

The Google client secret is never shipped in the app. A small Cloudflare Worker (`worker/`) holds it and adds it to token requests; the app embeds only the public client ID and the Worker URL.

1. In Google Cloud Console create an OAuth client of type **Desktop app** and enable the Gmail API.
2. Deploy the proxy (free Cloudflare account):
   ```
   cd worker
   npx wrangler secret put GOOGLE_CLIENT_ID
   npx wrangler secret put GOOGLE_CLIENT_SECRET
   npx wrangler deploy
   ```
3. Copy `.env.example` to `.env` (git-ignored) and set `MAIN_VITE_GOOGLE_CLIENT_ID` and `MAIN_VITE_TOKEN_PROXY_URL` to the deployed URL, then build.

The Worker only accepts the code-exchange and refresh grants, requires a `http://127.0.0.1:<port>` redirect, forces your client ID, rate-limits per IP and returns only the token fields. Refresh tokens stay on the user's device, encrypted by the OS keychain.
