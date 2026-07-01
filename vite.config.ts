import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    let s = ''; req.on('data', (c: Buffer) => { s += c }); req.on('end', () => resolve(s))
  })
}

function apiRoutes(env: Record<string, string>): Plugin {
  return {
    name: 'api-routes',
    configureServer(server) {
      // The production handler (api/hands.ts) reads connection + auth from
      // process.env; surface the vite-loaded env so dev can delegate to it.
      process.env.DATABASE_URL ||= env.DATABASE_URL
      process.env.POSTGRES_URL ||= env.POSTGRES_URL
      process.env.DATABASE_URL_UNPOOLED ||= env.DATABASE_URL_UNPOOLED
      process.env.CLERK_SECRET_KEY ||= env.CLERK_SECRET_KEY

      // Delegate /api/hands to the REAL production handler instead of a parallel
      // reimplementation (which silently drifted and broke reports/postflop in
      // dev). ssrLoadModule transpiles the TS module; we bridge Node req/res to
      // the Web Request/Response the handler expects.
      server.middlewares.use('/api/hands', async (req: IncomingMessage, res: ServerResponse) => {
        res.setHeader('Content-Type', 'application/json')
        try {
          const mod = await server.ssrLoadModule('/api/hands.ts')
          const headers = new Headers()
          for (const [k, v] of Object.entries(req.headers)) if (typeof v === 'string') headers.set(k, v)
          const method = req.method ?? 'GET'
          const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(req)
          const response: Response = await mod.default.fetch(
            new Request(`http://localhost${req.url}`, { method, headers, body }),
          )
          res.statusCode = response.status
          response.headers.forEach((v, k) => res.setHeader(k, v))
          res.end(await response.text())
        } catch (e) {
          res.statusCode = 500
          res.end(JSON.stringify({ error: String(e) }))
        }
      })

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
  // Expose the Clerk publishable key to the client. The Vercel Marketplace
  // integration provisions it as NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, so allow
  // that prefix too (publishable keys are safe to ship; the secret stays server-only).
  return { plugins: [react(), apiRoutes(env)], envPrefix: ['VITE_', 'NEXT_PUBLIC_'] }
})
