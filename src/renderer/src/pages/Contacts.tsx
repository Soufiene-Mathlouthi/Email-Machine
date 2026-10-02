import { useMemo, useState } from 'react'
import type { ColumnMapping, Contact, ContactField, ContactInput, ImportPreview, ImportResult } from '@shared/types'
import { errorText, invoke, useData } from '../lib/api'
import SearchInput from '../components/SearchInput'

const FIELDS: { key: ContactField; label: string }[] = [
  { key: 'email', label: 'Email (required)' }, { key: 'name', label: 'Name' }, { key: 'company', label: 'Company' },
  { key: 'role', label: 'Role' }, { key: 'notes', label: 'Notes' }
]

const empty: ContactInput = { name: '', email: '', company: '', role: '', notes: '' }

export default function Contacts() {
  const [contacts, reload] = useData<Contact[]>('contacts:list', [])
  const [form, setForm] = useState<ContactInput>(empty)
  const [msg, setMsg] = useState('')
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return contacts
    return contacts.filter(
      (c) => c.name.toLowerCase().includes(q) || c.email.toLowerCase().includes(q) || c.company.toLowerCase().includes(q)
    )
  }, [contacts, query])

  const save = async () => {
    if (!/^\S+@\S+\.\S+$/.test(form.email)) return setMsg('Enter a valid email address.')
    await invoke('contacts:save', form)
    setForm(empty)
    setMsg('')
    reload()
  }

  const [imp, setImp] = useState<ImportPreview | null>(null)
  const [mapping, setMapping] = useState<ColumnMapping>({})

  const startImport = async () => {
    try {
      const p = await invoke<ImportPreview | null>('contacts:importPreview')
      if (!p) return
      setImp(p)
      setMapping(p.mapping)
    } catch (e) {
      setMsg(errorText(e))
    }
  }

  const commitImport = async () => {
    if (!imp) return
    try {
      const r = await invoke<ImportResult>('contacts:importCommit', { path: imp.path, mapping })
      setMsg(`Imported ${r.added}, skipped ${r.duplicates} duplicates, ${r.invalid} invalid emails.`)
      setImp(null)
      reload()
    } catch (e) {
      setMsg(errorText(e))
    }
  }

  return (
    <>
      <header className="page-head">
        <div>
          <h1>Contacts</h1>
          <p className="subtitle">{contacts.length} {contacts.length === 1 ? 'person' : 'people'} in your list</p>
        </div>
        <div className="row tight">
          <SearchInput value={query} onChange={setQuery} placeholder="Search contacts…" />
          <button className="btn" onClick={() => void startImport()}>Import CSV / Excel</button>
        </div>
      </header>
      {msg && <p className="notice">{msg}</p>}

      {imp && (
        <section className="panel">
          <div className="panel-title">Match columns ({imp.total} rows found)</div>
          <div className="grid3">
            {FIELDS.map((f) => (
              <label className="field" key={f.key}>
                <span>{f.label}</span>
                <select value={mapping[f.key] ?? ''} onChange={(e) => {
                  const next = { ...mapping }
                  if (e.target.value === '') delete next[f.key]
                  else next[f.key] = Number(e.target.value)
                  setMapping(next)
                }}>
                  <option value="">— none —</option>
                  {imp.headers.map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </div>
          <table className="table">
            <thead><tr>{imp.headers.map((h, i) => <th key={i}>{h}</th>)}</tr></thead>
            <tbody>{imp.sample.map((r, ri) => <tr key={ri}>{imp.headers.map((_, ci) => <td key={ci}>{r[ci]}</td>)}</tr>)}</tbody>
          </table>
          <div className="row">
            <button className="btn primary" disabled={mapping.email === undefined || imp.total === 0} onClick={() => void commitImport()}>
              Import {imp.total} rows
            </button>
            <button className="btn" onClick={() => setImp(null)}>Cancel</button>
          </div>
        </section>
      )}

      <section className="panel">
        <div className="panel-title">{form.id ? 'Edit contact' : 'Add a contact'}</div>
        <div className="grid4">
          {(['name', 'email', 'company', 'role'] as const).map((k) => (
            <label className="field" key={k}>
              <span>{k[0].toUpperCase() + k.slice(1)}</span>
              <input value={form[k]} onChange={(e) => setForm({ ...form, [k]: e.target.value })} />
            </label>
          ))}
        </div>
        <div className="row">
          <button className="btn primary" onClick={() => void save()}>{form.id ? 'Save contact' : 'Add contact'}</button>
          {form.id && <button className="btn" onClick={() => setForm(empty)}>Cancel</button>}
          <span className="muted small">Import a .csv or .xlsx file, then match its columns. Only email is required.</span>
        </div>
      </section>

      {contacts.length === 0 ? (
        <p className="empty">No contacts yet. Add one above or import a CSV to get started.</p>
      ) : filtered.length === 0 ? (
        <p className="empty">No contacts match "{query}".</p>
      ) : (
        <table className="table">
          <thead><tr><th>Name</th><th>Email</th><th>Company</th><th>Role</th><th /></tr></thead>
          <tbody>
            {filtered.map((c) => (
              <tr key={c.id}>
                <td className="strong">{c.name || <span className="muted">—</span>}</td>
                <td>{c.email}</td><td>{c.company}</td><td>{c.role}</td>
                <td className="actions">
                  <button className="link" onClick={() => setForm(c)}>Edit</button>
                  <button className="link danger" onClick={() => void invoke('contacts:delete', c.id).then(() => { if (form.id === c.id) setForm(empty); reload() })}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
