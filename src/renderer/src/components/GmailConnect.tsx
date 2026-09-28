import { useState } from 'react'
import type { Settings } from '@shared/types'
import { errorText, invoke } from '../lib/api'

export default function GmailConnect({ settings, onChanged }: { settings: Settings; onChanged: () => void }) {
  const [clientId, setClientId] = useState(settings.googleClientId)
  const [secret, setSecret] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null)
  const clientReady = !!settings.googleClientId && settings.googleClientSecretSet
  const credsDirty = clientId.trim() !== settings.googleClientId || !!secret.trim()

  const saveClient = async () => {
    await invoke('settings:set', { googleClientId: clientId.trim(), ...(secret.trim() ? { googleClientSecret: secret.trim() } : {}) })
    setSecret('')
    setMsg({ ok: true, text: 'Google client saved.' })
    onChanged()
  }

  const connect = async () => {
    setBusy(true)
    setMsg(null)
    try {
      await invoke('gmail:connect')
      setMsg({ ok: true, text: 'Gmail account connected.' })
      onChanged()
    } catch (e) {
      setMsg({ ok: false, text: errorText(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="panel">
      <div className="panel-title">Connect Gmail with Google sign-in</div>
      <p className="hint">Sends through the Gmail API (no app password) and lets the app detect replies to stop follow-ups.</p>
      <details className="guide" open={!clientReady}>
        <summary>One-time Google setup (about 5 minutes)</summary>
        <ol>
          <li>In Google Cloud Console (console.cloud.google.com), create a project and enable the <strong>Gmail API</strong>.</li>
          <li>Configure the <strong>OAuth consent screen</strong> as External and add your address as a test user. Then set the
            publishing status to <strong>In production</strong>. Tokens from apps left in "Testing" expire after 7 days.</li>
          <li>Create credentials: <strong>OAuth client ID</strong> of type <strong>Desktop app</strong>.</li>
          <li>Paste the client ID and secret below, save, then click Connect Gmail. Google will warn that the app isn't
            verified. That's expected for your own client: choose <em>Advanced → Continue</em>.</li>
        </ol>
      </details>
      <div className="grid2">
        <label className="field"><span>OAuth client ID</span>
          <input value={clientId} onChange={(e) => setClientId(e.target.value)} placeholder="1234-abc.apps.googleusercontent.com" /></label>
        <label className="field"><span>Client secret {settings.googleClientSecretSet && '(saved)'}</span>
          <input type="password" value={secret} onChange={(e) => setSecret(e.target.value)}
            placeholder={settings.googleClientSecretSet ? 'Enter a new secret to replace it' : 'GOCSPX-…'} /></label>
      </div>
      <div className="row">
        <button className="btn" disabled={!credsDirty || !clientId.trim()} onClick={() => void saveClient()}>Save client</button>
        {busy ? (
          <>
            <span className="muted">Waiting for approval in your browser…</span>
            <button className="btn" onClick={() => void invoke('gmail:cancel')}>Cancel</button>
          </>
        ) : (
          <button className="btn primary" disabled={!clientReady} onClick={() => void connect()}>Connect Gmail</button>
        )}
      </div>
      {msg && <div className={`status-line ${msg.ok ? 'ok' : 'bad'}`} role="status">{msg.text}</div>}
    </section>
  )
}
