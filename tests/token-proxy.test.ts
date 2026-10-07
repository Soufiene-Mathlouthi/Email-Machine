import { describe, expect, it } from 'vitest'
import { handleTokenRequest, type ProxyEnv } from '../worker/handler'

const env: ProxyEnv = { GOOGLE_CLIENT_ID: 'cid.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'GOCSPX-secret' }

function call(body: unknown, opts: { method?: string; path?: string; raw?: string; e?: ProxyEnv; google?: { status: number; json: unknown } } = {}) {
  const sent: { url: string; body: URLSearchParams }[] = []
  const g = opts.google ?? { status: 200, json: { access_token: 'at', expires_in: 3600, refresh_token: 'rt', id_token: 'leak?' } }
  const fetchFn = async (url: string, init: { body: string }) => {
    sent.push({ url, body: new URLSearchParams(init.body) })
    return new Response(JSON.stringify(g.json), { status: g.status, headers: { 'content-type': 'application/json' } })
  }
  const req = new Request(`https://proxy.test${opts.path ?? '/token'}`, {
    method: opts.method ?? 'POST',
    headers: { 'content-type': 'application/json' },
    body: (opts.method ?? 'POST') === 'GET' ? undefined : opts.raw ?? JSON.stringify(body)
  })
  return handleTokenRequest(req, opts.e ?? env, { fetchFn: fetchFn as never }).then((res) => ({ res, sent }))
}

const code = { grant_type: 'authorization_code', code: 'c', code_verifier: 'v', redirect_uri: 'http://127.0.0.1:51234' }
const refresh = { grant_type: 'refresh_token', refresh_token: 'rt' }

describe('token proxy', () => {
  it('exchanges a code, adding the secret and client id server-side', async () => {
    const { res, sent } = await call(code)
    expect(res.status).toBe(200)
    expect(sent[0].url).toBe('https://oauth2.googleapis.com/token')
    expect(sent[0].body.get('client_secret')).toBe('GOCSPX-secret')
    expect(sent[0].body.get('client_id')).toBe(env.GOOGLE_CLIENT_ID)
    expect(sent[0].body.get('code_verifier')).toBe('v')
  })

  it('refreshes a token', async () => {
    const { res, sent } = await call(refresh)
    expect(res.status).toBe(200)
    expect(sent[0].body.get('refresh_token')).toBe('rt')
  })

  it('only returns the token fields, never the secret or extra fields', async () => {
    const { res } = await call(code)
    const out = await res.json()
    expect(out).toEqual({ access_token: 'at', expires_in: 3600, refresh_token: 'rt' })
  })

  it('ignores a client id or secret supplied by the caller', async () => {
    const { sent } = await call({ ...code, client_id: 'evil', client_secret: 'evil' })
    expect(sent[0].body.get('client_id')).toBe(env.GOOGLE_CLIENT_ID)
    expect(sent[0].body.get('client_secret')).toBe('GOCSPX-secret')
  })

  it.each(['password', 'client_credentials', 'urn:ietf:params:oauth:grant-type:jwt-bearer', undefined])('rejects grant %s', async (g) => {
    const { res, sent } = await call({ ...code, grant_type: g })
    expect(res.status).toBe(400)
    expect(sent).toHaveLength(0)
  })

  it.each(['https://evil.com', 'http://evil.com:80', 'http://127.0.0.1.evil.com:1234', 'http://localhost:5000', 'http://127.0.0.1', 'http://127.0.0.1:1234/x', ''])(
    'rejects redirect_uri %s', async (uri) => {
      const { res, sent } = await call({ ...code, redirect_uri: uri })
      expect(res.status).toBe(400)
      expect(sent).toHaveLength(0)
    })

  it('requires code and verifier for a code exchange, and a token for refresh', async () => {
    expect((await call({ ...code, code: '' })).res.status).toBe(400)
    expect((await call({ ...code, code_verifier: undefined })).res.status).toBe(400)
    expect((await call({ grant_type: 'refresh_token' })).res.status).toBe(400)
  })

  it('rejects non-POST, other paths, bad JSON and oversized bodies', async () => {
    expect((await call(null, { method: 'GET' })).res.status).toBe(405)
    expect((await call(code, { path: '/other' })).res.status).toBe(404)
    expect((await call(null, { raw: '{not json' })).res.status).toBe(400)
    expect((await call(null, { raw: JSON.stringify({ ...code, code: 'x'.repeat(5000) }) })).res.status).toBe(413)
  })

  it('passes Google errors through without the secret', async () => {
    const { res } = await call(refresh, { google: { status: 400, json: { error: 'invalid_grant', error_description: 'Bad', client_secret: 'x' } } })
    expect(res.status).toBe(400)
    expect(await res.json()).toEqual({ error: 'invalid_grant' })
  })

  it('returns 500 with a generic error when the proxy is not configured', async () => {
    const { res } = await call(code, { e: { GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '' } })
    expect(res.status).toBe(500)
    expect(JSON.stringify(await res.json())).not.toContain('GOCSPX')
  })

  it('returns 502 if Google is unreachable', async () => {
    const req = new Request('https://proxy.test/token', { method: 'POST', body: JSON.stringify(code) })
    const res = await handleTokenRequest(req, env, { fetchFn: (async () => { throw new Error('down') }) as never })
    expect(res.status).toBe(502)
  })
})
