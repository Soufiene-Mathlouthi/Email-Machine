import { useCallback, useEffect, useState } from 'react'

export const invoke = <T = void>(channel: string, ...args: unknown[]): Promise<T> =>
  window.api.invoke<T>(channel, ...args)

// Loads data from the main process and reloads whenever one of `events` fires.
export function useData<T>(channel: string, initial: T, events: string[] = []) {
  const [data, setData] = useState<T>(initial)
  const load = useCallback(() => {
    void invoke<T>(channel).then(setData)
  }, [channel])
  const key = events.join(',')
  useEffect(() => {
    load()
    const offs = key ? key.split(',').map((e) => window.api.on(e, load)) : []
    return () => offs.forEach((off) => off())
  }, [load, key])
  return [data, load] as const
}

export const errorText = (e: unknown): string =>
  e instanceof Error ? e.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '') : String(e)

export const fmtDate = (ms: number | null): string =>
  ms ? new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : ''
