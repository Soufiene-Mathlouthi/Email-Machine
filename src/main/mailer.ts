import nodemailer from 'nodemailer'
import { existsSync } from 'fs'
import { basename } from 'path'
import { decryptSecret, getDb, getSetting } from './db'

interface AccountRow {
  email: string
  label: string
  host: string
  port: number
  secure: number
  username: string
  password_enc: string
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
  const row = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as AccountRow | undefined
  if (!row) throw new Error('Account not found')
  await transportFor(row).verify()
}

export async function sendEmail(
  accountId: number,
  msg: { to: string; subject: string; body: string }
): Promise<void> {
  const row = getDb().prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as AccountRow | undefined
  if (!row) throw new Error('Account not found')

  const cvPath = getSetting('cvPath')
  const attachments = cvPath && existsSync(cvPath) ? [{ filename: basename(cvPath), path: cvPath }] : []

  await transportFor(row).sendMail({
    from: row.label ? `"${row.label.replace(/"/g, '')}" <${row.email}>` : row.email,
    to: msg.to, // always exactly one recipient, never CC/BCC
    subject: msg.subject,
    text: msg.body,
    attachments
  })
}
