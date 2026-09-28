import { contextBridge, ipcRenderer } from 'electron'

const api = {
  invoke: <T = unknown>(channel: string, ...args: unknown[]): Promise<T> => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, cb: (payload: any) => void): (() => void) => {
    const listener = (_e: unknown, payload: unknown): void => cb(payload)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }
}

contextBridge.exposeInMainWorld('api', api)

export type Api = typeof api
