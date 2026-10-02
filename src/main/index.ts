import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { migrateGlobalCv } from './attachments'
import { getDb, getSetting, setSetting } from './db'
import { registerIpc } from './ipc'
import { startLocalServer } from './server'
import { startFollowUpScheduler } from './followups/scheduler'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 980,
    minHeight: 620,
    title: 'Email Machine',
    backgroundColor: '#f9fafb',
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  win.webContents.setWindowOpenHandler(({ url }) => {
    void shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env['ELECTRON_RENDERER_URL']) {
    void win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    void win.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(() => {
  const db = getDb()
  // One-time: the old global CV setting becomes per-template attachments.
  const legacyCv = getSetting('cvPath')
  if (legacyCv) {
    migrateGlobalCv(db, join(app.getPath('userData'), 'attachments'), legacyCv)
    setSetting('cvPath', '')
  }
  registerIpc()
  startLocalServer()
  startFollowUpScheduler()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
