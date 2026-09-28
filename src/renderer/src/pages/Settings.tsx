import { useState } from 'react'
import type { Account, AccountInput, Settings as SettingsT, SettingsInput } from '@shared/types'
import { invoke, useData } from '../lib/api'

const PRESETS: Record<string, Pick<AccountInput, 'host' | 'port' | 'secure'>> = {
  Gmail: { host: 'smtp.gmail.com', port: 465, secure: true },
  Outlook: { host: 'smtp-mail.outlook.com', port: 587, secure: false },
  Custom: { host: '', port: 465, secure: true }
}

const blankAccount: AccountInput = {
  label: '', email: '', username: '', password: '', dailyCap: 40, ...PRESETS.Gmail
}

export default function Settings() {
  const [accounts, reloadAccounts] = useData<Account[]>('accounts:list', [])
  const [settings, reloadSettings] = useData<SettingsT | null>('settings:get', null)
  const [form, setForm] = useState<AccountInput>(blankAccount)
  const [status, setStatus] = useState<Record<number, string>>({})
  const [key, setKey] = useState('')
  const [draft, setDraft] = useState<SettingsInput>({})

  const saveAccount = async () => {
    if (!form.email) return
    await invoke('accounts:save', { ...form, username: form.username || form.email })
    setForm(blankAccount)
    reloadAccounts()
  }

  const test = async (id: number) => {
    setStatus((s) => ({ ...s, [id]: 'Testing…' }))
    const r = await invoke<{ ok: boolean; message: string }>('accounts:test', id)
    setStatus((s) => ({ ...s, [id]: r.message }))
  }

  const saveSettings = async () => {
    await invoke('settings:set', { ...draft, ...(key ? { anthropicKey: key } : {}) })
    setDraft({})
    setKey('')
    reloadSettings()
  }

  if (!settings) return null
  const v = { ...settings, ...draft }

  return (
    <>
      <header className="page-head"><h1>Settings</h1></header>

      <h2>Email accounts</h2>
      <p className="hint">
        For Gmail, turn on 2-step verification and create an app password. Use that instead of your normal password.
        Passwords are stored encrypted with your operating system keychain.
      </p>
      {accounts.map((a) => (
        <div className="card" key={a.id}>
          <div className="card-head">
            <strong>{a.label || a.email}</strong>
            <span className="actions">
              <button className="link" onClick={() => void test(a.id)}>Test connection</button>
              <button className="link" onClick={() => setForm({ ...a, password: '' })}>Edit</button>
              <button className="link danger" onClick={() => void invoke('accounts:delete', a.id).then(reloadAccounts)}>Delete</button>
            </span>
          </div>
          <div className="muted">{a.email} · {a.host}:{a.port} · max {a.dailyCap}/day</div>
          {status[a.id] && <div className="notice">{status[a.id]}</div>}
        </div>
      ))}

      <section className="panel">
        {!form.id && (
          <div className="row">
            {Object.keys(PRESETS).map((p) => (
              <button key={p} className="btn" onClick={() => setForm({ ...form, ...PRESETS[p] })}>{p}</button>
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
        <div className="row">
          <button className="btn primary" onClick={() => void saveAccount()}>{form.id ? 'Save account' : 'Add account'}</button>
          {form.id && <button className="btn" onClick={() => setForm(blankAccount)}>Cancel</button>}
        </div>
      </section>

      <h2>Sending</h2>
      <section className="panel">
        <div className="grid3">
          <label className="field"><span>Minimum delay between emails (seconds)</span>
            <input type="number" value={v.minDelaySec} onChange={(e) => setDraft({ ...draft, minDelaySec: Number(e.target.value) })} /></label>
          <label className="field"><span>Maximum delay (seconds)</span>
            <input type="number" value={v.maxDelaySec} onChange={(e) => setDraft({ ...draft, maxDelaySec: Number(e.target.value) })} /></label>
          <label className="field"><span>CV attachment</span>
            <div className="row tight">
              <input readOnly value={v.cvPath} placeholder="No file attached" />
              <button className="btn" onClick={() => void invoke<string>('dialog:pickCv').then((p) => p && setDraft({ ...draft, cvPath: p }))}>Choose</button>
              {v.cvPath && <button className="btn" onClick={() => setDraft({ ...draft, cvPath: '' })}>Remove</button>}
            </div></label>
        </div>
      </section>

      <h2>AI drafting</h2>
      <section className="panel">
        <div className="grid2">
          <label className="field"><span>Anthropic API key {settings.anthropicKeySet && '(saved)'}</span>
            <input type="password" value={key} placeholder={settings.anthropicKeySet ? 'Enter a new key to replace it' : 'sk-ant-…'} onChange={(e) => setKey(e.target.value)} /></label>
          <label className="field"><span>Model</span>
            <input value={v.aiModel} onChange={(e) => setDraft({ ...draft, aiModel: e.target.value })} /></label>
        </div>
        <label className="field"><span>About you (skills, experience, projects the AI may mention)</span>
          <textarea rows={7} value={v.profile} onChange={(e) => setDraft({ ...draft, profile: e.target.value })} /></label>
      </section>

      <div className="row">
        <button className="btn primary" onClick={() => void saveSettings()}>Save settings</button>
      </div>

      <h2>Browser extension</h2>
      <p className="hint">
        The extension will send jobs to http://127.0.0.1:{settings.serverPort}/jobs with this token:
      </p>
      <code className="token">{settings.apiToken}</code>
    </>
  )
}
