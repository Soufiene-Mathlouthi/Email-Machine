import { dialog, ipcMain } from 'electron'
import { readFileSync } from 'fs'
import Papa from 'papaparse'
import type {
  Account, AccountInput, Contact, ContactInput, Job, JobInput, OutboxEmail,
  Settings, SettingsInput, Template, TemplateInput
} from '@shared/types'
import { SERVER_PORT } from '@shared/types'
import { draftEmail } from './ai'
import { decryptSecret, encryptSecret, getApiToken, getDb, getSetting, setSetting } from './db'
import { renderTemplate, verifyAccount } from './mailer'
import { broadcast, queueState, startQueue, stopQueue } from './queue'

function handle<A extends unknown[], R>(channel: string, fn: (...args: A) => R | Promise<R>): void {
  ipcMain.handle(channel, (_e, ...args) => fn(...(args as A)))
}

const EMAIL_COLS = `id, account_id AS accountId, contact_id AS contactId, job_id AS jobId,
  to_email AS toEmail, subject, body, status, error, sent_at AS sentAt, created_at AS createdAt`

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
      dailyCap: r.daily_cap as number
    }))
  )

  handle('accounts:save', (a: AccountInput) => {
    if (a.id) {
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

  handle('accounts:delete', (id: number) => void db.prepare('DELETE FROM accounts WHERE id=?').run(id))

  handle('accounts:test', async (id: number) => {
    try {
      await verifyAccount(id)
      return { ok: true, message: 'Connection works.' }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
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

  handle('contacts:importCsv', async () => {
    const pick = await dialog.showOpenDialog({ filters: [{ name: 'CSV', extensions: ['csv'] }], properties: ['openFile'] })
    if (pick.canceled || !pick.filePaths[0]) return { added: 0, skipped: 0 }
    const parsed = Papa.parse<Record<string, string>>(readFileSync(pick.filePaths[0], 'utf8'), {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.trim().toLowerCase()
    })
    const insert = db.prepare('INSERT OR IGNORE INTO contacts (name, email, company, role, notes) VALUES (?,?,?,?,?)')
    let added = 0
    let skipped = 0
    db.transaction(() => {
      for (const r of parsed.data) {
        const email = (r.email ?? '').trim()
        if (!/^\S+@\S+\.\S+$/.test(email)) { skipped++; continue }
        const info = insert.run(r.name ?? '', email, r.company ?? '', r.role ?? '', r.notes ?? '')
        info.changes ? added++ : skipped++
      }
    })()
    return { added, skipped }
  })

  // ---------- templates ----------
  handle('templates:list', (): Template[] =>
    db.prepare('SELECT id, name, subject, body FROM templates ORDER BY id DESC').all() as Template[]
  )
  handle('templates:save', (t: TemplateInput) => {
    if (t.id) db.prepare('UPDATE templates SET name=?, subject=?, body=? WHERE id=?').run(t.name, t.subject, t.body, t.id)
    else db.prepare('INSERT INTO templates (name, subject, body) VALUES (?,?,?)').run(t.name, t.subject, t.body)
  })
  handle('templates:delete', (id: number) => void db.prepare('DELETE FROM templates WHERE id=?').run(id))

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
  handle('emails:list', (): OutboxEmail[] =>
    db.prepare(`SELECT ${EMAIL_COLS} FROM emails ORDER BY id DESC`).all() as OutboxEmail[]
  )

  // Create one personalized draft per contact from a template
  handle('emails:createFromTemplate', (p: { templateId: number; contactIds: number[]; accountId: number }) => {
    const tpl = db.prepare('SELECT subject, body FROM templates WHERE id=?').get(p.templateId) as
      | { subject: string; body: string }
      | undefined
    if (!tpl) throw new Error('Template not found')
    const getContact = db.prepare('SELECT * FROM contacts WHERE id=?')
    const insert = db.prepare(
      "INSERT INTO emails (account_id, contact_id, to_email, subject, body, status, created_at) VALUES (?,?,?,?,?,'draft',?)"
    )
    db.transaction(() => {
      for (const id of p.contactIds) {
        const c = getContact.get(id) as Contact | undefined
        if (!c) continue
        const vars = { name: c.name, firstName: c.name.split(' ')[0] ?? '', company: c.company, role: c.role, email: c.email }
        insert.run(p.accountId, c.id, c.email, renderTemplate(tpl.subject, vars), renderTemplate(tpl.body, vars), Date.now())
      }
    })()
    broadcast('emails:changed')
  })

  // Draft a tailored email for a scraped/saved job using Claude
  handle('emails:draftForJob', async (p: { jobId: number; accountId: number; toEmail: string; recipientName: string }) => {
    const job = db.prepare('SELECT title, company, description, contact_email AS contactEmail FROM jobs WHERE id=?').get(p.jobId) as
      | { title: string; company: string; description: string; contactEmail: string }
      | undefined
    if (!job) throw new Error('Job not found')
    const to = (p.toEmail || job.contactEmail).trim()
    if (!to) throw new Error('Enter a recipient email for this job.')
    const draft = await draftEmail({
      jobTitle: job.title, company: job.company, jobDescription: job.description, recipientName: p.recipientName
    })
    db.prepare(
      "INSERT INTO emails (account_id, job_id, to_email, subject, body, status, created_at) VALUES (?,?,?,?,?,'draft',?)"
    ).run(p.accountId, p.jobId, to, draft.subject, draft.body, Date.now())
    broadcast('emails:changed')
  })

  handle('emails:update', (e: { id: number; toEmail: string; subject: string; body: string }) => {
    db.prepare("UPDATE emails SET to_email=?, subject=?, body=? WHERE id=? AND status IN ('draft','failed','queued')").run(
      e.toEmail, e.subject, e.body, e.id
    )
  })

  handle('emails:setStatus', (p: { ids: number[]; status: 'draft' | 'queued' }) => {
    const stmt = db.prepare("UPDATE emails SET status=?, error='' WHERE id=? AND status IN ('draft','queued','failed')")
    db.transaction(() => p.ids.forEach((id) => stmt.run(p.status, id)))()
    broadcast('emails:changed')
    broadcast('queue:state', queueState())
  })

  handle('emails:delete', (ids: number[]) => {
    const stmt = db.prepare("DELETE FROM emails WHERE id=? AND status != 'sending'")
    db.transaction(() => ids.forEach((id) => stmt.run(id)))()
    broadcast('emails:changed')
  })

  // ---------- queue ----------
  handle('queue:state', () => queueState())
  handle('queue:start', () => startQueue())
  handle('queue:stop', () => stopQueue())

  // ---------- settings ----------
  handle('settings:get', (): Settings => ({
    minDelaySec: Number(getSetting('minDelaySec', '30')),
    maxDelaySec: Number(getSetting('maxDelaySec', '120')),
    cvPath: getSetting('cvPath'),
    profile: getSetting('profile'),
    aiModel: getSetting('aiModel', 'claude-sonnet-5'),
    anthropicKeySet: !!decryptSecret(getSetting('anthropicKeyEnc')),
    apiToken: getApiToken(),
    serverPort: SERVER_PORT
  }))

  handle('settings:set', (s: SettingsInput) => {
    if (s.minDelaySec !== undefined) setSetting('minDelaySec', String(s.minDelaySec))
    if (s.maxDelaySec !== undefined) setSetting('maxDelaySec', String(s.maxDelaySec))
    if (s.cvPath !== undefined) setSetting('cvPath', s.cvPath)
    if (s.profile !== undefined) setSetting('profile', s.profile)
    if (s.aiModel !== undefined) setSetting('aiModel', s.aiModel)
    if (s.anthropicKey) setSetting('anthropicKeyEnc', encryptSecret(s.anthropicKey))
  })

  handle('dialog:pickCv', async () => {
    const r = await dialog.showOpenDialog({
      filters: [{ name: 'Documents', extensions: ['pdf', 'doc', 'docx'] }],
      properties: ['openFile']
    })
    return r.canceled ? '' : r.filePaths[0]
  })
}
