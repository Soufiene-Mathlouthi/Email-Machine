import { useEffect, useMemo, useState } from 'react'
import { Check, ArrowRight } from 'lucide-react'
import type { Account, Contact, OutboxEmail, Template } from '@shared/types'
import { useData, fmtDate } from '../lib/api'
import StatTile from '../components/StatTile'

type NavTarget = 'Outbox' | 'Contacts' | 'Templates' | 'Settings'

// Local calendar day, matching the daily-cap boundary in queue.ts.
function isToday(ms: number | null): boolean {
  if (!ms) return false
  const d = new Date(ms)
  const now = new Date()
  return d.getFullYear() === now.getFullYear() && d.getMonth() === now.getMonth() && d.getDate() === now.getDate()
}

function useDayKey(): string {
  const [day, setDay] = useState(() => new Date().toDateString())
  useEffect(() => {
    const now = new Date()
    const nextMidnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1).getTime()
    const t = setTimeout(() => setDay(new Date().toDateString()), nextMidnight - now.getTime() + 1000)
    return () => clearTimeout(t)
  }, [day])
  return day
}

export default function Dashboard({ onNavigate }: { onNavigate: (tab: NavTarget) => void }) {
  const day = useDayKey()
  const [emails] = useData<OutboxEmail[]>('emails:list', [], ['emails:changed'])
  const [contacts] = useData<Contact[]>('contacts:list', [])
  const [templates] = useData<Template[]>('templates:list', [])
  const [accounts] = useData<Account[]>('accounts:list', [])

  const stats = useMemo(() => {
    let sentToday = 0, sentTotal = 0, queued = 0, failed = 0, drafts = 0
    for (const e of emails) {
      if (e.status === 'sent') {
        sentTotal++
        if (isToday(e.sentAt)) sentToday++
      } else if (e.status === 'queued') queued++
      else if (e.status === 'failed') failed++
      else if (e.status === 'draft') drafts++
    }
    const attempted = sentTotal + failed
    const successRate = attempted ? Math.round((sentTotal / attempted) * 100) : null
    let originalsSent = 0, replied = 0, followUpDrafts = 0
    for (const e of emails) {
      if (e.step === 0 && e.status === 'sent') originalsSent++
      if (e.step === 0 && e.repliedAt !== null) replied++
      if (e.step > 0 && e.status === 'draft') followUpDrafts++
    }
    const replyRate = originalsSent ? Math.round((replied / originalsSent) * 100) : null
    return { sentToday, sentTotal, queued, failed, drafts, successRate, replied, followUpDrafts, replyRate }
  }, [emails, day])

  const dailyCapacity = accounts.reduce((sum, a) => sum + a.dailyCap, 0)

  const recent = useMemo(
    () =>
      emails
        .filter((e) => e.status === 'sent' || e.status === 'failed')
        .sort((a, b) => (b.sentAt ?? b.createdAt) - (a.sentAt ?? a.createdAt))
        .slice(0, 6),
    [emails]
  )

  const steps: { done: boolean; label: string; target: NavTarget }[] = [
    { done: accounts.length > 0, label: 'Connect an email account', target: 'Settings' },
    { done: templates.length > 0, label: 'Write your first template', target: 'Templates' },
    { done: contacts.length > 0, label: 'Add or import contacts', target: 'Contacts' },
    { done: emails.length > 0, label: 'Create a batch of drafts', target: 'Outbox' }
  ]
  const setupDone = steps.every((s) => s.done)

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Dashboard</h1>
          <p className="subtitle">{new Date().toLocaleDateString([], { weekday: 'long', month: 'long', day: 'numeric' })}</p>
        </div>
      </header>

      {!setupDone && (
        <section className="panel onboarding">
          <div className="panel-title">Get set up</div>
          <ol className="steps">
            {steps.map((s, i) => (
              <li key={s.label} className={s.done ? 'done' : ''}>
                <span className="step-dot">{s.done ? <Check size={13} /> : i + 1}</span>
                <span className="step-label">{s.label}</span>
                {!s.done && (
                  <button className="link step-go" onClick={() => onNavigate(s.target)}>
                    Go <ArrowRight size={13} />
                  </button>
                )}
              </li>
            ))}
          </ol>
        </section>
      )}

      <div className="stat-grid">
        <StatTile label="Sent today" value={stats.sentToday} tone="ok"
          hint={dailyCapacity ? `of ${dailyCapacity} daily capacity` : 'no accounts yet'} />
        <StatTile label="In queue" value={stats.queued}
          hint={`${stats.drafts} ${stats.drafts === 1 ? 'draft' : 'drafts'} awaiting review` +
            (stats.followUpDrafts ? ` · ${stats.followUpDrafts} follow-up${stats.followUpDrafts === 1 ? '' : 's'} to review` : '')} />
        <StatTile label="Failed" value={stats.failed} tone={stats.failed > 0 ? 'bad' : 'default'}
          hint={stats.failed > 0 ? 'check Outbox for errors' : stats.successRate === null ? 'all clear' : `${stats.successRate}% delivered`} />
        <StatTile label="Reply rate" value={stats.replyRate === null ? '—' : `${stats.replyRate}%`}
          hint={`${stats.replied} ${stats.replied === 1 ? 'reply' : 'replies'} · ${stats.sentTotal} sent`} />
      </div>

      <div className="mini-stats">
        <button className="mini-stat" onClick={() => onNavigate('Contacts')}>
          <strong>{contacts.length}</strong> contacts
        </button>
        <button className="mini-stat" onClick={() => onNavigate('Templates')}>
          <strong>{templates.length}</strong> templates
        </button>
        <button className="mini-stat" onClick={() => onNavigate('Settings')}>
          <strong>{accounts.length}</strong> accounts
        </button>
      </div>

      <div className="section-head">
        <h2>Recent activity</h2>
        {recent.length > 0 && <button className="link" onClick={() => onNavigate('Outbox')}>Open Outbox</button>}
      </div>
      {recent.length === 0 ? (
        <p className="empty">Nothing sent yet. Queue some drafts in the Outbox and press Start sending.</p>
      ) : (
        <table className="table">
          <thead><tr><th>To</th><th>Subject</th><th>Status</th><th>When</th></tr></thead>
          <tbody>
            {recent.map((e) => (
              <tr key={e.id}>
                <td>{e.toEmail}</td>
                <td className="ellipsis">{e.subject}</td>
                <td><span className={`badge st-${e.status}`} title={e.error}>{e.status}</span></td>
                <td className="muted">{fmtDate(e.sentAt ?? e.createdAt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
