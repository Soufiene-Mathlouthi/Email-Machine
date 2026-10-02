import type Database from 'better-sqlite3'
import { DAY_MS } from './followups/rules'

/** For each id, the time (ms) of the most recent earlier email to the same address inside the window. */
export function findDuplicates(db: Database.Database, ids: number[], windowDays: number, now = Date.now()): Map<number, number> {
  const found = new Map<number, number>()
  if (windowDays <= 0) return found
  const since = now - windowDays * DAY_MS
  const stmt = db.prepare(
    `SELECT MAX(COALESCE(p.sent_at, p.created_at)) AS at
     FROM emails e JOIN emails p ON lower(trim(p.to_email)) = lower(trim(e.to_email))
     WHERE e.id = ? AND e.step = 0 AND p.id != e.id
       AND (p.status IN ('queued','sending') OR (p.status = 'sent' AND p.sent_at >= ?))`
  )
  for (const id of ids) {
    const row = stmt.get(id, since) as { at: number | null } | undefined
    if (row?.at != null) found.set(id, row.at)
  }
  return found
}

const normalized = (s: string): string => s.trim().toLowerCase()

/** Saves an edit. A queued email whose address changed goes back to draft so the duplicate check runs again. */
export function updateEmail(db: Database.Database, e: { id: number; toEmail: string; subject: string; body: string }): boolean {
  const row = db.prepare("SELECT to_email, status FROM emails WHERE id = ? AND status IN ('draft','failed','queued')").get(e.id) as
    | { to_email: string; status: string }
    | undefined
  if (!row) return false
  const demote = row.status === 'queued' && normalized(row.to_email) !== normalized(e.toEmail)
  db.prepare('UPDATE emails SET to_email=?, subject=?, body=?, status=? WHERE id=?').run(
    e.toEmail, e.subject, e.body, demote ? 'draft' : row.status, e.id
  )
  return true
}

/** Queues drafts/failed/queued emails one by one so a duplicate inside the same selection is caught too. */
export function queueEmails(
  db: Database.Database,
  ids: number[],
  windowDays: number,
  override: boolean,
  now = Date.now()
): { changed: number[]; held: number[] } {
  const changed: number[] = []
  const held: number[] = []
  const update = db.prepare("UPDATE emails SET status='queued', error='' WHERE id=? AND status IN ('draft','queued','failed')")
  db.transaction(() => {
    for (const id of ids) {
      if (!override && findDuplicates(db, [id], windowDays, now).has(id)) {
        held.push(id)
        continue
      }
      if (update.run(id).changes) changed.push(id)
    }
  })()
  return { changed, held }
}
