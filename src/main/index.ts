import { app, BrowserWindow, shell } from 'electron'
import { join } from 'path'
import { getDb } from './db'
import { registerIpc } from './ipc'
import { startLocalServer } from './server'

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1240,
    height: 800,
    minWidth: 980,
    minHeight: 620,
    title: 'Email Machine',
    backgroundColor: '#0f1a2e',
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
  getDb()
  registerIpc()
  startLocalServer()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
