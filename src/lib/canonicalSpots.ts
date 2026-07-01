import type { ParsedHand } from './types'
import { ploCombo } from './ploCombo'
import { tableKind, type TableKind } from './positionUtils'
import {
  rfiSpots, vsRfiSpots, vs3betSpots, limpVsIsoSpots,
} from './reports'

// ---------------------------------------------------------------------------
// Materialized preflop spots. Each ParsedHand is flattened into the rows the
// `preflop_spots` table stores, so reports become a server-side GROUP BY over
// (report_type, position, combo, action) instead of re-deriving every spot in
// the browser. The spot logic itself is NOT reimplemented — this reuses the
// existing extractors in reports.ts verbatim, just projecting each spot onto the
// flat column shape. Stacks are stored raw (not pre-filtered by MIN_BB) so the
// depth threshold can change without re-materializing.
// ---------------------------------------------------------------------------

export type PreflopReportType = 'rfi' | 'vsrfi' | 'vs3bet' | 'limpiso'

// snake_case keys match the SQL columns so the API can insert via
// jsonb_to_recordset without remapping (same convention as canonicalHand.ts).
export interface PreflopSpotRow {
  hand_id: string
  table_kind: TableKind      // 'hu' (2 seats) vs 'sixmax' — keeps the two populations separate
  report_type: PreflopReportType
  pos_a: string              // rfi: displayPos · vsrfi: defender · vs3bet/limpiso: opener / iso tag
  pos_b: string | null       // vsrfi: opener · vs3bet: ip/oop/bb tag · else null
  multiway: boolean | null   // limpiso only (≥2 limpers before the iso)
  combo: string | null       // ploCombo(cards); null when cards unknown / unparsable
  action: string             // raw extractor action key: raise/limp/call/fold
  is_hero: boolean           // the decision-maker was the hand's owner
  stack_bb: number           // acting player's starting stack (bb)
  key_stack_bb: number       // the effective-stack partner (bb): BB / opener / iso raiser
}

const comboOf = (cards: { rank: string; suit: string }[] | null): string | null => {
  if (!cards) return null
  const c = ploCombo(cards as Parameters<typeof ploCombo>[0])
  return c || null
}

// Some extractors use Infinity for a missing partner stack (e.g. rfiSpots when
// the table has no Big Blind seat), which clears the MIN_BB depth filter in the
// JS reports. JSON.stringify turns Infinity into null, which would instead FAIL
// the SQL `>= MIN_BB` filter — so map non-finite stacks to a large finite
// sentinel that still passes the threshold, preserving parity.
const stack = (v: number): number => (Number.isFinite(v) ? v : 1e9)

export function spotsForHand(hand: ParsedHand): PreflopSpotRow[] {
  const rows: PreflopSpotRow[] = []
  const kind = tableKind(hand.players.length)

  for (const s of rfiSpots(hand)) {
    rows.push({
      hand_id: s.handId, table_kind: kind, report_type: 'rfi', pos_a: s.displayPos, pos_b: null, multiway: null,
      combo: comboOf(s.cards), action: s.action, is_hero: s.isHero,
      stack_bb: stack(s.stackBB), key_stack_bb: stack(s.bbStackBB),
    })
  }
  for (const s of vsRfiSpots(hand)) {
    rows.push({
      hand_id: s.handId, table_kind: kind, report_type: 'vsrfi', pos_a: s.defenderPos, pos_b: s.openerPos, multiway: null,
      combo: comboOf(s.cards), action: s.action, is_hero: s.isHero,
      stack_bb: stack(s.stackBB), key_stack_bb: stack(s.openerStackBB),
    })
  }
  for (const s of vs3betSpots(hand)) {
    rows.push({
      hand_id: s.handId, table_kind: kind, report_type: 'vs3bet', pos_a: s.openerPos, pos_b: s.tag, multiway: null,
      combo: comboOf(s.cards), action: s.action, is_hero: s.isHero,
      stack_bb: stack(s.stackBB), key_stack_bb: stack(s.threeBettorStackBB),
    })
  }
  for (const s of limpVsIsoSpots(hand)) {
    rows.push({
      hand_id: s.handId, table_kind: kind, report_type: 'limpiso', pos_a: s.tag, pos_b: null, multiway: s.multiway,
      combo: comboOf(s.cards), action: s.action, is_hero: s.isHero,
      stack_bb: stack(s.stackBB), key_stack_bb: stack(s.isoStackBB),
    })
  }

  return rows
}
