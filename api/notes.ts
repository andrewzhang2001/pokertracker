import { neon } from '@neondatabase/serverless'
import { verifyToken } from '@clerk/backend'
import { ensureNotesSchema } from '../db/schema'

// Persistent study notes, one per (user, anchor). The anchor is a semantic key
// for a page — a postflop node, a report, a leakbuster spot — built filter-blind
// so a note follows the spot across every board/size/date filter (see
// src/shared/api/noteAnchor.ts). Notes are personal: keyed by the Clerk account, never
// pooled. Same Node runtime / auth shape as api/hands.ts.
export const config = { runtime: 'nodejs' }

const connectionString =
  process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.DATABASE_URL_UNPOOLED ?? ''

const sql = neon(connectionString)

async function userIdFrom(req: Request): Promise<string | null> {
  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey) return null
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  try {
    const claims = await verifyToken(token, { secretKey })
    return claims.sub ?? null
  } catch {
    return null
  }
}

async function handler(req: Request): Promise<Response> {
  if (!connectionString) {
    return Response.json({ error: 'Database not configured' }, { status: 500 })
  }

  const userId = await userIdFrom(req)
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await ensureNotesSchema(sql)

    if (req.method === 'GET') {
      const params = new URL(req.url).searchParams
      // Bulk: every anchor this user has a note for — lets menus show a "has a
      // note" dot per tile without a request per tile.
      if (params.get('list') !== null) {
        const rows = await sql`SELECT anchor FROM notes WHERE user_id = ${userId}` as { anchor: string }[]
        return Response.json({ anchors: rows.map(r => r.anchor) })
      }
      // Read one note by anchor. Missing → empty body (so the UI shows a blank pad).
      const anchor = params.get('anchor')
      if (!anchor) return Response.json({ error: 'missing anchor' }, { status: 400 })
      const rows = await sql`
        SELECT body, updated_at FROM notes WHERE user_id = ${userId} AND anchor = ${anchor}
      ` as { body: string; updated_at: string }[]
      const row = rows[0]
      return Response.json({ body: row?.body ?? '', updated_at: row?.updated_at ?? null })
    }

    // Upsert. An empty/whitespace body deletes the row so stale dots don't linger.
    if (req.method === 'PUT') {
      const { anchor, body } = await req.json() as { anchor?: string; body?: string }
      if (!anchor) return Response.json({ error: 'missing anchor' }, { status: 400 })
      const trimmed = (body ?? '').trim()
      if (!trimmed) {
        await sql`DELETE FROM notes WHERE user_id = ${userId} AND anchor = ${anchor}`
        return Response.json({ body: '', updated_at: null })
      }
      const rows = await sql`
        INSERT INTO notes (user_id, anchor, body, updated_at)
        VALUES (${userId}, ${anchor}, ${trimmed}, now())
        ON CONFLICT (user_id, anchor) DO UPDATE SET body = EXCLUDED.body, updated_at = now()
        RETURNING body, updated_at
      ` as { body: string; updated_at: string }[]
      return Response.json({ body: rows[0].body, updated_at: rows[0].updated_at })
    }

    return Response.json({ error: 'method not allowed' }, { status: 405 })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}

export default { fetch: handler }
