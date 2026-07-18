// One-time: populate hand_players.net_bb for rows stamped before that column
// existed (new imports set it in api/profiles.ts commit). Net is each seat's
// stack delta — it depends only on betting/result actions + starting stacks, all
// present in hands.parsed, so no re-parse of the original CSV is needed and the
// value is correct even for hands parsed by older code. Idempotent.
//
// Run: node_modules/.bin/esbuild scripts/backfill-hand-net.ts --bundle --platform=node \
//        --format=esm --external:@neondatabase/serverless --outfile=<tmp>.mjs && node <tmp>.mjs
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'
import { rowToParsedHand } from '../src/lib/canonicalHand'
import { netForSeat } from '../src/lib/graph'
import type { ParsedHand } from '../src/lib/types'

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

  await sql`ALTER TABLE hand_players ADD COLUMN IF NOT EXISTS net_bb numeric`

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
