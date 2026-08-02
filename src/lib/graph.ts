import type { ParsedHand, ParsedCard } from './types'
import { computeHandState } from './computeHandState'
import { showdownEquities } from './equity'
import { handGame, filterByGame, type GameFilter, type GameKey } from './games'

// ---------------------------------------------------------------------------
// Results graph: hero's BB won/lost over hands, plus winrate, all-in adjusted
// winrate (replace the luck of all-in run-outs with their equity), and rake.
// ---------------------------------------------------------------------------

const BETTING = new Set(['bet', 'call', 'raise', 'allin'])

export interface GraphStats {
  hands: number
  totalNetBB: number
  bbPer100: number
  adjBbPer100: number
  totalRakeBB: number
  points: { i: number; cum: number; cumAdj: number }[]
}

// One hand's persisted result numbers (stored in the DB so the graph never has
// to re-run all-in simulations). adjNet falls back to net when not stored.
// `game` rides along so the graph can be split by variant without refetching.
export interface GraphRow { playedAt: number | null; net: number; adjNet: number; rake: number; game: GameKey }

// Hero's net for one hand (in BB), the all-in-adjusted net, and rake paid.
// Exported so it can be computed ONCE at export time and stored.
export function handStat(hand: ParsedHand): { net: number; adjNet: number; rake: number } | null {
  const hero = hand.players.find(p => p.isMe)
  if (!hero) return null
  const bb = hand.bigBlind || 1
  const acts = hand.actions

  // actual net = final stack − starting stack
  const end = computeHandState(hand, acts.length - 1)
  const heroFinal = end.players.find(p => p.seatNumber === hero.seatNumber)!.stack
  const net = (heroFinal - hero.startingStack) / bb

  // rake attributed to hero = hand rake × hero's share of the winnings
  const results = acts.filter(a => a.type === 'result')
  const sumResults = results.reduce((s, a) => s + (a.amount ?? 0), 0)
  const heroResult = results.filter(a => a.seatNumber === hero.seatNumber).reduce((s, a) => s + (a.amount ?? 0), 0)
  const rakeTotal = hand.totalPot !== undefined ? Math.max(0, hand.totalPot - sumResults) : 0
  const rake = (sumResults > 0 ? rakeTotal * (heroResult / sumResults) : 0) / bb

  // All-in adjusted: if betting finished before the board was complete (an
  // all-in run-out), replace the actual win with hero's equity share of the
  // post-rake pot (= the chips actually distributed to winners = sumResults).
  let adjNet = net
  let lastBet = -1
  for (let i = 0; i < acts.length; i++) if (BETTING.has(acts[i].type)) lastBet = i
  const runout = lastBet >= 0 && acts.slice(lastBet + 1).some(a => a.type === 'deal_flop' || a.type === 'deal_turn' || a.type === 'deal_river')

  if (runout && sumResults > 0) {
    const dealt = new Set(acts.filter(a => a.type === 'deal_hole' && a.seatNumber !== undefined).map(a => a.seatNumber!))
    const folded = new Set(acts.filter(a => a.type === 'fold').map(a => a.seatNumber!))
    const live = [...dealt].filter(s => !folded.has(s))
    const holeOf = (seat: number) => acts.find(a => a.type === 'deal_hole' && a.seatNumber === seat)?.cards ?? null
    const omaha = /OMAHA/i.test(hand.gameType)
    const size = omaha ? 4 : 2
    const holes = live.map(holeOf)

    if (live.includes(hero.seatNumber) && live.length >= 2 && holes.every(h => h && h.length >= size)) {
      // board as it stood when the betting (the all-in) finished
      const board: ParsedCard[] = []
      for (let i = 0; i <= lastBet; i++) if (acts[i].cards && acts[i].type.startsWith('deal_') && acts[i].type !== 'deal_hole') board.push(...acts[i].cards!)
      const eqs = showdownEquities(holes as ParsedCard[][], board, omaha)
      const heroEq = eqs[live.indexOf(hero.seatNumber)]

      // chips hero put at risk (state just before the pot is awarded)
      const firstResult = acts.findIndex(a => a.type === 'result')
      const before = computeHandState(hand, firstResult - 1)
      const heroStackThen = before.players.find(p => p.seatNumber === hero.seatNumber)!.stack
      const contributed = hero.startingStack - heroStackThen

      adjNet = (heroEq * sumResults - contributed) / bb
    }
  }

  return { net, adjNet, rake }
}

// Build the graph from per-hand result numbers (already sorted by time).
function build(rows: GraphRow[]): GraphStats {
  const points: GraphStats['points'] = []
  let cum = 0, cumAdj = 0, totalRake = 0, n = 0
  for (const r of rows) {
    n++
    cum += r.net
    cumAdj += r.adjNet
    totalRake += r.rake
    points.push({ i: n, cum, cumAdj })
  }
  return {
    hands: n,
    totalNetBB: cum,
    bbPer100: n ? (cum / n) * 100 : 0,
    adjBbPer100: n ? (cumAdj / n) * 100 : 0,
    totalRakeBB: totalRake,
    points,
  }
}

// From parsed hands (recomputes everything, incl. all-in sims) — for live/import use.
export function computeGraph(hands: ParsedHand[]): GraphStats {
  const rows: GraphRow[] = []
  for (const h of hands) {
    const s = handStat(h)
    if (s) rows.push({ playedAt: h.playedAt, game: handGame(h), ...s })
  }
  rows.sort((a, b) => (a.playedAt ?? 0) - (b.playedAt ?? 0))
  return build(rows)
}

// From stored DB numbers (no simulation) — the fast path the graph page uses.
// A game filter narrows the sample *before* the running total is accumulated,
// so PLO and NLHE each get their own curve from zero rather than a slice of the
// pooled one.
export function computeGraphFromRows(rows: GraphRow[], game: GameFilter = 'all'): GraphStats {
  const kept = filterByGame(rows, game, r => r.game)
  return build([...kept].sort((a, b) => (a.playedAt ?? 0) - (b.playedAt ?? 0)))
}

// How many graphable hands there are of each variant — drives the filter pills.
export function graphGameCounts(rows: GraphRow[]): Record<GameKey, number> {
  const counts: Record<GameKey, number> = { nlhe: 0, plo: 0, other: 0 }
  for (const r of rows) counts[r.game]++
  return counts
}
