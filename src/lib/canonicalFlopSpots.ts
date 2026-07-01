import type { ParsedHand } from './types'
import { gameKind, type GameKind } from './games'
import { extractFlopSpot, FORMATIONS, type FlopSpot } from './postflop'

// ---------------------------------------------------------------------------
// Materialized postflop spots. One slim FlopSpot per heads-up SRP/3BP hand,
// stored in `flop_spots` so the postflop views load a single formation's spots
// (and run the existing node-walk client-side) instead of shipping the whole
// hand pool. The spot logic is NOT reimplemented — this reuses extractFlopSpot
// verbatim, drops the heavy `hand` field (drill-down fetches hands by id), and
// denormalizes the board texture into columns for the per-formation counts query.
// ---------------------------------------------------------------------------

// snake_case keys match the SQL columns so the API can insert via
// jsonb_to_recordset without remapping (same convention as canonicalHand.ts).
export interface FlopSpotRow {
  hand_id: string
  game: GameKind      // 'plo' | 'nlhe' — filters the postflop views by game
  formation_id: string
  pot_type: string
  oop_pos: string
  ip_pos: string
  oop_is_hero: boolean
  ip_is_hero: boolean
  flop_suits: string
  flop_paired: boolean
  flop_straighty: boolean
  flop_high: string | null
  flop_mid: string | null
  flop_low: string | null
  turn_suits: string | null
  turn_paired: boolean | null
  turn_straighty: boolean | null
  river_suits: string | null
  river_paired: boolean | null
  river_straighty: boolean | null
  spot: Omit<FlopSpot, 'hand'>   // the slim spot the node-walk runs on
}

// (pot type, OOP pos, IP pos) → the one formation it belongs to, using the same
// role test as filterFormation. Returns undefined for spots outside every
// formation's roles (those are never shown, so they're skipped entirely).
function formationIdFor(potType: string, oopPos: string, ipPos: string): string | undefined {
  return FORMATIONS.find(f => f.potType === potType && f.oopRoles.includes(oopPos) && f.ipRoles.includes(ipPos))?.id
}

export function slimFlopSpot(hand: ParsedHand): FlopSpotRow | null {
  const spot = extractFlopSpot(hand)
  if (!spot) return null
  const formationId = formationIdFor(spot.potType, spot.oopPos, spot.ipPos)
  if (!formationId) return null

  const { hand: _omit, ...slim } = spot
  return {
    hand_id: spot.handId,
    game: gameKind(hand.gameType),
    formation_id: formationId,
    pot_type: spot.potType,
    oop_pos: spot.oopPos,
    ip_pos: spot.ipPos,
    oop_is_hero: spot.oopIsHero,
    ip_is_hero: spot.ipIsHero,
    flop_suits: spot.texture.suits,
    flop_paired: spot.texture.paired,
    flop_straighty: spot.straighty,
    flop_high: spot.flopRanks[0] ?? null,
    flop_mid: spot.flopRanks[1] ?? null,
    flop_low: spot.flopRanks[2] ?? null,
    turn_suits: spot.turnSuits ?? null,
    turn_paired: spot.turnPaired ?? null,
    turn_straighty: spot.turnStraighty ?? null,
    river_suits: spot.riverSuits ?? null,
    river_paired: spot.riverPaired ?? null,
    river_straighty: spot.riverStraighty ?? null,
    spot: slim,
  }
}
