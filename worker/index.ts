import { handleTokenRequest, type ProxyEnv } from './handler'

interface Env extends ProxyEnv {
  LIMITER?: { limit(o: { key: string }): Promise<{ success: boolean }> }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (env.LIMITER) {
      const { success } = await env.LIMITER.limit({ key: req.headers.get('cf-connecting-ip') ?? 'unknown' })
      if (!success) return new Response(JSON.stringify({ error: 'rate_limited' }), { status: 429, headers: { 'content-type': 'application/json' } })
    }
    return handleTokenRequest(req, env)
  }
}
