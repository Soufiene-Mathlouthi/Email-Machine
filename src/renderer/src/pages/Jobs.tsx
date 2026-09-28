import { useState } from 'react'
import type { Account, Job, JobInput } from '@shared/types'
import { invoke, useData, fmtDate } from '../lib/api'

const empty: JobInput = { title: '', company: '', url: '', description: '', contactEmail: '' }

export default function Jobs() {
  const [jobs, reload] = useData<Job[]>('jobs:list', [], ['jobs:changed'])
  const [accounts] = useData<Account[]>('accounts:list', [])
  const [form, setForm] = useState<JobInput>(empty)
  const [draftFor, setDraftFor] = useState<number | null>(null)
  const [toEmail, setToEmail] = useState('')
  const [toName, setToName] = useState('')
  const [accountId, setAccountId] = useState(0)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')

  const save = async () => {
    if (!form.title.trim() && !form.description.trim()) return
    await invoke('jobs:save', form)
    setForm(empty)
    reload()
  }

  const draft = async (job: Job) => {
    const acc = accountId || accounts[0]?.id
    if (!acc) return setMsg('Add an email account in Settings first.')
    setBusy(true)
    setMsg('')
    try {
      await invoke('emails:draftForJob', { jobId: job.id, accountId: acc, toEmail: toEmail || job.contactEmail, recipientName: toName })
      setMsg('Draft created. Review and edit it in the Outbox before sending.')
      setDraftFor(null)
    } catch (e) {
      setMsg(e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <header className="page-head"><h1>Jobs</h1></header>
      <p className="hint">Paste a job here now. Later the browser extension will drop jobs into this list automatically.</p>
      {msg && <p className="notice">{msg}</p>}

      <section className="panel">
        <div className="grid3">
          <label className="field"><span>Job title</span>
            <input value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></label>
          <label className="field"><span>Company</span>
            <input value={form.company} onChange={(e) => setForm({ ...form, company: e.target.value })} /></label>
          <label className="field"><span>Recruiter email (if listed)</span>
            <input value={form.contactEmail} onChange={(e) => setForm({ ...form, contactEmail: e.target.value })} /></label>
        </div>
        <label className="field"><span>Job description</span>
          <textarea rows={7} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} /></label>
        <div className="row">
          <button className="btn primary" onClick={() => void save()}>{form.id ? 'Save job' : 'Add job'}</button>
          {form.id && <button className="btn" onClick={() => setForm(empty)}>Cancel</button>}
        </div>
      </section>

      {jobs.length === 0 && <p className="empty">No jobs saved yet.</p>}
      {jobs.map((j) => (
        <div className="card" key={j.id}>
          <div className="card-head">
            <strong>{j.title || 'Untitled job'}{j.company && ` at ${j.company}`}</strong>
            <span className="actions">
              <button className="link" onClick={() => { setDraftFor(draftFor === j.id ? null : j.id); setToEmail(j.contactEmail); setToName('') }}>
                Draft email with AI
              </button>
              <button className="link" onClick={() => setForm(j)}>Edit</button>
              <button className="link danger" onClick={() => void invoke('jobs:delete', j.id).then(reload)}>Delete</button>
            </span>
          </div>
          <div className="muted">{fmtDate(j.createdAt)}{j.url && ` · ${j.url}`}</div>
          {draftFor === j.id && (
            <div className="inline-form">
              <label className="field"><span>Send to</span>
                <input value={toEmail} onChange={(e) => setToEmail(e.target.value)} placeholder="recruiter@company.com" /></label>
              <label className="field"><span>Recipient name (optional)</span>
                <input value={toName} onChange={(e) => setToName(e.target.value)} /></label>
              <label className="field"><span>Send from</span>
                <select value={accountId || accounts[0]?.id || 0} onChange={(e) => setAccountId(Number(e.target.value))}>
                  {accounts.map((a) => <option key={a.id} value={a.id}>{a.label || a.email}</option>)}
                </select></label>
              <button className="btn primary" disabled={busy} onClick={() => void draft(j)}>
                {busy ? 'Writing draft…' : 'Write draft'}
              </button>
            </div>
          )}
        </div>
      ))}
    </>
  )
}
