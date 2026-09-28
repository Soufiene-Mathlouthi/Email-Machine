import { createHash, randomBytes } from 'crypto'

export const GMAIL_SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.metadata',
  'openid',
  'email'
]

export const base64url = (buf: Buffer): string =>
  buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

export const challengeFor = (verifier: string): string => base64url(createHash('sha256').update(verifier).digest())

export function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64url(randomBytes(48))
  return { verifier, challenge: challengeFor(verifier) }
}

export function buildAuthUrl(p: { clientId: string; redirectUri: string; challenge: string; state: string }): string {
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth')
  url.search = new URLSearchParams({
    client_id: p.clientId,
    redirect_uri: p.redirectUri,
    response_type: 'code',
    scope: GMAIL_SCOPES.join(' '),
    code_challenge: p.challenge,
    code_challenge_method: 'S256',
    state: p.state,
    access_type: 'offline',
    prompt: 'consent'
  }).toString()
  return url.toString()
}

const paramsOf = (url: string): URLSearchParams => new URL(url, 'http://127.0.0.1').searchParams

// Only our own redirect (matching state) may end the flow; anything else is ignored.
export function isCallbackRequest(url: string, expectedState: string): boolean {
  const q = paramsOf(url)
  return (q.has('code') || q.has('error')) && q.get('state') === expectedState
}

export function parseCallback(url: string, expectedState: string): { code: string } | { error: string } {
  const q = paramsOf(url)
  const error = q.get('error')
  if (error) return { error: error === 'access_denied' ? 'Google sign-in was declined.' : `Google sign-in failed: ${error}` }
  if (q.get('state') !== expectedState) return { error: 'Google sign-in failed: state mismatch.' }
  const code = q.get('code')
  return code ? { code } : { error: 'Google sign-in failed: no authorization code.' }
}
