import type { ParsedHand, HandAction } from './types'
import { analyzeHand } from './analyzeHand'
import { displayPosition, POSITION_RANK } from './positionUtils'
import { holdemCombo } from './holdemCombo'

// ---------------------------------------------------------------------------
// Per-profile preflop tendencies, computed from a person's hands + the seat they
// sat in. The core is a preflop action tree keyed on how many raises the player
// faced when they acted: 0 → open (RFI), 1 → vs-open (3-bet), 2 → vs-3-bet
// (4-bet), 3 → vs-4-bet (5-bet). Each node splits into raise / call / fold, so
// "RFI %", "3-bet %", "call vs a 3-bet", etc. all fall out of one pass.
// ---------------------------------------------------------------------------

export interface Rate { made: number; opp: number }
export const pct = (r: Rate) => (r.opp ? (r.made / r.opp) * 100 : 0)

export type SpotKey = 'open' | 'vsOpen' | 'vs3bet' | 'vs4bet'

export interface PreflopSpot {
  key: SpotKey
  label: string        // "Open (first in)", "vs Open", …
  raiseLabel: string   // the aggressive option at this node: RFI / 3-Bet / 4-Bet / 5-Bet
  n: number            // times the player faced this spot
  raise: number
  call: number
  fold: number
}

export interface RfiPos { pos: string; n: number; rfi: number }

// A player's first voluntary preflop decision at one seat, bucketed by the spot
// they were put in. Each `n` is the count of times they faced that spot:
//   open   — first in, pot unraised & unlimped: raise (RFI) / limp / fold
//   vsRaise— a raise stands in front of them: raise (3-bet+) / call / fold
//   vsLimp — limper(s) but no raise: iso (raise) / overlimp (call) / fold
// Only the seat's FIRST decision in a hand counts, so the three buckets are
// mutually exclusive and a "fold to open" isn't double-counted as anything else.
export interface PosStats {
  pos: string
  open: { n: number; raise: number; limp: number; fold: number }
  vsRaise: { n: number; raise: number; call: number; fold: number }
  vsLimp: { n: number; iso: number; overlimp: number; fold: number }
}

export interface ProfileStats {
  hands: number
  spots: PreflopSpot[]
  rfiByPosition: RfiPos[]
  byPosition: PosStats[]
  flopCbet: Rate
  vpip: Rate
  pfr: Rate
}

const RAISE = new Set<HandAction['type']>(['raise', 'allin'])
const VOLUNTARY = new Set<HandAction['type']>(['call', 'raise', 'bet', 'allin'])

const SPOT_META: Record<SpotKey, { label: string; raiseLabel: string }> = {
  open:   { label: 'Open (first in)', raiseLabel: 'RFI' },
  vsOpen: { label: 'vs Open',         raiseLabel: '3-Bet' },
  vs3bet: { label: 'vs 3-Bet',        raiseLabel: '4-Bet' },
  vs4bet: { label: 'vs 4-Bet',        raiseLabel: '5-Bet' },
}

// Display order: BB, SB, BU, then CO/HJ/LJ and the earlier AJ..DJ seats stepping
// back from the button. Matches displayPosition's button-anchored AJ..DJ labels.
const posSort = (a: string, b: string) => {
  const order: Record<string, number> = { BB: 0, SB: 1, BU: 2, CO: 3, HJ: 4, LJ: 5, AJ: 6, BJ: 7, CJ: 8, DJ: 9 }
  const av = order[a] ?? POSITION_RANK[a] ?? 99, bv = order[b] ?? POSITION_RANK[b] ?? 99
  return av - bv || a.localeCompare(b)
}

export interface ComboTally { raise: number; call: number; fold: number; n: number }

// A player's preflop decisions at one node of the raise tree, bucketed by their
// actual 169-hand — the observed range to compare against a solver. `level` = how
// many raises stood in front when they acted: 0 open (RFI), 1 vs-open (3-bet
// spot), 2 vs-3-bet, 3 vs-4-bet, 4 vs-jam. In heads-up this also fixes the seat
// by parity (even = the SB/opener line, odd = the BB/defender line). Keyed by
// holdemCombo (matches the GTO grid); known hole cards only.
export function preflopNodeByCombo(hands: { hand: ParsedHand; seat: number }[], level = 0): Map<string, ComboTally> {
  const out = new Map<string, ComboTally>()
  for (const { hand, seat } of hands) {
    const hole = hand.actions.find(a => a.type === 'deal_hole' && a.seatNumber === seat)?.cards
    if (!hole || hole.length < 2) continue
    const combo = holdemCombo(hole)
    if (!combo) continue
    let raises = 0, limps = 0, recorded = false
    for (const a of hand.actions) {
      if (a.street !== 'preflop') break
      // The blind post isn't a decision — only a voluntary fold/call/raise is.
      const decision = a.type === 'fold' || a.type === 'call' || a.type === 'raise' || a.type === 'bet' || a.type === 'allin'
      if (!recorded && a.seatNumber === seat && decision && raises === level && (level > 0 || limps === 0)) {
        const t = out.get(combo) ?? { raise: 0, call: 0, fold: 0, n: 0 }
        if (RAISE.has(a.type)) t.raise++
        else if (a.type === 'call') t.call++
        else if (a.type === 'fold') t.fold++
        t.n++; out.set(combo, t)
        recorded = true
      }
      if (RAISE.has(a.type)) raises++
      else if (a.type === 'call' && raises === 0) limps++
    }
  }
  return out
}

