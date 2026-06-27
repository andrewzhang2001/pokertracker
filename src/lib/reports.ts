import type { ParsedHand, ParsedCard } from './types'
import { displayPosition } from './positionUtils'

// ---------------------------------------------------------------------------
// Population reports. These aggregate across every seat (not just the hero),
// computed client-side from loaded hands — no DB columns/backfill required.
// ---------------------------------------------------------------------------

// RFI reports we surface, in position order. (BB can't open-raise; UTG can be
// added later — these are the spots requested first.)
export const RFI_POSITIONS = ['LJ', 'HJ', 'CO', 'BU', 'SB'] as const
export const POSITION_NAMES: Record<string, string> = {
  UTG: 'UTG', 'UTG+1': 'UTG+1', LJ: 'Lojack', HJ: 'Hijack', CO: 'Cutoff', BU: 'Button', SB: 'Small Blind',
}

export type RfiAction = 'raise' | 'limp' | 'fold'

export interface RfiSpot {
  handId: string
  seat: number
  position: string
  displayPos: string          // 'BU' | 'CO' | 'UTG' | …
  isHero: boolean
  stackBB: number
  cards: ParsedCard[] | null
  action: RfiAction
}

function seatCards(hand: ParsedHand, seat: number): ParsedCard[] | null {
  return hand.actions.find(a => a.type === 'deal_hole' && a.seatNumber === seat)?.cards ?? null
}

// Every seat that faced an UNOPENED pot preflop (folded to them, no limp/raise
// yet) and what they did with it. We stop at the first voluntary action — the
// opener — so seats acting into a limp/raise are NOT counted as RFI spots.
export function rfiSpots(hand: ParsedHand): RfiSpot[] {
  const tableSize = hand.players.length
  const make = (seat: number, action: RfiAction): RfiSpot | null => {
    const p = hand.players.find(pp => pp.seatNumber === seat)
    if (!p) return null
    return {
      handId: hand.handId, seat, position: p.position,
      displayPos: displayPosition(p.position, tableSize),
      isHero: p.isMe, stackBB: p.startingStack / hand.bigBlind,
      cards: seatCards(hand, seat), action,
    }
  }

  const spots: RfiSpot[] = []
  for (const a of hand.actions) {
    if (a.street !== 'preflop' || a.seatNumber === undefined) continue
    // skip setup actions that aren't preflop decisions
    if (a.type === 'post_blind' || a.type === 'post_ante' || a.type === 'deal_hole') continue
    if (a.type === 'fold') { const s = make(a.seatNumber, 'fold'); if (s) spots.push(s); continue }
    if (a.type === 'raise' || a.type === 'bet' || a.type === 'allin') {
      const s = make(a.seatNumber, 'raise'); if (s) spots.push(s); break  // pot opened
    }
    if (a.type === 'call') {
      const s = make(a.seatNumber, 'limp'); if (s) spots.push(s); break   // limped open
    }
    break // BB option-check or anything else — not an RFI open
  }
  return spots
}

export interface RfiEntry { spot: RfiSpot; hand: ParsedHand }

export interface RfiReport {
  position: string
  minBB: number
  total: number
  counts: Record<RfiAction, number>
  pct: Record<RfiAction, number>
  entries: Record<RfiAction, RfiEntry[]>
}

export function rfiReport(
  hands: ParsedHand[],
  opts: { position: string; minBB: number; excludeHero: boolean },
): RfiReport {
  const entries: Record<RfiAction, RfiEntry[]> = { raise: [], limp: [], fold: [] }
  for (const hand of hands) {
    for (const spot of rfiSpots(hand)) {
      if (spot.displayPos !== opts.position) continue
      if (opts.excludeHero && spot.isHero) continue
      if (spot.stackBB < opts.minBB) continue
      entries[spot.action].push({ spot, hand })
    }
  }
  const counts = { raise: entries.raise.length, limp: entries.limp.length, fold: entries.fold.length }
  const total = counts.raise + counts.limp + counts.fold
  const pct = {
    raise: total ? (counts.raise / total) * 100 : 0,
    limp: total ? (counts.limp / total) * 100 : 0,
    fold: total ? (counts.fold / total) * 100 : 0,
  }
  return { position: opts.position, minBB: opts.minBB, total, counts, pct, entries }
}

// The RFI-eligible positions present in the data (BB can't open-raise → excluded).
export function availableRfiPositions(hands: ParsedHand[]): string[] {
  const set = new Set<string>()
  for (const h of hands) for (const s of rfiSpots(h)) if (s.displayPos !== 'BB') set.add(s.displayPos)
  const order = ['UTG', 'UTG+1', 'UTG+2', 'UTG+3', 'UTG+4', 'LJ', 'HJ', 'CO', 'BU', 'SB']
  return [...set].sort((a, b) => order.indexOf(a) - order.indexOf(b))
}
