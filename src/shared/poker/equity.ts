import type { ParsedCard, ParsedHand, HandState } from './types'
import { gameKind } from './games'

// ---------------------------------------------------------------------------
// Postflop showdown equity. Given the players still in the pot (with their
// actual hole cards) and the current board, we EXACTLY enumerate every possible
// remaining board run-out, award the pot to the best hand each time (split on
// ties), and return each player's share. Equities sum to 100%.
// ---------------------------------------------------------------------------

const RV: Record<string, number> = { '2': 0, '3': 1, '4': 2, '5': 3, '6': 4, '7': 5, '8': 6, '9': 7, T: 8, J: 9, Q: 10, K: 11, A: 12 }
const SV: Record<string, number> = { h: 0, d: 1, c: 2, s: 3 }
const toInt = (c: ParsedCard) => RV[c.rank] * 4 + SV[c.suit]

// k-combinations of [0..n) as index arrays (n,k both tiny here).
function combos(n: number, k: number): number[][] {
  const out: number[][] = []
  const pick = (start: number, acc: number[]) => {
    if (acc.length === k) { out.push(acc.slice()); return }
    for (let i = start; i < n; i++) { acc.push(i); pick(i + 1, acc); acc.pop() }
  }
  pick(0, [])
  return out
}
const C75 = combos(7, 5)   // hold'em: best 5 of 7
const C42 = combos(4, 2)   // omaha: 2 of 4 hole

// Rank a 5-card hand as a single comparable integer (category + tiebreakers).
function score5(c0: number, c1: number, c2: number, c3: number, c4: number): number {
  const r = [c0 >> 2, c1 >> 2, c2 >> 2, c3 >> 2, c4 >> 2].sort((a, b) => b - a)
  const flush = (c0 & 3) === (c1 & 3) && (c1 & 3) === (c2 & 3) && (c2 & 3) === (c3 & 3) && (c3 & 3) === (c4 & 3)
  const uniq = [...new Set(r)]
  let straightHigh = -1
  if (uniq.length === 5) {
    if (uniq[0] - uniq[4] === 4) straightHigh = uniq[0]
    else if (uniq[0] === 12 && uniq[1] === 3 && uniq[2] === 2 && uniq[3] === 1 && uniq[4] === 0) straightHigh = 3 // wheel A-5
  }
  const cnt = new Map<number, number>()
  for (const v of r) cnt.set(v, (cnt.get(v) || 0) + 1)
  const groups = [...cnt.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])

  let cat: number, tb: number[]
  if (straightHigh >= 0 && flush) { cat = 8; tb = [straightHigh] }
  else if (groups[0][1] === 4) { cat = 7; tb = [groups[0][0], groups[1][0]] }
  else if (groups[0][1] === 3 && groups[1][1] === 2) { cat = 6; tb = [groups[0][0], groups[1][0]] }
  else if (flush) { cat = 5; tb = r }
  else if (straightHigh >= 0) { cat = 4; tb = [straightHigh] }
  else if (groups[0][1] === 3) { cat = 3; tb = [groups[0][0], groups[1][0], groups[2][0]] }
  else if (groups[0][1] === 2 && groups[1][1] === 2) { cat = 2; tb = [groups[0][0], groups[1][0], groups[2][0]] }
  else if (groups[0][1] === 2) { cat = 1; tb = [groups[0][0], groups[1][0], groups[2][0], groups[3][0]] }
  else { cat = 0; tb = r }

  // Fixed-width encode (category dominates, then up to 5 tiebreakers) so hands
  // of different categories stay comparable.
  let v = cat
  for (let i = 0; i < 5; i++) v = v * 15 + ((tb[i] ?? -1) + 1)
  return v
}

// Best score: hold'em = best 5 of (2 hole + 5 board); omaha = exactly 2 hole + 3 board.
function bestScore(hole: number[], board: number[], omaha: boolean): number {
  let best = -1
  if (omaha) {
    const bc = combos(board.length, 3)
    for (const h of C42) {
      for (const b of bc) {
        const s = score5(hole[h[0]], hole[h[1]], board[b[0]], board[b[1]], board[b[2]])
        if (s > best) best = s
      }
    }
  } else {
    const seven = [hole[0], hole[1], ...board]
    for (const idx of C75) {
      const s = score5(seven[idx[0]], seven[idx[1]], seven[idx[2]], seven[idx[3]], seven[idx[4]])
      if (s > best) best = s
    }
  }
  return best
}

function nCk(n: number, k: number): number {
  if (k < 0 || k > n) return 0
  let r = 1
  for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1)
  return r
}

// Each hand's share of the pot over the remaining run-outs. Exact enumeration
// when the number of run-outs is small (flop/turn all-ins), Monte Carlo when it
// blows up (preflop all-ins). Returns one equity per input hand; they sum to 1.
export function showdownEquities(holes: ParsedCard[][], board: ParsedCard[], omaha: boolean, mcIters = 12000): number[] {
  const holeInts = holes.map(h => h.map(toInt))
  const boardInts = board.map(toInt)
  const dead = new Set([...holeInts.flat(), ...boardInts])
  const deck: number[] = []
  for (let c = 0; c < 52; c++) if (!dead.has(c)) deck.push(c)
  const need = 5 - board.length

  const eq = new Array(holes.length).fill(0)
  let runouts = 0
  const award = (full: number[]) => {
    let best = -1
    const winners: number[] = []
    for (let i = 0; i < holeInts.length; i++) {
      const s = bestScore(holeInts[i], full, omaha)
      if (s > best) { best = s; winners.length = 0; winners.push(i) }
      else if (s === best) winners.push(i)
    }
    const share = 1 / winners.length
    for (const w of winners) eq[w] += share
    runouts++
  }

  if (need <= 0) {
    award(boardInts)
  } else if (nCk(deck.length, need) <= 200000) {
    for (const idx of combos(deck.length, need)) award([...boardInts, ...idx.map(i => deck[i])])
  } else {
    for (let it = 0; it < mcIters; it++) {
      for (let i = 0; i < need; i++) {
        const j = i + Math.floor(Math.random() * (deck.length - i))
        const t = deck[i]; deck[i] = deck[j]; deck[j] = t
      }
      award([...boardInts, ...deck.slice(0, need)])
    }
  }

  return runouts ? eq.map(e => e / runouts) : eq
}

// Equity per seat for the current step: the showdown equities of the players
// still in the pot. Only computed postflop (board ≥ 3) AND only when EVERY live
// player's hole cards are known (otherwise true shares can't be determined).
export function computeEquities(hand: ParsedHand, state: HandState): Record<number, number> {
  const board = state.communityCards
  const out: Record<number, number> = {}
  if (board.length < 3) return out
  const live = state.players.filter(p => !p.folded)
  if (live.length < 2) return out
  const omaha = gameKind(hand.gameType) === 'plo'  // PLO uses 2-of-4; NLHE best-5-of-7
  const need = omaha ? 4 : 2
  if (!live.every(p => p.holeCards && p.holeCards.length >= need)) return out
  const eqs = showdownEquities(live.map(p => p.holeCards!), board, omaha)
  live.forEach((p, i) => { out[p.seatNumber] = eqs[i] })
  return out
}
