import type { ParsedCard } from './types'
import type { GameKind } from './games'

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

// `sub` = the fine subcategory for the postflop dropdowns: a nut/tier split of the
// made hand plus a combined draw tag (e.g. "top set · flush draw", "nut flush").
export interface HandClass { made: MadeCategory | null; draws: DrawType[]; label: string; sub: string }

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

// High card of a 5-card straight (wheel A-2-3-4-5 → 5), or 0 if not a straight.
function straightTop(vals: number[]): number {
  const u = [...new Set(vals)].sort((a, b) => a - b)
  if (u.length !== 5) return 0
  if (u[4] - u[0] === 4) return u[4]
  if (u[0] === 2 && u[1] === 3 && u[2] === 4 && u[3] === 5 && u[4] === 14) return 5 // wheel
  return 0
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

// The (hole, board) card sets forming candidate 5-card hands. PLO uses EXACTLY 2
// hole + 3 board; Hold'em uses the best 5 of all 7 (0–2 hole cards — it can play
// the board). On a 3-card board the two are identical (only 5 cards total).
function fiveCardHands(hole: ParsedCard[], board: ParsedCard[], game: GameKind): ParsedCard[][] {
  if (game === 'nlhe') return combos([...hole, ...board], 5)
  const out: ParsedCard[][] = []
  for (const hp of combos(hole, 2)) for (const bp of combos(board, 3)) out.push([...hp, ...bp])
  return out
}

function bestCategory(hole: ParsedCard[], board: ParsedCard[], game: GameKind): number {
  let best = 0
  for (const h of fiveCardHands(hole, board, game)) best = Math.max(best, cat5(h))
  return best
}

function hasStraight(hole: ParsedCard[], board: ParsedCard[], game: GameKind): boolean {
  for (const h of fiveCardHands(hole, board, game)) if (isStraight(h.map(c => RV[c.rank]))) return true
  return false
}

// Classify a 2-card hole against a 3-card flop.
export function classifyFlop(hole: ParsedCard[], flop: ParsedCard[], game: GameKind = 'plo'): HandClass {
  return classifyBoard(hole, flop, game)
}

// Classify a hole against a 3- to 5-card board (flop/turn/river).
export function classifyBoard(hole: ParsedCard[], board: ParsedCard[], game: GameKind = 'plo'): HandClass {
  const best = bestCategory(hole, board, game)

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
  // A GENUINE two pair spends both hole cards pairing two DIFFERENT board ranks.
  // In PLO you use exactly 2 hole cards, so a pocket pair makes only one pair —
  // it can't also borrow the board's pair for a second (that'd need a 3rd hole
  // card). So a pocket/overpair on a paired board (KK65 on 622, AA77 on TT2) is
  // NOT two pair; only two distinct hole-card-to-board matches are.
  const matchedPairs = (): number => {
    let n = 0
    for (const r in hrc) if (hrc[+r] >= 1 && brc[+r] >= 1) n++
    return n
  }

  let made: MadeCategory | null = null
  if (best === 8) made = 'straight flush'
  else if (best === 7) made = 'quads'
  else if (best === 6) made = 'full house'
  else if (best === 5) made = 'flush'
  else if (best === 4) made = 'straight'
  else if (best === 3) {
    made = setOrTrips()
    // PLO only: trips entirely on the board (e.g. A-J on J666) are shared — you
    // can't use the board's third card with just one hole card, so demote to the
    // real holding (top pair). Hold'em plays the board trips, so it keeps them.
    if (game === 'plo' && made === 'trips' && boardVals.some(v => brc[v] >= 3)) made = pairSubtype()
  }
  // PLO only: a "two pair" whose second pair is just the paired board (JAT9/99/AA
  // on J33, KK65 on 622) is shared — PLO spends both hole cards, so it can't also
  // borrow the board pair. Hold'em CAN play the board pair (Kx on KQQ = two pair),
  // so it keeps best===2 as genuine two pair.
  else if (best === 2) made = (game === 'nlhe' || matchedPairs() >= 2) ? 'two pair' : pairSubtype()
  else if (best === 1) made = pairSubtype()

  // draws (only if they'd improve on the made hand; meaningless once the board is complete)
  const draws: DrawType[] = []
  const canDraw = board.length < 5
  if (canDraw && best < 5) {
    // PLO needs 2 of a suit in hand + 2 on board; Hold'em just needs 4 total to a
    // flush across hole+board (so 1 hole + 3 board also draws).
    for (const s of Object.keys(hsuit)) {
      const draw = game === 'nlhe' ? hsuit[s] + (bsuit[s] || 0) === 4 : hsuit[s] >= 2 && (bsuit[s] || 0) === 2
      if (draw) { draws.push('flush draw'); break }
    }
  }
  if (canDraw && best < 4) {
    let completing = 0
    for (let R = 2; R <= 14; R++) {
      if (hasStraight(hole, [...board, { rank: VR[R], suit: 'x' as ParsedCard['suit'] }], game)) completing++
    }
    if (completing >= 3) draws.push('wrap')
    else if (completing === 2) draws.push('OESD')
    else if (completing === 1) draws.push('gutshot')
  }

  // ---- subcategory: a nut/tier split of the made hand + a combined draw tag ----
  const boardRanks = new Set(board.map(c => RV[c.rank]))
  const holeRanks = hole.map(c => RV[c.rank])
  const availOfSuit = (suit: string): number[] => {          // suit ranks NOT on the board, high→low
    const onBoard = new Set(board.filter(c => c.suit === suit).map(c => RV[c.rank]))
    const out: number[] = []
    for (let r = 14; r >= 2; r--) if (!onBoard.has(r)) out.push(r)
    return out
  }
  const suitTier = (needBoard: number): string => {         // nut / second nut / other for the flush(-draw) suit
    const suit = Object.keys(hsuit).find(s => hsuit[s] >= 2 && (bsuit[s] || 0) >= needBoard)
    if (!suit) return 'other'
    const av = availOfSuit(suit), held = new Set(hole.filter(c => c.suit === suit).map(c => RV[c.rank]))
    return held.has(av[0]) ? 'nut' : held.has(av[1]) ? 'second nut' : 'other'
  }

  const flushDraw = draws.includes('flush draw')
  const straightDraw = draws.some(d => d === 'wrap' || d === 'OESD' || d === 'gutshot')
  const fdBlocker = !flushDraw && Object.keys(bsuit).some(s => bsuit[s] === 2 && (hsuit[s] || 0) >= 1)
  const drawTag = flushDraw ? 'flush draw' : straightDraw ? 'straight draw' : fdBlocker ? 'fd blocker' : ''

  let sub: string = made ?? (draws.length ? 'draw' : 'air')
  if (made === 'flush') { const t = suitTier(3); sub = t === 'nut' ? 'nut flush' : t === 'second nut' ? 'second nut flush' : 'other flush' }
  else if (made === 'straight') {
    const windows: number[] = []                            // makeable straight high cards, high→low
    for (let H = 14; H >= 5; H--) {
      const ranks = H === 5 ? [5, 4, 3, 2, 14] : [H, H - 1, H - 2, H - 3, H - 4]
      if (ranks.filter(r => boardRanks.has(r)).length >= 3) windows.push(H)
    }
    let hi = 0
    for (const h of fiveCardHands(hole, board, game)) { const t = straightTop(h.map(c => RV[c.rank])); if (t > hi) hi = t }
    sub = hi === windows[0] ? 'straight' : hi === windows[1] ? 'second nut straight' : 'other straight'
  }
  else if (made === 'set') {
    const r = Math.max(...boardVals.filter(v => hrc[v] >= 2))
    sub = r === boardVals[0] ? 'top set' : r === boardVals[boardVals.length - 1] ? 'bottom set' : 'middle set'
  }
  else if (made === 'trips') {
    const trip = Math.max(...boardVals.filter(v => brc[v] >= 2 && (hrc[v] || 0) >= 1))
    let nutKicker = 0
    for (let r = 14; r >= 2; r--) if (!boardRanks.has(r) && r !== trip) { nutKicker = r; break }
    sub = holeRanks.includes(nutKicker) ? 'nut trips' : 'non-nut trips'
  }
  else if (made === 'two pair') {
    const paired = boardVals.filter(v => (hrc[v] || 0) >= 1) // board ranks the player pairs, high→low
    sub = paired[0] === boardVals[0] && paired[1] === boardVals[1] ? 'top two pair'
      : paired[0] === boardVals[0] ? 'two pair w/ TP' : 'other two pair'
  }
  else if (made === 'full house') {
    const trip = Math.max(0, ...boardVals.filter(v => (hrc[v] || 0) + (brc[v] || 0) >= 3))
    sub = trip >= boardVals[0] ? 'full house' : 'non-nut full house'
  }
  else if (!made && draws.length) {                          // pure-draw bucket (finer taxonomy)
    if (flushDraw) sub = suitTier(2) === 'nut' ? 'nut flush draw' : 'other flush draw'
    else sub = draws.includes('wrap') ? 'wrap' : draws.includes('OESD') ? 'OESD' : 'gutshot'
  }

  // Combined draw tag for made hands down to pocket pair (NOT full house+ / SF / quads).
  const DRAW_TAG_CATS = new Set<MadeCategory>(['flush', 'straight', 'set', 'trips', 'two pair', 'overpair', 'top pair', 'middle pair', 'bottom pair', 'pocket pair'])
  if (made && DRAW_TAG_CATS.has(made) && drawTag) sub = `${sub} · ${drawTag}`

  const parts = [made, ...draws].filter(Boolean) as string[]
  return { made, draws, sub, label: parts.length ? parts.join(', ') : 'air' }
}

// Canonical order for a subcategory row within its made-category dropdown:
// strongest tier first (nut → 2nd → other), then draw precedence
// (flush draw > straight draw > fd blocker > none).
const TIER_RANK: Record<string, number> = {
  'nut flush': 0, 'second nut flush': 1, 'other flush': 2,
  'straight': 0, 'second nut straight': 1, 'other straight': 2,
  'top set': 0, 'middle set': 1, 'bottom set': 2,
  'nut trips': 0, 'non-nut trips': 1,
  'top two pair': 0, 'two pair w/ TP': 1, 'other two pair': 2,
  'full house': 0, 'non-nut full house': 1,
  'nut flush draw': 0, 'other flush draw': 1, wrap: 2, OESD: 3, gutshot: 4,
}
const DRAW_RANK: Record<string, number> = { 'flush draw': 0, 'straight draw': 1, 'fd blocker': 2 }
export function subRank(sub: string): number {
  const [base, draw] = sub.split(' · ')
  return (TIER_RANK[base] ?? 0) * 10 + (draw ? (DRAW_RANK[draw] ?? 3) : 3)
}
