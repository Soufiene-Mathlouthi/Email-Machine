import { describe, expect, it } from 'vitest'
import { GMAIL_SCOPES, buildAuthUrl, challengeFor, createPkcePair, isCallbackRequest, parseCallback } from '../src/main/google/pkce'

describe('PKCE', () => {
  it('matches the RFC 7636 test vector', () => {
    expect(challengeFor('dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk')).toBe('E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM')
  })
  it('creates a 64-char url-safe verifier and its challenge', () => {
    const { verifier, challenge } = createPkcePair()
    expect(verifier).toMatch(/^[A-Za-z0-9_-]{64}$/)
    expect(challenge).toBe(challengeFor(verifier))
  })
})

describe('buildAuthUrl', () => {
  it('requests offline access with PKCE and the minimal scopes', () => {
    const u = new URL(buildAuthUrl({ clientId: 'cid', redirectUri: 'http://127.0.0.1:5555', challenge: 'ch', state: 'st' }))
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    const q = Object.fromEntries(u.searchParams)
    expect(q).toMatchObject({
      client_id: 'cid', redirect_uri: 'http://127.0.0.1:5555', response_type: 'code', code_challenge: 'ch',
      code_challenge_method: 'S256', state: 'st', access_type: 'offline', prompt: 'consent'
    })
    expect(q.scope.split(' ')).toEqual(GMAIL_SCOPES)
  })
})

describe('parseCallback', () => {
  it('returns the code when state matches', () => {
    expect(parseCallback('/?state=st&code=abc', 'st')).toEqual({ code: 'abc' })
  })
  it('rejects a state mismatch', () => {
    expect(parseCallback('/?state=evil&code=abc', 'st')).toEqual({ error: 'Google sign-in failed: state mismatch.' })
  })
  it('maps access_denied to a friendly message', () => {
    expect(parseCallback('/?error=access_denied&state=st', 'st')).toEqual({ error: 'Google sign-in was declined.' })
  })
  it('only treats requests carrying our state plus code or error as the callback', () => {
    expect(isCallbackRequest('/favicon.ico', 'st')).toBe(false)
    expect(isCallbackRequest('/?code=abc&state=st', 'st')).toBe(true)
    expect(isCallbackRequest('/?error=access_denied&state=st', 'st')).toBe(true)
  })
  it('ignores forged or stray requests so they cannot cancel sign-in', () => {
    expect(isCallbackRequest('/?error=access_denied', 'st')).toBe(false)
    expect(isCallbackRequest('/?code=abc&state=evil', 'st')).toBe(false)
  })
})
