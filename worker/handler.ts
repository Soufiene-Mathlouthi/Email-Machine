export interface ProxyEnv {
  GOOGLE_CLIENT_ID: string
  GOOGLE_CLIENT_SECRET: string
}

export interface ProxyDeps {
  fetchFn?: (url: string, init: { method: string; headers: Record<string, string>; body: string }) => Promise<Response>
}

const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const MAX_BODY = 4096
const LOOPBACK = /^http:\/\/127\.0\.0\.1:\d{1,5}$/

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', 'cache-control': 'no-store' } })

const str = (v: unknown): string => (typeof v === 'string' ? v : '')

// Adds the client secret to Google token requests so it never ships inside the desktop app.
export async function handleTokenRequest(req: Request, env: ProxyEnv, deps: ProxyDeps = {}): Promise<Response> {
  if (new URL(req.url).pathname !== '/token') return json(404, { error: 'not_found' })
  if (req.method !== 'POST') return json(405, { error: 'method_not_allowed' })

  const text = await req.text()
  if (text.length > MAX_BODY) return json(413, { error: 'too_large' })
  let body: Record<string, unknown>
  try {
    body = JSON.parse(text) as Record<string, unknown>
  } catch {
    return json(400, { error: 'invalid_request' })
  }

  const params = new URLSearchParams()
  const grant = str(body.grant_type)
  if (grant === 'authorization_code') {
    const code = str(body.code), verifier = str(body.code_verifier), redirect = str(body.redirect_uri)
    if (!code || !verifier || !LOOPBACK.test(redirect)) return json(400, { error: 'invalid_request' })
    params.set('code', code)
    params.set('code_verifier', verifier)
    params.set('redirect_uri', redirect)
  } else if (grant === 'refresh_token') {
    const refresh = str(body.refresh_token)
    if (!refresh) return json(400, { error: 'invalid_request' })
    params.set('refresh_token', refresh)
  } else {
    return json(400, { error: 'unsupported_grant_type' })
  }

  if (!env.GOOGLE_CLIENT_ID || !env.GOOGLE_CLIENT_SECRET) return json(500, { error: 'server_misconfigured' })
  params.set('grant_type', grant)
  params.set('client_id', env.GOOGLE_CLIENT_ID)
  params.set('client_secret', env.GOOGLE_CLIENT_SECRET)

  let res: Response
  try {
    res = await (deps.fetchFn ?? fetch)(TOKEN_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: params.toString()
    })
  } catch {
    return json(502, { error: 'upstream_unreachable' })
  }
  const data = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) return json(res.status, { error: str(data.error) || 'token_request_failed' })
  return json(200, { access_token: data.access_token, expires_in: data.expires_in, refresh_token: data.refresh_token })
}
