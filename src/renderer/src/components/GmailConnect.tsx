import { useEffect, useState } from 'react'
import { Check, Lock, LogOut, ShieldCheck } from 'lucide-react'
import type { Account, Settings } from '@shared/types'
import { invoke } from '../lib/api'
import { initialsFor, useGmailConnect } from '../lib/gmail'
import GoogleMark from './GoogleMark'

type Probe = { ok: boolean | null; message: string }

function ConnectedCard({ account }: { account: Account }) {
  const [cap, setCap] = useState(account.dailyCap)
  const [probe, setProbe] = useState<Probe | null>(null)
  const [confirming, setConfirming] = useState(false)
  const { connect, busy, error } = useGmailConnect()
  useEffect(() => setCap(account.dailyCap), [account.dailyCap])

  const test = async () => {
    setProbe({ ok: null, message: 'Checking the connection…' })
    setProbe(await invoke<Probe>('accounts:test', account.id))
  }
  const name = account.label || account.email

  return (
    <section className="panel account-card">
      <div className="account-card-head">
        <span className="avatar lg" aria-hidden="true">{initialsFor(account.label, account.email)}</span>
        <div className="account-card-id">
          <div className="account-card-name">{name}</div>
          {name !== account.email && <div className="muted">{account.email}</div>}
        </div>
        <span className={`tag ${account.authError ? 'bad' : 'ok'}`}>{account.authError ? 'Needs reconnecting' : 'Connected'}</span>
      </div>

      {account.authError && (
        <div className="status-line bad">
          {account.authError}
          <button className="link" disabled={busy} onClick={() => void connect()}>{busy ? 'Waiting for Google…' : 'Reconnect'}</button>
        </div>
      )}
      {error && <div className="status-line bad" role="alert">{error}</div>}

      <div className="account-limit">
        <label className="field">
          <span>Daily send limit</span>
          <input type="number" min={0} value={cap} onChange={(e) => setCap(Math.max(0, Number(e.target.value)))} />
        </label>
        <button className="btn" disabled={cap === account.dailyCap}
          onClick={() => void invoke('accounts:save', { ...account, dailyCap: cap })}>Save limit</button>
      </div>
      <p className="hint">0 means no limit. Gmail itself caps new accounts, so raise volume gradually.</p>

      <div className="row account-actions">
        <button className="btn" onClick={() => void test()}><Check size={14} /> Test connection</button>
        {confirming ? (
          <>
            <span className="muted">Sign out? Your outbox and contacts stay.</span>
            <button className="btn danger-btn" onClick={() => void invoke('gmail:signOut', account.id)}>Yes, sign out</button>
            <button className="btn" onClick={() => setConfirming(false)}>Cancel</button>
          </>
        ) : (
          <button className="btn" onClick={() => setConfirming(true)}><LogOut size={14} /> Sign out</button>
        )}
      </div>
      {probe && <div className={`status-line ${probe.ok === true ? 'ok' : probe.ok === false ? 'bad' : ''}`} role="status">{probe.message}</div>}
    </section>
  )
}

function SignInCard({ signedOut }: { signedOut: Account | undefined }) {
  const { busy, error, connect, cancel } = useGmailConnect()
  return (
    <section className="panel signin-card">
      <h2 className="signin-title">{signedOut ? `Sign back in as ${signedOut.email}` : 'Connect your Gmail'}</h2>
      <p className="signin-lead">
        {signedOut
          ? 'You are signed out. Your outbox, contacts and templates are untouched.'
          : 'Email Machine sends from your own Gmail address, so replies land in your inbox as usual.'}
      </p>
      <div className="row">
        {busy ? (
          <>
            <span className="muted"><span className="spinner" aria-hidden="true" /> Waiting for approval in your browser…</span>
            <button className="btn" onClick={cancel}>Cancel</button>
          </>
        ) : (
          <button className="btn google-btn lg" onClick={() => void connect()}><GoogleMark /> Sign in with Google</button>
        )}
      </div>
      {error && <div className="status-line bad" role="alert">{error} <button className="link" onClick={() => void connect()}>Try again</button></div>}
      <ul className="trust">
        <li><ShieldCheck size={16} aria-hidden="true" /> Sends email as you and reads message headers only, to notice replies and stop follow-ups.</li>
        <li><Lock size={16} aria-hidden="true" /> No password is stored. The sign-in token stays on this computer, encrypted by your system keychain.</li>
      </ul>
      <p className="muted small">You can revoke access any time at myaccount.google.com/permissions.</p>
    </section>
  )
}

function OwnClient({ settings }: { settings: Settings }) {
  const [clientId, setClientId] = useState(settings.googleClientId)
  const [secret, setSecret] = useState('')
  const [saved, setSaved] = useState(false)
  const dirty = clientId.trim() !== settings.googleClientId || !!secret.trim()
  const save = async () => {
    await invoke('settings:set', { googleClientId: clientId.trim(), ...(secret.trim() ? { googleClientSecret: secret.trim() } : {}) })
    setSecret('')
    setSaved(true)
  }
  return (
    <details className="guide" open={!settings.googleReady}>
      <summary>Use your own Google client</summary>
      <p className="hint">This build has no built-in Google client. Create a Desktop-app OAuth client in Google Cloud Console, enable the Gmail API, and paste its details here.</p>
      <div className="grid2">
        <label className="field"><span>OAuth client ID</span>
          <input value={clientId} onChange={(e) => { setClientId(e.target.value); setSaved(false) }} placeholder="1234-abc.apps.googleusercontent.com" /></label>
        <label className="field"><span>Client secret {settings.googleClientSecretSet && '(saved)'}</span>
          <input type="password" value={secret} onChange={(e) => { setSecret(e.target.value); setSaved(false) }}
            placeholder={settings.googleClientSecretSet ? 'Enter a new secret to replace it' : 'GOCSPX-…'} /></label>
      </div>
      <div className="row">
        <button className="btn" disabled={!dirty || !clientId.trim()} onClick={() => void save()}>Save client</button>
        {saved && <span className="saved-note"><Check size={14} /> Saved</span>}
      </div>
    </details>
  )
}

export default function GmailConnect({ settings, accounts, onChanged }: { settings: Settings; accounts: Account[]; onChanged: () => void }) {
  const gmail = accounts.filter((a) => a.authType === 'gmail')
  const active = gmail.filter((a) => !a.signedOut)
  const legacy = accounts.filter((a) => a.authType === 'smtp')

  return (
    <>
      {active.map((a) => <ConnectedCard key={a.id} account={a} />)}
      {!active.length && settings.googleReady && <SignInCard signedOut={gmail[0]} />}
      {!settings.googleBuiltIn && <OwnClient settings={settings} />}

      {legacy.length > 0 && (
        <section className="panel">
          <div className="panel-title">Old SMTP accounts</div>
          <p className="hint">Email Machine now sends through Google sign-in. These older accounts can only be removed. Removing one also removes the emails sent from it.</p>
          {legacy.map((a) => (
            <div className="card-head legacy-row" key={a.id}>
              <span>{a.email} <span className="muted small">{a.host}</span></span>
              <button className="link danger" onClick={() => void invoke('accounts:delete', a.id).then(onChanged)}>Remove</button>
            </div>
          ))}
        </section>
      )}
    </>
  )
}
