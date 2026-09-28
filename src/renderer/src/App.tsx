import { useEffect, useState } from 'react'
import type { QueueState } from '@shared/types'
import { invoke } from './lib/api'
import Outbox from './pages/Outbox'
import Contacts from './pages/Contacts'
import Templates from './pages/Templates'
import Jobs from './pages/Jobs'
import Settings from './pages/Settings'

const TABS = ['Outbox', 'Contacts', 'Templates', 'Jobs', 'Settings'] as const
type Tab = (typeof TABS)[number]

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
        <span>{line}</span>
      </div>
      <div className="machine-sub">{q.queued} queued</div>
      {q.running ? (
        <button className="btn ghost-light" onClick={() => void invoke('queue:stop')}>Pause sending</button>
      ) : (
        <button className="btn go" disabled={q.queued === 0} onClick={() => void invoke('queue:start')}>
          Start sending
        </button>
      )}
    </div>
  )
}

export default function App() {
  const [tab, setTab] = useState<Tab>('Outbox')
  const q = useQueue()

  return (
    <div className="app">
      <aside className="side">
        <div className="brand">Email Machine</div>
        <nav>
          {TABS.map((t) => (
            <button key={t} className={`nav ${tab === t ? 'active' : ''}`} onClick={() => setTab(t)}>
              {t}
            </button>
          ))}
        </nav>
        <MachineStrip q={q} />
      </aside>
      <main className="main">
        {tab === 'Outbox' && <Outbox />}
        {tab === 'Contacts' && <Contacts />}
        {tab === 'Templates' && <Templates />}
        {tab === 'Jobs' && <Jobs />}
        {tab === 'Settings' && <Settings />}
      </main>
    </div>
  )
}
