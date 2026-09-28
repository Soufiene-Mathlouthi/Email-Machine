# Remove AI, Redesign UI, Enhance Functionality — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the AI/Claude drafting feature from Email Machine, add a Dashboard tab, search/filter, and live template preview, and apply a full "Sleek" visual redesign across all six tabs.

**Architecture:** Electron main process (SQLite via better-sqlite3, IPC handlers) stays structurally the same minus the AI handler; a new `src/shared/template.ts` lets both main and renderer render `{{var}}` templates. The renderer gets one new page (Dashboard), two new small components (`StatTile`, `SearchInput`), client-side search/filter added to three existing pages, and a full rewrite of `styles.css`.

**Tech Stack:** Electron, React 19, TypeScript, Vite (electron-vite), better-sqlite3, Nodemailer, `lucide-react` (new).

**Spec:** `docs/superpowers/specs/2026-09-28-remove-ai-redesign-ui-design.md`

## Global Constraints

- No dependency changes except adding `lucide-react` (small, tree-shakeable icon set).
- No new IPC channels beyond `emails:createForJob` (replaces `emails:draftForJob`).
- No test framework introduction — this repo has none. Verification is `npm run typecheck` plus a described manual check in the running app for every task.
- No changes to `src/main/db.ts` schema or to queue/send/mailer logic beyond moving `renderTemplate` out of `mailer.ts`.
- No dark mode toggle.
- Node 20+, existing Electron/React/TypeScript/Vite versions unchanged.

## Review Focus

- **Empty search query must show the full list**, not an empty result — a naive `.filter(x => x.includes(query))` with query `''` already does this correctly since every string contains `''`, but it's worth a deliberate check since a stray `query.length > 0 &&` guard would break it silently.
- **Outbox search and status filter must compose with AND**, not overwrite each other — typing a search term while a non-"All" status chip is active must keep both constraints active.
- **Settings page must not break on a database that still has old `anthropicKeyEnc`/`aiModel`/`profile` rows** from before this change — the app only ever reads the specific keys it asks for via `getSetting`, so orphaned rows are inert, but this is worth a manual confirmation since a crash here would block the whole Settings tab.
- **`emails:createForJob` must reject a blank recipient email with the same clear, user-facing error** the old AI flow had (`"Enter a recipient email for this job."`), not a raw unhandled-promise/IPC error string.
- **Dashboard "Sent today" must use the same local-calendar-day boundary the queue's daily cap already uses** (`queue.ts` uses `date(sent_at/1000, 'unixepoch', 'localtime')`), not UTC — otherwise the dashboard number will visibly disagree with the cap the user is relying on near midnight.

---

## Task 1: Initialize git

This repo has no version control yet. Every later task in this plan ends with a commit, so version control needs to exist first. `.gitignore` already correctly excludes `node_modules`, `out`, `dist`, and `*.db`.

**Files:**
- Create: `.git/` (via `git init`)

**Interfaces:** none — infrastructure only.

- [ ] **Step 1: Initialize the repository**

Run: `git init`
Expected: `Initialized empty Git repository in .../email-machine/.git/`

- [ ] **Step 2: Stage and commit the current state**

```bash
git add -A
git status
```

Check the `git status` output: it must list only real project files (no `node_modules`, `out`, `dist`, `*.db` entries). If any of those appear, stop and fix `.gitignore` before continuing.

```bash
git commit -m "chore: initial commit before AI removal and UI redesign"
```

Expected: commit succeeds, `git log --oneline` shows one commit.

---

## Task 2: Extract shared template renderer

`renderTemplate` currently lives in `src/main/mailer.ts`. It's a pure function with no Node-specific APIs, so it can move to `src/shared/template.ts` and be imported by both the main process (`ipc.ts`, for the new Jobs draft flow) and the renderer (`Templates.tsx`, for live preview) — the `@shared` alias already resolves for main, preload, and renderer (`electron.vite.config.ts:5-19`).

**Files:**
- Create: `src/shared/template.ts`
- Modify: `src/main/mailer.ts:6-8` (remove the function, keep everything else)
- Modify: `src/main/ipc.ts:11` (import `renderTemplate` from `@shared/template` instead of `./mailer`)

**Interfaces:**
- Produces: `renderTemplate(tpl: string, vars: Record<string, string>): string` from `@shared/template` — replaces the identical function that used to live in `src/main/mailer.ts`. Same signature, same behavior (replaces `{{key}}` with `vars[key] ?? ''`).

- [ ] **Step 1: Create the shared module**

Create `src/shared/template.ts`:

```typescript
export function renderTemplate(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/{{\s*(\w+)\s*}}/g, (_m, key: string) => vars[key] ?? '')
}
```

- [ ] **Step 2: Remove the function from mailer.ts**

In `src/main/mailer.ts`, delete lines 6-8 (the `renderTemplate` export). The top of the file should now read:

```typescript
import nodemailer from 'nodemailer'
import { existsSync } from 'fs'
import { basename } from 'path'
import { decryptSecret, getDb, getSetting } from './db'

interface AccountRow {
```

(everything from `interface AccountRow` onward is unchanged)

- [ ] **Step 3: Update the import in ipc.ts**

In `src/main/ipc.ts`, line 11 currently reads:

```typescript
import { renderTemplate, verifyAccount } from './mailer'
```

Change it to:

```typescript
import { verifyAccount } from './mailer'
```

And add a new import line right after the existing `@shared/types` import (currently line 8):

```typescript
import { renderTemplate } from '@shared/template'
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`. Go to **Outbox → New batch from template**, pick a template and a contact, create the batch, and confirm the generated draft's subject/body still has `{{name}}`-style variables correctly substituted (this batch flow already depends on `renderTemplate` via `ipc.ts`'s existing `emails:createFromTemplate` handler, so it proves the moved function still works end to end).

- [ ] **Step 6: Commit**

```bash
git add src/shared/template.ts src/main/mailer.ts src/main/ipc.ts
git commit -m "refactor: move renderTemplate to shared module"
```

---

## Task 3: Remove the AI feature

Deletes `ai.ts`, the `emails:draftForJob` IPC handler, the AI-only `Settings` fields, and the "AI drafting" section of the Settings page. `src/main/db.ts` needs no change: `settings` is a generic key/value table, so once nothing writes `anthropicKeyEnc`/`aiModel`/`profile` anymore, those keys simply stop being read — see the "Settings page must not break on old rows" item in Review Focus.

**Files:**
- Delete: `src/main/ai.ts`
- Modify: `src/main/ipc.ts` — remove the `draftEmail` import, remove the `emails:draftForJob` handler (replaced by `emails:createForJob` in Task 4, so for this task just delete it), and drop the AI fields from `settings:get`/`settings:set`. Task 2 shifted every line number in this file down by one (it inserted an import), so locate each block below by its literal code, not by line number.
- Modify: `src/shared/types.ts:73-91` (`Settings`/`SettingsInput` — remove AI fields)
- Modify: `src/renderer/src/pages/Settings.tsx` (remove "AI drafting" section and its state)

**Interfaces:**
- Produces: `Settings` (no longer has `profile`, `aiModel`, `anthropicKeySet`); `SettingsInput` (no longer has `anthropicKey`). Both types still have `minDelaySec`, `maxDelaySec`, `cvPath`, `apiToken`, `serverPort` (`Settings`) / `minDelaySec`, `maxDelaySec`, `cvPath` (`SettingsInput`).

