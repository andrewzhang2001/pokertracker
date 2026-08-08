// One-time: materialize preflop_spots for every hand already in the DB (new
// exports populate it automatically via api/hands.ts). Re-derives each hand from
// raw_text and runs the same spot extractor the client uses, then full-rebuilds
// the table. Idempotent — safe to re-run.
//
// Run: node_modules/.bin/esbuild scripts/backfill-spots.ts --bundle --platform=node \
//        --format=esm --external:@neondatabase/serverless --outfile=<tmp>.mjs && node <tmp>.mjs
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { parseHandHistories } from '../src/lib/parseHandHistory'
import { spotsForHand } from '../src/lib/canonicalSpots'

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

  // Same DDL as api/hands.ts ensureTable(), so the script can run standalone.
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
  await sql`ALTER TABLE preflop_spots ADD COLUMN IF NOT EXISTS table_kind text`
  await sql`ALTER TABLE preflop_spots ADD COLUMN IF NOT EXISTS game text`
  await sql`ALTER TABLE preflop_spots ADD COLUMN IF NOT EXISTS faced_bb numeric`
  await sql`ALTER TABLE preflop_spots ADD COLUMN IF NOT EXISTS size_bucket text`
  await sql`CREATE INDEX IF NOT EXISTS preflop_spots_lookup ON preflop_spots (game, table_kind, report_type, pos_a, pos_b, is_hero)`
  await sql`CREATE INDEX IF NOT EXISTS preflop_spots_hand ON preflop_spots (hand_id)`

  const rows = await sql`SELECT id, raw_text, owner_id FROM hands` as { id: string; raw_text: string; owner_id: string | null }[]
  console.log(`loaded ${rows.length} hands`)

  // owner_id is carried from the hand (the API stamps it from the token on live
  // exports), so the grid's hero/owner accounting works after the backfill.
  const spots: unknown[] = []
  let failed = 0
  for (const r of rows) {
    const parsed = parseHandHistories(r.raw_text)
    if (!parsed[0]) { failed++; continue }
    for (const s of spotsForHand(parsed[0])) spots.push({ ...s, owner_id: r.owner_id })
  }
  console.log(`extracted ${spots.length} spots (parse-failed ${failed})`)

  await sql`DELETE FROM preflop_spots`
  const CHUNK = 1000
  let done = 0
  for (let i = 0; i < spots.length; i += CHUNK) {
    const batch = spots.slice(i, i + CHUNK)
    await sql`
      INSERT INTO preflop_spots (
        hand_id, game, table_kind, report_type, pos_a, pos_b, multiway, combo, action, is_hero, stack_bb, key_stack_bb, faced_bb, size_bucket, owner_id)
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS x(
        hand_id text, game text, table_kind text, report_type text, pos_a text, pos_b text, multiway boolean,
        combo text, action text, is_hero boolean, stack_bb numeric, key_stack_bb numeric, faced_bb numeric, size_bucket text, owner_id text)`
    done += batch.length
    console.log(`inserted ${done}/${spots.length}`)
  }

  const summ = await sql`
    SELECT game, table_kind, report_type, count(*) AS spots,
           count(*) FILTER (WHERE stack_bb >= 75 AND key_stack_bb >= 75) AS deep
    FROM preflop_spots GROUP BY game, table_kind, report_type ORDER BY game, table_kind, report_type`
  console.log('summary:', summ)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
