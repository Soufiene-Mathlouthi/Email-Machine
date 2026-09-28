import { BrowserWindow } from 'electron'
import type { QueueState } from '@shared/types'
import { getDb, getSetting } from './db'
import { sendEmail } from './mailer'

let running = false
let timer: NodeJS.Timeout | null = null
let nextSendAt: number | null = null
let current: string | null = null

interface QueuedRow {
  id: number
  account_id: number
  to_email: string
  subject: string
  body: string
}

// Next queued email whose account has not reached its daily cap yet
function nextEligible(): QueuedRow | undefined {
  return getDb()
    .prepare(
      `SELECT e.id, e.account_id, e.to_email, e.subject, e.body
       FROM emails e JOIN accounts a ON a.id = e.account_id
       WHERE e.status = 'queued'
         AND (SELECT COUNT(*) FROM emails s
              WHERE s.account_id = e.account_id AND s.status = 'sent'
                AND date(s.sent_at / 1000, 'unixepoch', 'localtime') = date('now', 'localtime')
             ) < a.daily_cap
       ORDER BY e.id LIMIT 1`
    )
    .get() as QueuedRow | undefined
}

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
  const email = nextEligible()
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
    await sendEmail(email.account_id, { to: email.to_email, subject: email.subject, body: email.body })
    db.prepare("UPDATE emails SET status = 'sent', sent_at = ?, error = '' WHERE id = ?").run(Date.now(), email.id)
  } catch (err) {
    db.prepare("UPDATE emails SET status = 'failed', error = ? WHERE id = ?").run(
      err instanceof Error ? err.message : String(err),
      email.id
    )
  }

  current = null
  broadcast('emails:changed')
  if (!running) return
  if (!nextEligible()) {
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
