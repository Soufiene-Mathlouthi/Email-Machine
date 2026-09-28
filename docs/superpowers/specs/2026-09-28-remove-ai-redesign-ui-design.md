# Remove AI drafting, redesign UI, enhance functionality

Date: 2026-09-28
Status: Approved

## Context

Email Machine is a small Electron/React/TypeScript desktop app that sends
personalized emails one-by-one from the user's own SMTP accounts, with
queueing, delays, and human review. It currently has an AI-drafting feature
(Claude API) wired into the Jobs tab and Settings, and a fairly plain,
utilitarian UI (`src/renderer/src/styles.css`, five flat tabs: Outbox,
Contacts, Templates, Jobs, Settings).

The user wants: (1) the AI feature removed completely, (2) meaningful
functional enhancements to the existing tabs, and (3) a full visual
redesign for a better user experience.

## Goals

- Remove all AI/Claude drafting code and UI — no dead code, no leftover
  settings fields, no stale README references.
- Turn the Jobs tab from "AI draft generator" into a manual lead tracker
  with a one-click "create draft from template" action.
- Add a Dashboard tab (first tab) summarizing send activity and queue
  state, computed entirely client-side from data already loaded.
- Add search/filter to Contacts, Outbox, and Templates.
- Add a live template preview pane to Templates.
- Redesign the visual language ("Sleek" direction): new palette, spacing,
  typography, iconography, and per-page polish — applied consistently
  across all six tabs.

## Non-goals

- No new backend/IPC surface beyond what's needed for the Jobs-tab manual
  draft action (dashboard and search/filter are pure client-side derived
  state — no new tables, no new persisted settings).
- No test framework introduction (repo has none today); verification is
  typecheck + manual run-through.
- No routing library, no state-management library, no icon-library beyond
  `lucide-react`.
- No changes to queue/send/mailer logic, SQLite schema, encryption, or the
  browser-extension HTTP server.

## Design

### 1. Remove AI

Files removed:
- `src/main/ai.ts` (deleted entirely)

Files changed:
- `src/main/ipc.ts` — remove the `emails:draftForJob` handler and the
  `draftEmail` import; replaced by `emails:createForJob` (see §3).
- `src/shared/types.ts` — remove `aiModel`, `anthropicKeySet` from
  `Settings`, and `anthropicKey` from `SettingsInput`.
- `src/renderer/src/pages/Settings.tsx` — remove the entire "AI drafting"
  `<section>` (API key field, model field, profile textarea) and its
  related state (`key`, part of `draft`).
- `src/main/db.ts` — no schema change (settings is a generic key/value
  table); simply stop writing `anthropicKeyEnc` / `aiModel` / `profile`
  keys. `profile` ("About you") was AI-only, so it's dropped too.
- `README.md` — remove Claude from the stack line, drop the "AI drafting"
  setup step, remove it from the roadmap's done list.
- `package.json` — no dependency changes (AI drafting used a raw `fetch`
  call, not an SDK).

### 2. Shared template rendering

`renderTemplate` currently lives in `src/main/mailer.ts` (pure function,
no Node-specific APIs). Move it to `src/shared/template.ts` and import it
from both `mailer.ts` (main process) and the new Templates preview pane +
Jobs manual-draft flow (renderer, via IPC only — the renderer never
imports main-process code directly, so the renderer-side preview calls its
own copy of this same pure function bundled through `@shared`).

### 3. Jobs tab → manual lead tracker

- Remove the "Draft email with AI" flow (`draftFor` state, AI-specific
  fields) from `Jobs.tsx`.
- Add "Create draft": an inline form (template picker, send-from account
  picker, to-email/recipient-name fields pre-filled from the job) with a
  "Create draft" button.
- New IPC handler `emails:createForJob(p: { jobId, templateId, accountId,
  toEmail, recipientName })`:
  - Loads the template, renders subject/body with vars `{ name:
    recipientName, firstName: recipientName.split(' ')[0] ?? '',
    company: job.company, role: job.title, email: toEmail }` using
    `renderTemplate`.
  - Inserts a `draft` row into `emails` with `job_id` set (same shape as
    `emails:createFromTemplate`, but single-recipient and job-linked).
  - Broadcasts `emails:changed`.
- Remove `DraftInput`/AI-specific types; `JobInput`/`Job` types unchanged.

### 4. Dashboard tab (new first tab)

Client-side only — reuses the already-loaded `useData` results for
`emails:list`, `contacts:list`, `templates:list`, `accounts:list`. No new
IPC.

Contents:
- Stat tiles: Sent today (emails with `status='sent'` and `sentAt` within
  the current calendar day), Queued, Failed, Total contacts, Active
  templates.
