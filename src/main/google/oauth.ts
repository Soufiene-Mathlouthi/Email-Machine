import { shell } from 'electron'
import { createServer, type Server } from 'http'
import { randomBytes } from 'crypto'
import type { AddressInfo } from 'net'
import { decryptSecret, encryptSecret, getDb, getSetting } from '../db'
import { getProfile, type GmailDeps } from './gmail'
import { base64url, buildAuthUrl, createPkcePair, isCallbackRequest, parseCallback } from './pkce'

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const TIMEOUT_MS = 5 * 60_000
export const REVOKED_MESSAGE = 'Google access expired or was revoked. Reconnect this account.'
const CANCELLED = 'Google sign-in was cancelled.'

interface TokenResponse {
  access_token: string
  expires_in: number
  refresh_token?: string
}

export const tokenErrorMessage = (code: string): string =>
  code === 'invalid_grant' ? REVOKED_MESSAGE : `Google token request failed: ${code}`

class TokenError extends Error {
  code: string
  constructor(code: string) {
    super(tokenErrorMessage(code))
    this.code = code
  }
}

function clientCreds(): { clientId: string; clientSecret: string } {
  const clientId = getSetting('googleClientId').trim()
  const clientSecret = decryptSecret(getSetting('googleClientSecretEnc'))
  if (!clientId || !clientSecret) throw new Error('Add your Google OAuth client first.')
  return { clientId, clientSecret }
}

async function tokenRequest(params: Record<string, string>): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params).toString()
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) throw new TokenError(String(body.error ?? res.status))
  return body as unknown as TokenResponse
}

const cache = new Map<number, { token: string; expiresAt: number }>()

export function forgetAccountToken(accountId: number): void {
  cache.delete(accountId)
}

export async function getAccessToken(accountId: number, forceRefresh = false): Promise<string> {
  const hit = cache.get(accountId)
  if (!forceRefresh && hit && hit.expiresAt - 60_000 > Date.now()) return hit.token
  const db = getDb()
  const row = db.prepare('SELECT oauth_refresh_enc FROM accounts WHERE id=?').get(accountId) as
    | { oauth_refresh_enc: string }
    | undefined
  const refresh = row ? decryptSecret(row.oauth_refresh_enc) : ''
  if (!refresh) throw new Error(REVOKED_MESSAGE)
  const { clientId, clientSecret } = clientCreds()
  try {
    const t = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refresh, client_id: clientId, client_secret: clientSecret })
    cache.set(accountId, { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 })
    return t.access_token
  } catch (e) {
    if (e instanceof TokenError && e.code === 'invalid_grant') {
      db.prepare('UPDATE accounts SET auth_error=? WHERE id=?').run(REVOKED_MESSAGE, accountId)
    }
    throw e
  }
}

export const gmailDeps = (accountId: number): GmailDeps => ({
  getToken: (force) => getAccessToken(accountId, force)
})

const escapeHtml = (s: string): string =>
  s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c] as string)

const resultPage = (message: string): string =>
  `<!doctype html><meta charset="utf-8"><title>Email Machine</title>` +
  `<body style="font-family:system-ui,sans-serif;display:grid;place-items:center;height:100vh;margin:0;color:#111827">` +
  `<p>${escapeHtml(message)}</p></body>`

let pending: (() => void) | null = null

export function cancelGmailConnect(): void {
  pending?.()
}

function waitForCode(clientId: string, challenge: string, state: string): Promise<{ code: string; redirectUri: string }> {
  return new Promise((resolve, reject) => {
    let done = false
    let redirectUri = ''
    const finish = (err: Error | null, code?: string): void => {
      if (done) return
      done = true
      clearTimeout(timer)
      pending = null
      server.close()
      if (err) reject(err)
      else resolve({ code: code as string, redirectUri })
    }
    const server: Server = createServer((req, res) => {
      const url = req.url ?? '/'
      if (!isCallbackRequest(url, state)) return void res.writeHead(404).end()
      const result = parseCallback(url, state)
      if ('code' in result) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
        res.end(resultPage('Gmail connected. You can close this tab and return to Email Machine.'))
        finish(null, result.code)
      } else {
        res.writeHead(400, { 'content-type': 'text/html; charset=utf-8' })
        res.end(resultPage(result.error))
        finish(new Error(result.error))
      }
    })
    server.on('error', (e) => finish(e))
    server.listen(0, '127.0.0.1', () => {
      redirectUri = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
      void shell.openExternal(buildAuthUrl({ clientId, redirectUri, challenge, state }))
    })
    const timer = setTimeout(() => finish(new Error(CANCELLED)), TIMEOUT_MS)
    pending = () => finish(new Error(CANCELLED))
  })
}

export async function connectGmail(): Promise<number> {
  const { clientId, clientSecret } = clientCreds()
  cancelGmailConnect()
  const { verifier, challenge } = createPkcePair()
  const state = base64url(randomBytes(16))
  const { code, redirectUri } = await waitForCode(clientId, challenge, state)

  const t = await tokenRequest({
    grant_type: 'authorization_code', code, client_id: clientId, client_secret: clientSecret,
    code_verifier: verifier, redirect_uri: redirectUri
  })
  if (!t.refresh_token) {
    throw new Error('Google did not return a refresh token. Remove Email Machine from your Google account permissions and connect again.')
  }
  const { emailAddress } = await getProfile({ getToken: async () => t.access_token })

  const db = getDb()
  const existing = db.prepare("SELECT id FROM accounts WHERE auth_type='gmail' AND lower(email)=lower(?)").get(emailAddress) as
    | { id: number }
    | undefined
  let id: number
  if (existing) {
    db.prepare("UPDATE accounts SET oauth_refresh_enc=?, auth_error='' WHERE id=?").run(encryptSecret(t.refresh_token), existing.id)
    id = existing.id
  } else {
    id = Number(
      db.prepare(
        `INSERT INTO accounts (label, email, host, port, secure, username, password_enc, daily_cap, auth_type, oauth_refresh_enc)
         VALUES (?, ?, 'gmail-api', 0, 1, ?, '', 40, 'gmail', ?)`
      ).run(emailAddress, emailAddress, emailAddress, encryptSecret(t.refresh_token)).lastInsertRowid
    )
  }
  cache.set(id, { token: t.access_token, expiresAt: Date.now() + t.expires_in * 1000 })
  return id
}
