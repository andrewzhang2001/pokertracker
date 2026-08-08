// One-time: materialize flop_spots for every hand already in the DB (new exports
// populate it automatically via api/hands.ts). Re-derives each hand from raw_text
// and runs the same slimFlopSpot the client uses, then full-rebuilds the table.
// Idempotent — safe to re-run.
//
// Run: node_modules/.bin/esbuild scripts/backfill-flop-spots.ts --bundle --platform=node \
//        --format=esm --external:@neondatabase/serverless --outfile=<tmp>.mjs && node <tmp>.mjs
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { parseHandHistories } from '../src/lib/parseHandHistory'
import { slimFlopSpot } from '../src/lib/canonicalFlopSpots'

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
  await sql`ALTER TABLE flop_spots ADD COLUMN IF NOT EXISTS game text`
  await sql`CREATE INDEX IF NOT EXISTS flop_spots_formation ON flop_spots (formation_id)`

  const rows = await sql`SELECT id, raw_text, owner_id FROM hands` as { id: string; raw_text: string; owner_id: string | null }[]
  console.log(`loaded ${rows.length} hands`)

  // owner_id carried from the hand (the API stamps it from the token on live
  // exports), so the hero-mode counts query works after the backfill.
  const spots: unknown[] = []
  let failed = 0, noFormation = 0
  for (const r of rows) {
    const parsed = parseHandHistories(r.raw_text)
    if (!parsed[0]) { failed++; continue }
    const slim = slimFlopSpot(parsed[0])
    if (!slim) { noFormation++; continue }
    spots.push({ ...slim, owner_id: r.owner_id })
  }
  console.log(`extracted ${spots.length} flop spots (parse-failed ${failed}, no-formation/not-HU ${noFormation})`)

  await sql`DELETE FROM flop_spots`
  const CHUNK = 1000
  let done = 0
  for (let i = 0; i < spots.length; i += CHUNK) {
    const batch = spots.slice(i, i + CHUNK)
    await sql`
      INSERT INTO flop_spots (
        hand_id, game, formation_id, pot_type, oop_pos, ip_pos, oop_is_hero, ip_is_hero,
        flop_suits, flop_paired, flop_straighty, flop_high, flop_mid, flop_low,
        turn_suits, turn_paired, turn_straighty, river_suits, river_paired, river_straighty,
        spot, owner_id)
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS x(
        hand_id text, game text, formation_id text, pot_type text, oop_pos text, ip_pos text,
        oop_is_hero boolean, ip_is_hero boolean,
        flop_suits text, flop_paired boolean, flop_straighty boolean,
        flop_high text, flop_mid text, flop_low text,
        turn_suits text, turn_paired boolean, turn_straighty boolean,
        river_suits text, river_paired boolean, river_straighty boolean, spot jsonb, owner_id text)`
    done += batch.length
    console.log(`inserted ${done}/${spots.length}`)
  }

  const summ = await sql`SELECT game, formation_id, count(*)::int AS spots FROM flop_spots GROUP BY game, formation_id ORDER BY game, formation_id`
  console.log('summary:', summ)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
