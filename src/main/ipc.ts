import { app, dialog, ipcMain } from 'electron'
import { statSync } from 'fs'
import { join } from 'path'
import type {
  Account, AccountInput, ColumnMapping, Contact, ContactInput, EmailPreview, FollowUpRunSummary, ImportPreview, ImportResult, Job, JobInput, OutboxEmail,
  PickedFile, Settings, SettingsInput, SetStatusResult, Template, TemplateInput
} from '@shared/types'
import { SERVER_PORT } from '@shared/types'
import { renderTemplate } from '@shared/template'
import { applyTemplateChanges, listForTemplate, removeUnreferenced, snapshotForTemplate } from './attachments'
import { guessMapping, importRows, readSheet } from './contact-import'
import { decryptSecret, encryptSecret, getApiToken, getDb, getSetting, setSetting } from './db'
import { findDuplicates, queueEmails, updateEmail } from './duplicates'
import { deleteEmails, stopSequences } from './followups/engine'
import { applyFollowUpUpdate, parseFollowUpConfig } from './followups/rules'
import { runFollowUps } from './followups/scheduler'
import { cancelGmailConnect, clientConfigured, connectGmail, forgetAccountToken, hasBuiltInClient, signOutGmail } from './google/oauth'
import { verifyAccount } from './mailer'
import { buildPreview } from './preview'
import { broadcast, queueState, startQueue, stopQueue } from './queue'

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, (_e, ...args) => fn(...(args as A)))
}

const EMAIL_COLS = `id, account_id AS accountId, contact_id AS contactId, job_id AS jobId,
  to_email AS toEmail, subject, body, status, error, sent_at AS sentAt, created_at AS createdAt,
  parent_id AS parentId, step, replied_at AS repliedAt, followups_stopped AS followupsStopped, stop_reason AS stopReason,
  json_array_length(attachments) AS attachmentCount`

const duplicateWindow = (): number => Number(getSetting('duplicateWindowDays', '30'))

