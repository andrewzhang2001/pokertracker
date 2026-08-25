// One-time: materialize flop_spots for every hand already in the DB (new exports
// populate it automatically via api/hands.ts). Re-derives each hand from raw_text
// and runs the same slimFlopSpot the client uses, then full-rebuilds the table.
// Idempotent — safe to re-run.
//
// Run: npm run backfill-postflop
import { neon } from '@neondatabase/serverless'
import { loadConn } from '../../../db/connect'
import { apply, FLOP_SPOTS } from '../../../db/schema'
import { parseHandHistories } from '../../shared/poker/parsers'
import { slimFlopSpot } from '../../shared/poker/canonicalFlopSpots'


async function main() {
  const conn = loadConn()
  if (!conn) throw new Error('No DATABASE_URL / POSTGRES_URL found')
  const sql = neon(conn)

  await apply(sql, FLOP_SPOTS)

  await sql`DELETE FROM flop_spots`

  // Keyset paging, for the same reason as backfill-preflop-spots.ts: selecting
  // raw_text for every hand in one statement exceeds Neon's 64MB response cap.
  const PAGE = 500
  const CHUNK = 1000
  let lastId = ''
  let hands = 0, spotsTotal = 0, failed = 0, noFormation = 0

  for (;;) {
    const rows = await sql`
      SELECT id, raw_text, owner_id FROM hands
      WHERE id > ${lastId}
      ORDER BY id
      LIMIT ${PAGE}
    ` as { id: string; raw_text: string; owner_id: string | null }[]
    if (!rows.length) break
    lastId = rows[rows.length - 1].id

    // owner_id carried from the hand (the API stamps it from the token on live
    // exports), so the hero-mode counts query works after the backfill.
    const spots: unknown[] = []
    for (const r of rows) {
      const parsed = parseHandHistories(r.raw_text)
      if (!parsed[0]) { failed++; continue }
      const slim = slimFlopSpot(parsed[0])
      if (!slim) { noFormation++; continue }
      spots.push({ ...slim, owner_id: r.owner_id })
    }

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
    }

    hands += rows.length
    spotsTotal += spots.length
    console.log(`${hands} hands → ${spotsTotal} flop spots`)
  }
  console.log(`extracted ${spotsTotal} flop spots from ${hands} hands (parse-failed ${failed}, no-formation/not-HU ${noFormation})`)

  const summ = await sql`SELECT game, formation_id, count(*)::int AS spots FROM flop_spots GROUP BY game, formation_id ORDER BY game, formation_id`
  console.log('summary:', summ)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
