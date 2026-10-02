import { BrowserWindow } from 'electron'
import type { QueueState } from '@shared/types'
import { getDb, getSetting } from './db'
import { parseAttachments } from './attachments'
import { sendEmail } from './mailer'
import { selectNextEligible } from './queue-select'

let running = false
let timer: NodeJS.Timeout | null = null
let nextSendAt: number | null = null
let current: string | null = null

export function queueState(): QueueState {
  const { n } = getDb().prepare("SELECT COUNT(*) AS n FROM emails WHERE status = 'queued'").get() as { n: number }
  return { running, nextSendAt, current, queued: n }
}

export function broadcast(channel: string, payload?: unknown): void {
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send(channel, payload)
}

function emitState(): void {
  broadcast('queue:state', queueState())
}

function randomDelayMs(): number {
  const min = Math.max(0, Number(getSetting('minDelaySec', '30')))
  const max = Math.max(min, Number(getSetting('maxDelaySec', '120')))
  return (min + Math.random() * (max - min)) * 1000
}

async function tick(): Promise<void> {
  if (!running) return
  const email = selectNextEligible(getDb())
  if (!email) {
    stopQueue()
    return
  }

  const db = getDb()
  nextSendAt = null
  current = email.to_email
  db.prepare("UPDATE emails SET status = 'sending' WHERE id = ?").run(email.id)
  emitState()
  broadcast('emails:changed')

  try {
    const parent = email.parent_id
      ? (db.prepare('SELECT message_id, thread_id FROM emails WHERE id = ?').get(email.parent_id) as
          | { message_id: string; thread_id: string }
          | undefined)
      : undefined
    const thread = parent
      ? { inReplyTo: parent.message_id, references: parent.message_id, gmailThreadId: parent.thread_id }
      : undefined
    const sent = await sendEmail(
      email.account_id,
      { to: email.to_email, subject: email.subject, body: email.body, attachments: parseAttachments(email.attachments) },
      thread
    )
    db.prepare("UPDATE emails SET status = 'sent', sent_at = ?, error = '', message_id = ?, thread_id = ? WHERE id = ?").run(
      Date.now(), sent.messageId, sent.threadId, email.id
    )
  } catch (err) {
    db.prepare("UPDATE emails SET status = 'failed', error = ? WHERE id = ?").run(
      err instanceof Error ? err.message : String(err),
      email.id
    )
  }

  current = null
  broadcast('emails:changed')
  if (!running) return
  if (!selectNextEligible(db)) {
    stopQueue()
    return
  }

  const delay = randomDelayMs()
  nextSendAt = Date.now() + delay
  emitState()
  timer = setTimeout(() => void tick(), delay)
}

export function startQueue(): void {
  if (running) return
  running = true
  emitState()
  void tick()
}

export function stopQueue(): void {
  running = false
  if (timer) clearTimeout(timer)
  timer = null
  nextSendAt = null
  emitState()
}
