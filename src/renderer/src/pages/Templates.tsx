import { useMemo, useRef, useState } from 'react'
import { Paperclip, X } from 'lucide-react'
import type { PickedFile, Template, TemplateAttachment, TemplateInput } from '@shared/types'
import { renderTemplate } from '@shared/template'
import { invoke, useData } from '../lib/api'
import SearchInput from '../components/SearchInput'

const empty: TemplateInput = { name: '', subject: '', body: '' }
const MAX_BYTES = 15 * 1024 * 1024
const fmtSize = (n: number): string => (n >= 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`)

const SAMPLE_VARS = { name: 'Jane Doe', firstName: 'Jane', company: 'Acme Inc', role: 'Product Designer', email: 'jane@acme.com' }
const VARIABLES = Object.keys(SAMPLE_VARS)

export default function Templates() {
  const [templates, reload] = useData<Template[]>('templates:list', [])
  const [form, setForm] = useState<TemplateInput>(empty)
  const [query, setQuery] = useState('')
  const [existing, setExisting] = useState<TemplateAttachment[]>([])
  const [added, setAdded] = useState<PickedFile[]>([])
  const [removed, setRemoved] = useState<number[]>([])
  const [error, setError] = useState('')
  const bodyRef = useRef<HTMLTextAreaElement>(null)

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return templates
    return templates.filter((t) => t.name.toLowerCase().includes(q) || t.subject.toLowerCase().includes(q))
  }, [templates, query])

  const previewSubject = renderTemplate(form.subject, SAMPLE_VARS)
  const previewBody = renderTemplate(form.body, SAMPLE_VARS)

  const insertVariable = (v: string) => {
    const el = bodyRef.current
    const token = `{{${v}}}`
    const start = el?.selectionStart ?? form.body.length
    const end = el?.selectionEnd ?? form.body.length
    setForm({ ...form, body: form.body.slice(0, start) + token + form.body.slice(end) })
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + token.length, start + token.length)
    })
  }

  const keptExisting = existing.filter((a) => !removed.includes(a.id))
  const totalBytes = [...keptExisting, ...added].reduce((n, a) => n + a.size, 0)

  const reset = () => {
    setForm(empty)
    setExisting([])
    setAdded([])
    setRemoved([])
    setError('')
  }

  const edit = (t: Template) => {
    setForm(t)
    setExisting(t.attachments)
    setAdded([])
    setRemoved([])
    setError('')
  }

  const pickFiles = async () => {
    const picked = await invoke<PickedFile[]>('dialog:pickFiles')
    const fresh = picked.filter((p) => !added.some((a) => a.path === p.path))
    const next = [...added, ...fresh]
    const total = [...keptExisting, ...next].reduce((n, a) => n + a.size, 0)
    if (total > MAX_BYTES) {
      setError(`Attachments would be ${fmtSize(total)}; the limit per template is ${fmtSize(MAX_BYTES)}.`)
      return
    }
    setError('')
    setAdded(next)
  }

  const save = async () => {
    if (!form.name.trim()) return
    try {
      await invoke('templates:save', { ...form, attachments: undefined, addFiles: added.map((a) => a.path), removeAttachmentIds: removed })
      reset()
      reload()
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e))
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Templates</h1>
          <p className="subtitle">Reusable emails, personalized per contact with variables.</p>
        </div>
        <SearchInput value={query} onChange={setQuery} placeholder="Search templates…" />
      </header>

      <div className="editor-grid">
        <section className="panel">
          <div className="panel-title">{form.id ? 'Edit template' : 'New template'}</div>
          <label className="field"><span>Template name</span>
            <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="e.g. Intro to hiring manager" />
          </label>
          <label className="field"><span>Subject</span>
            <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          </label>
          <label className="field"><span>Body</span>
            <textarea ref={bodyRef} rows={10} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
          </label>
          <div className="var-row">
            <span className="muted small">Insert:</span>
            {VARIABLES.map((v) => (
              <button key={v} type="button" className="var-chip" onClick={() => insertVariable(v)}>{`{{${v}}}`}</button>
            ))}
          </div>
          <div className="field">
            <span>Attachments <span className="muted small">· sent with every email from this template</span></span>
            {(keptExisting.length > 0 || added.length > 0) && (
              <div className="attach-list">
                {keptExisting.map((a) => (
                  <div className="attach-item" key={a.id}>
                    <Paperclip size={14} /><span className="name">{a.filename}</span><span className="muted small">{fmtSize(a.size)}</span>
                    <button type="button" className="link danger" aria-label={`Remove ${a.filename}`} onClick={() => setRemoved([...removed, a.id])}><X size={14} /></button>
                  </div>
                ))}
                {added.map((a) => (
                  <div className="attach-item new" key={a.path}>
                    <Paperclip size={14} /><span className="name">{a.filename}</span><span className="muted small">{fmtSize(a.size)} · added on save</span>
                    <button type="button" className="link danger" aria-label={`Remove ${a.filename}`} onClick={() => setAdded(added.filter((x) => x.path !== a.path))}><X size={14} /></button>
                  </div>
                ))}
              </div>
            )}
            <div className="row tight">
              <button type="button" className="btn" onClick={() => void pickFiles()}><Paperclip size={14} /> Add files</button>
              <span className="muted small">{fmtSize(totalBytes)} of {fmtSize(MAX_BYTES)}</span>
            </div>
            {error && <p className="error-text">{error}</p>}
          </div>
          <div className="row">
            <button className="btn primary" disabled={!form.name.trim()} onClick={() => void save()}>
              {form.id ? 'Save template' : 'Add template'}
            </button>
            {form.id && <button className="btn" onClick={reset}>Cancel</button>}
          </div>
        </section>

        <section className="panel preview-pane" aria-live="polite">
          <div className="preview-label">Live preview <span className="muted">· sample contact Jane Doe, Acme Inc</span></div>
          <div className="preview-mail">
            <div className="preview-meta"><span className="muted">To</span> jane@acme.com</div>
            <div className="preview-subject">{previewSubject || <span className="muted">Subject will appear here</span>}</div>
            <div className="preview-body">{previewBody || <span className="muted">Body will appear here</span>}</div>
          </div>
        </section>
      </div>

      <h2>Saved templates <span className="muted count">{templates.length}</span></h2>
      {templates.length === 0 ? (
        <p className="empty">No templates yet. Write one above and reuse it for every batch.</p>
      ) : filtered.length === 0 ? (
        <p className="empty">No templates match "{query}".</p>
      ) : (
        <div className="card-list">
          {filtered.map((t) => (
            <div className={`card ${form.id === t.id ? 'selected' : ''}`} key={t.id}>
              <div className="card-head">
                <strong>{t.name}</strong>
                <span className="actions">
                  <button className="link" onClick={() => edit(t)}>Edit</button>
                  <button className="link danger" onClick={() => void invoke('templates:delete', t.id).then(() => { if (form.id === t.id) reset(); reload() })}>Delete</button>
                </span>
              </div>
              <div className="muted ellipsis-line">{t.subject || '(no subject)'}{t.attachments.length > 0 && ` · 📎 ${t.attachments.map((a) => a.filename).join(', ')}`}</div>
            </div>
          ))}
        </div>
      )}
    </>
  )
}