export function registerIpc(): void {
  const db = getDb()

  // ---------- accounts ----------
  handle('accounts:list', (): Account[] =>
    (db.prepare('SELECT * FROM accounts ORDER BY id').all() as Record<string, unknown>[]).map((r) => ({
      id: r.id as number,
      label: r.label as string,
      email: r.email as string,
      host: r.host as string,
      port: r.port as number,
      secure: !!r.secure,
      username: r.username as string,
      hasPassword: !!r.password_enc,
      dailyCap: r.daily_cap as number,
      authType: r.auth_type as 'smtp' | 'gmail',
      authError: r.auth_error as string,
      signedOut: r.auth_type === 'gmail' && !r.oauth_refresh_enc
    }))
  )

  handle('accounts:save', (a: AccountInput) => {
    broadcast('accounts:changed')
    if (a.id) {
      const kind = db.prepare('SELECT auth_type FROM accounts WHERE id=?').get(a.id) as { auth_type: string } | undefined
      if (kind?.auth_type === 'gmail') {
        db.prepare('UPDATE accounts SET label=?, daily_cap=? WHERE id=?').run(a.label, a.dailyCap, a.id)
        return
      }
      db.prepare(
        'UPDATE accounts SET label=?, email=?, host=?, port=?, secure=?, username=?, daily_cap=? WHERE id=?'
      ).run(a.label, a.email, a.host, a.port, a.secure ? 1 : 0, a.username, a.dailyCap, a.id)
      if (a.password) {
        db.prepare('UPDATE accounts SET password_enc=? WHERE id=?').run(encryptSecret(a.password), a.id)
      }
    } else {
      db.prepare(
        'INSERT INTO accounts (label, email, host, port, secure, username, password_enc, daily_cap) VALUES (?,?,?,?,?,?,?,?)'
      ).run(a.label, a.email, a.host, a.port, a.secure ? 1 : 0, a.username, encryptSecret(a.password ?? ''), a.dailyCap)
    }
  })

  handle('accounts:delete', (id: number) => {
    db.prepare('DELETE FROM accounts WHERE id=?').run(id)
    forgetAccountToken(id)
    broadcast('accounts:changed')
    broadcast('emails:changed')
  })

  handle('accounts:test', async (id: number) => {
    try {
      await verifyAccount(id)
      return { ok: true, message: 'Connection works.' }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  })

  handle('gmail:connect', async () => {
    await connectGmail()
    broadcast('accounts:changed')
  })
  handle('gmail:cancel', () => cancelGmailConnect())
  handle('gmail:signOut', async (id: number) => {
    await signOutGmail(id)
    broadcast('accounts:changed')
    broadcast('emails:changed')
  })

  // ---------- contacts ----------
  handle('contacts:list', (): Contact[] =>
    db.prepare('SELECT id, name, email, company, role, notes FROM contacts ORDER BY id DESC').all() as Contact[]
  )

  handle('contacts:save', (c: ContactInput) => {
    if (c.id) {
      db.prepare('UPDATE contacts SET name=?, email=?, company=?, role=?, notes=? WHERE id=?').run(
        c.name, c.email, c.company, c.role, c.notes, c.id
      )
    } else {
      db.prepare('INSERT OR IGNORE INTO contacts (name, email, company, role, notes) VALUES (?,?,?,?,?)').run(
        c.name, c.email, c.company, c.role, c.notes
      )
    }
  })

  handle('contacts:delete', (id: number) => void db.prepare('DELETE FROM contacts WHERE id=?').run(id))

  handle('contacts:importPreview', async (): Promise<ImportPreview | null> => {
    const pick = await dialog.showOpenDialog({
      filters: [{ name: 'Spreadsheet', extensions: ['csv', 'xlsx'] }],
      properties: ['openFile']
    })
    if (pick.canceled || !pick.filePaths[0]) return null
    const sheet = await readSheet(pick.filePaths[0])
    return {
      path: pick.filePaths[0],
      headers: sheet.headers,
      sample: sheet.rows.slice(0, 5),
      total: sheet.rows.length,
      mapping: guessMapping(sheet.headers)
    }
  })

  handle('contacts:importCommit', async (p: { path: string; mapping: ColumnMapping }): Promise<ImportResult> =>
    importRows(db, (await readSheet(p.path)).rows, p.mapping)
  )

  // ---------- templates ----------
  const attachmentsDir = (): string => join(app.getPath('userData'), 'attachments')

  handle('templates:list', (): Template[] =>
    (db.prepare('SELECT id, name, subject, body FROM templates ORDER BY id DESC').all() as Omit<Template, 'attachments'>[]).map(
      (t) => ({ ...t, attachments: listForTemplate(db, t.id) })
    )
  )
  handle('templates:save', (t: TemplateInput) => {
    const id = t.id
      ? (db.prepare('UPDATE templates SET name=?, subject=?, body=? WHERE id=?').run(t.name, t.subject, t.body, t.id), t.id)
      : Number(db.prepare('INSERT INTO templates (name, subject, body) VALUES (?,?,?)').run(t.name, t.subject, t.body).lastInsertRowid)
    try {
      applyTemplateChanges(db, attachmentsDir(), id, t.addFiles, t.removeAttachmentIds)
    } catch (e) {
      // A brand-new template whose files were rejected shouldn't linger half-created.
      if (!t.id) db.prepare('DELETE FROM templates WHERE id=?').run(id)
      throw e
    }
  })
  handle('templates:delete', (id: number) => {
    const paths = (db.prepare('SELECT path FROM template_attachments WHERE template_id=?').all(id) as { path: string }[]).map((r) => r.path)
    db.prepare('DELETE FROM templates WHERE id=?').run(id)
    removeUnreferenced(db, paths)
  })
  handle('dialog:pickFiles', async (): Promise<PickedFile[]> => {
    const r = await dialog.showOpenDialog({ properties: ['openFile', 'multiSelections'] })
    return r.canceled ? [] : r.filePaths.map((path) => ({ path, filename: path.split(/[\/]/).pop() ?? path, size: statSync(path).size }))
  })

  // ---------- jobs ----------
  handle('jobs:list', (): Job[] =>
    db.prepare(
      'SELECT id, title, company, url, description, contact_email AS contactEmail, created_at AS createdAt FROM jobs ORDER BY id DESC'
    ).all() as Job[]
  )
  handle('jobs:save', (j: JobInput) => {
    if (j.id) {
      db.prepare('UPDATE jobs SET title=?, company=?, url=?, description=?, contact_email=? WHERE id=?').run(
        j.title, j.company, j.url, j.description, j.contactEmail, j.id
      )
    } else {
      db.prepare(
        'INSERT INTO jobs (title, company, url, description, contact_email, created_at) VALUES (?,?,?,?,?,?)'
      ).run(j.title, j.company, j.url, j.description, j.contactEmail, Date.now())
    }
  })
  handle('jobs:delete', (id: number) => void db.prepare('DELETE FROM jobs WHERE id=?').run(id))

  // ---------- emails (outbox) ----------
  handle('emails:list', (): OutboxEmail[] => {
    const rows = db.prepare(`SELECT ${EMAIL_COLS} FROM emails ORDER BY id DESC`).all() as (Omit<OutboxEmail, 'followupsStopped' | 'duplicateOf'> & {
      followupsStopped: number
    })[]
    const dups = findDuplicates(
      db,
      rows.filter((e) => e.status === 'draft' || e.status === 'failed').map((e) => e.id),
      duplicateWindow()
    )
    return rows.map((e) => ({ ...e, followupsStopped: !!e.followupsStopped, duplicateOf: dups.get(e.id) ?? null }))
  })

  handle('emails:preview', (id: number): EmailPreview | null => buildPreview(db, id, duplicateWindow()) ?? null)

  // Create one personalized draft per contact from a template
  handle('emails:createFromTemplate', (p: { templateId: number; contactIds: number[]; accountId: number }) => {
    const tpl = db.prepare('SELECT subject, body FROM templates WHERE id=?').get(p.templateId) as
      | { subject: string; body: string }
      | undefined
    if (!tpl) throw new Error('Template not found')
    const files = snapshotForTemplate(db, p.templateId)
    const getContact = db.prepare('SELECT * FROM contacts WHERE id=?')
    const insert = db.prepare(
      "INSERT INTO emails (account_id, contact_id, to_email, subject, body, status, created_at, attachments) VALUES (?,?,?,?,?,'draft',?,?)"
    )
    db.transaction(() => {
      for (const id of p.contactIds) {
        const c = getContact.get(id) as Contact | undefined
        if (!c) continue
        const vars = { name: c.name, firstName: c.name.split(' ')[0] ?? '', company: c.company, role: c.role, email: c.email }
        insert.run(p.accountId, c.id, c.email, renderTemplate(tpl.subject, vars), renderTemplate(tpl.body, vars), Date.now(), files)
      }
    })()
    broadcast('emails:changed')
  })

  handle('emails:createForJob', (p: { jobId: number; templateId: number; accountId: number; toEmail: string; recipientName: string }) => {
    const job = db.prepare('SELECT title, company, contact_email AS contactEmail FROM jobs WHERE id=?').get(p.jobId) as
      | { title: string; company: string; contactEmail: string }
      | undefined
    if (!job) throw new Error('Job not found')
    const tpl = db.prepare('SELECT subject, body FROM templates WHERE id=?').get(p.templateId) as
      | { subject: string; body: string }
      | undefined
    if (!tpl) throw new Error('Template not found')
    const to = p.toEmail.trim() || job.contactEmail.trim()
    if (!to) throw new Error('Enter a recipient email for this job.')
    if (!/^\S+@\S+\.\S+$/.test(to)) throw new Error(`"${to}" doesn't look like a valid email address.`)
    const name = p.recipientName.trim()
    const vars = { name, firstName: name.split(' ')[0] ?? '', company: job.company, role: job.title, email: to }
    db.prepare(
      "INSERT INTO emails (account_id, job_id, to_email, subject, body, status, created_at, attachments) VALUES (?,?,?,?,?,'draft',?,?)"
    ).run(p.accountId, p.jobId, to, renderTemplate(tpl.subject, vars), renderTemplate(tpl.body, vars), Date.now(), snapshotForTemplate(db, p.templateId))
    broadcast('emails:changed')
  })

  handle('emails:update', (e: { id: number; toEmail: string; subject: string; body: string }): boolean => {
    const ok = updateEmail(db, e)
    if (ok) {
      broadcast('emails:changed')
      broadcast('queue:state', queueState())
    }
    return ok
  })

  handle('emails:setStatus', (p: { ids: number[]; status: 'draft' | 'queued'; override?: boolean }): SetStatusResult => {
    const result: SetStatusResult = { changed: [], held: [] }
    if (p.status === 'queued') {
      Object.assign(result, queueEmails(db, p.ids, duplicateWindow(), !!p.override))
    } else {
      const stmt = db.prepare("UPDATE emails SET status='draft', error='' WHERE id=? AND status IN ('draft','queued','failed')")
      db.transaction(() => p.ids.forEach((id) => { if (stmt.run(id).changes) result.changed.push(id) }))()
    }
    broadcast('emails:changed')
    broadcast('queue:state', queueState())
    return result
  })

  handle('emails:delete', (ids: number[]) => {
    deleteEmails(db, ids)
    broadcast('emails:changed')
  })

  handle('emails:markReplied', (ids: number[]) => {
    stopSequences(db, ids, 'replied', Date.now())
    broadcast('emails:changed')
    broadcast('queue:state', queueState())
  })
  handle('emails:stopFollowups', (ids: number[]) => {
    stopSequences(db, ids, 'manual', Date.now())
    broadcast('emails:changed')
    broadcast('queue:state', queueState())
  })
  handle('followups:run', (): Promise<FollowUpRunSummary> => runFollowUps())

  // ---------- queue ----------
  handle('queue:state', () => queueState())
  handle('queue:start', () => startQueue())
  handle('queue:stop', () => stopQueue())

  // ---------- settings ----------
  handle('settings:get', (): Settings => ({
    minDelaySec: Number(getSetting('minDelaySec', '30')),
    maxDelaySec: Number(getSetting('maxDelaySec', '120')),
    apiToken: getApiToken(),
    serverPort: SERVER_PORT,
    googleClientId: getSetting('googleClientId'),
    googleClientSecretSet: !!decryptSecret(getSetting('googleClientSecretEnc')),
    googleBuiltIn: hasBuiltInClient(),
    googleReady: clientConfigured(),
    followUps: parseFollowUpConfig(getSetting('followUps')),
    duplicateWindowDays: duplicateWindow()
  }))

  handle('settings:set', (s: SettingsInput) => {
    if (s.minDelaySec !== undefined) setSetting('minDelaySec', String(s.minDelaySec))
    if (s.maxDelaySec !== undefined) setSetting('maxDelaySec', String(s.maxDelaySec))
    if (s.duplicateWindowDays !== undefined) setSetting('duplicateWindowDays', String(Math.max(0, Math.floor(s.duplicateWindowDays))))
    if (s.googleClientId !== undefined) setSetting('googleClientId', s.googleClientId.trim())
    if (s.googleClientSecret) setSetting('googleClientSecretEnc', encryptSecret(s.googleClientSecret.trim()))
    if (s.followUps !== undefined) {
      const next = applyFollowUpUpdate(parseFollowUpConfig(getSetting('followUps')), s.followUps, Date.now())
      setSetting('followUps', JSON.stringify(next))
    }
  })
}
