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
      server.middlewares.use('/api/hands', async (req: IncomingMessage, res: ServerResponse) => {
        res.setHeader('Content-Type', 'application/json')
        try {
          const { neon } = await import('@neondatabase/serverless')
          const conn = env.DATABASE_URL || env.POSTGRES_URL || env.DATABASE_URL_UNPOOLED || ''
          if (!conn) { res.statusCode = 500; res.end(JSON.stringify({ error: 'Database not configured' })); return }
          const sql = neon(conn)

          await sql`
            CREATE TABLE IF NOT EXISTS hands (
              id text PRIMARY KEY, site text NOT NULL, game_type text NOT NULL,
              table_size int NOT NULL, small_blind numeric, big_blind numeric NOT NULL,
              currency text, played_at bigint, hero_position text, net_bb numeric,
              pot_type text, analysis jsonb NOT NULL, parsed jsonb NOT NULL,
              raw_text text NOT NULL, notes text, created_at timestamptz DEFAULT now()
            )`

          if (req.method === 'GET') {
            const rows = await sql`
              SELECT parsed, raw_text, notes FROM hands
              ORDER BY played_at DESC NULLS LAST, created_at DESC`
            res.end(JSON.stringify({ hands: rows }))
            return
          }

          if (req.method === 'POST') {
            const body = JSON.parse(await readBody(req)) as { hands: unknown[] }
            const rows = body.hands ?? []
            if (rows.length) {
              await sql`
                INSERT INTO hands (
                  id, site, game_type, table_size, small_blind, big_blind, currency,
                  played_at, hero_position, net_bb, pot_type, analysis, parsed, raw_text, notes)
                SELECT * FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(
                  id text, site text, game_type text, table_size int, small_blind numeric,
                  big_blind numeric, currency text, played_at bigint, hero_position text,
                  net_bb numeric, pot_type text, analysis jsonb, parsed jsonb, raw_text text, notes text)
                ON CONFLICT (id) DO UPDATE SET
                  analysis = EXCLUDED.analysis, parsed = EXCLUDED.parsed, raw_text = EXCLUDED.raw_text,
                  net_bb = EXCLUDED.net_bb, pot_type = EXCLUDED.pot_type, played_at = EXCLUDED.played_at,
                  hero_position = EXCLUDED.hero_position, notes = COALESCE(EXCLUDED.notes, hands.notes)`
            }
            res.end(JSON.stringify({ inserted: rows.length }))
            return
          }

          res.statusCode = 405
          res.end(JSON.stringify({ error: 'method not allowed' }))
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
  return { plugins: [react(), apiRoutes(env)] }
})
