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

const DEFAULT_PAGE_SIZE = 100
// Ceiling on what one request may pull: `parsed` + `raw_text` per hand is heavy,
// and an unbounded limit would reintroduce the truncated-response problem that
// pagination exists to fix.
const MAX_PAGE_SIZE = 500

function clampInt(raw: string | null, min: number, max: number, fallback: number): number {
  const n = Number.parseInt(raw ?? '', 10)
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
}

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
  // analysis.heroVpip promoted to a real column: the database view filters on
  // it while paginating, which can't be done client-side any more.
  await sql`ALTER TABLE hands ADD COLUMN IF NOT EXISTS hero_vpip boolean`
  // Game variant ('nlhe' | 'plo' | 'other'), for the same reason: the database
  // view filters on it while paginating. Mirrors handGame() in src/lib/games.ts.
  await sql`ALTER TABLE hands ADD COLUMN IF NOT EXISTS game text`
  // Matches the keyset order used by every listing query below, so paging deep
  // into a large account stays an index scan instead of a full sort.
  await sql`
    CREATE INDEX IF NOT EXISTS hands_owner_order_idx
    ON hands (owner_id, played_at DESC NULLS LAST, created_at DESC)
  `
  // Empties itself once backfillHeroVpip has run, which is what makes calling
  // that on every request cheap (the planner finds no candidate rows).
  await sql`
    CREATE INDEX IF NOT EXISTS hands_hero_vpip_backfill_idx
    ON hands (owner_id) WHERE hero_vpip IS NULL
  `
  // Same trick for the game column's one-time backfill.
  await sql`
    CREATE INDEX IF NOT EXISTS hands_game_backfill_idx
    ON hands (owner_id) WHERE game IS NULL
  `
}

// Populate hero_vpip for this account's rows that predate the column. Prefers
// the stored analysis blob; rows exported before analyzeHand grew heroVpip
// (see the VPIP-filter commit) have it re-derived from `parsed` with the same
// rule as analyzeHand: any voluntary action by the hero seat, on any street.
async function backfillHeroVpip(ownerId: string) {
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
    WHERE hero_vpip IS NULL AND owner_id = ${ownerId}
  `
}

// Populate `game` for this account's rows exported before the column existed.
// Same rule as handGame() in src/lib/games.ts: the game-type field names the
// variant for cash hands, and tournament headers (whose game type parses empty)
// still carry it in the header line — hence the COALESCE onto raw_text.
async function backfillGame(ownerId: string) {
  await sql`
    UPDATE hands SET game = CASE
      WHEN COALESCE(NULLIF(game_type, ''), left(raw_text, 200)) ILIKE '%omaha%' THEN 'plo'
      WHEN COALESCE(NULLIF(game_type, ''), left(raw_text, 200)) ILIKE '%hold%'  THEN 'nlhe'
      ELSE 'other'
    END
    WHERE game IS NULL AND owner_id = ${ownerId}
  `
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
      // Lightweight graph feed: YOUR own result numbers, oldest first.
      // `game` rides along per row rather than being filtered here: the feed is
      // four numbers a hand, so the client can switch variants without a
      // round-trip (and count the hands in each to build the filter).
      if (view === 'graph') {
        await backfillGame(ownerId)
        const rows = await sql`
          SELECT played_at, net_bb, adj_net_bb, rake_bb, game
          FROM hands
          WHERE net_bb IS NOT NULL AND owner_id = ${ownerId}
          ORDER BY played_at ASC NULLS LAST, created_at ASC
        `
        return Response.json({ rows })
      }
      // Paged slice of YOUR hands for the database browser: a `limit` opts into
      // pagination, and the VPIP + game filters are applied in SQL so the page is
      // a page of *matching* hands and the counts describe the whole filtered set.
      // Without `limit` the queries below stay unpaginated for the aggregate
      // consumers (Leakbuster / Reports / Postflop), which need every hand.
      if (view === 'mine' && params.has('limit')) {
        await backfillHeroVpip(ownerId)
        await backfillGame(ownerId)
        const limit = clampInt(params.get('limit'), 1, MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE)
        const offset = clampInt(params.get('offset'), 0, Number.MAX_SAFE_INTEGER, 0)
        // null = no VPIP filter; true/false = keep only that bucket.
        const vpip = params.get('vpip')
        const want = vpip === 'yes' ? true : vpip === 'no' ? false : null
        // null = every variant; otherwise one of nlhe / plo / other.
        const gameParam = params.get('game')
        const game = gameParam === 'nlhe' || gameParam === 'plo' || gameParam === 'other' ? gameParam : null

        // One pass gives the unfiltered total, the size of the filtered set, and
        // each variant's size, so the client can render "matching / total" and
        // the game pills without extra round-trips. The per-variant counts honour
        // the VPIP filter but not the game filter — they're what you'd get by
        // switching to that variant, so they must not shrink when one is picked.
        const [counts] = await sql`
          SELECT count(*)::int AS total,
                 count(*) FILTER (WHERE ${want}::boolean IS NULL
                                    OR (hero_vpip IS TRUE) = ${want}::boolean)::int AS vpip_matching,
                 count(*) FILTER (WHERE (${want}::boolean IS NULL OR (hero_vpip IS TRUE) = ${want}::boolean)
                                    AND game = 'nlhe')::int AS nlhe,
                 count(*) FILTER (WHERE (${want}::boolean IS NULL OR (hero_vpip IS TRUE) = ${want}::boolean)
                                    AND game = 'plo')::int AS plo,
                 count(*) FILTER (WHERE (${want}::boolean IS NULL OR (hero_vpip IS TRUE) = ${want}::boolean)
                                    AND (game IS NULL OR game NOT IN ('nlhe', 'plo')))::int AS other
          FROM hands WHERE owner_id = ${ownerId}
        ` as { total: number; vpip_matching: number; nlhe: number; plo: number; other: number }[]
        const total = counts?.total ?? 0
        const games = { nlhe: counts?.nlhe ?? 0, plo: counts?.plo ?? 0, other: counts?.other ?? 0 }
        // Hands matching *both* filters — i.e. exactly what gets paginated.
        const filtered = game === null ? (counts?.vpip_matching ?? 0) : games[game]

        const rows = await sql`
          SELECT parsed, raw_text, notes
          FROM hands
          WHERE owner_id = ${ownerId}
            AND (${want}::boolean IS NULL OR (hero_vpip IS TRUE) = ${want}::boolean)
            AND (${game}::text IS NULL OR COALESCE(game, 'other') = ${game}::text)
          ORDER BY played_at DESC NULLS LAST, created_at DESC
          LIMIT ${limit} OFFSET ${offset}
        `
        return Response.json({ hands: rows, total, filtered, games, limit, offset })
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
          played_at, hero_position, net_bb, adj_net_bb, rake_bb, pot_type, hero_vpip, game, analysis, parsed, raw_text, notes, owner_id
        )
        SELECT x.*, ${ownerId} FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb) AS x(
          id text, site text, game_type text, table_size int, small_blind numeric,
          big_blind numeric, currency text, played_at bigint, hero_position text,
          net_bb numeric, adj_net_bb numeric, rake_bb numeric, pot_type text, hero_vpip boolean, game text, analysis jsonb, parsed jsonb, raw_text text, notes text
        )
        ON CONFLICT (id) DO UPDATE SET
          hero_vpip     = EXCLUDED.hero_vpip,
          game          = EXCLUDED.game,
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

// Web Standard `fetch` export so the Node runtime hands us a real Web Request.
export default { fetch: handler }