- Queue status: a larger-format version of the existing `MachineStrip`
  (same `useQueue`/`useNow` hooks, moved from `App.tsx` into
  `Dashboard.tsx` and reused via export, or kept in `App.tsx` and passed
  down — implementation detail decided during coding, functionally
  identical to today's behavior).
- Recent activity: last 6 emails ordered by `sentAt`/`createdAt` descending
  (sent or failed), showing recipient, subject, status, timestamp.

`App.tsx` tab order becomes: **Dashboard, Outbox, Contacts, Templates,
Jobs, Settings**. Dashboard is the default active tab on launch.

### 5. Search & filter

New shared renderer component `SearchInput` (controlled text input with a
search icon, debouncing not required given in-memory filtering of small
lists).

- **Contacts**: filters by name/email/company (case-insensitive substring).
- **Outbox**: text search (to/subject) + status filter chips (All, Draft,
  Queued, Sending, Sent, Failed) shown above the table; chips and search
  compose (AND).
- **Templates**: filters by name/subject.

All filtering happens client-side over the arrays already returned by
existing `useData` hooks — no IPC changes.

### 6. Live template preview

`Templates.tsx` gains a preview pane alongside the edit form, rendering
the in-progress `form.subject`/`form.body` through `renderTemplate` with
fixed sample values (`name: 'Jane Doe'`, `firstName: 'Jane'`, `company:
'Acme Inc'`, `role: 'Product Designer'`, `email: 'jane@acme.com'`),
updating on every keystroke (pure client-side, no debouncing needed at
this scale).

### 7. Visual redesign — "Sleek"

Full rewrite of `src/renderer/src/styles.css` plus small structural JSX
tweaks where the new look needs them (icons in nav, stat tiles, search
inputs, filter chips). Direction:

- **Palette**: warm off-white background (not cool gray), deep charcoal
  ink (not navy-black), a single intentional indigo/violet accent, muted
  supporting colors for status badges. Both light-leaning throughout (no
  dark mode toggle — out of scope).
- **Typography**: slightly refined scale/weight hierarchy for headings vs.
  body vs. muted text; consistent letter-spacing on labels.
- **Spacing/shape**: consistent spacing scale, softer shadows in place of
  some hard borders, slightly larger corner radius for a more modern feel.
- **Sidebar**: adds per-tab icons via `lucide-react` (new dependency —
  small, tree-shakeable, no runtime cost beyond the icons used); active-tab
  indicator restyled; queue status strip restyled to match.
- **Tables/cards/badges/empty states**: consistent restyle across all six
  tabs; subtle hover/transition polish on interactive elements
  (`prefers-reduced-motion` respected, matching the existing pattern for
  the queue lamp animation).
- **New components** introduced only where new functionality needs them:
  `StatTile` (Dashboard), `SearchInput` (Contacts/Outbox/Templates). No
  broader componentization of existing pages — they keep their current
  JSX structure and CSS-class approach, just restyled.

### Error handling

No new error paths beyond what exists today. `emails:createForJob` follows
the same validation pattern as the removed `emails:draftForJob` (throws
with a user-facing message if the template/job isn't found or the
recipient email is blank), surfaced in `Jobs.tsx` the same way the old AI
errors were (catch, strip the IPC error prefix, show in the page's
`msg` banner).

### Testing

No test framework in this repo. Verification:
1. `npm run typecheck` — must pass with no errors after all changes.
2. `npm run dev` — manually walk every tab: add/edit/delete/search on
   Contacts; create/edit/delete/preview a Template; add/edit/delete a Job
   and create a draft from it; verify the draft lands correctly in
   Outbox; create a batch from a template in Outbox, filter by status and
   search, queue and (with a real or dummy account) observe the queue
   strip and Dashboard stats update; confirm Settings no longer shows any
   AI-related fields and saving still works for accounts/sending settings.

## File-level change summary

| File | Change |
|---|---|
| `src/main/ai.ts` | deleted |
| `src/main/ipc.ts` | remove AI handler; add `emails:createForJob` |
| `src/main/mailer.ts` | `renderTemplate` moved out to shared |
| `src/main/db.ts` | stop writing AI-only setting keys |
| `src/shared/types.ts` | drop AI fields from `Settings`/`SettingsInput` |
| `src/shared/template.ts` | new: shared `renderTemplate` |
| `src/renderer/src/App.tsx` | add Dashboard tab, reorder tabs |
| `src/renderer/src/pages/Dashboard.tsx` | new |
| `src/renderer/src/pages/Jobs.tsx` | AI flow → manual create-draft flow |
| `src/renderer/src/pages/Settings.tsx` | remove AI section |
| `src/renderer/src/pages/Contacts.tsx` | add search |
| `src/renderer/src/pages/Outbox.tsx` | add search + status filter |
| `src/renderer/src/pages/Templates.tsx` | add search + live preview |
| `src/renderer/src/components/StatTile.tsx` | new |
| `src/renderer/src/components/SearchInput.tsx` | new |
| `src/renderer/src/styles.css` | full visual redesign |
| `README.md` | remove AI references, update roadmap |
| `package.json` | add `lucide-react` dependency |
