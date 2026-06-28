import type { ParsedCard } from './types'

// ---------------------------------------------------------------------------
// PLO flop hand classifier. Omaha uses EXACTLY 2 hole cards. Returns the made
// hand (by the precedence below) plus any draws that improve on it, e.g.
// "top pair, flush draw, OESD".
//   straight flush > quads > full house > flush > straight > trips > set >
//   two pair > overpair > top pair > middle pair > bottom pair > pocket pair
//   draws: flush draw, wrap (3+ completing ranks), OESD (2), gutshot (1)
// ---------------------------------------------------------------------------

export type MadeCategory =
  | 'straight flush' | 'quads' | 'full house' | 'flush' | 'straight'
  | 'trips' | 'set' | 'two pair'
  | 'overpair' | 'top pair' | 'middle pair' | 'bottom pair' | 'pocket pair'
export type DrawType = 'flush draw' | 'wrap' | 'OESD' | 'gutshot'

export interface HandClass { made: MadeCategory | null; draws: DrawType[]; label: string }

const RV: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14 }
const VR: Record<number, string> = Object.fromEntries(Object.entries(RV).map(([k, v]) => [v, k]))

function combos<T>(a: T[], k: number): T[][] {
  if (k === 0) return [[]]
  if (k > a.length) return []
  const [h, ...t] = a
  return [...combos(t, k - 1).map(c => [h, ...c]), ...combos(t, k)]
}

function isStraight(vals: number[]): boolean {
  const u = [...new Set(vals)]
  if (u.length < 5) return false
  u.sort((a, b) => a - b)
  if (u[u.length - 1] - u[0] === 4 && u.length === 5) return true
  const s = new Set(u)
  return s.has(14) && s.has(2) && s.has(3) && s.has(4) && s.has(5)
}

// Standard 5-card category: 8=SF 7=quads 6=full 5=flush 4=straight 3=trips 2=2pair 1=pair 0=high
function cat5(cards: ParsedCard[]): number {
  const vals = cards.map(c => RV[c.rank])
  const flush = cards.every(c => c.suit === cards[0].suit)
  const straight = isStraight(vals)
  const cnt: Record<number, number> = {}
  for (const v of vals) cnt[v] = (cnt[v] || 0) + 1
  const groups = Object.values(cnt).sort((a, b) => b - a)
  if (straight && flush) return 8
  if (groups[0] === 4) return 7
  if (groups[0] === 3 && groups[1] === 2) return 6
  if (flush) return 5
  if (straight) return 4
  if (groups[0] === 3) return 3
  if (groups[0] === 2 && groups[1] === 2) return 2
  if (groups[0] === 2) return 1
  return 0
}

// best 5-card category using exactly 2 hole + 3 board (works for 3- or 4-card boards)
function bestCategory(hole: ParsedCard[], board: ParsedCard[]): number {
  let best = 0
  for (const hp of combos(hole, 2))
    for (const bp of combos(board, 3))
      best = Math.max(best, cat5([...hp, ...bp]))
  return best
}

// Straight possible using exactly 2 hole + 3 of the given board cards?
function hasStraight(hole: ParsedCard[], board: ParsedCard[]): boolean {
  for (const hp of combos(hole, 2))
    for (const bp of combos(board, 3))
      if (isStraight([...hp, ...bp].map(c => RV[c.rank]))) return true
  return false
}

// Classify a 2-card hole against a 3-card flop.
export function classifyFlop(hole: ParsedCard[], flop: ParsedCard[]): HandClass {
  return classifyBoard(hole, flop)
}

// Classify a 2-card hole against a 3- or 4-card board (flop or turn).
export function classifyBoard(hole: ParsedCard[], board: ParsedCard[]): HandClass {
  const best = bestCategory(hole, board)

  // rank/suit tallies
  const hrc: Record<number, number> = {}, brc: Record<number, number> = {}
  const hsuit: Record<string, number> = {}, bsuit: Record<string, number> = {}
  for (const c of hole) { hrc[RV[c.rank]] = (hrc[RV[c.rank]] || 0) + 1; hsuit[c.suit] = (hsuit[c.suit] || 0) + 1 }
  for (const c of board) { brc[RV[c.rank]] = (brc[RV[c.rank]] || 0) + 1; bsuit[c.suit] = (bsuit[c.suit] || 0) + 1 }
  const boardVals = [...new Set(board.map(c => RV[c.rank]))].sort((a, b) => b - a)
  const [top, mid, bot] = boardVals

  const setOrTrips = (): MadeCategory => {
    for (const r in hrc) if (hrc[r] >= 2 && brc[+r] >= 1) return 'set'      // pocket pair hits board
    return 'trips'                                                          // board pair + one hole
  }
  const pairSubtype = (): MadeCategory | null => {
    for (const r in hrc) if (hrc[r] >= 2 && +r > top) return 'overpair'
    if (hrc[top] >= 1) return 'top pair'
    if (mid !== undefined && hrc[mid] >= 1) return 'middle pair'
    if (bot !== undefined && hrc[bot] >= 1) return 'bottom pair'
    for (const r in hrc) if (hrc[r] >= 2) return 'pocket pair'              // underpair
    return null                                                            // board-only pair → air
  }

  let made: MadeCategory | null = null
  if (best === 8) made = 'straight flush'
  else if (best === 7) made = 'quads'
  else if (best === 6) made = 'full house'
  else if (best === 5) made = 'flush'
  else if (best === 4) made = 'straight'
  else if (best === 3) made = setOrTrips()
  else if (best === 2) made = 'two pair'
  else if (best === 1) made = pairSubtype()

  // draws (only if they'd improve on the made hand; meaningless once the board is complete)
  const draws: DrawType[] = []
  const canDraw = board.length < 5
  if (canDraw && best < 5) {
    for (const s of Object.keys(hsuit)) if (hsuit[s] >= 2 && (bsuit[s] || 0) === 2) { draws.push('flush draw'); break }
  }
  if (canDraw && best < 4) {
    let completing = 0
    for (let R = 2; R <= 14; R++) {
      if (hasStraight(hole, [...board, { rank: VR[R], suit: 'x' as ParsedCard['suit'] }])) completing++
    }
    if (completing >= 3) draws.push('wrap')
    else if (completing === 2) draws.push('OESD')
    else if (completing === 1) draws.push('gutshot')
  }

  const parts = [made, ...draws].filter(Boolean) as string[]
  return { made, draws, label: parts.length ? parts.join(', ') : 'air' }
}
