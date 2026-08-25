// Re-derive everything from the source of truth. For every hand, re-parse its
// raw_text with the current parser, overlay the hero seat from hand_players
// (PokerNow's hero can't be re-identified from a single hand — it's detected
// globally at import — so we trust the stored is_hero), then rebuild the hand's
// derived row (parsed / analysis / net / pot type / hero position) and its
// preflop_spots + flop_spots.
//
// Use this after a parser or schema change instead of re-importing. It's
// non-destructive to hands whose raw_text can't be re-parsed (e.g. PokerNow rows
// stored before raw_text became a faithful CSV — those still need a re-import).
// The mapping in hand_players (profile_id, net_bb) is left untouched.
//
// Run: npm run backfill-reparse
import { neon } from '@neondatabase/serverless'
import { loadConn } from '../connect'
import { parseHandHistories } from '../../src/shared/poker/parsers'
import { canonicalizeHand } from '../../src/shared/poker/canonicalHand'
import { spotsForHand } from '../../src/shared/poker/canonicalSpots'
import { slimFlopSpot } from '../../src/shared/poker/canonicalFlopSpots'


async function main() {
  const conn = loadConn()
  if (!conn) throw new Error('No DATABASE_URL / POSTGRES_URL found')
  const sql = neon(conn)

  // Hero seat per hand (PokerNow; Ignition marks [ME] in raw_text so it needs no
  // overlay). Table may not exist on a fresh DB — fall back to no overlay.
  const heroSeat = new Map<string, number>()
  try {
    const hp = await sql`SELECT hand_id, seat FROM hand_players WHERE is_hero = true` as { hand_id: string; seat: number }[]
    for (const r of hp) heroSeat.set(r.hand_id, Number(r.seat))
  } catch { /* hand_players not present */ }

  const rows = await sql`SELECT id, raw_text, owner_id FROM hands` as { id: string; raw_text: string; owner_id: string | null }[]
  console.log(`loaded ${rows.length} hands, ${heroSeat.size} with a stored hero seat`)

  const handUpdates: Record<string, unknown>[] = []
  const preflop: unknown[] = []
  const flop: unknown[] = []
  const doneIds: string[] = []
  let failed = 0

  for (const r of rows) {
    const parsed = parseHandHistories(r.raw_text)
    const hand = parsed[0]
    if (!hand) { failed++; continue }

    // Overlay the authoritative hero seat when we have one.
    const hs = heroSeat.get(r.id)
    if (hs !== undefined) for (const p of hand.players) p.isMe = p.seatNumber === hs

    const row = canonicalizeHand(hand)
    handUpdates.push({
      id: r.id, parsed: row.parsed, analysis: row.analysis, net_bb: row.net_bb,
      adj_net_bb: row.adj_net_bb, rake_bb: row.rake_bb, pot_type: row.pot_type,
      hero_position: row.hero_position, game_type: row.game_type, played_at: row.played_at,
      small_blind: row.small_blind, big_blind: row.big_blind, currency: row.currency, table_size: row.table_size,
    })
    for (const s of spotsForHand(hand)) preflop.push({ ...s, owner_id: r.owner_id })
    const slim = slimFlopSpot(hand)
    if (slim) flop.push({ ...slim, owner_id: r.owner_id })
    doneIds.push(r.id)
  }
  console.log(`re-parsed ${doneIds.length} (failed/unparseable ${failed}) → ${preflop.length} preflop, ${flop.length} flop spots`)

  const CHUNK = 1000
  const chunk = <T>(a: T[], f: (b: T[]) => Promise<void>) => (async () => {
    for (let i = 0; i < a.length; i += CHUNK) { await f(a.slice(i, i + CHUNK)); console.log(`  …${Math.min(i + CHUNK, a.length)}/${a.length}`) }
  })()

  // 1) Update the derived columns on each re-parsed hand (raw_text/owner/notes untouched).
  console.log('updating hands…')
  await chunk(handUpdates, async batch => {
    await sql`
      UPDATE hands h SET
        parsed = x.parsed, analysis = x.analysis, net_bb = x.net_bb, adj_net_bb = x.adj_net_bb,
        rake_bb = x.rake_bb, pot_type = x.pot_type, hero_position = x.hero_position,
        game_type = x.game_type, played_at = x.played_at, small_blind = x.small_blind,
        big_blind = x.big_blind, currency = x.currency, table_size = x.table_size
      FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS x(
        id text, parsed jsonb, analysis jsonb, net_bb numeric, adj_net_bb numeric, rake_bb numeric,
        pot_type text, hero_position text, game_type text, played_at bigint, small_blind numeric,
        big_blind numeric, currency text, table_size int)
      WHERE h.id = x.id`
  })

  // 2) Rebuild spots only for the hands we re-parsed (leave others' spots intact).
  console.log('rebuilding preflop_spots…')
  await sql`DELETE FROM preflop_spots WHERE hand_id = ANY(${doneIds}::text[])`
  await chunk(preflop, async batch => {
    await sql`
      INSERT INTO preflop_spots (
        hand_id, game, table_kind, report_type, pos_a, pos_b, multiway, combo, action, is_hero, stack_bb, key_stack_bb, owner_id)
      SELECT * FROM jsonb_to_recordset(${JSON.stringify(batch)}::jsonb) AS x(
        hand_id text, game text, table_kind text, report_type text, pos_a text, pos_b text, multiway boolean,
        combo text, action text, is_hero boolean, stack_bb numeric, key_stack_bb numeric, owner_id text)`
  })

  console.log('rebuilding flop_spots…')
  await sql`DELETE FROM flop_spots WHERE hand_id = ANY(${doneIds}::text[])`
  await chunk(flop, async batch => {
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
  })

  console.log(`done — updated ${doneIds.length} hands, ${failed} left as-is (re-import needed)`)
}

main().then(() => process.exit(0)).catch(e => { console.error(e); process.exit(1) })
