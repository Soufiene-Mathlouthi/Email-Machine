import { useEffect, useState } from 'react'
import type { QueueState } from '@shared/types'
import {
  LayoutDashboard, Inbox, Users, FileText, Briefcase, Settings as SettingsIcon, Mail, Play, Pause, type LucideIcon
} from 'lucide-react'
import { invoke } from './lib/api'
import Dashboard from './pages/Dashboard'
import Outbox from './pages/Outbox'
import Contacts from './pages/Contacts'
import Templates from './pages/Templates'
import Jobs from './pages/Jobs'
import Settings from './pages/Settings'

const TABS = ['Dashboard', 'Outbox', 'Contacts', 'Templates', 'Jobs', 'Settings'] as const
type Tab = (typeof TABS)[number]

const ICONS: Record<Tab, LucideIcon> = {
  Dashboard: LayoutDashboard,
  Outbox: Inbox,
  Contacts: Users,
  Templates: FileText,
  Jobs: Briefcase,
  Settings: SettingsIcon
}

function useQueue(): QueueState {
  const [q, setQ] = useState<QueueState>({ running: false, nextSendAt: null, current: null, queued: 0 })
  useEffect(() => {
    void invoke<QueueState>('queue:state').then(setQ)
    return window.api.on('queue:state', setQ)
  }, [])
  return q
}

function useNow(active: boolean): number {
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!active) return
    const t = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(t)
  }, [active])
  return now
}

function MachineStrip({ q }: { q: QueueState }) {
  const now = useNow(q.running)
  const wait = q.nextSendAt ? Math.max(0, Math.ceil((q.nextSendAt - now) / 1000)) : 0

  let line = 'Idle'
  if (q.running) line = q.current ? `Sending to ${q.current}` : q.nextSendAt ? `Next email in ${wait}s` : 'Starting…'

  return (
    <div className={`machine ${q.running ? 'on' : ''}`}>
      <div className="machine-line">
        <span className="lamp" />
        <span className="machine-status">{line}</span>
      </div>
      <div className="machine-sub">{q.queued} queued</div>
      {q.running ? (
        <button className="btn ghost-light" onClick={() => void invoke('queue:stop')}>
          <Pause size={14} /> Pause sending
        </button>
      ) : (
        <button className="btn go" disabled={q.queued === 0} onClick={() => void invoke('queue:start')}>
          <Play size={14} /> Start sending
        </button>
      )}
    </div>
  )
}

export default function App() {
  const [tab, setTab] = useState<Tab>('Dashboard')
  const q = useQueue()

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">
          <span className="brand-mark"><Mail size={16} /></span>
          Email Machine
        </div>
        <nav aria-label="Main">
          {TABS.map((t) => {
            const Icon = ICONS[t]
            return (
              <button key={t} className={`nav ${tab === t ? 'active' : ''}`} aria-current={tab === t ? 'page' : undefined}
                onClick={() => setTab(t)}>
                <Icon size={17} aria-hidden="true" />
                <span>{t}</span>
                {t === 'Outbox' && q.queued > 0 && <span className="nav-badge">{q.queued}</span>}
              </button>
            )
          })}
        </nav>
        <MachineStrip q={q} />
      </aside>
      <main className="main">
        <div className="page" key={tab}>
          {tab === 'Dashboard' && <Dashboard onNavigate={setTab} />}
          {tab === 'Outbox' && <Outbox />}
          {tab === 'Contacts' && <Contacts />}
          {tab === 'Templates' && <Templates />}
          {tab === 'Jobs' && <Jobs />}
          {tab === 'Settings' && <Settings />}
        </div>
      </main>
    </div>
  )
}
