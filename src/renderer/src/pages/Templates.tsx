import { useState } from 'react'
import type { Template, TemplateInput } from '@shared/types'
import { invoke, useData } from '../lib/api'

const empty: TemplateInput = { name: '', subject: '', body: '' }

export default function Templates() {
  const [templates, reload] = useData<Template[]>('templates:list', [])
  const [form, setForm] = useState<TemplateInput>(empty)

  const save = async () => {
    if (!form.name.trim()) return
    await invoke('templates:save', form)
    setForm(empty)
    reload()
  }

  return (
    <>
      <header className="page-head"><h1>Templates</h1></header>
      <p className="hint">
        Variables: {'{{name}}'} {'{{firstName}}'} {'{{company}}'} {'{{role}}'} {'{{email}}'}
      </p>

      <section className="panel">
        <label className="field"><span>Template name</span>
          <input value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </label>
        <label className="field"><span>Subject</span>
          <input value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
        </label>
        <label className="field"><span>Body</span>
          <textarea rows={9} value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })} />
        </label>
        <div className="row">
          <button className="btn primary" onClick={() => void save()}>{form.id ? 'Save template' : 'Add template'}</button>
          {form.id && <button className="btn" onClick={() => setForm(empty)}>Cancel</button>}
        </div>
      </section>

      {templates.length === 0 && <p className="empty">No templates yet. Write one above and reuse it for every batch.</p>}
      {templates.map((t) => (
        <div className="card" key={t.id}>
          <div className="card-head">
            <strong>{t.name}</strong>
            <span className="actions">
              <button className="link" onClick={() => setForm(t)}>Edit</button>
              <button className="link danger" onClick={() => void invoke('templates:delete', t.id).then(reload)}>Delete</button>
            </span>
          </div>
          <div className="muted">{t.subject}</div>
        </div>
      ))}
    </>
  )
}
