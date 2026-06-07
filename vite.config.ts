import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

function apiRoutes(env: Record<string, string>): Plugin {
  return {
    name: 'api-routes',
    configureServer(server) {
      server.middlewares.use('/api/share', async (req: IncomingMessage, res: ServerResponse) => {
        res.setHeader('Content-Type', 'application/json')
        try {
          const { Redis } = await import('@upstash/redis')
          const redis = new Redis({ url: env.KV_REST_API_URL, token: env.KV_REST_API_TOKEN })

          if (req.method === 'POST') {
            const body = await new Promise<string>(resolve => {
              let s = ''; req.on('data', (c: Buffer) => { s += c }); req.on('end', () => resolve(s))
            })
            const parsed = JSON.parse(body) as { rawText: string; handNotes?: string[]; notes?: string }
            const handNotes = parsed.handNotes ?? (parsed.notes ? [parsed.notes] : [''])
            const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
            let id = ''
            for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)]
            await redis.set(id, { rawText: parsed.rawText, handNotes }, { ex: 7_776_000 })
            res.end(JSON.stringify({ id }))
            return
          }

          if (req.method === 'GET') {
            const id = new URL(req.url!, 'http://localhost').searchParams.get('id')
            if (!id) { res.statusCode = 400; res.end(JSON.stringify({ error: 'missing id' })); return }
            const data = await redis.get<{ rawText: string; handNotes?: string[]; notes?: string }>(id)
            if (!data) { res.statusCode = 404; res.end(JSON.stringify({ error: 'not found' })); return }
            const handNotes = data.handNotes ?? (data.notes ? [data.notes] : [''])
            res.end(JSON.stringify({ rawText: data.rawText, handNotes }))
            return
          }

          res.statusCode = 405
          res.end(JSON.stringify({ error: 'method not allowed' }))
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(e) }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  return { plugins: [react(), apiRoutes(env)] }
})