- [ ] **Step 1: Delete ai.ts**

Run: `rm src/main/ai.ts` (or delete the file directly).

- [ ] **Step 2: Remove the draftEmail import from ipc.ts**

In `src/main/ipc.ts`, find and delete this line:

```typescript
import { draftEmail } from './ai'
```

- [ ] **Step 3: Remove the emails:draftForJob handler**

In `src/main/ipc.ts`, find and delete the entire handler block below, including the leading comment (it sits between the `emails:createFromTemplate` handler and the `emails:update` handler):

```typescript
  // Draft a tailored email for a scraped/saved job using Claude
  handle('emails:draftForJob', async (p: { jobId: number; accountId: number; toEmail: string; recipientName: string }) => {
    const job = db.prepare('SELECT title, company, description, contact_email AS contactEmail FROM jobs WHERE id=?').get(p.jobId) as
      | { title: string; company: string; description: string; contactEmail: string }
      | undefined
    if (!job) throw new Error('Job not found')
    const to = (p.toEmail || job.contactEmail).trim()
    if (!to) throw new Error('Enter a recipient email for this job.')
    const draft = await draftEmail({
      jobTitle: job.title, company: job.company, jobDescription: job.description, recipientName: p.recipientName
    })
    db.prepare(
      "INSERT INTO emails (account_id, job_id, to_email, subject, body, status, created_at) VALUES (?,?,?,?,?,'draft',?)"
    ).run(p.accountId, p.jobId, to, draft.subject, draft.body, Date.now())
    broadcast('emails:changed')
  })
```

(Task 4 adds its replacement, `emails:createForJob`, in this same spot.)

- [ ] **Step 4: Strip AI fields out of settings:get / settings:set**

In `src/main/ipc.ts`, find and replace the `settings:get` handler:

```typescript
  handle('settings:get', (): Settings => ({
    minDelaySec: Number(getSetting('minDelaySec', '30')),
    maxDelaySec: Number(getSetting('maxDelaySec', '120')),
    cvPath: getSetting('cvPath'),
    profile: getSetting('profile'),
    aiModel: getSetting('aiModel', 'claude-sonnet-5'),
    anthropicKeySet: !!decryptSecret(getSetting('anthropicKeyEnc')),
    apiToken: getApiToken(),
    serverPort: SERVER_PORT
  }))
```

with:

```typescript
  handle('settings:get', (): Settings => ({
    minDelaySec: Number(getSetting('minDelaySec', '30')),
    maxDelaySec: Number(getSetting('maxDelaySec', '120')),
    cvPath: getSetting('cvPath'),
    apiToken: getApiToken(),
    serverPort: SERVER_PORT
  }))
```

And replace the `settings:set` handler:

```typescript
  handle('settings:set', (s: SettingsInput) => {
    if (s.minDelaySec !== undefined) setSetting('minDelaySec', String(s.minDelaySec))
    if (s.maxDelaySec !== undefined) setSetting('maxDelaySec', String(s.maxDelaySec))
    if (s.cvPath !== undefined) setSetting('cvPath', s.cvPath)
    if (s.profile !== undefined) setSetting('profile', s.profile)
    if (s.aiModel !== undefined) setSetting('aiModel', s.aiModel)
    if (s.anthropicKey) setSetting('anthropicKeyEnc', encryptSecret(s.anthropicKey))
  })
```

with:

```typescript
  handle('settings:set', (s: SettingsInput) => {
    if (s.minDelaySec !== undefined) setSetting('minDelaySec', String(s.minDelaySec))
    if (s.maxDelaySec !== undefined) setSetting('maxDelaySec', String(s.maxDelaySec))
    if (s.cvPath !== undefined) setSetting('cvPath', s.cvPath)
  })
```

`decryptSecret` and `encryptSecret` are still used elsewhere in `ipc.ts` (account passwords), so leave their import on line 10 as-is.

- [ ] **Step 5: Update the shared Settings types**

In `src/shared/types.ts`, replace:

```typescript
export interface Settings {
  minDelaySec: number
  maxDelaySec: number
  cvPath: string
  profile: string
  aiModel: string
  anthropicKeySet: boolean
  apiToken: string
  serverPort: number
}

export interface SettingsInput {
  minDelaySec?: number
  maxDelaySec?: number
  cvPath?: string
  profile?: string
  aiModel?: string
  anthropicKey?: string
}
```

with:

```typescript
export interface Settings {
  minDelaySec: number
  maxDelaySec: number
  cvPath: string
  apiToken: string
  serverPort: number
}

export interface SettingsInput {
  minDelaySec?: number
  maxDelaySec?: number
  cvPath?: string
}
```

- [ ] **Step 6: Remove the AI drafting section from Settings.tsx**

In `src/renderer/src/pages/Settings.tsx`:

1. Remove the `key`/`setKey` state (line 20: `const [key, setKey] = useState('')`).
2. In `saveSettings`, change:

```typescript
  const saveSettings = async () => {
    await invoke('settings:set', { ...draft, ...(key ? { anthropicKey: key } : {}) })
    setDraft({})
    setKey('')
    reloadSettings()
  }
```

to:

```typescript
  const saveSettings = async () => {
    await invoke('settings:set', draft)
    setDraft({})
    reloadSettings()
  }
```

3. Delete the entire "AI drafting" block:

```typescript
      <h2>AI drafting</h2>
      <section className="panel">
        <div className="grid2">
          <label className="field"><span>Anthropic API key {settings.anthropicKeySet && '(saved)'}</span>
            <input type="password" value={key} placeholder={settings.anthropicKeySet ? 'Enter a new key to replace it' : 'sk-ant-…'} onChange={(e) => setKey(e.target.value)} /></label>
          <label className="field"><span>Model</span>
            <input value={v.aiModel} onChange={(e) => setDraft({ ...draft, aiModel: e.target.value })} /></label>
        </div>
        <label className="field"><span>About you (skills, experience, projects the AI may mention)</span>
          <textarea rows={7} value={v.profile} onChange={(e) => setDraft({ ...draft, profile: e.target.value })} /></label>
      </section>
```

- [ ] **Step 7: Typecheck**

Run: `npm run typecheck`
Expected: passes with no errors (confirms no remaining reference to `profile`, `aiModel`, `anthropicKeySet`, `anthropicKey`, or `draftEmail` anywhere).

- [ ] **Step 8: Manual verification**

Run: `npm run dev`. Open **Settings**. Confirm there is no "AI drafting" heading/section, no leftover console errors, and that changing/saving **Minimum delay** or **CV attachment** still works (click Save settings, reload the tab, confirm the value persisted). Confirm **Jobs** tab still loads without errors even though its "Draft email with AI" button is still present and now broken — that's expected, Task 4 fixes it next.

- [ ] **Step 9: Commit**

```bash
git add -A
git commit -m "feat: remove AI drafting feature"
```

---

## Task 4: Jobs tab — manual "Create draft" flow

Replaces the (now-broken) AI draft button with a template-based manual draft flow, reusing `renderTemplate` from Task 2.

