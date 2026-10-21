import { app, BrowserWindow } from 'electron'
import { autoUpdater } from 'electron-updater'
import type { UpdateState } from '@shared/types'

const CHECK_EVERY_MS = 4 * 60 * 60 * 1000

let state: UpdateState = { status: 'idle' }

function setState(next: UpdateState): void {
  state = next
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:state', state)
}

export function updateState(): UpdateState {
  return state
}

export function installUpdate(): void {
  if (state.status === 'ready') autoUpdater.quitAndInstall()
}

export async function checkForUpdates(): Promise<void> {
  if (!app.isPackaged) return
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    setState({ status: 'error', message: (e as Error).message })
  }
}

export function startAutoUpdates(): void {
  if (!app.isPackaged) return
  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('update-available', (i) => setState({ status: 'downloading', version: i.version, percent: 0 }))
  autoUpdater.on('download-progress', (p) => {
    if (state.status === 'downloading') setState({ ...state, percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (i) => setState({ status: 'ready', version: i.version }))
  autoUpdater.on('error', (e) => setState({ status: 'error', message: e.message }))
  void checkForUpdates()
  setInterval(() => void checkForUpdates(), CHECK_EVERY_MS)
}