export function computeProfileStats(hands: { hand: ParsedHand; seat: number }[]): ProfileStats {
  const split: Record<SpotKey, { n: number; raise: number; call: number; fold: number }> = {
    open: { n: 0, raise: 0, call: 0, fold: 0 }, vsOpen: { n: 0, raise: 0, call: 0, fold: 0 },
    vs3bet: { n: 0, raise: 0, call: 0, fold: 0 }, vs4bet: { n: 0, raise: 0, call: 0, fold: 0 },
  }
  const rfiByPos = new Map<string, RfiPos>()
  const posMap = new Map<string, PosStats>()
  const posStats = (pos: string) => {
    let s = posMap.get(pos)
    if (!s) { s = { pos, open: { n: 0, raise: 0, limp: 0, fold: 0 }, vsRaise: { n: 0, raise: 0, call: 0, fold: 0 }, vsLimp: { n: 0, iso: 0, overlimp: 0, fold: 0 } }; posMap.set(pos, s) }
    return s
  }
  const flopCbet: Rate = { made: 0, opp: 0 }
  const vpip: Rate = { made: 0, opp: 0 }, pfr: Rate = { made: 0, opp: 0 }

  for (const { hand, seat } of hands) {
    const pf = hand.actions.filter(a => a.street === 'preflop')
    const player = hand.players.find(p => p.seatNumber === seat)
    const pos = player ? displayPosition(player.position, hand.players.length) : String(seat)

    // Walk preflop in order, tracking raises faced and pre-raise limps so each of
    // the player's decisions lands in the right node (open / vs-open / …).
    let raises = 0, limps = 0, openRecorded = false, firstRecorded = false, didVpip = false, didPfr = false
    for (const a of pf) {
      if (a.seatNumber === seat) {
        if (VOLUNTARY.has(a.type)) didVpip = true
        if (RAISE.has(a.type)) didPfr = true
        const key: SpotKey | null =
          raises === 0 && limps === 0 ? 'open'
            : raises === 1 ? 'vsOpen'
            : raises === 2 ? 'vs3bet'
            : raises === 3 ? 'vs4bet'
            : null
        if (key) {
          const b = split[key]
          if (RAISE.has(a.type)) { b.raise++; b.n++ }
          else if (a.type === 'call') { b.call++; b.n++ }
          else if (a.type === 'fold') { b.fold++; b.n++ }
          // (a 'check' — BB's option in a limped pot — isn't a clean node; skip)
          if (key === 'open' && !openRecorded && a.type !== 'check') {
            const rp = rfiByPos.get(pos) ?? { pos, n: 0, rfi: 0 }
            rp.n++; if (RAISE.has(a.type)) rp.rfi++
            rfiByPos.set(pos, rp); openRecorded = true
          }
        }
        // Per-position: bucket only the seat's FIRST voluntary decision (a 'check'
        // — a free BB option — isn't a raise/limp/fold choice, so it's skipped and
        // the next action becomes the "first").
        if (!firstRecorded && a.type !== 'check' && (a.type === 'fold' || a.type === 'call' || RAISE.has(a.type))) {
          const s = posStats(pos)
          if (raises >= 1) { s.vsRaise.n++; if (RAISE.has(a.type)) s.vsRaise.raise++; else if (a.type === 'call') s.vsRaise.call++; else s.vsRaise.fold++ }
          else if (limps >= 1) { s.vsLimp.n++; if (RAISE.has(a.type)) s.vsLimp.iso++; else if (a.type === 'call') s.vsLimp.overlimp++; else s.vsLimp.fold++ }
          else { s.open.n++; if (RAISE.has(a.type)) s.open.raise++; else if (a.type === 'call') s.open.limp++; else s.open.fold++ }
          firstRecorded = true
        }
      }
      if (RAISE.has(a.type)) raises++
      else if (a.type === 'call' && raises === 0) limps++
    }
    vpip.opp++; if (didVpip) vpip.made++
    pfr.opp++; if (didPfr) pfr.made++

    const cb = analyzeHand(hand).flopCbet
    if (cb && cb.seat === seat && cb.opportunity) { flopCbet.opp++; if (cb.took) flopCbet.made++ }
  }

  const spots: PreflopSpot[] = (['open', 'vsOpen', 'vs3bet', 'vs4bet'] as const).map(k => ({
    key: k, label: SPOT_META[k].label, raiseLabel: SPOT_META[k].raiseLabel, ...split[k],
  }))
  return {
    hands: hands.length,
    spots,
    rfiByPosition: [...rfiByPos.values()].sort((a, b) => posSort(a.pos, b.pos)),
    byPosition: [...posMap.values()].sort((a, b) => posSort(a.pos, b.pos)),
    flopCbet, vpip, pfr,
  }
}
