export interface BuiltInClient {
  clientId: string
  proxyUrl: string
}
export interface UserClient {
  clientId: string
  clientSecret: string
}
// Direct: the user's own client, secret held locally. Proxy: the shipped client, secret held by the token proxy.
export type GoogleClient = UserClient | { clientId: string; proxyUrl: string }

export const isProxy = (c: GoogleClient): c is { clientId: string; proxyUrl: string } => 'proxyUrl' in c

// A client baked in at build time wins (its settings UI is hidden, so a saved one could not be seen or fixed);
// builds without one fall back to the user's own pasted client.
export function resolveClient(builtIn: BuiltInClient, user: UserClient): GoogleClient | null {
  const bid = builtIn.clientId.trim(), url = builtIn.proxyUrl.trim().replace(/\/+$/, '')
  if (bid && url) return { clientId: bid, proxyUrl: url }
  const id = user.clientId.trim(), secret = user.clientSecret.trim()
  return id && secret ? { clientId: id, clientSecret: secret } : null
}
