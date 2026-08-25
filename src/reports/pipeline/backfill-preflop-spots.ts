// One-time: materialize preflop_spots for every hand already in the DB (new
// exports populate it automatically via api/hands.ts). Re-derives each hand from
// raw_text and runs the same spot extractor the client uses, then full-rebuilds
// the table. Idempotent — safe to re-run.
//
// Run: npm run backfill-preflop
import { neon } from '@neondatabase/serverless'
import { loadConn } from '../../../db/connect'
import { apply, PREFLOP_SPOTS } from '../../../db/schema'
import { parseHandHistories } from '../../shared/poker/parsers'
import { spotsForHand } from '../../shared/poker/canonicalSpots'


async function main() {
  const conn = loadConn()
  if (!conn) throw new Error('No DATABASE_URL / POSTGRES_URL found')
  const sql = neon(conn)

  await apply(sql, PREFLOP_SPOTS)

  await sql`DELETE FROM preflop_spots`

  // Hands are read in keyset pages. Selecting raw_text for the whole table at
  // once is what trips Neon's 64MB response cap (HTTP 507) — the same failure
  // this materialization exists to remove, so the rebuild must not reintroduce
  // it. Each page is extracted and inserted before the next is fetched, which
  // also keeps peak memory flat regardless of table size.
  const PAGE = 500
  const CHUNK = 1000
  let lastId = ''
  let hands = 0, spotsTotal = 0, failed = 0

  for (;;) {
    const rows = await sql`
      SELECT id, raw_text, owner_id FROM hands
      WHERE id > ${lastId}
      ORDER BY id
      LIMIT ${PAGE}
    ` as { id: string; raw_text: string; owner_id: string | null }[]
    if (!rows.length) break
    lastId = rows[rows.length - 1].id

    // owner_id is carried from the hand (the API stamps it from the token on
    // live exports), so the grid's hero/owner accounting works after the
    // backfill.
    const spots: unknown[] = []
    for (const r of rows) {
      const parsed = parseHandHistories(r.raw_text)
      if (!parsed[0]) { failed++; continue }
      for (const s of spotsForHand(parsed[0])) spots.push({ ...s, owner_id: r.owner_id })
    }

    for (let i = 0; i < spots.length; i += CHUNK) {
      const batch = spots.slice(i, i + CHUNK)
      await sql`
        INSERT INTO preflop_spots (
          hand_id, game, table_kind, report_type, pos_a, pos_b, multiway, combo, action, is_hero, stack_bb, key_stack_bb, faced_bb, size_bucket, owner_id)
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS x(
          hand_id text, game text, table_kind text, report_type text, pos_a text, pos_b text, multiway boolean,
          combo text, action text, is_hero boolean, stack_bb numeric, key_stack_bb numeric, faced_bb numeric, size_bucket text, owner_id text)`
    }

    hands += rows.length
    spotsTotal += spots.length
    console.log(`${hands} hands → ${spotsTotal} spots`)
  }
  console.log(`extracted ${spotsTotal} spots from ${hands} hands (parse-failed ${failed})`)

  const summ = await sql`
    SELECT game, table_kind, report_type, count(*) AS spots,
           count(*) FILTER (WHERE stack_bb >= 75 AND key_stack_bb >= 75) AS deep
    FROM preflop_spots GROUP BY game, table_kind, report_type ORDER BY game, table_kind, report_type`
  console.log('summary:', summ)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
