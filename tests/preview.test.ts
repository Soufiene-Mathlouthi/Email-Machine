import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DAY_MS } from '../src/main/followups/rules'
import { buildPreview } from '../src/main/preview'
import { memoryDb } from './helpers'

const NOW = 100 * DAY_MS
let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'em-prev-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

function seed(label = 'Sam') {
  const db = memoryDb()
  db.prepare("INSERT INTO accounts (id, label, email, host, username) VALUES (1, ?, 'sam@x.com', 'h', 'u')").run(label)
  return db
}
const email = (db: ReturnType<typeof seed>, to: string, status: string, attachments = '[]', sentAt: number | null = null) =>
  Number(
    db.prepare('INSERT INTO emails (account_id, to_email, status, attachments, sent_at, created_at) VALUES (1,?,?,?,?,?)').run(
      to, status, attachments, sentAt, NOW
    ).lastInsertRowid
  )

describe('buildPreview', () => {
  it('returns undefined for an unknown id', () => {
    expect(buildPreview(seed(), 99, 30, NOW)).toBeUndefined()
  })

  it('formats From with the label, or just the address without one', () => {
    const db = seed()
    const id = email(db, 'a@b.com', 'draft')
    expect(buildPreview(db, id, 30, NOW)?.from).toBe('Sam <sam@x.com>')
    const db2 = seed('')
    expect(buildPreview(db2, email(db2, 'a@b.com', 'draft'), 30, NOW)?.from).toBe('sam@x.com')
  })

  it('reports attachment size and missing files without throwing', () => {
    const db = seed()
    const here = join(dir, 'cv.pdf')
    writeFileSync(here, 'hello')
    const list = JSON.stringify([
      { filename: 'cv.pdf', path: here },
      { filename: 'gone.pdf', path: join(dir, 'gone.pdf') }
    ])
    const p = buildPreview(db, email(db, 'a@b.com', 'draft', list), 30, NOW)
    expect(p?.attachments).toEqual([
      { filename: 'cv.pdf', size: 5, missing: false },
      { filename: 'gone.pdf', size: 0, missing: true }
    ])
  })

  it('includes duplicate info only for drafts and failed emails', () => {
    const db = seed()
    email(db, 'a@b.com', 'sent', '[]', NOW - DAY_MS)
    const draft = email(db, 'a@b.com', 'draft')
    email(db, 'q@b.com', 'sent', '[]', NOW - DAY_MS)
    const queued = email(db, 'q@b.com', 'queued')
    expect(buildPreview(db, draft, 30, NOW)?.duplicateOf).toBe(NOW - DAY_MS)
    expect(buildPreview(db, queued, 30, NOW)?.duplicateOf).toBeNull()
  })
})
