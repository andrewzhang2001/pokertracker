import type { ParsedHand, HandAction } from './types'

// ---------------------------------------------------------------------------
// Pure hand analysis. Takes a ParsedHand and derives structured "spot" facts
// that are expensive to recompute ad-hoc but cheap to store/query.
//
// Design intent: this is the single source of truth for spot classification.
// Whether a fact ends up as an indexed DB column (a "tag") or is recomputed by
// a report script, it comes from THIS function — so tags and scripts never
// drift apart. Persist analyzeHand()'s output as JSONB next to each hand and
// you get fast hero-centric filters; aggregate it across hands for population
// reports.
// ---------------------------------------------------------------------------

export type PotType = 'walk' | 'limped' | 'srp' | '3bet' | '4bet' | '5bet+'

export interface FlopCbet {
  seat: number          // the preflop aggressor (the would-be c-bettor)
  opportunity: boolean  // reached flop & could bet without facing aggression first
  took: boolean         // actually bet the flop
  inPosition: boolean   // true = checked to (IP), false = first to act (OOP)
}

export interface HandAnalysis {
  handId: string
  gameType: string
  tableSize: number
  potType: PotType
  preflopRaiseCount: number
  pfrSeat: number | null        // preflop aggressor (last preflop raiser)
  heroSeat: number | null
  sawFlop: boolean
  playersToFlop: number[]       // seats that were dealt in & not folded by the flop
  multiwayPostflop: boolean     // 3+ players saw the flop
  flopCbet: FlopCbet | null     // for the preflop aggressor, if a flop happened

  // hero conveniences (collapse of the above onto the hero seat)
  heroIsPfr: boolean
  heroFlopCbetOpportunity: boolean
  heroFlopCbet: boolean
  heroVpip: boolean             // hero voluntarily put money in (call/raise/bet/allin;
                                // NOT forced blinds/antes). Matches the sidebar red/green.
}

// Voluntary money actions — posting blinds/antes is forced and excluded.
const VOLUNTARY_TYPES: HandAction['type'][] = ['call', 'raise', 'bet', 'allin']

const AGGRO_TYPES: HandAction['type'][] = ['bet', 'raise', 'allin']

export function analyzeHand(hand: ParsedHand): HandAnalysis {
  const heroSeat = hand.players.find(p => p.isMe)?.seatNumber ?? null
  const tableSize = hand.players.length

  const preflop = hand.actions.filter(a => a.street === 'preflop')
  const flop = hand.actions.filter(a => a.street === 'flop' && a.seatNumber !== undefined)
  const sawFlop = hand.actions.some(a => a.type === 'deal_flop')

  // Preflop aggressor = last player to raise preflop (covers SRP, 3bet, 4bet…)
  const preflopRaises = preflop.filter(a => a.type === 'raise')
  const preflopRaiseCount = preflopRaises.length
  const pfrSeat = preflopRaiseCount > 0
    ? preflopRaises[preflopRaises.length - 1].seatNumber ?? null
    : null

  const potType: PotType =
    preflopRaiseCount === 0
      ? (preflop.some(a => a.type === 'call') ? 'limped' : 'walk')
      : preflopRaiseCount === 1 ? 'srp'
      : preflopRaiseCount === 2 ? '3bet'
      : preflopRaiseCount === 3 ? '4bet'
      : '5bet+'

  // Who reached the flop: dealt-in seats minus those who folded preflop.
  const dealtSeats = new Set(
    hand.actions.filter(a => a.type === 'deal_hole' && a.seatNumber !== undefined)
      .map(a => a.seatNumber as number),
  )
  const foldedPreflop = new Set(
    preflop.filter(a => a.type === 'fold' && a.seatNumber !== undefined)
      .map(a => a.seatNumber as number),
  )
  const playersToFlop = sawFlop
    ? [...dealtSeats].filter(s => !foldedPreflop.has(s)).sort((a, b) => a - b)
    : []
  const multiwayPostflop = playersToFlop.length >= 3

  // Flop c-bet for the preflop aggressor.
  let flopCbet: FlopCbet | null = null
  if (sawFlop && pfrSeat !== null && playersToFlop.includes(pfrSeat)) {
    let betSeen = false
    let firstActor: number | null = null
    for (const a of flop) {
      if (firstActor === null) firstActor = a.seatNumber ?? null
      if (a.seatNumber === pfrSeat) {
        flopCbet = {
          seat: pfrSeat,
          opportunity: !betSeen,
          took: !betSeen && a.type === 'bet',
          inPosition: firstActor !== pfrSeat,
        }
        break
      }
      if (AGGRO_TYPES.includes(a.type)) betSeen = true
    }
    // pfr reached the flop but has no flop action (all-in preflop): no opportunity
    if (!flopCbet) flopCbet = { seat: pfrSeat, opportunity: false, took: false, inPosition: false }
  }

  const heroIsPfr = heroSeat !== null && pfrSeat === heroSeat
  const heroFlopCbetOpportunity = heroIsPfr && !!flopCbet?.opportunity
  const heroFlopCbet = heroIsPfr && !!flopCbet?.took
  const heroVpip = heroSeat !== null &&
    hand.actions.some(a => a.seatNumber === heroSeat && VOLUNTARY_TYPES.includes(a.type))

  return {
    handId: hand.handId,
    gameType: hand.gameType,
    tableSize,
    potType,
    preflopRaiseCount,
    pfrSeat,
    heroSeat,
    sawFlop,
    playersToFlop,
    multiwayPostflop,
    flopCbet,
    heroIsPfr,
    heroFlopCbetOpportunity,
    heroFlopCbet,
    heroVpip,
  }
}
