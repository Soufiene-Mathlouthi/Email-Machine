import { describe, expect, it, vi } from 'vitest'
import { getThreadSenders, sendRaw } from '../src/main/google/gmail'
import { REVOKED_MESSAGE, tokenErrorMessage } from '../src/main/google/oauth'

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

describe('gmail client', () => {
  it('sends base64url raw with the thread id and bearer token', async () => {
    const fetchFn = vi.fn(async () => json(200, { id: 'm1', threadId: 't1' }))
    const out = await sendRaw({ getToken: async () => 'tok', fetchFn }, Buffer.from('hi?>'), 't1')
    expect(out).toEqual({ id: 'm1', threadId: 't1' })
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://gmail.googleapis.com/gmail/v1/users/me/messages/send')
    expect((init.headers as Record<string, string>).authorization).toBe('Bearer tok')
    expect(JSON.parse(init.body as string)).toEqual({ raw: 'aGk_Pg', threadId: 't1' })
  })

  it('refreshes the token once on 401', async () => {
    const getToken = vi.fn(async (force?: boolean) => (force ? 'fresh' : 'stale'))
    const fetchFn = vi.fn()
      .mockResolvedValueOnce(json(401, {}))
      .mockResolvedValueOnce(json(200, { messages: [{ payload: { headers: [{ name: 'From', value: 'Jane <jane@acme.com>' }] } }] }))
    expect(await getThreadSenders({ getToken, fetchFn }, 't1')).toEqual(['Jane <jane@acme.com>'])
    expect(getToken).toHaveBeenLastCalledWith(true)
  })

  it('surfaces API errors with the status', async () => {
    const fetchFn = vi.fn(async () => new Response('quota', { status: 429 }))
    await expect(sendRaw({ getToken: async () => 't', fetchFn }, Buffer.from('x'))).rejects.toThrow('Gmail API 429')
  })
})

describe('tokenErrorMessage', () => {
  it('maps invalid_grant to the reconnect message', () => {
    expect(tokenErrorMessage('invalid_grant')).toBe(REVOKED_MESSAGE)
    expect(tokenErrorMessage('invalid_client')).toBe('Google token request failed: invalid_client')
  })
})