**Files:**
- Modify: `src/main/ipc.ts` (add `emails:createForJob` handler, in the spot the old `emails:draftForJob` occupied)
- Modify: `src/renderer/src/pages/Jobs.tsx` (replace the AI draft UI with the manual flow)

**Interfaces:**
- Consumes: `renderTemplate(tpl, vars)` from `@shared/template` (Task 2); existing `templates:list` IPC channel (already registered, returns `Template[]`).
- Produces: new IPC channel `emails:createForJob(p: { jobId: number; templateId: number; accountId: number; toEmail: string; recipientName: string }): void` — inserts one `draft` row into `emails` linked to the job, throws `Error('Enter a recipient email for this job.')` if `toEmail` (after falling back to the job's saved contact email) is blank, throws `Error('Template not found')` / `Error('Job not found')` if either lookup fails.

- [ ] **Step 1: Add the emails:createForJob handler**

In `src/main/ipc.ts`, in the spot where `emails:draftForJob` used to be (right after the `emails:createFromTemplate` handler, before the `handle('emails:update', ...)` block), add:

```typescript
  // Create a single draft for a job, from a template, for manual review
  handle('emails:createForJob', (p: { jobId: number; templateId: number; accountId: number; toEmail: string; recipientName: string }) => {
    const job = db.prepare('SELECT title, company, contact_email AS contactEmail FROM jobs WHERE id=?').get(p.jobId) as
      | { title: string; company: string; contactEmail: string }
      | undefined
    if (!job) throw new Error('Job not found')
    const tpl = db.prepare('SELECT subject, body FROM templates WHERE id=?').get(p.templateId) as
      | { subject: string; body: string }
      | undefined
    if (!tpl) throw new Error('Template not found')
    const to = (p.toEmail || job.contactEmail).trim()
    if (!to) throw new Error('Enter a recipient email for this job.')
    const vars = {
      name: p.recipientName,
      firstName: p.recipientName.split(' ')[0] ?? '',
      company: job.company,
      role: job.title,
      email: to
    }
    db.prepare(
      "INSERT INTO emails (account_id, job_id, to_email, subject, body, status, created_at) VALUES (?,?,?,?,?,'draft',?)"
    ).run(p.accountId, p.jobId, to, renderTemplate(tpl.subject, vars), renderTemplate(tpl.body, vars), Date.now())
    broadcast('emails:changed')
  })
```

- [ ] **Step 2: Replace the Jobs.tsx draft flow**

Replace the full contents of `src/renderer/src/pages/Jobs.tsx` with:

```tsx
import { useState } from 'react'
import type { Account, Job, JobInput, Template } from '@shared/types'
import { invoke, useData, fmtDate } from '../lib/api'

const empty: JobInput = { title: '', company: '', url: '', description: '', contactEmail: '' }

export default function Jobs() {
  const [jobs, reload] = useData<Job[]>('jobs:list', [], ['jobs:changed'])
  const [accounts] = useData<Account[]>('accounts:list', [])
  const [templates] = useData<Template[]>('templates:list', [])
  const [form, setForm] = useState<JobInput>(empty)
  const [draftFor, setDraftFor] = useState<number | null>(null)
  const [toEmail, setToEmail] = useState('')
  const [toName, setToName] = useState('')
  const [accountId, setAccountId] = useState(0)
  const [templateId, setTemplateId] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const save = async () => {
    if (!form.title.trim() && !form.description.trim()) return
    await invoke('jobs:save', form)
    setForm(empty)
    reload()
  }

  const createDraft = async (job: Job) => {
    const acc = accountId || accounts[0]?.id
    const tpl = templateId || templates[0]?.id
    if (!acc) return setMsg('Add an email account in Settings first.')
    if (!tpl) return setMsg('Add a template first.')
    setBusy(true)
    setMsg('')
    try {
      await invoke('emails:createForJob', {
        jobId: job.id, templateId: tpl, accountId: acc, toEmail: toEmail || job.contactEmail, recipientName: toName
      })
      setMsg('Draft created. Review and edit it in the Outbox before sending.')
      setDraftFor(null)
    } catch (e) {
      setMsg(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="page-head"><h1>Jobs</h1></header>
      <p className="hint">Track roles you're applying to, then create a draft email for the contact in one click.</p>
      {msg && <p className="notice">{msg}</p>}

      <section className="panel">
        <div className="grid3">
          <label className="field"><span>Job title</span>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label className="field"><span>Company</span>
            <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></label>
          <label className="field"><span>Recruiter email (if listed)</span>
            <input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></label>
        </div>
        <label className="field"><span>Job description</span>
          <textarea rows={7} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <div className="row">
          <button className="btn primary" onClick={() => void save()}>{form.id ? 'Save job' : 'Add job'}</button>
          {form.id && <button className="btn" onClick={() => setForm(empty)}>Cancel</button>}
        </div>
      </section>

      {jobs.length === 0 && <p className="empty">No jobs saved yet.</p>}
      {jobs.map((j) => (
        <div className="card" key={j.id}>
          <div className="card-head">
            <strong>{j.title || 'Untitled job'}{j.company && ` at ${j.company}`}</strong>
            <span className="actions">
              <button className="link" onClick={() => { setDraftFor(draftFor === j.id ? null : j.id); setToEmail(j.contactEmail); setToName('') }}>
                Create draft
              </button>
              <button className="link" onClick={() => setForm(j)}>Edit</button>
              <button className="link danger" onClick={() => void invoke('jobs:delete', j.id).then(reload)}>Delete</button>
            </span>
          </div>
          <div className="muted">{fmtDate(j.createdAt)}{j.url && ` · ${j.url}`}</div>
          {draftFor === j.id && (
            <div className="inline-form">
              <label className="field"><span>Template</span>
                <select value={templateId || templates[0]?.id || 0} onChange={(e) => setTemplateId(Number(e.target.value))}>
                  {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                </select></label>
              <label className="field"><span>Send to</span>
                <input value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="recruiter@company.com" /></label>
              <label className="field"><span>Recipient name (optional)</span>
                <input value={toName} onChange={(e) => setToName(e.target.value)} /></label>
              <label className="field"><span>Send from</span>
                <select value={accountId || accounts[0]?.id || 0} onChange={(e) => setAccountId(Number(e.target.value))}>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.label || a.email}</option>)}
                </select></label>
              <button className="btn primary" disabled={busy} onClick={() => void createDraft(j)}>
                {busy ? 'Creating…' : 'Create draft'}
              </button>
            </div>
          )}
        </div>
      ))}
    </>
  )
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 4: Manual verification**

Run: `npm run dev`. In **Jobs**, add a job with a title, company, and recruiter email. Click **Create draft**, pick a template and an account, click **Create draft** again. Confirm the success message appears and the new draft shows up in **Outbox** with the template's variables correctly filled from the job's title/company and the entered recipient. Then test the error path: temporarily clear both the job's recruiter email and the "Send to" field before submitting, and confirm you get the message "Enter a recipient email for this job." (not a raw IPC error string) — this covers the Review Focus item on `emails:createForJob` error handling.

- [ ] **Step 5: Commit**

```bash
git add src/main/ipc.ts src/renderer/src/pages/Jobs.tsx
git commit -m "feat: replace AI job drafting with manual create-draft flow"
```

---

## Task 5: Contacts search

Adds the reusable `SearchInput` component (first use) and wires it into Contacts.

**Files:**
- Create: `src/renderer/src/components/SearchInput.tsx`
- Modify: `src/renderer/src/pages/Contacts.tsx`

**Interfaces:**
- Produces: `SearchInput` component, props `{ value: string; onChange: (v: string) => void; placeholder?: string }`, renders a text input with a search icon. Reused as-is by Tasks 6 and 7.

- [ ] **Step 1: Create SearchInput**

Create `src/renderer/src/components/SearchInput.tsx`:

```tsx
import { Search } from 'lucide-react'

interface SearchInputProps {
  value: string
  onChange: (v: string) => void
  placeholder?: string
}

export default function SearchInput({ value, onChange, placeholder }: SearchInputProps) {
  return (
    <div className="search-input">
      <Search size={15} className="search-icon" aria-hidden="true" />
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder ?? 'Search…'}
        aria-label={placeholder ?? 'Search'}
      />
    </div>
  )
}
```

(`lucide-react` is added as a dependency in Task 8, but it's imported here first — Task 8's `npm install` must run before this compiles. Since tasks execute in order, add a note: if typechecking this task in isolation before Task 8 runs, `npm install lucide-react` first. See Task 8 Step 1.)

- [ ] **Step 2: Install lucide-react now (pulled forward from Task 8 so this task typechecks independently)**

Run: `npm install lucide-react`
Expected: adds `lucide-react` to `dependencies` in `package.json` and installs successfully.

- [ ] **Step 3: Wire search into Contacts.tsx**

In `src/renderer/src/pages/Contacts.tsx`, add the import and filter state, and filter the rendered list. Replace the full file with:

```tsx
import { useMemo, useState } from 'react'
import type { Contact, ContactInput } from '@shared/types'
import { invoke, useData } from '../lib/api'
import SearchInput from '../components/SearchInput'

