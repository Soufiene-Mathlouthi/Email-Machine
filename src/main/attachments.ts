import type Database from 'better-sqlite3'
import { copyFileSync, existsSync, mkdirSync, rmSync, statSync } from 'fs'
import { basename, join } from 'path'
import { randomBytes } from 'crypto'
import type { EmailAttachment, TemplateAttachment } from '@shared/types'

// Gmail rejects messages over 25 MB and base64 adds ~37%, so keep the raw total well under that.
export const MAX_ATTACHMENT_BYTES = 15 * 1024 * 1024

export function parseAttachments(json: string): EmailAttachment[] {
  try {
    const v = JSON.parse(json) as unknown
    if (!Array.isArray(v)) return []
    return v.filter(
      (a): a is EmailAttachment => !!a && typeof a.filename === 'string' && typeof a.path === 'string'
    )
  } catch {
    return []
  }
}

export function missingAttachment(list: EmailAttachment[]): EmailAttachment | undefined {
  return list.find((a) => !existsSync(a.path))
}

export function listForTemplate(db: Database.Database, templateId: number): TemplateAttachment[] {
  return db
    .prepare('SELECT id, filename, size FROM template_attachments WHERE template_id = ? ORDER BY id')
    .all(templateId) as TemplateAttachment[]
}

/** Frozen copy of a template's files, stored on the email so later template edits don't change queued mail. */
export function snapshotForTemplate(db: Database.Database, templateId: number | null): string {
  if (templateId == null) return '[]'
  const rows = db
    .prepare('SELECT filename, path FROM template_attachments WHERE template_id = ? ORDER BY id')
    .all(templateId) as EmailAttachment[]
  return JSON.stringify(rows)
}

export function storeFile(dir: string, source: string): { filename: string; path: string; size: number } {
  const st = statSync(source)
  if (!st.isFile()) throw new Error(`"${basename(source)}" is not a file.`)
  mkdirSync(dir, { recursive: true })
  const filename = basename(source)
  const path = join(dir, `${randomBytes(6).toString('hex')}-${filename}`)
  copyFileSync(source, path)
  return { filename, path, size: st.size }
}

function isReferenced(db: Database.Database, path: string): boolean {
  if (db.prepare('SELECT 1 FROM template_attachments WHERE path = ?').get(path)) return true
  // Paths are stored JSON-escaped (backslashes doubled on Windows) inside emails.attachments.
  const escaped = JSON.stringify(path).slice(1, -1)
  return !!db
    .prepare("SELECT 1 FROM emails WHERE status != 'sent' AND instr(attachments, ?) > 0 LIMIT 1")
    .get(escaped)
}

/** Deletes stored files that no template and no unsent email still points to. */
export function removeUnreferenced(db: Database.Database, paths: string[]): void {
  for (const p of new Set(paths)) {
    if (!isReferenced(db, p)) rmSync(p, { force: true })
  }
}

export function applyTemplateChanges(
  db: Database.Database,
  dir: string,
  templateId: number,
  addFiles: string[] = [],
  removeIds: number[] = []
): void {
  const existing = db
    .prepare('SELECT id, path, size FROM template_attachments WHERE template_id = ?')
    .all(templateId) as { id: number; path: string; size: number }[]
  const removing = existing.filter((a) => removeIds.includes(a.id))
  const kept = existing.filter((a) => !removeIds.includes(a.id))
  const adding = addFiles.map((f) => ({ source: f, size: statSync(f).size }))
  const total = [...kept.map((a) => a.size), ...adding.map((a) => a.size)].reduce((a, b) => a + b, 0)
  if (total > MAX_ATTACHMENT_BYTES) {
    throw new Error(`Attachments are ${(total / 1048576).toFixed(1)} MB; the limit per template is ${MAX_ATTACHMENT_BYTES / 1048576} MB.`)
  }

  const stored = adding.map((a) => storeFile(dir, a.source))
  try {
    db.transaction(() => {
      const del = db.prepare('DELETE FROM template_attachments WHERE id = ?')
      removing.forEach((a) => del.run(a.id))
      const ins = db.prepare('INSERT INTO template_attachments (template_id, filename, path, size) VALUES (?,?,?,?)')
      stored.forEach((s) => ins.run(templateId, s.filename, s.path, s.size))
    })()
  } catch (e) {
    stored.forEach((s) => rmSync(s.path, { force: true }))
    throw e
  }
  removeUnreferenced(db, removing.map((a) => a.path))
}

/** One-time move of the old global "CV attachment" setting onto templates and unsent emails. */
export function migrateGlobalCv(db: Database.Database, dir: string, cvPath: string): void {
  if (!cvPath || !existsSync(cvPath)) return
  const cv = storeFile(dir, cvPath)
  db.transaction(() => {
    const ins = db.prepare('INSERT INTO template_attachments (template_id, filename, path, size) VALUES (?,?,?,?)')
    const templates = db
      .prepare('SELECT t.id FROM templates t WHERE NOT EXISTS (SELECT 1 FROM template_attachments a WHERE a.template_id = t.id)')
      .all() as { id: number }[]
    templates.forEach((t) => ins.run(t.id, cv.filename, cv.path, cv.size))
    db.prepare("UPDATE emails SET attachments = ? WHERE status != 'sent' AND attachments = '[]'").run(
      JSON.stringify([{ filename: cv.filename, path: cv.path }])
    )
  })()
  removeUnreferenced(db, [cv.path])
}
