import type Database from 'better-sqlite3'

export interface QueuedRow {
  id: number
  account_id: number
  to_email: string
  subject: string
  body: string
  parent_id: number | null
  attachments: string
}

// Next queued email whose account is under its daily cap and whose sequence hasn't been stopped.
export function selectNextEligible(db: Database.Database): QueuedRow | undefined {
  return db
    .prepare(
      `SELECT e.id, e.account_id, e.to_email, e.subject, e.body, e.parent_id, e.attachments
       FROM emails e JOIN accounts a ON a.id = e.account_id
       WHERE e.status = 'queued'
         AND (e.parent_id IS NULL OR NOT EXISTS (
               SELECT 1 FROM emails p WHERE p.id = e.parent_id AND p.followups_stopped = 1))
         AND (SELECT COUNT(*) FROM emails s
              WHERE s.account_id = e.account_id AND s.status = 'sent'
                AND date(s.sent_at / 1000, 'unixepoch', 'localtime') = date('now', 'localtime')
             ) < a.daily_cap
       ORDER BY e.id LIMIT 1`
    )
    .get() as QueuedRow | undefined
}
