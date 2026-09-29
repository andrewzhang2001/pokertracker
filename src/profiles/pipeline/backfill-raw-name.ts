// Populate hand_players.raw_name by re-parsing each hand's raw_text. New
// imports set it in api/profiles.ts commit; this covers rows stamped before
// that column existed. Seats whose raw_text can't be re-parsed stay as they are
// and show under their profile's name.
//
// Default: only rows with raw_name NULL. With --all: every row, overwriting any
// raw_name that disagrees with the hand's own log, and listing each change.
// Both are idempotent.
//
// Reports identities whose seats landed on more than one profile (one person
// mapped differently across imports); moving that identity on its profile page
// reunites them.
//
// Run: npm run backfill-raw-name            (fill missing)
//      npm run backfill-raw-name -- --all   (re-derive every row)
import { neon } from '@neondatabase/serverless'
import { loadConn } from '../../../db/connect'
import { apply, HAND_PLAYERS_ADD_RAW_NAME, HAND_PLAYERS_RAW_NAME_IDX } from '../../../db/schema'
import { seatIdentities } from './seatIdentities'

async function main() {
  const rederiveAll = process.argv.includes('--all')
  const conn = loadConn()
  if (!conn) throw new Error('No DATABASE_URL / POSTGRES_URL found')
  const sql = neon(conn)

  await apply(sql, [HAND_PLAYERS_ADD_RAW_NAME, HAND_PLAYERS_RAW_NAME_IDX])

  // Each hand with at least one seat link to (re)derive.
  const hands = await sql`
    SELECT h.id, h.raw_text
    FROM hands h
    WHERE EXISTS (
      SELECT 1 FROM hand_players hp
      WHERE hp.hand_id = h.id AND (${rederiveAll}::boolean OR hp.raw_name IS NULL)
    )
  ` as { id: string; raw_text: string }[]
  console.log(`loaded ${hands.length} hands with seat links to ${rederiveAll ? 're-derive' : 'fill'}`)

  const updates: { hand_id: string; seat: number; raw_name: string }[] = []
  let unrecovered = 0
  for (const h of hands) {
    const seats = seatIdentities(h.raw_text, h.id)
    if (!seats.size) { unrecovered++; continue }
    for (const [seat, raw_name] of seats) updates.push({ hand_id: h.id, seat, raw_name })
  }
  console.log(`recovered ${updates.length} seat identities; ${unrecovered} hands had none (left as-is)`)

  // Rows whose stored raw_name differs from the log, before → after.
  const changes = new Map<string, number>()
  let written = 0
  const CHUNK = 1000
  for (let i = 0; i < updates.length; i += CHUNK) {
    const slice = updates.slice(i, i + CHUNK)
    const changed = await sql`
      WITH x AS (
        SELECT * FROM jsonb_to_recordset(${JSON.stringify(slice)}::jsonb) AS x(hand_id text, seat int, raw_name text)
      ), before AS (
        SELECT hp.owner_id, hp.hand_id, hp.seat, hp.raw_name AS old_name, x.raw_name AS new_name
        FROM hand_players hp JOIN x ON hp.hand_id = x.hand_id AND hp.seat = x.seat
        WHERE hp.raw_name IS DISTINCT FROM x.raw_name
          AND (${rederiveAll}::boolean OR hp.raw_name IS NULL)
      )
      UPDATE hand_players hp SET raw_name = b.new_name
      FROM before b
      WHERE hp.owner_id = b.owner_id AND hp.hand_id = b.hand_id AND hp.seat = b.seat
      RETURNING b.old_name, b.new_name
    ` as { old_name: string | null; new_name: string }[]
    for (const c of changed) {
      const key = `${c.old_name ?? '(none)'} → ${c.new_name}`
      changes.set(key, (changes.get(key) ?? 0) + 1)
    }
    written += changed.length
    console.log(`checked ${Math.min(i + CHUNK, updates.length)}/${updates.length}, changed ${written}`)
  }

  const overwritten = [...changes].filter(([key]) => !key.startsWith('(none)'))
  console.log(`${written} rows changed; ${overwritten.length ? 'overwritten identities:' : 'no existing identity was wrong'}`)
  for (const [key, n] of overwritten.sort((a, b) => b[1] - a[1])) console.log(`  ${String(n).padStart(5)}  ${key}`)

  const split = await sql`
    SELECT hp.raw_name, array_agg(DISTINCT p.name) AS profiles
    FROM hand_players hp JOIN profiles p ON p.id = hp.profile_id
    WHERE hp.raw_name IS NOT NULL
    GROUP BY hp.owner_id, hp.raw_name
    HAVING count(DISTINCT hp.profile_id) > 1
  ` as { raw_name: string; profiles: string[] }[]
  console.log(`done — ${split.length} identities are split across profiles${split.length ? ':' : ''}`)
  for (const s of split) console.log(`  ${s.raw_name}: ${s.profiles.join(', ')}`)
}

main().catch(e => { console.error(e); process.exit(1) })
