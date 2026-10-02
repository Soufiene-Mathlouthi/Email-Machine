import { describe, expect, it } from 'vitest'
import { DAY_MS } from '../src/main/followups/rules'
import { findDuplicates, queueEmails, updateEmail } from '../src/main/duplicates'
import { memoryDb } from './helpers'

const NOW = 100 * DAY_MS

function seed() {
  const db = memoryDb()
  db.prepare("INSERT INTO accounts (id, label, email, host, username) VALUES (1, 'Me', 'me@x.com', 'h', 'me@x.com')").run()
  return db
}
function add(db: ReturnType<typeof seed>, row: { to?: string; status?: string; sentAt?: number | null; createdAt?: number; step?: number }) {
  return Number(
    db.prepare('INSERT INTO emails (account_id, to_email, status, sent_at, created_at, step) VALUES (1,?,?,?,?,?)').run(
      row.to ?? 'a@b.com', row.status ?? 'draft', row.sentAt ?? null, row.createdAt ?? NOW, row.step ?? 0
    ).lastInsertRowid
  )
}
const status = (db: ReturnType<typeof seed>, id: number) =>
  (db.prepare('SELECT status FROM emails WHERE id = ?').get(id) as { status: string }).status

describe('findDuplicates', () => {
  it('flags an address already sent to within the window', () => {
    const db = seed()
    add(db, { status: 'sent', sentAt: NOW - 5 * DAY_MS })
    const d = add(db, {})
    expect(findDuplicates(db, [d], 30, NOW).get(d)).toBe(NOW - 5 * DAY_MS)
  })

  it('ignores case and surrounding whitespace', () => {
    const db = seed()
    add(db, { to: ' Bob@Example.com ', status: 'sent', sentAt: NOW - DAY_MS })
    const d = add(db, { to: 'bob@example.com' })
    expect(findDuplicates(db, [d], 30, NOW).has(d)).toBe(true)
  })

  it('counts queued and sending but not drafts or failed', () => {
    const db = seed()
    const d = add(db, {})
    add(db, { status: 'draft' })
    add(db, { status: 'failed' })
    expect(findDuplicates(db, [d], 30, NOW).has(d)).toBe(false)
    add(db, { status: 'queued', createdAt: NOW - DAY_MS })
    expect(findDuplicates(db, [d], 30, NOW).has(d)).toBe(true)
  })

  it('includes the window edge and excludes older', () => {
    const db = seed()
    const d = add(db, {})
    const old = add(db, { status: 'sent', sentAt: NOW - 30 * DAY_MS - 1 })
    expect(findDuplicates(db, [d], 30, NOW).has(d)).toBe(false)
    db.prepare('UPDATE emails SET sent_at = ? WHERE id = ?').run(NOW - 30 * DAY_MS, old)
    expect(findDuplicates(db, [d], 30, NOW).has(d)).toBe(true)
  })

  it('counts a queued or sending email however old it is, since it has not gone out yet', () => {
    const db = seed()
    add(db, { status: 'queued', createdAt: NOW - 45 * DAY_MS })
    add(db, { to: 's@x.com', status: 'sending', createdAt: NOW - 45 * DAY_MS })
    const d = add(db, {})
    const d2 = add(db, { to: 's@x.com' })
    const found = findDuplicates(db, [d, d2], 30, NOW)
    expect(found.has(d)).toBe(true)
    expect(found.has(d2)).toBe(true)
  })

  it('never flags follow-ups, itself, or other addresses; window 0 disables', () => {
    const db = seed()
    add(db, { status: 'sent', sentAt: NOW - DAY_MS })
    const followUp = add(db, { step: 1 })
    const other = add(db, { to: 'c@d.com' })
    const alreadyQueued = add(db, { to: 'e@f.com', status: 'queued' })
    expect(findDuplicates(db, [followUp, other, alreadyQueued], 30, NOW).size).toBe(0)
    const d = add(db, {})
    expect(findDuplicates(db, [d], 0, NOW).size).toBe(0)
  })
})

describe('queueEmails', () => {
  it('holds duplicates and queues the rest', () => {
    const db = seed()
    add(db, { status: 'sent', sentAt: NOW - DAY_MS })
    const dup = add(db, {})
    const fresh = add(db, { to: 'new@x.com' })
    const r = queueEmails(db, [dup, fresh], 30, false, NOW)
    expect(r).toEqual({ changed: [fresh], held: [dup] })
    expect(status(db, dup)).toBe('draft')
    expect(status(db, fresh)).toBe('queued')
  })

  it('queues duplicates when override is set', () => {
    const db = seed()
    add(db, { status: 'sent', sentAt: NOW - DAY_MS })
    const dup = add(db, {})
    expect(queueEmails(db, [dup], 30, true, NOW)).toEqual({ changed: [dup], held: [] })
    expect(status(db, dup)).toBe('queued')
  })

  it('holds the second of two drafts to the same address in one call', () => {
    const db = seed()
    const a = add(db, { to: 'same@x.com' })
    const b = add(db, { to: 'same@x.com' })
    expect(queueEmails(db, [a, b], 30, false, NOW)).toEqual({ changed: [a], held: [b] })
  })

  it('does not flag an already queued email against itself and skips sent rows', () => {
    const db = seed()
    const q = add(db, { status: 'queued' })
    const s = add(db, { to: 'z@z.com', status: 'sent', sentAt: NOW })
    expect(queueEmails(db, [q, s], 30, false, NOW)).toEqual({ changed: [q], held: [] })
    expect(status(db, s)).toBe('sent')
  })
})

describe('updateEmail', () => {
  const edit = (db: ReturnType<typeof seed>, id: number, toEmail: string, subject = 's') => updateEmail(db, { id, toEmail, subject, body: 'b' })

  it('edits a draft in place', () => {
    const db = seed()
    const id = add(db, {})
    expect(edit(db, id, 'other@x.com', 'New')).toBe(true)
    expect(db.prepare('SELECT to_email, subject, status FROM emails WHERE id = ?').get(id)).toEqual({ to_email: 'other@x.com', subject: 'New', status: 'draft' })
  })

  it('moves a queued email back to draft when its address changes, so it is re-checked', () => {
    const db = seed()
    const id = add(db, { status: 'queued' })
    edit(db, id, 'new@x.com')
    expect(status(db, id)).toBe('draft')
  })

  it('keeps a queued email queued when only the body, subject or address casing changes', () => {
    const db = seed()
    const id = add(db, { status: 'queued' })
    edit(db, id, ' A@B.com ', 'changed')
    expect(status(db, id)).toBe('queued')
  })

  it('refuses sent and sending emails', () => {
    const db = seed()
    expect(edit(db, add(db, { status: 'sent', sentAt: NOW }), 'x@y.com')).toBe(false)
    expect(edit(db, add(db, { status: 'sending' }), 'x@y.com')).toBe(false)
  })
})
