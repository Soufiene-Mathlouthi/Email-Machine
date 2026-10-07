import { useState } from 'react'
import { LogOut, TriangleAlert } from 'lucide-react'
import type { Account } from '@shared/types'
import { invoke } from '../lib/api'
import { initialsFor, useGmailConnect } from '../lib/gmail'
import GoogleMark from './GoogleMark'

// Who is connected, at a glance, with sign-in and sign-out one click away.
export default function AccountChip({ accounts, onOpenSettings }: { accounts: Account[]; onOpenSettings: () => void }) {
  const gmail = accounts.filter((a) => a.authType === 'gmail')
  const active = gmail.find((a) => !a.signedOut)
  const { busy, error, connect, cancel } = useGmailConnect()
  const [confirming, setConfirming] = useState(false)

  if (busy) {
    return (
      <div className="account-chip" role="status">
        <div className="account-line"><span className="spinner" aria-hidden="true" /> Waiting for Google…</div>
        <button className="link small" onClick={cancel}>Cancel</button>
      </div>
    )
  }

  if (!active) {
    return (
      <div className="account-chip signed-out">
        <div className="account-state">{gmail.length ? 'Signed out' : 'Not connected'}</div>
        <button className="btn google-btn" onClick={() => void connect()}>
          <GoogleMark /> Sign in with Google
        </button>
        {error && <div className="account-error" role="alert">{error}</div>}
      </div>
    )
  }

  const name = active.label || active.email
  if (confirming) {
    return (
      <div className="account-chip">
        <div className="account-line">Sign out of {active.email}?</div>
        <div className="muted small">Your outbox and contacts stay.</div>
        <div className="row">
          <button className="btn danger-btn" onClick={() => void invoke('gmail:signOut', active.id).then(() => setConfirming(false))}>Sign out</button>
          <button className="btn" onClick={() => setConfirming(false)}>Cancel</button>
        </div>
      </div>
    )
  }

  return (
    <div className={`account-chip ${active.authError ? 'warn' : ''}`}>
      <div className="account-row">
        <button className="account-main" onClick={onOpenSettings} title="Open account settings">
          <span className="avatar" aria-hidden="true">
            {initialsFor(active.label, active.email)}
            <span className={`avatar-dot ${active.authError ? 'warn' : 'ok'}`} />
          </span>
          <span className="account-text">
            <span className="account-name">{name}</span>
            <span className="account-email">{name === active.email ? (active.authError ? 'Needs reconnecting' : 'Connected') : active.email}</span>
          </span>
        </button>
        <button className="icon-btn" aria-label="Sign out" title="Sign out" onClick={() => setConfirming(true)}>
          <LogOut size={16} />
        </button>
      </div>
      {active.authError && (
        <button className="account-reconnect" onClick={() => void connect()}>
          <TriangleAlert size={14} aria-hidden="true" /> Reconnect Google
        </button>
      )}
    </div>
  )
}
