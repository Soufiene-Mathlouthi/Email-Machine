# Email Machine

Desktop app that sends personalized emails **one by one** from your own accounts, with delays, daily caps, and human review.

**Stack:** Electron, React, TypeScript, Vite (electron-vite), SQLite (better-sqlite3), Nodemailer, Claude API.

## Run

```bash
npm install     # also rebuilds better-sqlite3 for Electron
npm run dev
```

Requires Node 20+. Build installers with `npm run dist`.

## First-time setup (inside the app)

1. **Settings > Email accounts**: add Gmail (use an app password) or Outlook, click *Test connection*.
2. **Templates**: write a template using `{{name}} {{firstName}} {{company}} {{role}}`.
3. **Contacts**: add or import a CSV (`name,email,company,role,notes`).
4. **Outbox > New batch**: creates one draft per contact. Click a row to review/edit, select, *Add to send queue*, then *Start sending*.
5. **AI drafting**: in Settings add your Anthropic API key and an "About you" text. In **Jobs**, paste a job and click *Draft email with AI*. The result lands in the Outbox as a draft for review.

## Structure

```
src/main/      Electron main process
  db.ts        SQLite schema, settings, encrypted secrets (OS keychain)
  mailer.ts    Nodemailer sending, template variables, CV attachment
  queue.ts     Send queue: random delays, per-account daily cap, resumable
  ai.ts        Claude drafting from job description + your profile
  server.ts    127.0.0.1:47821 endpoint for the future browser extension
  ipc.ts       All renderer <-> main handlers
src/preload/   Safe bridge (contextIsolation on)
src/renderer/  React UI (Outbox, Contacts, Templates, Jobs, Settings)
src/shared/    Types shared by both sides
```

## Extension API (ready for the next step)

```
POST http://127.0.0.1:47821/jobs
Authorization: Bearer <token shown in Settings>
{ "title": "", "company": "", "url": "", "description": "", "contactEmail": "" }
```

## Roadmap

- [x] Desktop app, queue, templates, CSV import, AI drafting
- [ ] Chrome/Edge extension that posts to `/jobs`
- [ ] Gmail API (OAuth) instead of SMTP app password
- [ ] Reply tracking and follow-up reminders
