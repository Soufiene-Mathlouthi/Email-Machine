import Database from 'better-sqlite3'
import { app, safeStorage } from 'electron'
import { randomBytes } from 'crypto'
import { join } from 'path'
import { runMigrations } from './migrations'

let db: Database.Database | null = null

export function getDb(): Database.Database {
  if (db) return db
  db = new Database(join(app.getPath('userData'), 'email-machine.db'))
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  runMigrations(db)
  // A crash mid-send must not leave emails stuck in "sending"
  db.prepare("UPDATE emails SET status = 'queued' WHERE status = 'sending'").run()
  return db
}

export function getSetting(key: string, fallback = ''): string {
  const row = getDb().prepare('SELECT value FROM settings WHERE key = ?').get(key) as
    | { value: string }
    | undefined
  return row ? row.value : fallback
}

export function setSetting(key: string, value: string): void {
  getDb()
    .prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value')
    .run(key, value)
}

export function getApiToken(): string {
  let token = getSetting('apiToken')
  if (!token) {
    token = randomBytes(24).toString('hex')
    setSetting('apiToken', token)
  }
  return token
}

// ---- secrets (SMTP passwords) ----
// Encrypted with the OS keychain when available (Keychain / DPAPI / libsecret).
export function encryptSecret(plain: string): string {
  if (!plain) return ''
  if (safeStorage.isEncryptionAvailable()) {
    return 'enc:' + safeStorage.encryptString(plain).toString('base64')
  }
  return 'plain:' + Buffer.from(plain, 'utf8').toString('base64')
}

export function decryptSecret(stored: string): string {
  if (!stored) return ''
  if (stored.startsWith('enc:')) {
    return safeStorage.decryptString(Buffer.from(stored.slice(4), 'base64'))
  }
  if (stored.startsWith('plain:')) {
    return Buffer.from(stored.slice(6), 'base64').toString('utf8')
  }
  return ''
}
