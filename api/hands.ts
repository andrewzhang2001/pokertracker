import { neon } from '@neondatabase/serverless'
import { verifyToken } from '@clerk/backend'

// Node.js runtime (Fluid Compute), not Edge: @clerk/backend pulls in Node crypto
// the Edge runtime doesn't support. On Node, the Web Request/Response handler
// must be exported via the `fetch` Web Standard shape (see bottom of file) — a
// bare default function would be invoked with the legacy Node (req, res) args.
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

  // Materialized preflop spots — one row per extracted spot, so reports become a
  // single GROUP BY here instead of shipping every hand to the browser. Derived
  // from `parsed`; rebuilt on each export and by scripts/backfill-spots.mjs.
  await sql`
    CREATE TABLE IF NOT EXISTS preflop_spots (
      id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      hand_id       text NOT NULL,
      owner_id      text,
      report_type   text NOT NULL,
      pos_a         text NOT NULL,
      pos_b         text,
      multiway      boolean,
      combo         text,
      action        text NOT NULL,
      is_hero       boolean NOT NULL,
      stack_bb      numeric NOT NULL,
      key_stack_bb  numeric NOT NULL
    )
  `
  // 'hu' vs 'sixmax' — keeps heads-up and 6-max reports on separate tracks.
  await sql`ALTER TABLE preflop_spots ADD COLUMN IF NOT EXISTS table_kind text`
  await sql`CREATE INDEX IF NOT EXISTS preflop_spots_lookup ON preflop_spots (table_kind, report_type, pos_a, pos_b, is_hero)`
  await sql`CREATE INDEX IF NOT EXISTS preflop_spots_hand ON preflop_spots (hand_id)`

  // Materialized postflop spots — one slim FlopSpot per heads-up hand, so the
  // postflop views load a single formation's spots and run the node-walk
  // client-side. Texture columns drive the per-formation counts query.
  await sql`
    CREATE TABLE IF NOT EXISTS flop_spots (
      hand_id        text PRIMARY KEY,
      owner_id       text,
      formation_id   text NOT NULL,
      pot_type       text NOT NULL,
      oop_pos        text NOT NULL,
      ip_pos         text NOT NULL,
      oop_is_hero    boolean NOT NULL,
      ip_is_hero     boolean NOT NULL,
      flop_suits     text,
      flop_paired    boolean,
      flop_straighty boolean,
      flop_high      text,
      flop_mid       text,
      flop_low       text,
      turn_suits     text,
      turn_paired    boolean,
      turn_straighty boolean,
      river_suits    text,
      river_paired   boolean,
      river_straighty boolean,
      spot           jsonb NOT NULL
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS flop_spots_formation ON flop_spots (formation_id)`
}

