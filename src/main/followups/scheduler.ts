import type { FollowUpRunSummary } from '@shared/types'
import { getDb } from '../db'
import { getThreadSenders } from '../google/gmail'
import { gmailDeps } from '../google/oauth'
import { broadcast } from '../queue'
import { runFollowUpsOnce } from './engine'

let inFlight: Promise<FollowUpRunSummary> | null = null

export function runFollowUps(): Promise<FollowUpRunSummary> {
  if (inFlight) return inFlight
  inFlight = runFollowUpsOnce({
    db: getDb(),
    now: Date.now(),
    getThreadSenders: (accountId, threadId) => getThreadSenders(gmailDeps(accountId), threadId),
    log: (m) => console.warn(m)
  })
    .then((s) => {
      if (s.repliesFound || s.bounces || s.draftsCreated || s.cleanedUp) broadcast('emails:changed')
      return s
    })
    .finally(() => {
      inFlight = null
    })
  return inFlight
}

export function startFollowUpScheduler(): void {
  const run = () => void runFollowUps().catch((e) => console.warn('Follow-up run failed:', e instanceof Error ? e.message : e))
  setTimeout(run, 10_000)
  setInterval(run, 30 * 60_000)
}
