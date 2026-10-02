import { useEffect, useMemo, useState } from 'react'
import type { Account, Contact, EmailPreview, EmailStatus, OutboxEmail, SetStatusResult, Template } from '@shared/types'
import { invoke, useData, fmtDate } from '../lib/api'
import SearchInput from '../components/SearchInput'

type Filter = 'all' | EmailStatus | 'replied'
const STATUSES: Filter[] = ['all', 'draft', 'queued', 'sending', 'sent', 'failed', 'replied']

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
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<Filter>('all')

  const counts = useMemo(() => {
    const c: Record<string, number> = { all: emails.length, replied: 0 }
    for (const e of emails) {
      c[e.status] = (c[e.status] ?? 0) + 1
      if (e.repliedAt !== null) c.replied++
    }
    return c
  }, [emails])

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    return emails.filter((e) => {
      if (statusFilter === 'replied' ? e.repliedAt === null : statusFilter !== 'all' && e.status !== statusFilter) return false
      if (!q) return true
      return e.toEmail.toLowerCase().includes(q) || e.subject.toLowerCase().includes(q)
    })
  }, [emails, query, statusFilter])

  useEffect(() => {
    if (!editing) return
    const onKey = (ev: KeyboardEvent) => ev.key === 'Escape' && setEditing(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [editing])

  const canEdit = (e: OutboxEmail) => e.status !== 'sent' && e.status !== 'sending'
  const selectable = (e: OutboxEmail) => e.status !== 'sending'
  const visibleEditable = filtered.filter(selectable).map((e) => e.id)
  const byId = useMemo(() => new Map(emails.map((e) => [e.id, e])), [emails])
  const selectedRows = selected.map((id) => byId.get(id)).filter((e): e is OutboxEmail => !!e)
  const hasSent = selectedRows.some((e) => e.status === 'sent')
  const canStop = selectedRows.length > 0 && selectedRows.every((e) => e.status === 'sent' || e.parentId !== null)

  // Bulk actions must only ever touch rows the user can currently see.
  useEffect(() => {
    const allowed = new Set(filtered.filter(selectable).map((e) => e.id))
    setSelected((s) => (s.every((id) => allowed.has(id)) ? s : s.filter((id) => allowed.has(id))))
  }, [filtered])
  const allVisibleSelected = visibleEditable.length > 0 && visibleEditable.every((id) => selected.includes(id))

  const toggle = (id: number) => setSelected((s) => (s.includes(id) ? s.filter((x) => x !== id) : [...s, id]))
  const toggleAllVisible = () =>
    setSelected((s) => (allVisibleSelected ? s.filter((id) => !visibleEditable.includes(id)) : [...new Set([...s, ...visibleEditable])]))

  const createBatch = async () => {
    const templateId = batch.templateId || templates[0]?.id
    const accountId = batch.accountId || accounts[0]?.id
    if (!templateId || !accountId || batch.contactIds.length === 0) return
    await invoke('emails:createFromTemplate', { templateId, accountId, contactIds: batch.contactIds })
    setBatch({ ...batch, contactIds: [] })
    setBatchOpen(false)
  }

  const [queueMsg, setQueueMsg] = useState('')
  const setStatus = async (status: 'draft' | 'queued', ids = selected, override = false) => {
    const r = await invoke<SetStatusResult>('emails:setStatus', { ids, status, override })
    setSelected([])
    setQueueMsg(
      status === 'queued'
        ? `Queued ${r.changed.length}${r.held.length ? `, held ${r.held.length} ${r.held.length === 1 ? 'duplicate' : 'duplicates'} (open one to send anyway).` : '.'}`
        : ''
    )
  }

  const [editError, setEditError] = useState('')
  const liveEditing = editing ? emails.find((e) => e.id === editing.id) : undefined
  const editLocked = !!editing && (!liveEditing || !canEdit(liveEditing))

  const [preview, setPreview] = useState<EmailPreview | null>(null)
  useEffect(() => {
    setPreview(null)
    if (!editing) return
    let live = true
    void invoke<EmailPreview | null>('emails:preview', editing.id).then((p) => live && setPreview(p))
    return () => { live = false }
  }, [editing?.id, emails])

  // The duplicate warning describes the saved address, so it only applies while the To field is unchanged.
  const toChanged = !!editing && !!liveEditing && editing.toEmail.trim().toLowerCase() !== liveEditing.toEmail.trim().toLowerCase()
  const dupAt = toChanged ? null : (preview?.duplicateOf ?? null)

  const editable = filtered.filter(canEdit)
  const pos = editing ? editable.findIndex((e) => e.id === editing.id) : -1

  const openEditor = (e: OutboxEmail) => {
    setEditError('')
    setEditing(e)
  }

  const saveEdit = async (): Promise<boolean> => {
    if (!editing) return false
    const ok = await invoke<boolean>('emails:update', {
      id: editing.id, toEmail: editing.toEmail, subject: editing.subject, body: editing.body
    })
    if (ok) setEditing(null)
    else setEditError('Changes not saved: this email was sent or removed while you were reviewing it.')
    return ok
  }

  const step = (d: number) => {
    const n = editable[pos + d]
    if (n) openEditor(n)
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Outbox</h1>
          <p className="subtitle">Review drafts, queue them, and let the machine send them one by one.</p>
        </div>
        <div className="row tight">
          <SearchInput value={query} onChange={setQuery} placeholder="Search to or subject…" />
          <button className="btn primary" onClick={() => setBatchOpen(!batchOpen)}>
            {batchOpen ? 'Close' : 'New batch'}
          </button>
        </div>
      </header>

      {batchOpen && (
        <section className="panel">
          <div className="panel-title">New batch from template</div>
          {accounts.length === 0 || templates.length === 0 || contacts.length === 0 ? (
            <p className="empty compact">
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
                Create {batch.contactIds.length} {batch.contactIds.length === 1 ? 'draft' : 'drafts'}
              </button>
            </>
          )}
        </section>
      )}

      <div className="chip-row" role="group" aria-label="Filter by status">
        {STATUSES.map((s) => (
          <button
            key={s}
            aria-pressed={statusFilter === s}
            className={`chip ${statusFilter === s ? 'active' : ''}`}
            onClick={() => setStatusFilter(s)}
          >
            {s === 'all' ? 'All' : s[0].toUpperCase() + s.slice(1)}
            <span className="chip-count">{counts[s] ?? 0}</span>
          </button>
        ))}
      </div>

      <div className={`toolbar ${selected.length ? 'has-selection' : ''}`}>
        <span className="muted">{selected.length ? `${selected.length} selected` : 'Select emails to act on them'}</span>
        <div className="row tight">
          <button className="btn" disabled={!selected.length || hasSent} onClick={() => void setStatus('queued')}>Add to send queue</button>
          <button className="btn" disabled={!selected.length || hasSent} onClick={() => void setStatus('draft')}>Back to drafts</button>
          <button className="btn" disabled={!canStop} title="They replied: stop following up"
            onClick={() => void invoke('emails:markReplied', selected).then(() => setSelected([]))}>Mark replied</button>
          <button className="btn" disabled={!canStop}
            onClick={() => void invoke('emails:stopFollowups', selected).then(() => setSelected([]))}>Stop follow-ups</button>
          <button className="btn danger-btn" disabled={!selected.length || hasSent}
            onClick={() => void invoke('emails:delete', selected).then(() => setSelected([]))}>Delete</button>
        </div>
      </div>

      {queueMsg && <p className="notice">{queueMsg}</p>}

      {emails.length === 0 ? (
        <p className="empty">Nothing here yet. Create a batch from a template, or create a draft from a job.</p>
      ) : filtered.length === 0 ? (
        <p className="empty">No emails match the current search and filter.</p>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th className="col-check">
                <input type="checkbox" aria-label="Select all visible" checked={allVisibleSelected}
                  disabled={visibleEditable.length === 0} onChange={toggleAllVisible} />
              </th>
              <th>To</th><th>Subject</th><th>Status</th><th>Sent</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((e) => (
              <tr key={e.id} className={`${canEdit(e) ? 'clickable' : ''} ${selected.includes(e.id) ? 'selected' : ''}`} onClick={() => canEdit(e) && openEditor(e)}>
                <td className="col-check" onClick={(ev) => ev.stopPropagation()}>
                  <input type="checkbox" checked={selected.includes(e.id)} disabled={!selectable(e)} onChange={() => toggle(e.id)} />
                </td>
                <td>{e.toEmail}</td>
                <td className="ellipsis subject-cell">
                  {e.attachmentCount > 0 && <span className="tag" title={`${e.attachmentCount} attached file(s)`}>📎 {e.attachmentCount}</span>}
                  {e.duplicateOf !== null && <span className="tag bad" title={`Already emailed on ${fmtDate(e.duplicateOf)}`}>Duplicate</span>}
                  {e.step > 0 && <span className="tag accent">Follow-up {e.step}</span>}
                  {e.repliedAt !== null && <span className="tag ok">Replied</span>}
                  {e.stopReason === 'bounced' && <span className="tag bad">Bounced</span>}
                  {e.stopReason === 'manual' && <span className="tag">Follow-ups off</span>}
                  {e.subject || <span className="muted">(no subject)</span>}
                </td>
                <td><span className={`badge st-${e.status}`} title={e.error}>{e.status}</span></td>
                <td className="muted">
                  {fmtDate(e.sentAt)}
                  {e.status === 'failed' && <span className="error-text" title={e.error}>{e.error}</span>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {editing && (
        <div className="drawer-backdrop" onClick={() => setEditing(null)}>
          <div className="drawer" role="dialog" aria-label="Review email" onClick={(ev) => ev.stopPropagation()}>
            <div className="drawer-head">
              <h2>Review email</h2>
              <span className={`badge st-${liveEditing?.status ?? editing.status}`}>{liveEditing?.status ?? 'removed'}</span>
            </div>
            {(editError || editLocked) && (
              <div className="status-line bad drawer-alert" role="alert">
                {editError || 'This email was sent or removed while you were reviewing it, so it can no longer be edited.'}
              </div>
            )}
            {preview && (
              <div className="preview-meta">
                <div><span className="muted">From</span> {preview.from}</div>
                {preview.attachments.length > 0 && (
                  <ul className="attach-list">
                    {preview.attachments.map((a, i) => (
                      <li className={`attach-item ${a.missing ? 'bad' : ''}`} key={i}>
                        📎 {a.filename}
                        <span className="muted"> {a.missing ? 'file missing from storage, re-add it to the template' : `${Math.max(1, Math.round(a.size / 1024))} KB`}</span>
                      </li>
                    ))}
                  </ul>
                )}
                {dupAt !== null && (
                  <div className="status-line bad" role="alert">
                    You already emailed this address on {fmtDate(dupAt)}.{' '}
                    <button className="link" disabled={editLocked}
                      onClick={() => void saveEdit().then(async (ok) => { if (ok) await setStatus('queued', [editing.id], true) })}>Send anyway</button>
                  </div>
                )}
              </div>
            )}
            <label className="field"><span>To</span>
              <input value={editing.toEmail} onChange={(e) => setEditing({ ...editing, toEmail: e.target.value })} /></label>
            <label className="field"><span>Subject</span>
              <input value={editing.subject} onChange={(e) => setEditing({ ...editing, subject: e.target.value })} /></label>
            <label className="field"><span>Body</span>
              <textarea rows={16} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} /></label>
            <div className="row">
              <button className="btn primary" disabled={editLocked} onClick={() => void saveEdit()}>Save changes</button>
              <button className="btn" disabled={editLocked || dupAt !== null}
                onClick={() => void saveEdit().then(async (ok) => { if (ok) await setStatus('queued', [editing.id]) })}>Add to queue</button>
              <button className="btn" onClick={() => setEditing(null)}>Close</button>
              <span className="row tight" style={{ marginLeft: 'auto' }}>
                <button className="btn" aria-label="Previous email" disabled={pos <= 0} onClick={() => step(-1)}>‹</button>
                <button className="btn" aria-label="Next email" disabled={pos < 0 || pos >= editable.length - 1} onClick={() => step(1)}>›</button>
              </span>
            </div>
          </div>
        </div>
      )}
    </>
  )
}
