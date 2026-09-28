import { createServer } from 'http'
import { getApiToken, getDb } from './db'
import { broadcast } from './queue'
import { SERVER_PORT } from '@shared/types'

// Local-only endpoint the browser extension will post scraped jobs to.
// Bound to 127.0.0.1 and protected by a bearer token shown in Settings.
export function startLocalServer(): void {
  const server = createServer((req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Headers', 'authorization, content-type')
    res.setHeader('Access-Control-Allow-Methods', 'POST, GET, OPTIONS')
    if (req.method === 'OPTIONS') return void res.writeHead(204).end()

    if (req.method === 'GET' && req.url === '/ping') {
      return void res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}')
    }

    if (req.method === 'POST' && req.url === '/jobs') {
      if (req.headers.authorization !== `Bearer ${getApiToken()}`) {
        return void res.writeHead(401).end('{"error":"unauthorized"}')
      }
      let raw = ''
      req.on('data', (chunk: Buffer) => {
        raw += chunk
        if (raw.length > 2_000_000) req.destroy()
      })
      req.on('end', () => {
        try {
          const j = JSON.parse(raw) as Record<string, string>
          const info = getDb()
            .prepare(
              'INSERT INTO jobs (title, company, url, description, contact_email, created_at) VALUES (?, ?, ?, ?, ?, ?)'
            )
            .run(j.title ?? '', j.company ?? '', j.url ?? '', j.description ?? '', j.contactEmail ?? '', Date.now())
          broadcast('jobs:changed')
          res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: info.lastInsertRowid }))
        } catch {
          res.writeHead(400).end('{"error":"bad request"}')
        }
      })
      return
    }

    res.writeHead(404).end()
  })

  server.on('error', (err) => console.error('Local server error:', err.message))
  server.listen(SERVER_PORT, '127.0.0.1')
}
