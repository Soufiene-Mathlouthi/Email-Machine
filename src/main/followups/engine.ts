import type Database from 'better-sqlite3'
import type { FollowUpRunSummary } from '@shared/types'
import { renderTemplate } from '@shared/template'
import { DAY_MS, classifyThread, followUpSubject, nextFollowUp, parseFollowUpConfig, type SequenceEmail } from './rules'

export interface EngineDeps {
  db: Database.Database
  now: number
  getThreadSenders: (accountId: number, threadId: string) => Promise<string[]>
  log?: (message: string) => void
}

const REPLY_WINDOW_MS = 45 * DAY_MS

interface SequenceRow {
  step: number
  status: string
  sentAt: number | null
  followupsStopped: number
}

interface OriginalRow extends SequenceRow {
  id: number
  accountId: number
  contactId: number | null
  jobId: number | null
  toEmail: string
  subject: string
}

const asSequence = (r: SequenceRow): SequenceEmail => ({
  step: r.step, status: r.status, sentAt: r.sentAt, followupsStopped: !!r.followupsStopped
})

export function cleanupStoppedFollowUps(db: Database.Database): number {
  return db.prepare(
    `DELETE FROM emails WHERE status IN ('draft', 'queued')
       AND parent_id IN (SELECT id FROM emails WHERE followups_stopped = 1)`
  ).run().changes
}

export function stopSequences(db: Database.Database, ids: number[], kind: 'replied' | 'manual', now: number): void {
  const root = db.prepare('SELECT COALESCE(parent_id, id) AS root FROM emails WHERE id = ?')
  const markReplied = db.prepare(
    "UPDATE emails SET replied_at = COALESCE(replied_at, ?), followups_stopped = 1, stop_reason = 'replied' WHERE id = ?"
  )
  const markManual = db.prepare(
    "UPDATE emails SET followups_stopped = 1, stop_reason = CASE WHEN stop_reason = '' THEN 'manual' ELSE stop_reason END WHERE id = ?"
  )
  db.transaction(() => {
    for (const id of ids) {
      const r = root.get(id) as { root: number } | undefined
      if (!r) continue
      if (kind === 'replied') markReplied.run(now, r.root)
      else markManual.run(r.root)
    }
    cleanupStoppedFollowUps(db)
  })()
}

function varsFor(db: Database.Database, o: OriginalRow): Record<string, string> {
  if (o.contactId) {
    const c = db.prepare('SELECT name, company, role FROM contacts WHERE id = ?').get(o.contactId) as
      | { name: string; company: string; role: string }
      | undefined
    if (c) return { name: c.name, firstName: c.name.split(' ')[0] ?? '', company: c.company, role: c.role, email: o.toEmail }
  }
  if (o.jobId) {
    const j = db.prepare('SELECT title, company FROM jobs WHERE id = ?').get(o.jobId) as
      | { title: string; company: string }
      | undefined
    if (j) return { name: '', firstName: '', company: j.company, role: j.title, email: o.toEmail }
  }
  return { name: '', firstName: '', company: '', role: '', email: o.toEmail }
}

async function checkReplies(deps: EngineDeps, summary: FollowUpRunSummary): Promise<void> {
  const { db, now } = deps
  const candidates = db.prepare(
    `SELECT e.id, e.account_id AS accountId, e.thread_id AS threadId, a.email AS selfEmail
     FROM emails e JOIN accounts a ON a.id = e.account_id
     WHERE e.step = 0 AND e.status = 'sent' AND e.followups_stopped = 0 AND e.thread_id != ''
       AND a.auth_type = 'gmail' AND a.auth_error = '' AND e.sent_at >= ?`
  ).all(now - REPLY_WINDOW_MS) as { id: number; accountId: number; threadId: string; selfEmail: string }[]
  const markReplied = db.prepare("UPDATE emails SET replied_at = ?, followups_stopped = 1, stop_reason = 'replied' WHERE id = ?")
  const markBounced = db.prepare("UPDATE emails SET followups_stopped = 1, stop_reason = 'bounced' WHERE id = ?")
  for (const c of candidates) {
    try {
      const verdict = classifyThread(await deps.getThreadSenders(c.accountId, c.threadId), c.selfEmail)
      if (verdict === 'replied') {
        markReplied.run(now, c.id)
        summary.repliesFound++
      } else if (verdict === 'bounced') {
        markBounced.run(c.id)
        summary.bounces++
      }
    } catch (e) {
      deps.log?.(`Reply check failed for email ${c.id}: ${e instanceof Error ? e.message : String(e)}`)
    }
  }
}

function createDueDrafts(db: Database.Database, now: number): number {
  const settingRow = db.prepare("SELECT value FROM settings WHERE key = 'followUps'").get() as { value: string } | undefined
  const config = parseFollowUpConfig(settingRow?.value ?? '')
  if (!config.enabled || config.enabledAt === null) return 0

  const originals = db.prepare(
    `SELECT id, account_id AS accountId, contact_id AS contactId, job_id AS jobId, to_email AS toEmail, subject,
            status, sent_at AS sentAt, step, followups_stopped AS followupsStopped
     FROM emails WHERE step = 0 AND status = 'sent' AND followups_stopped = 0 AND sent_at >= ?`
  ).all(config.enabledAt) as OriginalRow[]
  const children = db.prepare(
    'SELECT step, status, sent_at AS sentAt, followups_stopped AS followupsStopped FROM emails WHERE parent_id = ?'
  )
  const template = db.prepare('SELECT subject, body FROM templates WHERE id = ?')
  const insert = db.prepare(
    `INSERT INTO emails (account_id, contact_id, job_id, to_email, subject, body, status, parent_id, step, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 'draft', ?, ?, ?)`
  )

  let created = 0
  for (const o of originals) {
    const kids = (children.all(o.id) as SequenceRow[]).map(asSequence)
    const next = nextFollowUp(asSequence(o), kids, config, now)
    if (!next) continue
    const tpl = template.get(next.templateId) as { subject: string; body: string } | undefined
    if (!tpl) continue
    const vars = varsFor(db, o)
    insert.run(
      o.accountId, o.contactId, o.jobId, o.toEmail,
      followUpSubject(renderTemplate(tpl.subject, vars), o.subject), renderTemplate(tpl.body, vars),
      o.id, next.step, now
    )
    created++
  }
  return created
}

export async function runFollowUpsOnce(deps: EngineDeps): Promise<FollowUpRunSummary> {
  const summary: FollowUpRunSummary = { repliesFound: 0, bounces: 0, draftsCreated: 0, cleanedUp: 0 }
  await checkReplies(deps, summary)
  summary.cleanedUp = cleanupStoppedFollowUps(deps.db)
  summary.draftsCreated = createDueDrafts(deps.db, deps.now)
  return summary
}
