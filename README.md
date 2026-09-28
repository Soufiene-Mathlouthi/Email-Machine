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

1. **Settings > Gmail** (recommended): follow the one-time Google setup shown there (create your own OAuth client, type *Desktop app*, publishing status *In production*), paste the client ID and secret, then **Connect Gmail**. Alternatively add an SMTP account under **Email accounts** (for Gmail over SMTP, use an app password).
2. **Templates**: write a template using `{{name}} {{firstName}} {{company}} {{role}} {{email}}`. Click a variable to insert it, and watch the live preview as you type.
3. **Contacts**: add or import a CSV (`name,email,company,role,notes`). Search by name, email, or company.
4. **Outbox > New batch**: creates one draft per contact. Filter by status or search, click a row to review/edit, select, *Add to send queue*, then *Start sending*.
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
