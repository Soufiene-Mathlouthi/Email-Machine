import type Database from 'better-sqlite3'

// Signing out clears the Google token but keeps the account row, so email history survives and the
// same address can reconnect later. Returns the stored (still encrypted) token so the caller can revoke it.
export function signOutAccount(db: Database.Database, id: number): string {
  const row = db.prepare("SELECT oauth_refresh_enc FROM accounts WHERE id = ? AND auth_type = 'gmail'").get(id) as
    | { oauth_refresh_enc: string }
    | undefined
  if (!row) return ''
  db.prepare("UPDATE accounts SET oauth_refresh_enc = '', auth_error = '' WHERE id = ?").run(id)
  return row.oauth_refresh_enc
}

export function displayNameFor(info: { name?: string } | null, email: string): string {
  return info?.name?.trim() || email
}
