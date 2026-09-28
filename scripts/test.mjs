import { spawnSync } from 'node:child_process'
import { createRequire } from 'node:module'

// better-sqlite3 is compiled for Electron's ABI, so tests run on Electron's Node.
const require = createRequire(import.meta.url)
const electron = require('electron')
const r = spawnSync(electron, ['node_modules/vitest/vitest.mjs', 'run', ...process.argv.slice(2)], {
  stdio: 'inherit',
  env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }
})
process.exit(r.status ?? 1)
