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

      // Delegate each /api/* route to its REAL production handler instead of a
      // parallel reimplementation (which silently drifted and broke dev before).
      // ssrLoadModule transpiles the TS module; we bridge Node req/res to the Web
      // Request/Response the handler expects. Every api/*.ts endpoint must be
      // registered here or it 404s in dev.
      const bridge = (route: string, modPath: string) =>
        server.middlewares.use(route, async (req: IncomingMessage, res: ServerResponse) => {
          res.setHeader('Content-Type', 'application/json')
          try {
            const mod = await server.ssrLoadModule(modPath)
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

      bridge('/api/hands', '/api/hands.ts')
      bridge('/api/notes', '/api/notes.ts')
      bridge('/api/profiles', '/api/profiles.ts')
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
