import nodemailer from 'nodemailer'
import type { EmailAttachment } from '@shared/types'
import { missingAttachment } from './attachments'
import { decryptSecret, getDb } from './db'
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
  msg: { to: string; subject: string; body: string; attachments: EmailAttachment[] },
  thread?: ThreadInfo
): Promise<{ messageId: string; threadId: string }> {
  const row = getAccount(accountId)
  const { attachments } = msg
  const missing = missingAttachment(attachments)
  if (missing) throw new Error(`Attachment "${missing.filename}" is missing from the app's storage. Re-add it to the template.`)
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
