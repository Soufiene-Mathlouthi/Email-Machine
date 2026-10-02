import type Database from 'better-sqlite3'
import { readFileSync } from 'fs'
import { extname } from 'path'
import Papa from 'papaparse'
import { readSheet as readXlsx } from 'read-excel-file/node'
import type { ColumnMapping, ContactField, ImportResult } from '@shared/types'

export interface Sheet { headers: string[]; rows: string[][] }

const SYNONYMS: Record<ContactField, string[]> = {
  email: ['email', 'e-mail', 'email address', 'e-mail address', 'mail'],
  name: ['name', 'full name', 'contact', 'contact name'],
  company: ['company', 'company name', 'organisation', 'organization', 'employer'],
  role: ['role', 'title', 'job title', 'position'],
  notes: ['notes', 'note', 'comments', 'comment']
}

const cell = (v: unknown): string => (v === null || v === undefined ? '' : v instanceof Date ? v.toISOString() : String(v).trim())

function toSheet(all: unknown[][]): Sheet {
  const matrix = all.map((r) => r.map(cell)).filter((r) => r.some((c) => c !== ''))
  const [headers = [], ...rows] = matrix
  return { headers, rows }
}

export async function readSheet(path: string): Promise<Sheet> {
  const ext = extname(path).toLowerCase()
  if (ext === '.csv') {
    const text = readFileSync(path, 'utf8').replace(/^﻿/, '')
    return toSheet(Papa.parse<string[]>(text, { skipEmptyLines: true }).data)
  }
  if (ext === '.xlsx') return toSheet((await readXlsx(path)) as unknown[][])
  throw new Error('Unsupported file type. Choose a .csv or .xlsx file.')
}

export function guessMapping(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {}
  const used = new Set<number>()
  for (const field of Object.keys(SYNONYMS) as ContactField[]) {
    const idx = headers.findIndex((h, i) => !used.has(i) && SYNONYMS[field].includes(h.trim().toLowerCase()))
    if (idx >= 0) {
      mapping[field] = idx
      used.add(idx)
    }
  }
  return mapping
}

export function importRows(db: Database.Database, rows: string[][], mapping: ColumnMapping): ImportResult {
  const result: ImportResult = { added: 0, duplicates: 0, invalid: 0 }
  const insert = db.prepare('INSERT OR IGNORE INTO contacts (name, email, company, role, notes) VALUES (?,?,?,?,?)')
  const get = (r: string[], f: ContactField): string => (mapping[f] === undefined ? '' : (r[mapping[f]!] ?? '').trim())
  db.transaction(() => {
    for (const r of rows) {
      const email = get(r, 'email').toLowerCase()
      if (!/^\S+@\S+\.\S+$/.test(email)) { result.invalid++; continue }
      const info = insert.run(get(r, 'name'), email, get(r, 'company'), get(r, 'role'), get(r, 'notes'))
      info.changes ? result.added++ : result.duplicates++
    }
  })()
  return result
}
