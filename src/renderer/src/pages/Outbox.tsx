import { useState } from 'react'
import type { Account, Contact, OutboxEmail, Template } from '@shared/types'
import { invoke, useData, fmtDate } from '../lib/api'

export default function Outbox() {
  const [emails] = useData<OutboxEmail[]>('emails:list', [], ['emails:changed'])
  const [accounts] = useData<Account[]>('accounts:list', [])
  const [templates] = useData<Template[]>('templates:list', [])
  const [contacts] = useData<Contact[]>('contacts:list', [])

  const [selected, setSelected] = useState<number[]>([])
  const [editing, setEditing] = useState<OutboxEmail | null>(null)
  const [batchOpen, setBatchOpen] = useState(false)
  const [batch, setBatch] = useState<{ templateId: number; accountId: number; contactIds: number[] }>({
    templateId: 0, accountId: 0, contactIds: []
  })

  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))

  const createBatch = async () => {
    const templateId = batch.templateId || templates[0]?.id
    const accountId = batch.accountId || accounts[0]?.id
    if (!templateId || !accountId || batch.contactIds.length === 0) return
    await invoke('emails:createFromTemplate', { templateId, accountId, contactIds: batch.contactIds })
    setBatch({ ...batch, contactIds: [] })
    setBatchOpen(false)
  }

  const setStatus = async (status: 'draft' | 'queued') => {
    await invoke('emails:setStatus', { ids: selected, status })
    setSelected([])
  }

  const saveEdit = async () => {
    if (!editing) return
    await invoke('emails:update', { id: editing.id, toEmail: editing.toEmail, subject: editing.subject, body: editing.body })
    setEditing(null)
  }

  const canEdit = (e: OutboxEmail) => e.status !== 'sent' && e.status !== 'sending'

  return (
    <>
      <header className="page-head">
        <h1>Outbox</h1>
        <button className="btn primary" onClick={() => setBatchOpen(!batchOpen)}>New batch from template</button>
      </header>

      {batchOpen && (
        <section className="panel">
          {accounts.length === 0 || templates.length === 0 || contacts.length === 0 ? (
            <p className="empty">
              A batch needs at least one email account (Settings), one template and one contact.
            </p>
          ) : (
            <>
              <div className="grid2">
                <label className="field"><span>Template</span>
                  <select value={batch.templateId || templates[0].id} onChange={(e) => setBatch({ ...batch, templateId: Number(e.target.value) })}>
                    {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select></label>
                <label className="field"><span>Send from</span>
                  <select value={batch.accountId || accounts[0].id} onChange={(e) => setBatch({ ...batch, accountId: Number(e.target.value) })}>
                    {accounts.map((a) => <option key={a.id} value={a.id}>{a.label || a.email}</option>)}
                  </select></label>
              </div>
              <div className="picker">
                <label className="check strong">
                  <input type="checkbox"
                    checked={batch.contactIds.length === contacts.length}
                    onChange={(e) => setBatch({ ...batch, contactIds: e.target.checked ? contacts.map((c) => c.id) : [] })} />
                  Select all ({contacts.length})
                </label>
                {contacts.map((c) => (
                  <label className="check" key={c.id}>
                    <input type="checkbox" checked={batch.contactIds.includes(c.id)}
                      onChange={() => setBatch({
                        ...batch,
                        contactIds: batch.contactIds.includes(c.id) ? batch.contactIds.filter((x) => x !== c.id) : [...batch.contactIds, c.id]
                      })} />
                    {c.name || c.email} <span className="muted">{c.company}</span>
                  </label>
                ))}
              </div>
              <button className="btn primary" disabled={batch.contactIds.length === 0} onClick={() => void createBatch()}>
                Create {batch.contactIds.length} drafts
              </button>
            </>
          )}
        </section>
      )}

      <div className="toolbar">
        <span className="muted">{selected.length} selected</span>
        <button className="btn" disabled={!selected.length} onClick={() => void setStatus('queued')}>Add to send queue</button>
        <button className="btn" disabled={!selected.length} onClick={() => void setStatus('draft')}>Back to drafts</button>
        <button className="btn danger-btn" disabled={!selected.length}
          onClick={() => void invoke('emails:delete', selected).then(() => setSelected([]))}>Delete</button>
      </div>

      {emails.length === 0 ? (
        <p className="empty">Nothing here yet. Create a batch from a template, or draft one from a job.</p>
      ) : (
        <table className="table">
          <thead><tr><th /><th>To</th><th>Subject</th><th>Status</th><th>Sent</th></tr></thead>
          <tbody>
            {emails.map((e) => (
              <tr key={e.id} className="clickable" onClick={() => canEdit(e) && setEditing(e)}>
                <td onClick={(ev) => ev.stopPropagation()}>
                  <input type="checkbox" checked={selected.includes(e.id)} disabled={!canEdit(e)} onChange={() => toggle(e.id)} />
                </td>
                <td>{e.toEmail}</td>
                <td className="ellipsis">{e.subject}</td>
                <td><span className={`badge st-${e.status}`} title={e.error}>{e.status}</span></td>
                <td className="muted">{fmtDate(e.sentAt)}{e.status === 'failed' && ` ${e.error}`}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <div className="drawer-backdrop" onClick={() => setEditing(null)}>
          <div className="drawer" onClick={(ev) => ev.stopPropagation()}>
            <h2>Review email</h2>
            <label className="field"><span>To</span>
              <input value={editing.toEmail} onChange={(e) => setEditing({ ...editing, toEmail: e.target.value })} /></label>
            <label className="field"><span>Subject</span>
              <input value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} /></label>
            <label className="field"><span>Body</span>
              <textarea rows={14} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} /></label>
            <div className="row">
              <button className="btn primary" onClick={() => void saveEdit()}>Save changes</button>
              <button className="btn" onClick={() => setEditing(null)}>Close</button>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
