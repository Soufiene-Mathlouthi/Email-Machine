import { useMemo, useState } from 'react'
import type { Contact, ContactInput } from '@shared/types'
import { invoke, useData } from '../lib/api'
import SearchInput from '../components/SearchInput'

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

  const importCsv = async () => {
    const r = await invoke<{ added: number; skipped: number }>('contacts:importCsv')
    setMsg(`Imported ${r.added} contacts, skipped ${r.skipped} (duplicates or invalid emails).`)
    reload()
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
          <button className="btn" onClick={() => void importCsv()}>Import CSV</button>
        </div>
      </header>
      {msg && <p className="notice">{msg}</p>}

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
          <span className="muted small">CSV import columns: name, email, company, role, notes. Only email is required.</span>
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
                  <button className="link danger" onClick={() => void invoke('contacts:delete', c.id).then(reload)}>Delete</button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </>
  )
}
