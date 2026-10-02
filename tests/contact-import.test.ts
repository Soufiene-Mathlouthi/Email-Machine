import { mkdtempSync, rmSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { guessMapping, importRows, readSheet } from '../src/main/contact-import'
import { memoryDb } from './helpers'
import { writeXlsx } from './xlsx-fixture'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'em-imp-')) })
afterEach(() => rmSync(dir, { recursive: true, force: true }))

describe('guessMapping', () => {
  it('matches plain and synonym headers case-insensitively', () => {
    expect(guessMapping(['Full Name', 'E-mail', 'Company Name', 'Job Title', 'Notes'])).toEqual({
      name: 0, email: 1, company: 2, role: 3, notes: 4
    })
  })
  it('leaves unknown columns unmapped and does not map one column twice', () => {
    expect(guessMapping(['foo', 'Email', 'Email address'])).toEqual({ email: 1 })
  })
})

describe('readSheet', () => {
  it('reads csv with a BOM, quoted commas and blank lines', async () => {
    const p = join(dir, 'c.csv')
    writeFileSync(p, '﻿Name,Email,Company\n"Doe, Jane",jane@x.com,Acme\n\n')
    expect(await readSheet(p)).toEqual({ headers: ['Name', 'Email', 'Company'], rows: [['Doe, Jane', 'jane@x.com', 'Acme']] })
  })

  it('reads xlsx, turning numbers into strings and empty cells into blanks', async () => {
    const p = join(dir, 'c.xlsx')
    writeXlsx(p, [['Name', 'Email', 'Notes'], ['Bob', 'bob@x.com', 42], ['Eve', 'eve@x.com', null]])
    const s = await readSheet(p)
    expect(s.headers).toEqual(['Name', 'Email', 'Notes'])
    expect(s.rows).toEqual([['Bob', 'bob@x.com', '42'], ['Eve', 'eve@x.com', '']])
  })

  it('returns no rows for a header-only file', async () => {
    const p = join(dir, 'h.csv')
    writeFileSync(p, 'Name,Email\n')
    expect(await readSheet(p)).toEqual({ headers: ['Name', 'Email'], rows: [] })
  })

  it('rejects unsupported extensions', async () => {
    await expect(readSheet(join(dir, 'x.xls'))).rejects.toThrow(/\.csv or \.xlsx/)
  })
})

describe('importRows', () => {
  const rows = [
    ['Jane', 'jane@x.com', 'Acme'],
    ['Jane again', ' JANE@x.com ', 'Acme'],
    ['No mail', 'not-an-email', ''],
    ['', '', ''],
    ['Bob', 'bob@x.com', 'Beta']
  ]

  it('splits added, duplicates and invalid, and trims addresses', () => {
    const db = memoryDb()
    expect(importRows(db, rows, { name: 0, email: 1, company: 2 })).toEqual({ added: 2, duplicates: 1, invalid: 2 })
    expect(db.prepare('SELECT name, email, company FROM contacts ORDER BY id').all()).toEqual([
      { name: 'Jane', email: 'jane@x.com', company: 'Acme' },
      { name: 'Bob', email: 'bob@x.com', company: 'Beta' }
    ])
  })

  it('treats existing contacts as duplicates and imports nothing without an email column', () => {
    const db = memoryDb()
    db.prepare("INSERT INTO contacts (name, email) VALUES ('Old', 'jane@x.com')").run()
    expect(importRows(db, rows, { name: 0, email: 1 })).toEqual({ added: 1, duplicates: 2, invalid: 2 })
    expect(importRows(db, rows, { name: 0 })).toEqual({ added: 0, duplicates: 0, invalid: 5 })
  })
})
