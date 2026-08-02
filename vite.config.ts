import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise(resolve => {
    let s = ''; req.on('data', (c: Buffer) => { s += c }); req.on('end', () => resolve(s))
  })
}

// Keep in sync with api/hands.ts — this middleware is the local-dev mirror of it.
const DEFAULT_PAGE_SIZE = 100
const MAX_PAGE_SIZE = 500
const DEFAULT_CHUNK_SIZE = 500
const MAX_CHUNK_SIZE = 2000

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

function apiRoutes(env: Record<string, string>): Plugin {
  return {
    name: 'api-routes',
    configureServer(server) {
      server.middlewares.use('/api/hands', async (req: IncomingMessage, res: ServerResponse) => {
        res.setHeader('Content-Type', 'application/json')
        try {
          // Mirror production auth: verify the Clerk token → owner id.
          const { verifyToken } = await import('@clerk/backend')
          const secretKey = env.CLERK_SECRET_KEY
          const token = (req.headers['authorization'] as string | undefined)?.replace(/^Bearer\s+/i, '')
          let ownerId: string | null = null
          if (secretKey && token) {
            try { ownerId = (await verifyToken(token, { secretKey })).sub ?? null } catch { ownerId = null }
          }
          if (!ownerId) { res.statusCode = 401; res.end(JSON.stringify({ error: 'Unauthorized' })); return }

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
          await sql`ALTER TABLE hands ADD COLUMN IF NOT EXISTS adj_net_bb numeric`
          await sql`ALTER TABLE hands ADD COLUMN IF NOT EXISTS rake_bb numeric`
          await sql`ALTER TABLE hands ADD COLUMN IF NOT EXISTS owner_id text`
          await sql`ALTER TABLE hands ADD COLUMN IF NOT EXISTS hero_vpip boolean`
          await sql`
            CREATE INDEX IF NOT EXISTS hands_owner_order_idx
            ON hands (owner_id, played_at DESC NULLS LAST, created_at DESC)`
          await sql`
            CREATE INDEX IF NOT EXISTS hands_pool_order_idx
            ON hands (played_at DESC NULLS LAST, created_at DESC, id DESC)`
          await sql`
            CREATE INDEX IF NOT EXISTS hands_hero_vpip_backfill_idx
            ON hands (owner_id) WHERE hero_vpip IS NULL`

          if (req.method === 'GET') {
            const params = new URL(req.url!, 'http://localhost').searchParams
            const view = params.get('view')
            if (view === 'graph') {
              const rows = await sql`
                SELECT played_at, net_bb, adj_net_bb, rake_bb FROM hands
                WHERE net_bb IS NOT NULL AND owner_id = ${ownerId}
                ORDER BY played_at ASC NULLS LAST, created_at ASC`
              res.end(JSON.stringify({ rows }))
              return
            }
            // Paged slice for the database browser (VPIP filtered in SQL).
            if (view === 'mine' && params.has('limit')) {
              await sql`
                UPDATE hands SET hero_vpip = COALESCE(
                  (analysis->>'heroVpip')::boolean,
                  EXISTS (
                    SELECT 1 FROM jsonb_array_elements(parsed->'actions') AS a
                    WHERE a->>'type' IN ('call', 'raise', 'bet', 'allin')
                      AND a->>'seatNumber' = (
                        SELECT p->>'seatNumber' FROM jsonb_array_elements(parsed->'players') AS p
                        WHERE (p->>'isMe')::boolean LIMIT 1
                      )
                  )
                )
                WHERE hero_vpip IS NULL AND owner_id = ${ownerId}`
              const limit = clampInt(params.get('limit'), 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE)
              const offset = clampInt(params.get('offset'), 0, Number.MAX_SAFE_INTEGER, 0)
              const vpip = params.get('vpip')
              const want = vpip === 'yes' ? true : vpip === 'no' ? false : null
              const [counts] = await sql`
                SELECT count(*)::int AS total,
                       count(*) FILTER (WHERE hero_vpip IS TRUE)::int AS vpip_yes
                FROM hands WHERE owner_id = ${ownerId}` as { total: number; vpip_yes: number }[]
              const total = counts?.total ?? 0
              const vpipYes = counts?.vpip_yes ?? 0
              const filtered = want === null ? total : want ? vpipYes : total - vpipYes
              const page = await sql`
                SELECT parsed, raw_text, notes FROM hands
                WHERE owner_id = ${ownerId}
                  AND (${want}::boolean IS NULL OR (hero_vpip IS TRUE) = ${want}::boolean)
                ORDER BY played_at DESC NULLS LAST, created_at DESC
                LIMIT ${limit} OFFSET ${offset}`
              res.end(JSON.stringify({ hands: page, total, filtered, limit, offset }))
              return
            }
            // Aggregate feed (Reports / Postflop / Leakbuster), one chunk at a
            // time — the whole sample in a single response exceeds Neon's 64 MB
            // limit. `total` rides along with the first chunk only.
            const chunk = clampInt(params.get('chunk'), 1, MAX_CHUNK_SIZE, DEFAULT_CHUNK_SIZE)
            const from = clampInt(params.get('offset'), 0, Number.MAX_SAFE_INTEGER, 0)
            const mine = view === 'mine'
            let count: number | undefined
            if (from === 0) {
              const [c] = (mine
                ? await sql`SELECT count(*)::int AS total FROM hands WHERE owner_id = ${ownerId}`
                : await sql`SELECT count(*)::int AS total FROM hands`) as { total: number }[]
              count = c?.total ?? 0
            }
            const rows = mine
              ? await sql`
                  SELECT parsed, raw_text FROM hands
                  WHERE owner_id = ${ownerId}
                  ORDER BY played_at DESC NULLS LAST, created_at DESC, id DESC
                  LIMIT ${chunk} OFFSET ${from}`
              : await sql`
                  SELECT parsed, raw_text FROM hands
                  ORDER BY played_at DESC NULLS LAST, created_at DESC, id DESC
                  LIMIT ${chunk} OFFSET ${from}`
            res.end(JSON.stringify({ hands: rows, total: count, limit: chunk, offset: from }))
            return
          }

          if (req.method === 'POST') {
            const body = JSON.parse(await readBody(req)) as { hands: unknown[] }
            const rows = body.hands ?? []
            if (rows.length) {
              await sql`
                INSERT INTO hands (
                  id, site, game_type, table_size, small_blind, big_blind, currency,
                  played_at, hero_position, net_bb, adj_net_bb, rake_bb, pot_type, hero_vpip, analysis, parsed, raw_text, notes, owner_id)
                SELECT x.*, ${ownerId} FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(
                  id text, site text, game_type text, table_size int, small_blind numeric,
                  big_blind numeric, currency text, played_at bigint, hero_position text,
                  net_bb numeric, adj_net_bb numeric, rake_bb numeric, pot_type text, hero_vpip boolean, analysis jsonb, parsed jsonb, raw_text text, notes text)
                ON CONFLICT (id) DO UPDATE SET
                  hero_vpip = EXCLUDED.hero_vpip,
                  analysis = EXCLUDED.analysis, parsed = EXCLUDED.parsed, raw_text = EXCLUDED.raw_text,
                  net_bb = EXCLUDED.net_bb, adj_net_bb = EXCLUDED.adj_net_bb, rake_bb = EXCLUDED.rake_bb,
                  pot_type = EXCLUDED.pot_type, played_at = EXCLUDED.played_at,
                  hero_position = EXCLUDED.hero_position, owner_id = EXCLUDED.owner_id,
                  notes = COALESCE(EXCLUDED.notes, hands.notes)`
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
  // Expose the Clerk publishable key to the client. The Vercel Marketplace
  // integration provisions it as NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY, so allow
  // that prefix too (publishable keys are safe to ship; the secret stays server-only).
  return { plugins: [react(), apiRoutes(env)], envPrefix: ['VITE_', 'NEXT_PUBLIC_'] }
})
