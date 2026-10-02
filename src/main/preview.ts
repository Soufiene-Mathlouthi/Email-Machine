import type Database from 'better-sqlite3'
import { existsSync, statSync } from 'fs'
import type { EmailPreview } from '@shared/types'
import { parseAttachments } from './attachments'
import { findDuplicates } from './duplicates'

export function buildPreview(db: Database.Database, id: number, windowDays: number, now = Date.now()): EmailPreview | undefined {
  const row = db
    .prepare(
      `SELECT e.status, e.attachments, a.label, a.email
       FROM emails e JOIN accounts a ON a.id = e.account_id WHERE e.id = ?`
    )
    .get(id) as { status: string; attachments: string; label: string; email: string } | undefined
  if (!row) return undefined
  const attachments = parseAttachments(row.attachments).map((a) => {
    const missing = !existsSync(a.path)
    return { filename: a.filename, size: missing ? 0 : statSync(a.path).size, missing }
  })
  const flaggable = row.status === 'draft' || row.status === 'failed'
  return {
    from: row.label ? `${row.label} <${row.email}>` : row.email,
    attachments,
    duplicateOf: flaggable ? (findDuplicates(db, [id], windowDays, now).get(id) ?? null) : null
  }
}
