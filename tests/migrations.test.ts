import Database from 'better-sqlite3'
import { describe, expect, it } from 'vitest'
import { MIGRATIONS, runMigrations } from '../src/main/migrations'
import { memoryDb } from './helpers'

const columns = (db: Database.Database, table: string) =>
  (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name)

describe('runMigrations', () => {
  it('builds a fresh database at the latest version', () => {
    const db = memoryDb()
    expect(db.pragma('user_version', { simple: true })).toBe(MIGRATIONS.length)
    expect(columns(db, 'accounts')).toEqual(expect.arrayContaining(['auth_type', 'oauth_refresh_enc', 'auth_error']))
    expect(columns(db, 'emails')).toEqual(
      expect.arrayContaining(['message_id', 'thread_id', 'parent_id', 'step', 'replied_at', 'followups_stopped', 'stop_reason'])
    )
  })

  it('upgrades an existing version-0 database without losing rows', () => {
    const db = new Database(':memory:')
    db.exec(MIGRATIONS[0])
    db.pragma('user_version = 0')
    db.prepare("INSERT INTO accounts (label, email, host, username) VALUES ('Me', 'me@x.com', 'smtp.x.com', 'me@x.com')").run()
    db.prepare("INSERT INTO emails (account_id, to_email, subject, status, created_at) VALUES (1, 'a@b.com', 'Hi', 'sent', 1)").run()

    expect(runMigrations(db)).toBe(MIGRATIONS.length)
    expect(db.prepare('SELECT auth_type FROM accounts').get()).toEqual({ auth_type: 'smtp' })
    expect(db.prepare('SELECT subject, step, followups_stopped, parent_id FROM emails').get()).toEqual({
      subject: 'Hi', step: 0, followups_stopped: 0, parent_id: null
    })
  })

  it('is idempotent', () => {
    const db = memoryDb()
    expect(runMigrations(db)).toBe(MIGRATIONS.length)
  })

  it('cascades follow-up deletion from the original', () => {
    const db = memoryDb()
    db.prepare("INSERT INTO accounts (label, email, host, username) VALUES ('Me', 'me@x.com', 'h', 'me@x.com')").run()
    db.prepare("INSERT INTO emails (id, account_id, to_email, status, created_at) VALUES (1, 1, 'a@b.com', 'sent', 1)").run()
    db.prepare("INSERT INTO emails (account_id, to_email, status, created_at, parent_id, step) VALUES (1, 'a@b.com', 'draft', 2, 1, 1)").run()
    db.prepare('DELETE FROM emails WHERE id = 1').run()
    expect(db.prepare('SELECT COUNT(*) AS n FROM emails').get()).toEqual({ n: 0 })
  })
})
