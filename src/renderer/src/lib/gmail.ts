import { useCallback, useState } from 'react'
import { errorText, invoke } from './api'

export function initialsFor(label: string, email: string): string {
  const words = (label && label !== email ? label : email.split('@')[0]).split(/[\s._-]+/).filter(Boolean)
  const letters = words.length > 1 ? words[0][0] + words[words.length - 1][0] : (words[0] ?? '?').slice(0, 2)
  return letters.toUpperCase()
}

// One sign-in flow shared by the sidebar and Settings.
export function useGmailConnect() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const connect = useCallback(async () => {
    setBusy(true)
    setError('')
    try {
      await invoke('gmail:connect')
    } catch (e) {
      setError(errorText(e))
    } finally {
      setBusy(false)
    }
  }, [])
  const cancel = useCallback(() => void invoke('gmail:cancel'), [])
  return { busy, error, connect, cancel, clearError: () => setError('') }
}