async function handler(req: Request): Promise<Response> {
  if (!connectionString) {
    return Response.json({ error: 'Database not configured' }, { status: 500 })
  }

  const ownerId = await userIdFrom(req)
  if (!ownerId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await ensureTable()

    if (req.method === 'GET') {
      const params = new URL(req.url).searchParams
      const view = params.get('view')
      // Optional month-range filter (epoch ms; `to` is exclusive = start of the
      // month after the selected end month). Null bound → unbounded on that side.
      const dFrom = params.get('from')
      const dTo = params.get('to')
      // Compact per-combo grid for every preflop report — one GROUP BY drives all
      // the report tiles. `hero` = the viewer's own spots; `pop` = the field's.
      if (view === 'reports') {
        const grid = await sql`
          SELECT s.table_kind, s.report_type, s.pos_a, s.pos_b, s.multiway, s.combo, s.action,
            sum(CASE WHEN s.is_hero AND s.owner_id = ${ownerId} THEN 1 ELSE 0 END)::int AS hero,
            sum(CASE WHEN NOT s.is_hero THEN 1 ELSE 0 END)::int AS pop
          FROM preflop_spots s JOIN hands h ON h.id = s.hand_id
          WHERE s.stack_bb >= 75 AND s.key_stack_bb >= 75
            AND (${dFrom}::bigint IS NULL OR h.played_at >= ${dFrom}::bigint)
            AND (${dTo}::bigint IS NULL OR h.played_at < ${dTo}::bigint)
          GROUP BY s.table_kind, s.report_type, s.pos_a, s.pos_b, s.multiway, s.combo, s.action
        `
        return Response.json({ grid })
      }
      // Drill-down for ONE report: just the hands that have a qualifying spot for
      // it, so the detail view can re-derive populated bucket lists via buildReport
      // without loading the whole pool. multiway is filtered client-side.
      if (view === 'report-hands') {
        const type = params.get('type'), posA = params.get('pos_a')
        const posB = params.get('pos_b') // null for rfi / limpiso
        const kind = params.get('kind') === 'hu' ? 'hu' : 'sixmax'
        const subject = params.get('subject') === 'hero' ? 'hero' : 'population'
        const rows = await sql`
          SELECT parsed, raw_text, notes
          FROM hands
          WHERE id IN (
            SELECT s.hand_id FROM preflop_spots s
            WHERE s.table_kind = ${kind} AND s.report_type = ${type} AND s.pos_a = ${posA}
              AND (${posB}::text IS NULL OR s.pos_b = ${posB})
              AND s.stack_bb >= 75 AND s.key_stack_bb >= 75
              AND (CASE WHEN ${subject} = 'hero'
                        THEN s.is_hero AND s.owner_id = ${ownerId}
                        ELSE NOT s.is_hero END)
          )
            AND (${dFrom}::bigint IS NULL OR played_at >= ${dFrom}::bigint)
            AND (${dTo}::bigint IS NULL OR played_at < ${dTo}::bigint)
          ORDER BY played_at DESC NULLS LAST, created_at DESC
        `
        return Response.json({ hands: rows })
      }
      // One formation's slim postflop spots — the browser runs the node-walk over
      // this subset (board texture / line / node / mode are all client-side).
      if (view === 'flop-spots') {
        const formation = params.get('formation')
        const rows = await sql`
          SELECT s.spot FROM flop_spots s JOIN hands h ON h.id = s.hand_id
          WHERE s.formation_id = ${formation}
            AND (${dFrom}::bigint IS NULL OR h.played_at >= ${dFrom}::bigint)
            AND (${dTo}::bigint IS NULL OR h.played_at < ${dTo}::bigint)
        ` as { spot: unknown }[]
        return Response.json({ spots: rows.map(r => r.spot) })
      }
      // Per-formation sample counts under the active board filter — the menu's
      // formation tiles. Predicates mirror filterFormation: a null param (filter
      // = 'any' / empty) is a no-op; an active suit/paired/straight on a street
      // that didn't happen (NULL column) is excluded, as in matchSuit/matchYN.
      if (view === 'flop-counts') {
        const su = (k: string) => { const v = params.get(k); return v && v !== 'any' ? v : null }
        const yn = (k: string) => { const v = params.get(k); return v === 'yes' ? true : v === 'no' ? false : null }
        const ranks = (k: string) => { const v = params.get(k); return v ? v.split(',') : null }
        const heroMode = params.get('mode') === 'hero'
        const rows = await sql`
          SELECT s.formation_id, count(*)::int AS total
          FROM flop_spots s JOIN hands h ON h.id = s.hand_id
          WHERE (${heroMode}::boolean = false OR (s.owner_id = ${ownerId} AND (s.oop_is_hero OR s.ip_is_hero)))
            AND (${dFrom}::bigint IS NULL OR h.played_at >= ${dFrom}::bigint)
            AND (${dTo}::bigint IS NULL OR h.played_at < ${dTo}::bigint)
            AND (${su('suits')}::text   IS NULL OR s.flop_suits      = ${su('suits')})
            AND (${yn('paired')}::boolean IS NULL OR s.flop_paired   = ${yn('paired')})
            AND (${yn('straight')}::boolean IS NULL OR s.flop_straighty = ${yn('straight')})
            AND (${su('tsuits')}::text  IS NULL OR s.turn_suits      = ${su('tsuits')})
            AND (${yn('tpaired')}::boolean IS NULL OR s.turn_paired  = ${yn('tpaired')})
            AND (${yn('tstraight')}::boolean IS NULL OR s.turn_straighty = ${yn('tstraight')})
            AND (${su('rsuits')}::text  IS NULL OR s.river_suits     = ${su('rsuits')})
            AND (${yn('rpaired')}::boolean IS NULL OR s.river_paired = ${yn('rpaired')})
            AND (${yn('rstraight')}::boolean IS NULL OR s.river_straighty = ${yn('rstraight')})
            AND (${ranks('fh')}::text[] IS NULL OR s.flop_high = ANY(${ranks('fh')}))
            AND (${ranks('fm')}::text[] IS NULL OR s.flop_mid  = ANY(${ranks('fm')}))
            AND (${ranks('fc')}::text[] IS NULL OR s.flop_low  = ANY(${ranks('fc')}))
          GROUP BY s.formation_id
        `
        return Response.json({ counts: rows })
      }
      // Drill-down hands by id (postflop "review these hands"). Order is restored
      // client-side from the requested id list.
      if (view === 'hands-by-id') {
        const ids = (params.get('ids') ?? '').split(',').filter(Boolean)
        if (!ids.length) return Response.json({ hands: [] })
        const rows = await sql`SELECT id, parsed, raw_text, notes FROM hands WHERE id = ANY(${ids}::text[])`
        return Response.json({ hands: rows })
      }
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
      // view=mine → just your hands (the database browser). Capped to the latest
      // N (default 500) so the browser isn't shipped the entire history — each
      // row carries full parsed JSONB + raw_text. default → the whole pool.
      if (view === 'mine') {
        const lim = Math.min(Math.max(parseInt(params.get('limit') ?? '500', 10) || 500, 1), 5000)
        const rows = await sql`
          SELECT parsed, raw_text, notes
          FROM hands
          WHERE owner_id = ${ownerId}
          ORDER BY played_at DESC NULLS LAST, created_at DESC
          LIMIT ${lim}
        `
        return Response.json({ hands: rows })
      }
      const rows = await sql`
        SELECT parsed, raw_text, notes
        FROM hands
        ORDER BY played_at DESC NULLS LAST, created_at DESC
      `
      return Response.json({ hands: rows })
    }

    if (req.method === 'POST') {
      const body = await req.json() as { hands: unknown[]; spots?: unknown[]; flopSpots?: unknown[] }
      const rows = body.hands ?? []
      if (!rows.length) return Response.json({ inserted: 0 })

      // Single round-trip bulk upsert: the whole array goes in as one jsonb
      // param and is expanded into rows by jsonb_to_recordset. owner_id comes
      // from the verified token, never the client payload. RETURNING (xmax = 0)
      // is true for freshly inserted rows, false for conflict-updates, so the
      // client can report new vs duplicate counts.
      const upserted = await sql`
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
        RETURNING (xmax = 0) AS is_new
      ` as { is_new: boolean }[]
      const added = upserted.filter(r => r.is_new).length

      // Rebuild the chunk's preflop spots: clear the prior spots for these hands
      // (so a re-export can't leave stale rows), then bulk-insert the fresh set.
      // Keyed off the chunk's hand ids, so hands that yield zero spots still get
      // cleaned. owner_id is stamped from the token, never the payload.
      if (body.spots !== undefined) {
        const handIds = (rows as { id: string }[]).map(r => r.id)
        await sql`DELETE FROM preflop_spots WHERE hand_id = ANY(${handIds}::text[])`
        const spots = body.spots ?? []
        if (spots.length) {
          await sql`
            INSERT INTO preflop_spots (
              hand_id, table_kind, report_type, pos_a, pos_b, multiway, combo, action, is_hero, stack_bb, key_stack_bb, owner_id
            )
            SELECT x.*, ${ownerId} FROM jsonb_to_recordset(${JSON.stringify(spots)}::jsonb) AS x(
              hand_id text, table_kind text, report_type text, pos_a text, pos_b text, multiway boolean,
              combo text, action text, is_hero boolean, stack_bb numeric, key_stack_bb numeric
            )
          `
        }
      }

      // Same rebuild for the chunk's postflop (flop) spots.
      if (body.flopSpots !== undefined) {
        const handIds = (rows as { id: string }[]).map(r => r.id)
        await sql`DELETE FROM flop_spots WHERE hand_id = ANY(${handIds}::text[])`
        const flopSpots = body.flopSpots ?? []
        if (flopSpots.length) {
          await sql`
            INSERT INTO flop_spots (
              hand_id, formation_id, pot_type, oop_pos, ip_pos, oop_is_hero, ip_is_hero,
              flop_suits, flop_paired, flop_straighty, flop_high, flop_mid, flop_low,
              turn_suits, turn_paired, turn_straighty, river_suits, river_paired, river_straighty,
              spot, owner_id
            )
            SELECT x.*, ${ownerId} FROM jsonb_to_recordset(${JSON.stringify(flopSpots)}::jsonb) AS x(
              hand_id text, formation_id text, pot_type text, oop_pos text, ip_pos text,
              oop_is_hero boolean, ip_is_hero boolean,
              flop_suits text, flop_paired boolean, flop_straighty boolean,
              flop_high text, flop_mid text, flop_low text,
              turn_suits text, turn_paired boolean, turn_straighty boolean,
              river_suits text, river_paired boolean, river_straighty boolean, spot jsonb
            )
          `
        }
      }
      return Response.json({ inserted: rows.length, added, updated: rows.length - added })
    }

    return Response.json({ error: 'method not allowed' }, { status: 405 })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}

// Web Standard `fetch` export so the Node runtime hands us a real Web Request.
export default { fetch: handler }