const empty: ContactInput = { name: '', email: '', company: '', role: '', notes: '' }

export default function Contacts() {
  const [contacts, reload] = useData<Contact[]>('contacts:list', [])
  const [form, setForm] = useState<ContactInput>(empty)
  const [msg, setMsg] = useState('')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.company.toLowerCase().includes(q)
    )
  }, [contacts, query])

  const save = async () => {
    if (!/^\S+@\S+\.\S+$/.test(form.email)) return setMsg('Enter a valid email address.')
    await invoke('contacts:save', form)
    setForm(empty)
    setMsg('')
    reload()
  }

  const importCsv = async () => {
    const r = await invoke<{ added: number; skipped: number }>('contacts:importCsv')
    setMsg(`Imported ${r.added} contacts, skipped ${r.skipped} (duplicates or invalid emails).`)
    reload()
  }

  return (
    <>
      <header className="page-head">
        <h1>Contacts</h1>
        <div className="row tight">
          <SearchInput value={query} onChange={setQuery} placeholder="Search contacts…" />
          <button className="btn" onClick={() => void importCsv()}>Import CSV</button>
        </div>
      </header>
      <p className="hint">CSV columns: name, email, company, role, notes. Only email is required.</p>
      {msg && <p className="notice">{msg}</p>}

      <section className="panel">
        <div className="grid4">
          {(['name', 'email', 'company', 'role'] as const).map((k) => (
            <label className="field" key={k}>
              <span>{k[0].toUpperCase() + k.slice(1)}</span>
              <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => void save()}>{form.id ? 'Save contact' : 'Add contact'}</button>
          {form.id && <button className="btn" onClick={() => setForm(empty)}>Cancel</button>}
        </div>
      </section>

      {contacts.length === 0 ? (
        <p className="empty">No contacts yet. Add one above or import a CSV to get started.</p>
      ) : filtered.length === 0 ? (
        <p className="empty">No contacts match "{query}".</p>
      ) : (
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Company</th><th>Role</th><th /></tr></thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <td>{c.name}</td><td>{c.email}</td><td>{c.company}</td><td>{c.role}</td>
                <td className="actions">
                  <button className="link" onClick={() => setForm(c)}>Edit</button>
                  <button className="link danger" onClick={() => void invoke('contacts:delete', c.id).then(reload)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 5: Manual verification**

Run: `npm run dev`. In **Contacts**, confirm the search box is empty by default and shows every contact (Review Focus: empty query shows full list). Type part of a name, email, or company and confirm the table narrows to matches only; clear it and confirm the full list returns.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/renderer/src/components/SearchInput.tsx src/renderer/src/pages/Contacts.tsx
git commit -m "feat: add search to Contacts"
```

---

## Task 6: Outbox search + status filter

Reuses `SearchInput` from Task 5. Adds status filter chips that compose with the search box.

**Files:**
- Modify: `src/renderer/src/pages/Outbox.tsx`

**Interfaces:**
- Consumes: `SearchInput` from `../components/SearchInput` (Task 5).

- [ ] **Step 1: Add filtering to Outbox.tsx**

In `src/renderer/src/pages/Outbox.tsx`, add the import, filter state, and a memoized filtered list. Insert after the existing imports (line 3):

```tsx
import { useMemo, useState } from 'react'
```

replaces the existing `import { useState } from 'react'` on line 1. Add below the other imports:

```tsx
import SearchInput from '../components/SearchInput'
```

Add filter state alongside the existing `selected`/`editing`/`batchOpen` state (after line 16):

```tsx
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<'all' | OutboxEmail['status']>('all')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return emails.filter((e) => {
      if (statusFilter !== 'all' && e.status !== statusFilter) return false
      if (!q) return true
      return e.toEmail.toLowerCase().includes(q) || e.subject.toLowerCase().includes(q)
    })
  }, [emails, query, statusFilter])
```

Replace the `<header className="page-head">` block (lines 44-47) with:

```tsx
      <header className="page-head">
        <h1>Outbox</h1>
        <div className="row tight">
          <SearchInput value={query} onChange={setQuery} placeholder="Search to/subject…" />
          <button className="btn primary" onClick={() => setBatchOpen(!batchOpen)}>New batch from template</button>
        </div>
      </header>

      <div className="chip-row">
        {(['all', 'draft', 'queued', 'sending', 'sent', 'failed'] as const).map((s) => (
          <button
            key={s}
            className={`chip ${statusFilter === s ? 'active' : ''}`}
            onClick={() => setStatusFilter(s)}
          >
            {s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
```

Replace the table rendering block (currently `{emails.length === 0 ? ... : ... emails.map ...}`, lines 101-120) with:

```tsx
      {emails.length === 0 ? (
        <p className="empty">Nothing here yet. Create a batch from a template, or create one from a job.</p>
      ) : filtered.length === 0 ? (
        <p className="empty">No emails match the current search/filter.</p>
      ) : (
        <table className="table">
          <thead><tr><th /><th>To</th><th>Subject</th><th>Status</th><th>Sent</th></tr></thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id} className="clickable" onClick={() => canEdit(e) && setEditing(e)}>
                <td onClick={(ev) => ev.stopPropagation()}>
                  <input type="checkbox" checked={selected.includes(e.id)} disabled={!canEdit(e)} onChange={() => toggle(e.id)} />
                </td>
                <td>{e.toEmail}</td>
                <td className="ellipsis">{e.subject}</td>
                <td><span className={`badge st-${e.status}`} title={e.error}>{e.status}</span></td>
                <td className="muted">{fmtDate(e.sentAt)}{e.status === 'failed' && ` ${e.error}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`. In **Outbox** with a mix of statuses present (create a batch and manually move some to queued via "Add to send queue" if needed), click a status chip and confirm only matching rows show. Then also type a search term while a non-"All" chip is active and confirm both constraints apply together — e.g. select "Draft" and search for an email that's queued; it must not appear (Review Focus: search + status filter compose with AND).

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/pages/Outbox.tsx
git commit -m "feat: add search and status filter to Outbox"
```

---

## Task 7: Templates search + live preview

Reuses `SearchInput`. Adds a live preview pane driven by `renderTemplate` from `@shared/template`.

**Files:**
- Modify: `src/renderer/src/pages/Templates.tsx`

**Interfaces:**
- Consumes: `SearchInput` (Task 5), `renderTemplate` from `@shared/template` (Task 2).

- [ ] **Step 1: Rewrite Templates.tsx**

Replace the full contents of `src/renderer/src/pages/Templates.tsx` with:

```tsx
import { useMemo, useState } from 'react'
import type { Template, TemplateInput } from '@shared/types'
import { renderTemplate } from '@shared/template'
import { invoke, useData } from '../lib/api'
import SearchInput from '../components/SearchInput'

const empty: TemplateInput = { name: '', subject: '', body: '' }

const SAMPLE_VARS = { name: 'Jane Doe', firstName: 'Jane', company: 'Acme Inc', role: 'Product Designer', email: 'jane@acme.com' }

export default function Templates() {
  const [templates, reload] = useData<Template[]>('templates:list', [])
  const [form, setForm] = useState<TemplateInput>(empty)
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return templates
    return templates.filter((t) => t.name.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q))
  }, [templates, query])

  const previewSubject = useMemo(() => renderTemplate(form.subject, SAMPLE_VARS), [form.subject])
  const previewBody = useMemo(() => renderTemplate(form.body, SAMPLE_VARS), [form.body])

  const save = async () => {
    if (!form.name.trim()) return
    await invoke('templates:save', form)
    setForm(empty)
    reload()
  }

  return (
    <>
      <header className="page-head">
        <h1>Templates</h1>
        <SearchInput value={query} onChange={setQuery} placeholder="Search templates…" />
      </header>
      <p className="hint">
        Variables: {'{{name}}'} {'{{firstName}}'} {'{{company}}'} {'{{role}}'} {'{{email}}'}
      </p>

      <div className="editor-grid">
        <section className="panel">
          <label className="field"><span>Template name</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </label>
          <label className="field"><span>Subject</span>
            <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          </label>
          <label className="field"><span>Body</span>
            <textarea rows={9} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </label>
          <div className="row">
            <button className="btn primary" onClick={() => void save()}>{form.id ? 'Save template' : 'Add template'}</button>
            {form.id && <button className="btn" onClick={() => setForm(empty)}>Cancel</button>}
          </div>
        </section>

        <section className="panel preview-pane">
          <div className="preview-label">Live preview <span className="muted">(sample contact: Jane Doe, Acme Inc)</span></div>
          <div className="preview-subject">{previewSubject || <span className="muted">Subject will appear here…</span>}</div>
          <div className="preview-body">{previewBody || <span className="muted">Body will appear here…</span>}</div>
        </section>
      </div>

      {templates.length === 0 ? (
        <p className="empty">No templates yet. Write one above and reuse it for every batch.</p>
      ) : filtered.length === 0 ? (
        <p className="empty">No templates match "{query}".</p>
      ) : (
        filtered.map((t) => (
          <div className="card" key={t.id}>
            <div className="card-head">
              <strong>{t.name}</strong>
              <span className="actions">
                <button className="link" onClick={() => setForm(t)}>Edit</button>
                <button className="link danger" onClick={() => void invoke('templates:delete', t.id).then(reload)}>Delete</button>
              </span>
            </div>
            <div className="muted">{t.subject}</div>
          </div>
        ))
      )}
    </>
  )
}
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 3: Manual verification**

Run: `npm run dev`. In **Templates**, start typing a subject/body containing `{{name}}`, `{{company}}`, etc. and confirm the preview pane updates on every keystroke with the sample values substituted. Confirm the search box filters the saved-templates list below by name/subject.

- [ ] **Step 4: Commit**

```bash
git add src/renderer/src/pages/Templates.tsx
git commit -m "feat: add search and live preview to Templates"
```

---

## Task 8: Dashboard tab and navigation redesign

Adds the Dashboard page (client-side derived stats, no new IPC), the `StatTile` component, reorders/re-icons the sidebar nav, and confirms the `lucide-react` dependency (already installed in Task 5).

**Files:**
- Create: `src/renderer/src/components/StatTile.tsx`
- Create: `src/renderer/src/pages/Dashboard.tsx`
- Modify: `src/renderer/src/App.tsx`

**Interfaces:**
- Consumes: existing `emails:list`, `contacts:list`, `templates:list`, `accounts:list` IPC channels via `useData` (no new IPC).
- Produces: `StatTile` component, props `{ label: string; value: string | number; tone?: 'default' | 'ok' | 'warn' | 'bad' }`.

- [ ] **Step 1: Confirm lucide-react is installed**

`lucide-react` was added to `package.json` in Task 5, Step 2. If for any reason `node_modules/lucide-react` is missing, run `npm install` here.

- [ ] **Step 2: Create StatTile**

Create `src/renderer/src/components/StatTile.tsx`:

```tsx
interface StatTileProps {
  label: string
  value: string | number
  tone?: 'default' | 'ok' | 'warn' | 'bad'
}

export default function StatTile({ label, value, tone = 'default' }: StatTileProps) {
  return (
    <div className={`stat-tile tone-${tone}`}>
      <div className="stat-value">{value}</div>
      <div className="stat-label">{label}</div>
    </div>
  )
}
```

- [ ] **Step 3: Create Dashboard.tsx**

Create `src/renderer/src/pages/Dashboard.tsx`:

```tsx
import { useMemo } from 'react'
import type { Account, Contact, OutboxEmail, Template } from '@shared/types'
import { useData, fmtDate } from '../lib/api'
import StatTile from '../components/StatTile'

// Matches the local-calendar-day boundary queue.ts uses for the daily cap
// (`date(sent_at/1000, 'unixepoch', 'localtime')`), not UTC.
function isToday(ms: number | null): boolean {
  if (!ms) return false
  const d = new Date(ms)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

export default function Dashboard() {
  const [emails] = useData<OutboxEmail[]>('emails:list', [], ['emails:changed'])
  const [contacts] = useData<Contact[]>('contacts:list', [])
  const [templates] = useData<Template[]>('templates:list', [])
  const [accounts] = useData<Account[]>('accounts:list', [])

  const sentToday = useMemo(() => emails.filter((e) => e.status === 'sent' && isToday(e.sentAt)).length, [emails])
  const queued = useMemo(() => emails.filter((e) => e.status === 'queued').length, [emails])
  const failed = useMemo(() => emails.filter((e) => e.status === 'failed').length, [emails])
  const recent = useMemo(
    () =>
      emails
        .filter((e) => e.status === 'sent' || e.status === 'failed')
        .slice()
        .sort((a, b) => (b.sentAt ?? b.createdAt) - (a.sentAt ?? a.createdAt))
        .slice(0, 6),
    [emails]
  )

  return (
    <>
      <header className="page-head"><h1>Dashboard</h1></header>

      <div className="stat-grid">
        <StatTile label="Sent today" value={sentToday} tone="ok" />
        <StatTile label="Queued" value={queued} />
        <StatTile label="Failed" value={failed} tone={failed > 0 ? 'bad' : 'default'} />
        <StatTile label="Contacts" value={contacts.length} />
        <StatTile label="Templates" value={templates.length} />
        <StatTile label="Accounts" value={accounts.length} />
      </div>

      <h2>Recent activity</h2>
      {recent.length === 0 ? (
        <p className="empty">Nothing sent yet. Create a batch in Outbox to get started.</p>
      ) : (
        <table className="table">
          <thead><tr><th>To</th><th>Subject</th><th>Status</th><th>When</th></tr></thead>
          <tbody>
            {recent.map((e) => (
              <tr key={e.id}>
                <td>{e.toEmail}</td>
                <td className="ellipsis">{e.subject}</td>
                <td><span className={`badge st-${e.status}`}>{e.status}</span></td>
                <td className="muted">{fmtDate(e.sentAt ?? e.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
```

- [ ] **Step 4: Wire Dashboard into App.tsx and add nav icons**

Replace the full contents of `src/renderer/src/App.tsx` with:

```tsx
import { useEffect, useState } from 'react'
import type { QueueState } from '@shared/types'
import { LayoutDashboard, Inbox, Users, FileText, Briefcase, Settings as SettingsIcon, type LucideIcon } from 'lucide-react'
import { invoke } from './lib/api'
import Dashboard from './pages/Dashboard'
import Outbox from './pages/Outbox'
import Contacts from './pages/Contacts'
import Templates from './pages/Templates'
import Jobs from './pages/Jobs'
import Settings from './pages/Settings'

const TABS = ['Dashboard', 'Outbox', 'Contacts', 'Templates', 'Jobs', 'Settings'] as const
type Tab = (typeof TABS)[number]

const ICONS: Record<Tab, LucideIcon> = {
  Dashboard: LayoutDashboard,
  Outbox: Inbox,
  Contacts: Users,
  Templates: FileText,
  Jobs: Briefcase,
  Settings: SettingsIcon
}

function useQueue(): QueueState {
  const [q, setQ] = useState<QueueState>({ running: false, nextSendAt: null, current: null, queued: 0 })
  useEffect(() => {
    void invoke<QueueState>('queue:state').then(setQ)
    return window.api.on('queue:state', setQ)
  }, [])
  return q
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

function MachineStrip({ q }: { q: QueueState }) {
  const now = useNow(q.running)
  const wait = q.nextSendAt ? Math.max(0, Math.ceil((q.nextSendAt - now) / 1000)) : 0

  let line = 'Idle'
  if (q.running) line = q.current ? `Sending to ${q.current}` : q.nextSendAt ? `Next email in ${wait}s` : 'Starting…'

  return (
    <div className={`machine ${q.running ? 'on' : ''}`}>
      <div className="machine-line">
        <span className="lamp" />
        <span>{line}</span>
      </div>
      <div className="machine-sub">{q.queued} queued</div>
      {q.running ? (
        <button className="btn ghost-light" onClick={() => void invoke('queue:stop')}>Pause sending</button>
      ) : (
        <button className="btn go" disabled={q.queued === 0} onClick={() => void invoke('queue:start')}>
          Start sending
        </button>
      )}
    </div>
  )
}

export default function App() {
  const [tab, setTab] = useState<Tab>('Dashboard')
  const q = useQueue()

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">Email Machine</div>
        <nav>
          {TABS.map((t) => {
            const Icon = ICONS[t]
            return (
              <button key={t} className={`nav ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
                <Icon size={16} aria-hidden="true" />
                <span>{t}</span>
              </button>
            )
          })}
        </nav>
        <MachineStrip q={q} />
      </aside>
      <main className="main">
        {tab === 'Dashboard' && <Dashboard />}
        {tab === 'Outbox' && <Outbox />}
        {tab === 'Contacts' && <Contacts />}
        {tab === 'Templates' && <Templates />}
        {tab === 'Jobs' && <Jobs />}
        {tab === 'Settings' && <Settings />}
      </main>
    </div>
  )
}
```

- [ ] **Step 5: Typecheck**

Run: `npm run typecheck`
Expected: passes with no errors.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`. Confirm the app now opens on **Dashboard** by default, showing six stat tiles and (once you've sent at least one email in earlier manual testing) a recent-activity table. Confirm every sidebar nav item now has an icon next to its label, in the order Dashboard, Outbox, Contacts, Templates, Jobs, Settings, and that clicking each still switches pages correctly. Confirm the queue "machine" strip at the bottom of the sidebar still works (start/pause) exactly as before.

- [ ] **Step 7: Commit**

```bash
git add src/renderer/src/components/StatTile.tsx src/renderer/src/pages/Dashboard.tsx src/renderer/src/App.tsx
git commit -m "feat: add Dashboard tab and sidebar icons"
```

---

## Task 9: Visual redesign ("Sleek")

Full rewrite of `styles.css`. Introduces the warm off-white/charcoal/indigo palette, refined spacing/typography/shadows, and styles for every class introduced by earlier tasks (`search-input`, `chip`/`chip-row`, `stat-grid`/`stat-tile`, `editor-grid`/`preview-pane`, and nav icon layout), while keeping every class name the pre-existing pages already reference (`app`, `side`, `brand`, `nav`, `machine*`, `main`, `page-head`, `hint`, `muted`, `empty`, `notice`, `btn*`, `link*`, `actions`, `field`, `row*`, `grid2/3/4`, `panel`, `card*`, `inline-form`, `picker`, `token`, `toolbar`, `table*`, `ellipsis`, `badge`, `st-*`, `drawer*`, `check*`).

**Files:**
- Modify: `src/renderer/src/styles.css` (full rewrite)
- Modify: `src/main/index.ts:14` (`backgroundColor` — update to match the new sidebar color so there's no flash-of-wrong-color on launch)

**Interfaces:** none — pure styling, no new props or exports.

- [ ] **Step 1: Rewrite styles.css**

Replace the full contents of `src/renderer/src/styles.css` with:

```css
:root {
  --side-bg: #1c1a22;
  --side-bg-2: #27242f;
  --side-text: #b7b2c4;
  --side-text-active: #ffffff;
  --ink: #211f2b;
  --muted: #6d6879;
  --bg: #f8f6f3;
  --panel: #ffffff;
  --line: #e8e4de;
  --line-soft: #f0ede8;
  --accent: #5b4de6;
  --accent-hover: #4c3fd6;
  --accent-soft: #efebff;
  --accent-ink: #ffffff;
  --signal: #e2913f;
  --ok: #1f9d63;
  --ok-soft: #dff3e8;
  --bad: #d6455a;
  --bad-soft: #fbe2e6;
  --warn-soft: #fbead8;
  --radius: 10px;
  --radius-lg: 14px;
  --shadow-sm: 0 1px 2px rgba(30, 24, 12, 0.05);
  --shadow-md: 0 10px 30px -14px rgba(30, 24, 12, 0.22);
  font-family: "Segoe UI Variable", "Segoe UI", system-ui, -apple-system, "Helvetica Neue", sans-serif;
  color: var(--ink);
}

* { box-sizing: border-box; }
body { margin: 0; background: var(--bg); font-size: 14px; line-height: 1.55; }
button, input, select, textarea { font: inherit; color: inherit; }
:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }

.app { display: grid; grid-template-columns: 232px 1fr; height: 100vh; }

/* ---- sidebar ---- */
.side { background: var(--side-bg); color: var(--side-text); display: flex; flex-direction: column; padding: 22px 14px; gap: 24px; }
.brand { font-size: 16px; font-weight: 650; letter-spacing: 0.1px; padding: 0 10px; color: #fff; }
.side nav { display: flex; flex-direction: column; gap: 2px; }
.nav { display: flex; align-items: center; gap: 10px; text-align: left; background: none; border: 0; padding: 9px 10px; border-radius: 8px; color: var(--side-text); cursor: pointer; transition: background-color 0.12s ease, color 0.12s ease; }
.nav:hover { background: var(--side-bg-2); color: #fff; }
.nav.active { background: var(--side-bg-2); color: #fff; box-shadow: inset 3px 0 0 var(--accent); }
.nav svg { flex: none; opacity: 0.85; }
.nav.active svg { opacity: 1; }

.machine { margin-top: auto; background: var(--side-bg-2); border-radius: var(--radius); padding: 14px; display: grid; gap: 8px; }
.machine-line { display: flex; align-items: center; gap: 9px; font-weight: 600; color: #fff; word-break: break-all; }
.machine-sub { color: #8f889f; font-size: 13px; }
.lamp { width: 9px; height: 9px; border-radius: 50%; background: #524c62; flex: none; }
.machine.on .lamp { background: var(--signal); animation: pulse 1.6s ease-in-out infinite; }
@keyframes pulse { 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { .machine.on .lamp { animation: none; } }

/* ---- main ---- */
.main { overflow-y: auto; padding: 30px 40px 64px; }
.main > * { max-width: 1080px; }
.page-head { display: flex; align-items: center; justify-content: space-between; gap: 14px; margin-bottom: 10px; flex-wrap: wrap; }
h1 { font-size: 23px; font-weight: 650; margin: 0; letter-spacing: -0.2px; }
h2 { font-size: 15px; font-weight: 650; margin: 32px 0 8px; }
.hint { color: var(--muted); margin: 4px 0 14px; }
.muted { color: var(--muted); }
.empty { color: var(--muted); padding: 28px 0; }
.notice { background: var(--accent-soft); border-left: 3px solid var(--accent); padding: 9px 12px; border-radius: 6px; margin: 10px 0; }

/* ---- controls ---- */
.btn { border: 1px solid var(--line); background: var(--panel); padding: 8px 14px; border-radius: 8px; cursor: pointer; transition: border-color 0.12s ease, background-color 0.12s ease; }
.btn:hover:not(:disabled) { border-color: #cfc8bd; background: #fbfaf8; }
.btn:disabled { opacity: 0.45; cursor: default; }
.btn.primary { background: var(--accent); border-color: var(--accent); color: var(--accent-ink); font-weight: 550; }
.btn.primary:hover:not(:disabled) { background: var(--accent-hover); border-color: var(--accent-hover); }
.btn.go { background: var(--signal); border-color: var(--signal); color: #2c1a00; font-weight: 600; }
.btn.ghost-light { background: transparent; border-color: #4a4557; color: #fff; }
.danger-btn { color: var(--bad); }
.link { background: none; border: 0; color: var(--accent); cursor: pointer; padding: 0; font-weight: 500; }
.link.danger { color: var(--bad); }
.link:hover { text-decoration: underline; }
.actions { display: flex; gap: 14px; white-space: nowrap; }

.field { display: grid; gap: 4px; margin-bottom: 12px; }
.field > span { font-size: 12.5px; color: var(--muted); font-weight: 500; }
input, select, textarea { border: 1px solid var(--line); background: #fff; border-radius: 8px; padding: 8px 11px; width: 100%; transition: border-color 0.12s ease; }
input:focus, select:focus, textarea:focus { border-color: var(--accent); }
textarea { resize: vertical; line-height: 1.5; }
input[type="checkbox"] { width: auto; }
.check { display: flex; gap: 8px; align-items: center; padding: 3px 0; }
.check.strong { font-weight: 600; }

.row { display: flex; gap: 10px; align-items: center; margin-top: 4px; flex-wrap: wrap; }
.row.tight { margin: 0; flex-wrap: nowrap; }
.grid2, .grid3, .grid4 { display: grid; gap: 0 14px; }
.grid2 { grid-template-columns: repeat(2, 1fr); }
.grid3 { grid-template-columns: repeat(3, 1fr); }
.grid4 { grid-template-columns: repeat(4, 1fr); }

.panel { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius-lg); padding: 20px; margin: 12px 0 18px; box-shadow: var(--shadow-sm); }
.card { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius); padding: 13px 16px; margin: 8px 0; transition: box-shadow 0.12s ease; }
.card:hover { box-shadow: var(--shadow-sm); }
.card-head { display: flex; justify-content: space-between; gap: 12px; }
.inline-form { display: grid; grid-template-columns: repeat(3, 1fr) auto; gap: 0 12px; align-items: end; margin-top: 12px; padding-top: 12px; border-top: 1px solid var(--line-soft); }
.inline-form .btn { margin-bottom: 12px; }
.picker { max-height: 220px; overflow-y: auto; border: 1px solid var(--line); border-radius: 8px; padding: 8px 12px; margin: 4px 0 14px; }
.token { display: block; background: var(--side-bg); color: #d8d2ea; padding: 10px 14px; border-radius: 8px; user-select: all; word-break: break-all; }

.toolbar { display: flex; gap: 10px; align-items: center; margin: 14px 0 10px; }

/* ---- search ---- */
.search-input { position: relative; display: flex; align-items: center; }
.search-input .search-icon { position: absolute; left: 11px; color: var(--muted); pointer-events: none; }
.search-input input { padding-left: 32px; min-width: 220px; }

/* ---- filter chips ---- */
.chip-row { display: flex; gap: 8px; flex-wrap: wrap; margin: 4px 0 16px; }
.chip { border: 1px solid var(--line); background: var(--panel); color: var(--muted); padding: 5px 13px; border-radius: 99px; font-size: 12.5px; font-weight: 550; cursor: pointer; transition: all 0.12s ease; }
.chip:hover { border-color: #cfc8bd; color: var(--ink); }
.chip.active { background: var(--accent); border-color: var(--accent); color: #fff; }

/* ---- stats ---- */
.stat-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 12px; margin: 14px 0 8px; }
.stat-tile { background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius-lg); padding: 16px 18px; box-shadow: var(--shadow-sm); }
.stat-value { font-size: 26px; font-weight: 650; letter-spacing: -0.4px; }
.stat-label { color: var(--muted); font-size: 12.5px; margin-top: 2px; }
.stat-tile.tone-ok .stat-value { color: var(--ok); }
.stat-tile.tone-bad .stat-value { color: var(--bad); }
.stat-tile.tone-warn .stat-value { color: var(--signal); }

/* ---- template editor + preview ---- */
.editor-grid { display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 16px; align-items: start; }
.preview-pane { display: grid; gap: 10px; }
.preview-label { font-size: 12.5px; color: var(--muted); font-weight: 550; }
.preview-subject { font-weight: 650; padding-bottom: 8px; border-bottom: 1px solid var(--line-soft); }
.preview-body { white-space: pre-wrap; line-height: 1.6; font-size: 13.5px; }

/* ---- table ---- */
.table { width: 100%; border-collapse: collapse; background: var(--panel); border: 1px solid var(--line); border-radius: var(--radius-lg); overflow: hidden; box-shadow: var(--shadow-sm); }
.table th { text-align: left; font-weight: 600; color: var(--muted); font-size: 12.5px; padding: 11px 14px; border-bottom: 1px solid var(--line); background: #fbfaf8; }
.table td { padding: 11px 14px; border-bottom: 1px solid var(--line-soft); vertical-align: top; }
.table tr:last-child td { border-bottom: 0; }
.table tr.clickable { cursor: pointer; }
.table tr.clickable:hover td { background: var(--accent-soft); }
.ellipsis { max-width: 320px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

.badge { padding: 2px 10px; border-radius: 99px; font-size: 12px; font-weight: 600; background: #eeebe5; color: var(--muted); }
.st-queued { background: var(--warn-soft); color: #92600f; }
.st-sending { background: var(--accent-soft); color: var(--accent); }
.st-sent { background: var(--ok-soft); color: #146342; }
.st-failed { background: var(--bad-soft); color: #9c2436; }

/* ---- drawer ---- */
.drawer-backdrop { position: fixed; inset: 0; background: rgba(28, 26, 34, 0.42); display: flex; justify-content: flex-end; z-index: 10; }
.drawer { width: min(560px, 100%); background: var(--panel); height: 100%; padding: 28px; overflow-y: auto; box-shadow: -10px 0 34px rgba(0, 0, 0, 0.16); }
.drawer h2 { margin-top: 0; }

@media (max-width: 1000px) {
  .grid3, .grid4 { grid-template-columns: repeat(2, 1fr); }
  .inline-form { grid-template-columns: 1fr; }
  .editor-grid { grid-template-columns: 1fr; }
}
```

- [ ] **Step 2: Update the Electron window background color**

In `src/main/index.ts`, line 14 currently reads:

```typescript
    backgroundColor: '#0f1a2e',
```

Change it to match the new sidebar background:

```typescript
    backgroundColor: '#1c1a22',
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: passes (this task doesn't touch `.ts`/`.tsx` logic beyond the one-line color constant, so this mainly guards against a stray typo).

- [ ] **Step 4: Manual visual verification**

Run: `npm run dev`. Walk every tab (Dashboard, Outbox, Contacts, Templates, Jobs, Settings) and confirm: no unstyled/broken elements, the sidebar/nav/icons look correct and the active tab is clearly highlighted, tables/cards/badges/buttons all render with the new palette, the search boxes and (on Outbox) filter chips are legible and usable, the Templates split editor/preview layout looks correct, and the Dashboard stat tiles line up in a clean grid. Resize the window narrower and confirm the responsive grid collapse at ~1000px still works without visual breakage.

- [ ] **Step 5: Commit**

```bash
git add src/renderer/src/styles.css src/main/index.ts
git commit -m "style: full visual redesign (Sleek)"
```

---

## Task 10: README update and final regression pass

**Files:**
- Modify: `README.md`

**Interfaces:** none.

- [ ] **Step 1: Rewrite README.md**

Replace the full contents of `README.md` with:

```markdown
# Email Machine

Desktop app that sends personalized emails **one by one** from your own accounts, with delays, daily caps, and human review.

**Stack:** Electron, React, TypeScript, Vite (electron-vite), SQLite (better-sqlite3), Nodemailer.

## Run

```bash
npm install     # also rebuilds better-sqlite3 for Electron
npm run dev
```

Requires Node 20+. Build installers with `npm run dist`.

## First-time setup (inside the app)

1. **Settings > Email accounts**: add Gmail (use an app password) or Outlook, click *Test connection*.
2. **Templates**: write a template using `{{name}} {{firstName}} {{company}} {{role}}`, and check the live preview pane as you write.
3. **Contacts**: add or import a CSV (`name,email,company,role,notes`).
4. **Outbox > New batch**: creates one draft per contact. Click a row to review/edit, select, *Add to send queue*, then *Start sending*.
5. **Jobs**: track roles you're applying to, then click *Create draft* on a job to generate one email from a template, addressed to that job's contact — it lands in the Outbox as a draft for review.
6. **Dashboard**: a running summary of sends, queue status, and recent activity.

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
src/shared/    Types and template-rendering logic shared by both sides
```

## Extension API (ready for the next step)

```
POST http://127.0.0.1:47821/jobs
Authorization: Bearer <token shown in Settings>
{ "title": "", "company": "", "url": "", "description": "", "contactEmail": "" }
```

## Roadmap

- [x] Desktop app, queue, templates, CSV import
- [x] Dashboard, search/filter, live template preview
- [ ] Chrome/Edge extension that posts to `/jobs`
- [ ] Gmail API (OAuth) instead of SMTP app password
- [ ] Reply tracking and follow-up reminders
```

- [ ] **Step 2: Commit the README**

```bash
git add README.md
git commit -m "docs: update README for AI removal and new features"
```

- [ ] **Step 3: Full regression pass**

Run: `npm run typecheck`
Expected: passes cleanly.

Run: `npm run dev` and walk through, in order:
1. **Settings**: add/edit an email account, run *Test connection*, set a min/max delay, attach and remove a CV, save. Confirm no AI-related UI exists anywhere on the page (Review Focus: no crash even if a pre-existing local DB has orphaned `anthropicKeyEnc`/`aiModel`/`profile` rows from before this change — if you have an old DB file, this is the moment to confirm it loads cleanly).
2. **Contacts**: add a contact, import a CSV, search, edit, delete.
3. **Templates**: create a template, confirm the live preview updates, search, edit, delete.
4. **Jobs**: add a job, create a draft via a template, confirm it lands correctly in Outbox, delete the job.
5. **Outbox**: create a batch from a template across multiple contacts, filter by status chip, search, select rows, move to queue, start sending (to a test account or dummy SMTP if available), watch the machine strip and Dashboard update live, pause.
6. **Dashboard**: confirm stat tiles and recent activity reflect what you just did, and that "Sent today" matches emails actually sent today.

If every step above works with no console errors and no visual breakage, the plan is complete.

- [ ] **Step 4: Final commit (only if Step 3 required fixes)**

If the regression pass in Step 3 surfaced any issues, fix them, re-run `npm run typecheck`, re-verify manually, then:

```bash
git add -A
git commit -m "fix: address issues found in final regression pass"
```

If Step 3 required no fixes, skip this step — Task 10 is already fully committed after Step 2.
