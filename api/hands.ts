import { neon } from '@neondatabase/serverless'
import { verifyToken } from '@clerk/backend'

// Node.js runtime (Fluid Compute), not Edge: @clerk/backend pulls in Node crypto
// that the Edge runtime doesn't support. The Web Request/Response handler below
// works the same on Node.
export const config = { runtime: 'nodejs' }

const connectionString =
  process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.DATABASE_URL_UNPOOLED ?? ''

const sql = neon(connectionString)

// Verify the Clerk session token from the Authorization header → user id (sub).
// Every hands request is per-account: exports are stamped with the owner, and
// the personal views (graph / your hands) are filtered to it.
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

async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS hands (
      id            text PRIMARY KEY,
      site          text NOT NULL,
      game_type     text NOT NULL,
      table_size    int  NOT NULL,
      small_blind   numeric,
      big_blind     numeric NOT NULL,
      currency      text,
      played_at     bigint,
      hero_position text,
      net_bb        numeric,
      pot_type      text,
      analysis      jsonb NOT NULL,
      parsed        jsonb NOT NULL,
      raw_text      text NOT NULL,
      notes         text,
      created_at    timestamptz DEFAULT now()
    )
  `
  // Result columns added later; backfilled on next export of each hand.
  await sql`ALTER TABLE hands ADD COLUMN IF NOT EXISTS adj_net_bb numeric`
  await sql`ALTER TABLE hands ADD COLUMN IF NOT EXISTS rake_bb numeric`
  // Per-account ownership. Legacy rows stay NULL until backfilled
  // (scripts/backfill-owner.mjs) or re-exported by their owner.
  await sql`ALTER TABLE hands ADD COLUMN IF NOT EXISTS owner_id text`
}

export default async function handler(req: Request): Promise<Response> {
  if (!connectionString) {
    return Response.json({ error: 'Database not configured' }, { status: 500 })
  }

  const ownerId = await userIdFrom(req)
  if (!ownerId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await ensureTable()

    if (req.method === 'GET') {
      const view = new URL(req.url).searchParams.get('view')
      // Lightweight graph feed: YOUR own result numbers, oldest first.
      if (view === 'graph') {
        const rows = await sql`
          SELECT played_at, net_bb, adj_net_bb, rake_bb
          FROM hands
          WHERE net_bb IS NOT NULL AND owner_id = ${ownerId}
          ORDER BY played_at ASC NULLS LAST, created_at ASC
        `
        return Response.json({ rows })
      }
      // view=mine → just your hands (your-hands review / Leakbuster).
      // default → the whole pool (population Reports + Postflop spots).
      const rows = view === 'mine'
        ? await sql`
            SELECT parsed, raw_text, notes
            FROM hands
            WHERE owner_id = ${ownerId}
            ORDER BY played_at DESC NULLS LAST, created_at DESC
          `
        : await sql`
            SELECT parsed, raw_text, notes
            FROM hands
            ORDER BY played_at DESC NULLS LAST, created_at DESC
          `
      return Response.json({ hands: rows })
    }

    if (req.method === 'POST') {
      const body = await req.json() as { hands: unknown[] }
      const rows = body.hands ?? []
      if (!rows.length) return Response.json({ inserted: 0 })

      // Single round-trip bulk upsert: the whole array goes in as one jsonb
      // param and is expanded into rows by jsonb_to_recordset. owner_id comes
      // from the verified token, never the client payload.
      await sql`
        INSERT INTO hands (
          id, site, game_type, table_size, small_blind, big_blind, currency,
          played_at, hero_position, net_bb, adj_net_bb, rake_bb, pot_type, analysis, parsed, raw_text, notes, owner_id
        )
        SELECT x.*, ${ownerId} FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(
          id text, site text, game_type text, table_size int, small_blind numeric,
          big_blind numeric, currency text, played_at bigint, hero_position text,
          net_bb numeric, adj_net_bb numeric, rake_bb numeric, pot_type text, analysis jsonb, parsed jsonb, raw_text text, notes text
        )
        ON CONFLICT (id) DO UPDATE SET
          analysis      = EXCLUDED.analysis,
          parsed        = EXCLUDED.parsed,
          raw_text      = EXCLUDED.raw_text,
          net_bb        = EXCLUDED.net_bb,
          adj_net_bb    = EXCLUDED.adj_net_bb,
          rake_bb       = EXCLUDED.rake_bb,
          pot_type      = EXCLUDED.pot_type,
          played_at     = EXCLUDED.played_at,
          hero_position = EXCLUDED.hero_position,
          owner_id      = EXCLUDED.owner_id,
          notes         = COALESCE(EXCLUDED.notes, hands.notes)
      `
      return Response.json({ inserted: rows.length })
    }

    return Response.json({ error: 'method not allowed' }, { status: 405 })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}
