import { net } from 'electron'

// Chromium's network stack: honors system proxy/VPN settings and certificates,
// which Node's built-in fetch does not.
export const googleFetch: typeof fetch = async (input, init) => {
  try {
    return await net.fetch(input as string, init)
  } catch (e) {
    const cause = e instanceof Error ? e.message : String(e)
    throw new Error(`Could not reach Google (${cause}). Check your internet connection, VPN or proxy.`)
  }
}
