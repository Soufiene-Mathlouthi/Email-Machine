import nodemailer from 'nodemailer'
import { existsSync } from 'fs'
import { basename } from 'path'
import { decryptSecret, getDb, getSetting } from './db'
import { composeMime, formatFrom } from './mime'
import { gmailDeps } from './google/oauth'
import { getMessageIdHeader, getProfile, sendRaw } from './google/gmail'

interface AccountRow {
  email: string
  label: string
  host: string
  port: number
  secure: number
  username: string
  password_enc: string
  auth_type: string
  auth_error: string
}

export interface ThreadInfo {
  inReplyTo: string
  references: string
  gmailThreadId: string
}

function getAccount(accountId: number): AccountRow {
  const row = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as AccountRow | undefined
  if (!row) throw new Error('Account not found')
  return row
}

function transportFor(row: AccountRow) {
  return nodemailer.createTransport({
    host: row.host,
    port: row.port,
    secure: !!row.secure,
    auth: { user: row.username, pass: decryptSecret(row.password_enc) }
  })
}

export async function verifyAccount(accountId: number): Promise<void> {
  const row = getAccount(accountId)
  if (row.auth_type === 'gmail') {
    await getProfile(gmailDeps(accountId))
    return
  }
  await transportFor(row).verify()
}

export async function sendEmail(
  accountId: number,
  msg: { to: string; subject: string; body: string },
  thread?: ThreadInfo
): Promise<{ messageId: string; threadId: string }> {
  const row = getAccount(accountId)
  const cvPath = getSetting('cvPath')
  const attachments = cvPath && existsSync(cvPath) ? [{ filename: basename(cvPath), path: cvPath }] : []
  const from = formatFrom(row.label, row.email)
  const threading = thread?.inReplyTo ? { inReplyTo: thread.inReplyTo, references: thread.references || thread.inReplyTo } : {}

  if (row.auth_type === 'gmail') {
    if (row.auth_error) throw new Error(row.auth_error)
    const deps = gmailDeps(accountId)
    const raw = await composeMime({ from, to: msg.to, subject: msg.subject, text: msg.body, attachments, ...threading })
    const sent = await sendRaw(deps, raw, thread?.gmailThreadId || undefined)
    const messageId = await getMessageIdHeader(deps, sent.id).catch(() => '')
    return { messageId, threadId: sent.threadId }
  }

  const info = await transportFor(row).sendMail({
    from,
    to: msg.to, // always exactly one recipient, never CC/BCC
    subject: msg.subject,
    text: msg.body,
    attachments,
    ...threading
  })
  return { messageId: info.messageId ?? '', threadId: '' }
}
