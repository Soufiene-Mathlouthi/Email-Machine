import type Database from 'better-sqlite3'

const V1 = `
CREATE TABLE IF NOT EXISTS accounts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  label TEXT NOT NULL,
  email TEXT NOT NULL,
  host TEXT NOT NULL,
  port INTEGER NOT NULL DEFAULT 465,
  secure INTEGER NOT NULL DEFAULT 1,
  username TEXT NOT NULL,
  password_enc TEXT NOT NULL DEFAULT '',
  daily_cap INTEGER NOT NULL DEFAULT 40
);
CREATE TABLE IF NOT EXISTS contacts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL DEFAULT '',
  email TEXT NOT NULL UNIQUE,
  company TEXT NOT NULL DEFAULT '',
  role TEXT NOT NULL DEFAULT '',
  notes TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT ''
);
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL DEFAULT '',
  company TEXT NOT NULL DEFAULT '',
  url TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  contact_email TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS emails (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id INTEGER NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  contact_id INTEGER REFERENCES contacts(id) ON DELETE SET NULL,
  job_id INTEGER REFERENCES jobs(id) ON DELETE SET NULL,
  to_email TEXT NOT NULL,
  subject TEXT NOT NULL DEFAULT '',
  body TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft',
  error TEXT NOT NULL DEFAULT '',
  sent_at INTEGER,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
`

const V2 = `
ALTER TABLE accounts ADD COLUMN auth_type TEXT NOT NULL DEFAULT 'smtp';
ALTER TABLE accounts ADD COLUMN oauth_refresh_enc TEXT NOT NULL DEFAULT '';
ALTER TABLE accounts ADD COLUMN auth_error TEXT NOT NULL DEFAULT '';
ALTER TABLE emails ADD COLUMN message_id TEXT NOT NULL DEFAULT '';
ALTER TABLE emails ADD COLUMN thread_id TEXT NOT NULL DEFAULT '';
ALTER TABLE emails ADD COLUMN parent_id INTEGER REFERENCES emails(id) ON DELETE CASCADE;
ALTER TABLE emails ADD COLUMN step INTEGER NOT NULL DEFAULT 0;
ALTER TABLE emails ADD COLUMN replied_at INTEGER;
ALTER TABLE emails ADD COLUMN followups_stopped INTEGER NOT NULL DEFAULT 0;
ALTER TABLE emails ADD COLUMN stop_reason TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_emails_parent ON emails(parent_id);
`

const V3 = `
CREATE TABLE IF NOT EXISTS template_attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  template_id INTEGER NOT NULL REFERENCES templates(id) ON DELETE CASCADE,
  filename TEXT NOT NULL,
  path TEXT NOT NULL,
  size INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_template_attachments_template ON template_attachments(template_id);
ALTER TABLE emails ADD COLUMN attachments TEXT NOT NULL DEFAULT '[]';
`

// Append-only: never edit a shipped migration, add a new one.
export const MIGRATIONS = [V1, V2, V3]

export function runMigrations(db: Database.Database): number {
  const current = db.pragma('user_version', { simple: true }) as number
  for (let v = current; v < MIGRATIONS.length; v++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[v])
      db.pragma(`user_version = ${v + 1}`)
    })()
  }
  return db.pragma('user_version', { simple: true }) as number
}
