import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import type { Account, AccountInput, Settings as SettingsT, SettingsInput } from '@shared/types'
import { errorText, invoke, useData } from '../lib/api'
import GmailConnect from '../components/GmailConnect'
import FollowUpSettings from '../components/FollowUpSettings'

const PRESETS: Record<string, Pick<AccountInput, 'host' | 'port' | 'secure'>> = {
  Gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
  Outlook: { host: 'smtp-mail.outlook.com', port: 587, secure: false },
  Custom: { host: '', port: 465, secure: true }
}

const blankAccount: AccountInput = {
  label: '', email: '', username: '', password: '', dailyCap: 40, ...PRESETS.Gmail
}

function presetFor(f: AccountInput): string {
  return Object.keys(PRESETS).find((k) => k !== 'Custom' && PRESETS[k].host === f.host) ?? 'Custom'
}

export default function Settings() {
  const [accounts, reloadAccounts] = useData<Account[]>('accounts:list', [])
  const [settings, reloadSettings] = useData<SettingsT | null>('settings:get', null)
  const [form, setForm] = useState<AccountInput>(blankAccount)
  const [status, setStatus] = useState<Record<number, { ok: boolean | null; message: string }>>({})
  const [draft, setDraft] = useState<SettingsInput>({})
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  const saveAccount = async () => {
    if (!form.email) return
    await invoke('accounts:save', { ...form, username: form.username || form.email })
    setForm(blankAccount)
    reloadAccounts()
  }

  const test = async (id: number) => {
    setStatus((s) => ({ ...s, [id]: { ok: null, message: 'Testing connection…' } }))
    const r = await invoke<{ ok: boolean; message: string }>('accounts:test', id)
    setStatus((s) => ({ ...s, [id]: r }))
  }

  const reloadAll = () => {
    reloadAccounts()
    reloadSettings()
  }

  const reconnect = async (id: number) => {
    setStatus((s) => ({ ...s, [id]: { ok: null, message: 'Waiting for approval in your browser…' } }))
    try {
      await invoke('gmail:connect')
      setStatus((s) => ({ ...s, [id]: { ok: true, message: 'Reconnected.' } }))
      reloadAccounts()
    } catch (e) {
      setStatus((s) => ({ ...s, [id]: { ok: false, message: errorText(e) } }))
    }
  }

  const saveSettings = async () => {
    await invoke('settings:set', draft)
    setDraft({})
    reloadSettings()
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const copyToken = async (token: string) => {
    try {
      await navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // token text stays selectable for manual copy
    }
  }

  if (!settings) return null
  const v = { ...settings, ...draft }
  const dirty = Object.keys(draft).length > 0
  const activePreset = presetFor(form)
  const editingGmail = accounts.find((a) => a.id === form.id)?.authType === 'gmail'

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="subtitle">Sending accounts and pacing.</p>
        </div>
      </header>

      <div className="section-head">
        <h2>Gmail</h2>
      </div>
      <GmailConnect settings={settings} onChanged={reloadAll} />

      <div className="section-head">
        <h2>Email accounts</h2>
      </div>
      <p className="hint">
        SMTP accounts work too: for Gmail over SMTP, turn on 2-step verification and create an app password.
        Passwords and Google tokens are stored encrypted with your operating system keychain.
      </p>
      {accounts.length === 0 && <p className="empty compact">No accounts yet. Add one below to start sending.</p>}
      {accounts.map((a) => (
        <div className={`card ${form.id === a.id ? 'selected' : ''}`} key={a.id}>
          <div className="card-head">
            <div>
              <strong>{a.label || a.email}</strong>
              <span className={`tag ${a.authType === 'gmail' ? 'accent' : ''}`}>{a.authType === 'gmail' ? 'Gmail' : 'SMTP'}</span>
              <div className="muted small">
                {a.email} · {a.authType === 'gmail' ? 'Gmail API' : `${a.host}:${a.port}`} · max {a.dailyCap}/day
              </div>
            </div>
            <span className="actions">
              <button className="link" onClick={() => void test(a.id)}>Test connection</button>
              <button className="link" onClick={() => setForm({ ...a, password: '' })}>Edit</button>
              <button className="link danger" onClick={() => void invoke('accounts:delete', a.id).then(() => { if (form.id === a.id) setForm(blankAccount); reloadAccounts() })}>Delete</button>
            </span>
          </div>
          {a.authError && !status[a.id] && (
            <div className="status-line bad">
              {a.authError} <button className="link" onClick={() => void reconnect(a.id)}>Reconnect</button>
            </div>
          )}
          {status[a.id] && (
            <div className={`status-line ${status[a.id].ok === true ? 'ok' : status[a.id].ok === false ? 'bad' : ''}`}>
              {status[a.id].message}
            </div>
          )}
        </div>
      ))}

      <section className="panel">
        <div className="panel-title">{editingGmail ? 'Edit Gmail account' : form.id ? 'Edit account' : 'Add an SMTP account'}</div>
        {editingGmail ? (
          <div className="grid2">
            <label className="field"><span>Label</span>
              <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Your name" /></label>
            <label className="field"><span>Daily send limit</span>
              <input type="number" value={form.dailyCap} onChange={(e) => setForm({ ...form, dailyCap: Number(e.target.value) })} /></label>
          </div>
        ) : (<>
        {!form.id && (
          <div className="segmented" role="radiogroup" aria-label="Provider">
            {Object.keys(PRESETS).map((p) => (
              <button key={p} role="radio" aria-checked={activePreset === p}
                className={activePreset === p ? 'active' : ''} onClick={() => setForm({ ...form, ...PRESETS[p] })}>
                {p}
              </button>
            ))}
          </div>
        )}
        <div className="grid3">
          <label className="field"><span>Label</span>
            <input value={form.label} onChange={(e) => setForm({ ...form, label: e.target.value })} placeholder="Your name" /></label>
          <label className="field"><span>Email address</span>
            <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} /></label>
          <label className="field"><span>{form.id ? 'New password (leave blank to keep)' : 'App password'}</span>
            <input type="password" value={form.password ?? ''} onChange={(e) => setForm({ ...form, password: e.target.value })} /></label>
          <label className="field"><span>SMTP host</span>
            <input value={form.host} onChange={(e) => setForm({ ...form, host: e.target.value })} /></label>
          <label className="field"><span>Port</span>
            <input type="number" value={form.port} onChange={(e) => setForm({ ...form, port: Number(e.target.value) })} /></label>
          <label className="field"><span>Daily send limit</span>
            <input type="number" value={form.dailyCap} onChange={(e) => setForm({ ...form, dailyCap: Number(e.target.value) })} /></label>
        </div>
        <label className="check">
          <input type="checkbox" checked={form.secure} onChange={(e) => setForm({ ...form, secure: e.target.checked })} />
          Use SSL (port 465). Leave off for STARTTLS on port 587.
        </label>
        </>)}
        <div className="row">
          <button className="btn primary" disabled={!form.email} onClick={() => void saveAccount()}>
            {form.id ? 'Save account' : 'Add account'}
          </button>
          {form.id && <button className="btn" onClick={() => setForm(blankAccount)}>Cancel</button>}
        </div>
      </section>

      <div className="section-head">
        <h2>Sending</h2>
      </div>
      <section className="panel">
        <div className="grid2">
          <label className="field"><span>Minimum delay between emails (seconds)</span>
            <input type="number" min={0} value={v.minDelaySec} onChange={(e) => setDraft({ ...draft, minDelaySec: Number(e.target.value) })} /></label>
          <label className="field"><span>Maximum delay (seconds)</span>
            <input type="number" min={0} value={v.maxDelaySec} onChange={(e) => setDraft({ ...draft, maxDelaySec: Number(e.target.value) })} /></label>
        </div>
        <div className="row">
          <button className="btn primary" disabled={!dirty} onClick={() => void saveSettings()}>Save settings</button>
          {saved && <span className="saved-note"><Check size={14} /> Saved</span>}
        </div>
      </section>

      <div className="section-head">
        <h2>Follow-ups</h2>
      </div>
      <FollowUpSettings config={settings.followUps} onSaved={reloadSettings} />

      <div className="section-head">
        <h2>Browser extension</h2>
      </div>
      <p className="hint">
        The extension will send jobs to http://127.0.0.1:{settings.serverPort}/jobs with this token:
      </p>
      <div className="token-row">
        <code className="token">{settings.apiToken}</code>
        <button className="btn" onClick={() => void copyToken(settings.apiToken)}>
          {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
        </button>
      </div>
    </>
  )
}
