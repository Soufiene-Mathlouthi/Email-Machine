import { useState } from 'react'
import { Copy, Check } from 'lucide-react'
import type { Account, Settings as SettingsT, SettingsInput } from '@shared/types'
import { invoke, useData } from '../lib/api'
import GmailConnect from '../components/GmailConnect'
import FollowUpSettings from '../components/FollowUpSettings'

export default function Settings() {
  const [accounts, reloadAccounts] = useData<Account[]>('accounts:list', [], ['accounts:changed'])
  const [settings, reloadSettings] = useData<SettingsT | null>('settings:get', null)
  const [draft, setDraft] = useState<SettingsInput>({})
  const [saved, setSaved] = useState(false)
  const [copied, setCopied] = useState(false)

  const reloadAll = () => {
    reloadAccounts()
    reloadSettings()
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

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Settings</h1>
          <p className="subtitle">Your Gmail connection and how fast emails go out.</p>
        </div>
      </header>

      <div className="section-head">
        <h2>Gmail account</h2>
      </div>
      <GmailConnect settings={settings} accounts={accounts} onChanged={reloadAll} />

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
        <label className="field"><span>Duplicate window (days, 0 = off)</span>
          <input type="number" min={0} value={v.duplicateWindowDays} onChange={(e) => setDraft({ ...draft, duplicateWindowDays: Number(e.target.value) })} /></label>
        <p className="hint">Emails to an address you already emailed within this many days are held in the Outbox until you confirm.</p>
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
