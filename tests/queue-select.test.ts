import { describe, expect, it } from 'vitest'
import { selectNextEligible } from '../src/main/queue-select'
import { memoryDb } from './helpers'

function seed(cap = 5) {
  const db = memoryDb()
  db.prepare("INSERT INTO accounts (id, label, email, host, username, daily_cap) VALUES (1, 'Me', 'me@x.com', 'h', 'me@x.com', ?)").run(cap)
  return db
}
const add = (db: ReturnType<typeof seed>, row: Record<string, unknown>) => {
  const r = { account_id: 1, to_email: 'a@b.com', status: 'queued', created_at: 1, parent_id: null, followups_stopped: 0, sent_at: null, ...row }
  return Number(db.prepare(
    'INSERT INTO emails (account_id, to_email, status, created_at, parent_id, followups_stopped, sent_at) VALUES (?,?,?,?,?,?,?)'
  ).run(r.account_id, r.to_email, r.status, r.created_at, r.parent_id, r.followups_stopped, r.sent_at).lastInsertRowid)
}

describe('selectNextEligible', () => {
  it('picks the oldest queued email', () => {
    const db = seed()
    const first = add(db, {})
    add(db, {})
    expect(selectNextEligible(db)?.id).toBe(first)
  })
  it('skips follow-ups whose original was replied to or stopped', () => {
    const db = seed()
    const original = add(db, { status: 'sent', followups_stopped: 1, sent_at: 1 })
    add(db, { parent_id: original })
    expect(selectNextEligible(db)).toBeUndefined()
  })
  it('respects the daily cap', () => {
    const db = seed(1)
    add(db, { status: 'sent', sent_at: Date.now() })
    add(db, {})
    expect(selectNextEligible(db)).toBeUndefined()
  })
  it('treats a cap of 0 as unlimited', () => {
    const db = seed(0)
    for (let i = 0; i < 3; i++) add(db, { status: 'sent', sent_at: Date.now() })
    const queued = add(db, {})
    expect(selectNextEligible(db)?.id).toBe(queued)
  })
})