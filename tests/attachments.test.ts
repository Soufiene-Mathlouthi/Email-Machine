import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  MAX_ATTACHMENT_BYTES,
  applyTemplateChanges,
  listForTemplate,
  migrateGlobalCv,
  missingAttachment,
  parseAttachments,
  snapshotForTemplate
} from '../src/main/attachments'
import { memoryDb } from './helpers'

let root: string
let store: string
beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'em-att-'))
  store = join(root, 'store')
})
afterEach(() => rmSync(root, { recursive: true, force: true }))

const file = (name: string, content = 'x') => {
  const p = join(root, name)
  writeFileSync(p, content)
  return p
}
const template = (db: ReturnType<typeof memoryDb>) =>
  Number(db.prepare("INSERT INTO templates (name) VALUES ('t')").run().lastInsertRowid)
const stored = () => (existsSync(store) ? readdirSync(store) : [])

describe('parseAttachments', () => {
  it('returns [] for junk and keeps valid entries', () => {
    expect(parseAttachments('nope')).toEqual([])
    expect(parseAttachments('{"a":1}')).toEqual([])
    expect(parseAttachments('[{"filename":"cv.pdf","path":"C:\\\\a\\\\cv.pdf"},{"x":1}]')).toEqual([
      { filename: 'cv.pdf', path: 'C:\\a\\cv.pdf' }
    ])
  })
})

describe('applyTemplateChanges', () => {
  it('copies files into the store and lists them', () => {
    const db = memoryDb()
    const id = template(db)
    applyTemplateChanges(db, store, id, [file('cv.pdf', 'hello')])
    expect(listForTemplate(db, id)).toEqual([{ id: expect.any(Number), filename: 'cv.pdf', size: 5 }])
    expect(stored()).toHaveLength(1)
    expect(JSON.parse(snapshotForTemplate(db, id))).toEqual([{ filename: 'cv.pdf', path: expect.stringContaining('cv.pdf') }])
  })

  it('removes the stored file when nothing else uses it', () => {
    const db = memoryDb()
    const id = template(db)
    applyTemplateChanges(db, store, id, [file('cv.pdf')])
    applyTemplateChanges(db, store, id, [], [listForTemplate(db, id)[0].id])
    expect(listForTemplate(db, id)).toEqual([])
    expect(stored()).toEqual([])
  })

  it('keeps the file while a queued email still carries it', () => {
    const db = memoryDb()
    const id = template(db)
    applyTemplateChanges(db, store, id, [file('cv.pdf')])
    const acc = Number(db.prepare("INSERT INTO accounts (label,email,host,username) VALUES ('a','a@a.c','h','u')").run().lastInsertRowid)
    db.prepare("INSERT INTO emails (account_id,to_email,status,attachments,created_at) VALUES (?, 'b@b.c','queued',?,1)").run(
      acc, snapshotForTemplate(db, id)
    )
    applyTemplateChanges(db, store, id, [], [listForTemplate(db, id)[0].id])
    expect(stored()).toHaveLength(1)
  })

  it('rejects more than the size limit and stores nothing', () => {
    const db = memoryDb()
    const id = template(db)
    expect(() => applyTemplateChanges(db, store, id, [file('big.pdf', 'x'.repeat(MAX_ATTACHMENT_BYTES + 1))])).toThrow(/limit/)
    expect(listForTemplate(db, id)).toEqual([])
    expect(stored()).toEqual([])
  })

  it('deleting a template cascades its rows', () => {
    const db = memoryDb()
    const id = template(db)
    applyTemplateChanges(db, store, id, [file('cv.pdf')])
    db.prepare('DELETE FROM templates WHERE id = ?').run(id)
    expect(db.prepare('SELECT COUNT(*) AS n FROM template_attachments').get()).toEqual({ n: 0 })
  })
})

describe('missingAttachment', () => {
  it('finds a file that no longer exists', () => {
    expect(missingAttachment([{ filename: 'a', path: join(root, 'gone.pdf') }])?.filename).toBe('a')
    expect(missingAttachment([{ filename: 'a', path: file('here.pdf') }])).toBeUndefined()
  })
})

describe('migrateGlobalCv', () => {
  it('moves the old global CV onto templates and unsent emails only', () => {
    const db = memoryDb()
    const t1 = template(db)
    const acc = Number(db.prepare("INSERT INTO accounts (label,email,host,username) VALUES ('a','a@a.c','h','u')").run().lastInsertRowid)
    const mail = (status: string) =>
      db.prepare("INSERT INTO emails (account_id,to_email,status,created_at) VALUES (?, 'b@b.c', ?, 1)").run(acc, status)
    mail('draft')
    mail('sent')
    migrateGlobalCv(db, store, file('old-cv.pdf'))
    expect(listForTemplate(db, t1).map((a) => a.filename)).toEqual(['old-cv.pdf'])
    const rows = db.prepare('SELECT status, attachments FROM emails ORDER BY id').all() as { status: string; attachments: string }[]
    expect(parseAttachments(rows[0].attachments)).toHaveLength(1)
    expect(rows[1].attachments).toBe('[]')
    expect(stored()).toHaveLength(1)
  })

  it('does nothing when the CV file is gone', () => {
    const db = memoryDb()
    const t1 = template(db)
    migrateGlobalCv(db, store, join(root, 'missing.pdf'))
    expect(listForTemplate(db, t1)).toEqual([])
  })
})
