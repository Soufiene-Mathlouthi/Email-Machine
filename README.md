# Email Machine

Desktop app that sends personalized emails **one by one** from your own accounts, with delays, daily caps, and human review.

**Stack:** Electron, React, TypeScript, Vite (electron-vite), SQLite (better-sqlite3), Nodemailer, lucide-react icons.

## Run

```bash
npm install     # also rebuilds better-sqlite3 for Electron
npm run dev
```

Requires Node 20+. Build installers with `npm run dist`.

## First-time setup (inside the app)

The **Dashboard** shows a setup checklist until these are done:

1. **Settings > Email accounts**: add Gmail (use an app password) or Outlook, click *Test connection*.
2. **Templates**: write a template using `{{name}} {{firstName}} {{company}} {{role}} {{email}}`. Click a variable to insert it, and watch the live preview as you type.
3. **Contacts**: add or import a CSV (`name,email,company,role,notes`). Search by name, email, or company.
4. **Outbox > New batch**: creates one draft per contact. Filter by status or search, click a row to review/edit, select, *Add to send queue*, then *Start sending*.
5. **Jobs**: track roles you're applying to. *Create draft* on a job renders a template with the job's title and company and drops the draft in the Outbox for review.

## Structure

```
src/main/      Electron main process
  db.ts        SQLite schema, settings, encrypted secrets (OS keychain)
  mailer.ts    Nodemailer sending, account verification, CV attachment
  queue.ts     Send queue: random delays, per-account daily cap, resumable
  server.ts    127.0.0.1:47821 endpoint for the future browser extension
  ipc.ts       All renderer <-> main handlers
src/preload/   Safe bridge (contextIsolation on)
src/renderer/  React UI (Dashboard, Outbox, Contacts, Templates, Jobs, Settings)
src/shared/    Types and template rendering shared by both sides
```

## Extension API (ready for the next step)

```
POST http://127.0.0.1:47821/jobs
Authorization: Bearer <token shown in Settings>
{ "title": "", "company": "", "url": "", "description": "", "contactEmail": "" }
```

## Roadmap

- [x] Desktop app, queue, templates, CSV import
- [x] Dashboard, search and filters, live template preview
- [ ] Chrome/Edge extension that posts to `/jobs`
- [ ] Gmail API (OAuth) instead of SMTP app password
- [ ] Reply tracking and follow-up reminders
