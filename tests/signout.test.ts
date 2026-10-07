import { describe, expect, it } from 'vitest'
import { displayNameFor, signOutAccount } from '../src/main/google/account'
import { memoryDb } from './helpers'

function seed() {
  const db = memoryDb()
  db.prepare(
    "INSERT INTO accounts (id, label, email, host, username, auth_type, oauth_refresh_enc, auth_error) VALUES (1, 'Sam', 'sam@x.com', 'gmail-api', 'sam@x.com', 'gmail', 'enc:abc', 'old error')"
  ).run()
  db.prepare("INSERT INTO emails (account_id, to_email, status, created_at) VALUES (1, 'a@b.com', 'sent', 1)").run()
  return db
}

describe('signOutAccount', () => {
  it('returns the stored token so the caller can revoke it, and clears it', () => {
    const db = seed()
    expect(signOutAccount(db, 1)).toBe('enc:abc')
    const row = db.prepare('SELECT oauth_refresh_enc, auth_error, email, label FROM accounts WHERE id = 1').get()
    expect(row).toEqual({ oauth_refresh_enc: '', auth_error: '', email: 'sam@x.com', label: 'Sam' })
  })

  it('keeps the account and its email history', () => {
    const db = seed()
    signOutAccount(db, 1)
    expect(db.prepare('SELECT COUNT(*) AS n FROM emails').get()).toEqual({ n: 1 })
  })

  it('is harmless for an unknown or already signed-out account', () => {
    const db = seed()
    expect(signOutAccount(db, 99)).toBe('')
    signOutAccount(db, 1)
    expect(signOutAccount(db, 1)).toBe('')
  })

  it('does not touch SMTP accounts', () => {
    const db = memoryDb()
    db.prepare("INSERT INTO accounts (id, label, email, host, username, password_enc) VALUES (2, 'S', 's@x.com', 'h', 's', 'enc:pw')").run()
    expect(signOutAccount(db, 2)).toBe('')
    expect(db.prepare('SELECT password_enc FROM accounts WHERE id = 2').get()).toEqual({ password_enc: 'enc:pw' })
  })
})

describe('displayNameFor', () => {
  it('uses the Google name when present', () => {
    expect(displayNameFor({ name: ' Sam Lee ' }, 'sam@x.com')).toBe('Sam Lee')
  })
  it('falls back to the email address', () => {
    expect(displayNameFor({}, 'sam@x.com')).toBe('sam@x.com')
    expect(displayNameFor({ name: '  ' }, 'sam@x.com')).toBe('sam@x.com')
    expect(displayNameFor(null, 'sam@x.com')).toBe('sam@x.com')
  })
})
