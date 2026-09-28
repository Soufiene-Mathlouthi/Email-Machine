import { base64url } from './pkce'

const API = 'https://gmail.googleapis.com/gmail/v1/users/me'

export interface GmailDeps {
  getToken: (forceRefresh?: boolean) => Promise<string>
  fetchFn?: typeof fetch
}

type Headers = { name: string; value: string }[]

async function call<T>(deps: GmailDeps, path: string, init: RequestInit = {}): Promise<T> {
  const doFetch = deps.fetchFn ?? fetch
  for (let attempt = 0; attempt < 2; attempt++) {
    const token = await deps.getToken(attempt > 0)
    const res = await doFetch(`${API}${path}`, {
      ...init,
      headers: { ...((init.headers as Record<string, string>) ?? {}), authorization: `Bearer ${token}` }
    })
    if (res.status === 401 && attempt === 0) continue
    if (!res.ok) throw new Error(`Gmail API ${res.status}: ${(await res.text()).slice(0, 300)}`)
    return (await res.json()) as T
  }
  throw new Error('Gmail API rejected the access token.')
}

const header = (headers: Headers | undefined, name: string): string =>
  headers?.find((h) => h.name.toLowerCase() === name.toLowerCase())?.value ?? ''

export const sendRaw = (deps: GmailDeps, raw: Buffer, threadId?: string) =>
  call<{ id: string; threadId: string }>(deps, '/messages/send', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ raw: base64url(raw), ...(threadId ? { threadId } : {}) })
  })

export async function getMessageIdHeader(deps: GmailDeps, id: string): Promise<string> {
  const m = await call<{ payload?: { headers?: Headers } }>(deps, `/messages/${id}?format=metadata&metadataHeaders=Message-ID`)
  return header(m.payload?.headers, 'Message-ID')
}

export async function getThreadSenders(deps: GmailDeps, threadId: string): Promise<string[]> {
  const t = await call<{ messages?: { payload?: { headers?: Headers } }[] }>(
    deps, `/threads/${threadId}?format=metadata&metadataHeaders=From`
  )
  return (t.messages ?? []).map((m) => header(m.payload?.headers, 'From')).filter(Boolean)
}

export const getProfile = (deps: GmailDeps) => call<{ emailAddress: string }>(deps, '/profile')
