import type { ParsedCard, ParsedHand } from '../shared/poker/types'
import { ploCombo } from '../shared/poker/ploCombo'
import { netForSeat } from '../shared/poker/graph'
import type { SolverTable } from '../shared/poker/reports'

// ---------------------------------------------------------------------------
// RFI opening EV-bands. Complementary to the vacuum EV-loss view: instead of
// grading each open against the GTO-best action, we take the solver's OPENING
// RANGE (combos that are +EV to open), rank it by open-EV, split it into four
// equal-weight quartile bands (strongest → most marginal opens), then drop the
// hero's ACTUAL opens into their band and compare realized net (bb) to the
// solver's expected EV. Answers "how do my premium vs my marginal opens perform
// relative to expectation?".
//
// PLO only: EVs are keyed by ploCombo, and band weighting uses each canonical
// combo's real-world multiplicity (how many of the C(52,4) deals map to it).
// ---------------------------------------------------------------------------

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'] as const
const SUITS = ['c', 'd', 'h', 's'] as const

export const TOTAL_PLO_HANDS = 270725 // C(52,4)

// combo -> number of the 270,725 four-card deals that canonicalize to it.
// Enumerated once (all C(52,4) hands) and memoized for the session; shared
// across every position/report.
let _weights: Map<string, number> | null = null
export function comboWeights(): Map<string, number> {
  if (_weights) return _weights
  const deck: ParsedCard[] = []
  for (const rank of RANKS) for (const suit of SUITS) deck.push({ rank, suit } as ParsedCard)
  const w = new Map<string, number>()
  for (let a = 0; a < 52; a++)
    for (let b = a + 1; b < 52; b++)
      for (let c = b + 1; c < 52; c++)
        for (let d = c + 1; d < 52; d++) {
          const k = ploCombo([deck[a], deck[b], deck[c], deck[d]])
          w.set(k, (w.get(k) ?? 0) + 1)
        }
  _weights = w
  return w
}

// The open EV of a combo (bb). RFI solver value = [foldEv, raiseEv]; foldEv is
// always 0, so raiseEv is the EV of opening. Absent combo → not solved.
const openEvOf = (solver: SolverTable, combo: string): number | undefined => solver[combo]?.[1]

export interface EvBand {
  idx: number          // 0 = strongest quartile … 3 = most marginal
  label: string        // "Top 25%", "2nd 25%", …
  loEv: number         // inclusive lower open-EV bound (bb)
  hiEv: number         // inclusive upper open-EV bound (bb)
  combos: number       // distinct canonical combos in the band
  weight: number       // total real-world deals in the band
  handPct: number      // weight / TOTAL_PLO_HANDS (share of ALL dealt hands)
  avgEv: number        // weight-weighted mean open-EV (bb) — the expectation
}

const BAND_LABELS = ['Top 25%', '2nd 25%', '3rd 25%', 'Bottom 25%']

// Cut the solver's +EV opening range into four equal-weight quartiles by open-EV.
export function openingRangeBands(solver: SolverTable, weights = comboWeights()): EvBand[] {
  // Opening range = combos that are +EV to open, sorted strongest-first.
  const open: { combo: string; ev: number; w: number }[] = []
  let totalW = 0
  for (const combo of Object.keys(solver)) {
    const ev = openEvOf(solver, combo)
    if (ev === undefined || ev <= 0) continue
    const w = weights.get(combo) ?? 0
    if (w <= 0) continue
    open.push({ combo, ev, w })
    totalW += w
  }
  open.sort((a, b) => b.ev - a.ev)

  const quartile = totalW / 4
  const bands: EvBand[] = BAND_LABELS.map((label, idx) => ({
    idx, label, loEv: Infinity, hiEv: -Infinity, combos: 0, weight: 0, handPct: 0, avgEv: 0,
  }))
  let acc = 0
  let evWeighted = 0
  const bandEvWeighted = [0, 0, 0, 0]
  for (const o of open) {
    const bi = Math.min(3, Math.floor(acc / quartile))
    const band = bands[bi]
    band.combos++
    band.weight += o.w
    band.loEv = Math.min(band.loEv, o.ev)
    band.hiEv = Math.max(band.hiEv, o.ev)
    bandEvWeighted[bi] += o.ev * o.w
    acc += o.w
    evWeighted += o.ev * o.w
  }
  for (const band of bands) {
    band.handPct = (band.weight / TOTAL_PLO_HANDS) * 100
    band.avgEv = band.weight ? bandEvWeighted[band.idx] / band.weight : 0
    if (!band.weight) { band.loEv = 0; band.hiEv = 0 }
  }
  return bands
}

// One band's realized performance from the hero's actual opens.
export interface BandPerf {
  band: EvBand
  opens: number        // hero opens that landed in this band
  netSum: number       // total realized net across them (bb)
  netAvg: number       // realized net per open (bb)
}

// Opens the solver folds (raiseEv <= 0 or combo unsolved) — outside the +EV
// range, so they don't belong to any band. `unknown` = cards missing.
export interface OffRange {
  opens: number
  netSum: number
  netAvg: number
  unknown: number
}

export interface BandsResult {
  bands: BandPerf[]
  offRange: OffRange
}

const heroSeatOf = (hand: ParsedHand): number | undefined =>
  hand.players.find(p => p.isMe)?.seatNumber

// The band whose [loEv, hiEv] contains this open's EV. Bands are contiguous and
// sorted strong→weak; ties fall to the stronger band (matching the cumulative-
// weight cut). An EV outside every band clamps to the nearest edge.
export function bandIndexForEv(bands: EvBand[], ev: number): number {
  const i = bands.findIndex(b => ev >= b.loEv && ev <= b.hiEv)
  if (i !== -1) return i
  return ev >= bands[0].hiEv ? 0 : bands.length - 1
}

// Place each hero open into its band and total realized net. `entries` are the
// RFI 'raise' bucket entries (hero's own opens); each contributes its whole-hand
// net for the hero seat.
export function assignOpensToBands(
  entries: { hand: ParsedHand; cards: ParsedCard[] | null }[],
  bands: EvBand[],
  solver: SolverTable,
): BandsResult {
  const perf: BandPerf[] = bands.map(band => ({ band, opens: 0, netSum: 0, netAvg: 0 }))
  const offRange: OffRange = { opens: 0, netSum: 0, netAvg: 0, unknown: 0 }

  for (const e of entries) {
    const seat = heroSeatOf(e.hand)
    if (seat === undefined) continue
    const net = netForSeat(e.hand, seat)
    if (!e.cards) { offRange.unknown++; offRange.opens++; offRange.netSum += net; continue }
    const ev = openEvOf(solver, ploCombo(e.cards))
    if (ev === undefined || ev <= 0) { offRange.opens++; offRange.netSum += net; continue }
    const bi = bandIndexForEv(bands, ev)
    perf[bi].opens++
    perf[bi].netSum += net
  }

  for (const p of perf) p.netAvg = p.opens ? p.netSum / p.opens : 0
  offRange.netAvg = offRange.opens ? offRange.netSum / offRange.opens : 0
  return { bands: perf, offRange }
}
