// One-off backfill: re-parse every stored hand's raw_text and re-upsert so the
// derived columns (net_bb, adj_net_bb, rake_bb) and parsed JSON are refreshed.
// Run: node_modules/.bin/esbuild scripts/backfill.ts --bundle --platform=node \
//        --format=esm --external:@neondatabase/serverless --outfile=<tmp>.mjs && node <tmp>.mjs
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { parseHandHistories } from '../src/lib/parseHandHistory'
import { canonicalizeHand } from '../src/lib/canonicalHand'

function loadConn(): string {
  let conn = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL_UNPOOLED || ''
  if (!conn) {
    const env = readFileSync('.env.local', 'utf8')
    for (const key of ['DATABASE_URL', 'POSTGRES_URL', 'DATABASE_URL_UNPOOLED']) {
      const m = env.match(new RegExp(`^${key}=(.*)$`, 'm'))
      if (m) { conn = m[1].trim().replace(/^["']|["']$/g, ''); break }
    }
  }
  return conn
}

async function main() {
  const conn = loadConn()
  if (!conn) throw new Error('No DATABASE_URL / POSTGRES_URL found')
  const sql = neon(conn)

  await sql`ALTER TABLE hands ADD COLUMN IF NOT EXISTS adj_net_bb numeric`
  await sql`ALTER TABLE hands ADD COLUMN IF NOT EXISTS rake_bb numeric`

  const rows = await sql`SELECT id, raw_text, notes FROM hands` as { id: string; raw_text: string; notes: string | null }[]
  console.log(`loaded ${rows.length} hands`)

  const recomputed: unknown[] = []
  let failed = 0
  for (const r of rows) {
    const parsed = parseHandHistories(r.raw_text)
    if (!parsed[0]) { failed++; continue }
    recomputed.push(canonicalizeHand(parsed[0], r.notes ?? undefined))
  }
  console.log(`recomputed ${recomputed.length} (parse-failed ${failed})`)

  const CHUNK = 500
  let done = 0
  for (let i = 0; i < recomputed.length; i += CHUNK) {
    const batch = recomputed.slice(i, i + CHUNK)
    await sql`
      INSERT INTO hands (
        id, site, game_type, table_size, small_blind, big_blind, currency,
        played_at, hero_position, net_bb, adj_net_bb, rake_bb, pot_type, analysis, parsed, raw_text, notes)
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS x(
        id text, site text, game_type text, table_size int, small_blind numeric,
        big_blind numeric, currency text, played_at bigint, hero_position text,
        net_bb numeric, adj_net_bb numeric, rake_bb numeric, pot_type text, analysis jsonb, parsed jsonb, raw_text text, notes text)
      ON CONFLICT (id) DO UPDATE SET
        analysis = EXCLUDED.analysis, parsed = EXCLUDED.parsed, raw_text = EXCLUDED.raw_text,
        net_bb = EXCLUDED.net_bb, adj_net_bb = EXCLUDED.adj_net_bb, rake_bb = EXCLUDED.rake_bb,
        pot_type = EXCLUDED.pot_type, played_at = EXCLUDED.played_at,
        hero_position = EXCLUDED.hero_position, notes = COALESCE(EXCLUDED.notes, hands.notes)`
    done += batch.length
    console.log(`upserted ${done}/${recomputed.length}`)
  }

  const summ = await sql`
    SELECT count(*) AS total,
           count(*) FILTER (WHERE adj_net_bb IS NOT NULL) AS with_adj,
           count(*) FILTER (WHERE rake_bb > 0) AS raked,
           round(sum(rake_bb)::numeric, 1) AS total_rake_bb,
           count(*) FILTER (WHERE adj_net_bb IS DISTINCT FROM net_bb) AS allin_adjusted
    FROM hands`
  console.log('summary:', summ[0])
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
