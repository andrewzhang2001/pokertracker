// One-time: populate hand_players.net_bb for rows stamped before that column
// existed (new imports set it in api/profiles.ts commit). Net is each seat's
// stack delta — it depends only on betting/result actions + starting stacks, all
// present in hands.parsed, so no re-parse of the original CSV is needed and the
// value is correct even for hands parsed by older code. Idempotent.
//
// Run: npm run backfill-net
import { neon } from '@neondatabase/serverless'
import { loadConn } from '../../../db/connect'
import { apply, HAND_PLAYERS_ADD_NET_BB } from '../../../db/schema'
import { rowToParsedHand } from '../../shared/poker/canonicalHand'
import { netForSeat } from '../../shared/poker/graph'
import type { ParsedHand } from '../../shared/poker/types'


async function main() {
  const conn = loadConn()
  if (!conn) throw new Error('No DATABASE_URL / POSTGRES_URL found')
  const sql = neon(conn)

  await apply(sql, [HAND_PLAYERS_ADD_NET_BB])

  // Every seat link + its hand's parsed blob. Only rows missing net_bb, so a
  // re-run is cheap.
  const rows = await sql`
    SELECT hp.owner_id, hp.hand_id, hp.seat, h.parsed
    FROM hand_players hp JOIN hands h ON h.id = hp.hand_id
    WHERE hp.net_bb IS NULL
  ` as { owner_id: string; hand_id: string; seat: number; parsed: Omit<ParsedHand, 'rawText'> }[]
  console.log(`loaded ${rows.length} seat links needing net_bb`)

  const updates: { owner_id: string; hand_id: string; seat: number; net_bb: number }[] = []
  let failed = 0
  for (const r of rows) {
    try {
      const hand = rowToParsedHand({ parsed: r.parsed })
      updates.push({ owner_id: r.owner_id, hand_id: r.hand_id, seat: Number(r.seat), net_bb: netForSeat(hand, Number(r.seat)) })
    } catch { failed++ }
  }

  // One bulk UPDATE … FROM jsonb_to_recordset, in chunks to keep the payload sane.
  const CHUNK = 1000
  let done = 0
  for (let i = 0; i < updates.length; i += CHUNK) {
    const slice = updates.slice(i, i + CHUNK)
    await sql`
      UPDATE hand_players hp SET net_bb = x.net_bb
      FROM jsonb_to_recordset(${JSON.stringify(slice)}::jsonb)
        AS x(owner_id text, hand_id text, seat int, net_bb numeric)
      WHERE hp.owner_id = x.owner_id AND hp.hand_id = x.hand_id AND hp.seat = x.seat
    `
    done += slice.length
    console.log(`updated ${done}/${updates.length}`)
  }
  console.log(`done — ${done} updated${failed ? `, ${failed} failed to parse` : ''}`)
}

main().catch(e => { console.error(e); process.exit(1) })
