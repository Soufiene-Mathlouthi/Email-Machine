import { describe, expect, it } from 'vitest'
import { resolveClient } from '../src/main/google/client'

const none = { clientId: '', clientSecret: '' }
const noBuilt = { clientId: '', proxyUrl: '' }

describe('resolveClient', () => {
  const builtIn = { clientId: 'built.apps.googleusercontent.com', proxyUrl: 'https://proxy.example.workers.dev' }
  const custom = { clientId: 'mine.apps.googleusercontent.com', clientSecret: 'GOCSPX-mine' }

  const viaProxy = { clientId: builtIn.clientId, proxyUrl: builtIn.proxyUrl }

  it('uses the built-in client through the proxy when there is no saved client', () => {
    expect(resolveClient(builtIn, none)).toEqual(viaProxy)
  })

  it('prefers the built-in client over a client saved earlier, since the UI hides saved ones', () => {
    expect(resolveClient(builtIn, custom)).toEqual(viaProxy)
  })

  it('falls back to the user client when nothing is built in', () => {
    expect(resolveClient(noBuilt, custom)).toEqual(custom)
  })

  it('needs both a client id and a proxy url for the built-in client', () => {
    expect(resolveClient({ clientId: 'a', proxyUrl: '' }, none)).toBeNull()
    expect(resolveClient({ clientId: '', proxyUrl: 'https://x' }, none)).toBeNull()
  })

  it('returns null when neither is configured', () => {
    expect(resolveClient(noBuilt, none)).toBeNull()
  })

  it('trims whitespace and a trailing slash', () => {
    expect(resolveClient({ clientId: ' a ', proxyUrl: ' https://p.dev/ ' }, none)).toEqual({ clientId: 'a', proxyUrl: 'https://p.dev' })
  })
})
