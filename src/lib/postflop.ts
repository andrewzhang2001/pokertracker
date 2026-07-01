import type { ParsedHand, ParsedCard, HandAction } from './types'
import { displayPosition, type TableKind } from './positionUtils'
import { gameKind, GAMES } from './games'
import { computeHandState } from './computeHandState'
import { classifyFlop, classifyBoard, subRank, type HandClass } from './ploEval'

// ---------------------------------------------------------------------------
// Postflop scenario engine. A SCENARIO is one of YOUR decision nodes in the
// heads-up flop tree, plus the adjacent villain nodes (the prior action that
// created your spot, and the villain's responses to the actions of yours that
// keep them in a decision). Everything is a node: a path of flop actions + who
// acts next; its chart = the acting player's hand class × their action.
//   OOP = first to act on the flop, IP = the other (so position falls out of
//   the data). Scenarios filter by pot type + OOP/IP position groups.
// ---------------------------------------------------------------------------

const RV: Record<string, number> = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14 }

// Preflop sanity filters (keep spots comparable / on-strategy):
const MIN_EFF_BB = 75         // effective stack (min of the two players)
const THREEBET_MIN_POT = 0.75 // the 3-bet must be ~pot-sized (no tiny 3-bets)
// The open-size gate reuses the per-game config (GAMES in ./games) — same source
// of truth as the preflop reports, so PLO/NLHE sizing lives in one place.

export const RANKS_DESC = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']

// Suit texture by flush potential (what a 2-suited hole can make):
//   flush = a suit with 3+ on board (hole 2 → made flush)
//   dfd   = two suits with exactly 2 (two flush draws) — turn/river only
//   fd    = one suit with exactly 2 (a flush draw)
//   nofd  = no flush draw. On the RIVER draws can't complete, so it's only
//           flush vs nofd (a lone 2-suit river = no flush).
export type SuitTexture = 'nofd' | 'fd' | 'dfd' | 'flush'
export interface FlopTexture { suits: SuitTexture; paired: boolean }
export function flopTexture(flop: ParsedCard[]): FlopTexture {
  return { suits: boardSuits(flop), paired: boardPaired(flop) }
}
export function boardSuits(board: ParsedCard[]): SuitTexture {
  const cnt: Record<string, number> = {}
  for (const c of board) cnt[c.suit] = (cnt[c.suit] || 0) + 1
  const counts = Object.values(cnt)
  if (counts.some(n => n >= 3)) return 'flush'
  if (board.length >= 5) return 'nofd'                       // river: flush vs no flush only
  const twos = counts.filter(n => n === 2).length
  return twos >= 2 ? 'dfd' : twos === 1 ? 'fd' : 'nofd'
}
// A board is "paired" if any rank repeats among its cards.
export const boardPaired = (board: ParsedCard[]): boolean => new Set(board.map(c => c.rank)).size < board.length

// A made straight is possible iff some 3 board cards are distinct ranks that
// fit in a 5-card window (max−min ≤ 4), A high or low. In PLO you must use
// exactly 3 board cards, so this generalizes across flop/turn/river: evaluate
// all the dealt board cards (Q63 = no; on the turn the 4th card may complete it).
export function straightPossibleBoard(board: ParsedCard[]): boolean {
  const sets = board.map(c => (RV[c.rank] === 14 ? [14, 1] : [RV[c.rank]]))
  const n = board.length
  for (let i = 0; i < n; i++)
    for (let j = i + 1; j < n; j++)
      for (let k = j + 1; k < n; k++)
        for (const a of sets[i]) for (const b of sets[j]) for (const c of sets[k]) {
          const d = [...new Set([a, b, c])]
          if (d.length === 3 && Math.max(...d) - Math.min(...d) <= 4) return true
        }
  return false
}
// Flop-only alias (kept for tests / call sites that pass exactly 3 cards).
export const straightPossibleFlop = straightPossibleBoard

export type FlopActor = 'oop' | 'ip'
export type FlopActType = 'check' | 'bet' | 'call' | 'raise' | 'fold'
export interface FlopAction { actor: FlopActor; type: FlopActType; betPct?: number }

export interface FlopSpot {
  handId: string
  hand?: ParsedHand          // omitted on rehydrated (materialized) spots; drill-down fetches by handId
  potType: 'SRP' | '3BP'
  oopPos: string
  ipPos: string
  oopIsHero: boolean
  ipIsHero: boolean
  oopCards: ParsedCard[] | null
  ipCards: ParsedCard[] | null
  oopClass?: HandClass
  ipClass?: HandClass
  flop: ParsedCard[]
  texture: FlopTexture
  straighty: boolean       // a made straight is possible on this flop
  flopRanks: string[]      // flop ranks sorted high→low (e.g. QQ2 → ['Q','Q','2'])
  actions: FlopAction[]    // flop action sequence
  // turn (null if the hand didn't reach the turn). Texture flags evaluate the
  // 4-card board (flop + turn), so "turn straight" = straight made by the turn.
  turnCard: ParsedCard | null
  turnSuits?: SuitTexture
  turnPaired?: boolean
  turnStraighty?: boolean
  turnActions: FlopAction[]
  oopTurnClass?: HandClass
  ipTurnClass?: HandClass
  // river (null if the hand didn't reach the river). Texture flags evaluate the
  // full 5-card board.
  riverCard: ParsedCard | null
  riverSuits?: SuitTexture
  riverPaired?: boolean
  riverStraighty?: boolean
  riverActions: FlopAction[]
  oopRiverClass?: HandClass
  ipRiverClass?: HandClass
}

const AGGRO: HandAction['type'][] = ['bet', 'allin', 'raise']

// Generic heads-up flop spot (SRP or 3BP). null if the hand isn't HU postflop.
export function extractFlopSpot(hand: ParsedHand): FlopSpot | null {
  const n = hand.players.length
  const preflop = hand.actions.filter(a => a.street === 'preflop' && a.seatNumber !== undefined)
  const raises = preflop.filter(a => a.type === 'raise').length
  const potType = raises === 1 ? 'SRP' : raises === 2 ? '3BP' : null
  if (!potType) return null

  // Require a CLEAN line (no limps, cold-calls, or squeezes):
  //   SRP = the first voluntary action is the open raise.
  //   3BP = open then 3-bet with no caller in between (else it's a squeeze / cold-call pot).
  const vol = preflop.filter(a => a.type === 'raise' || a.type === 'call')
  if (potType === 'SRP' && vol[0]?.type !== 'raise') return null
  if (potType === '3BP' && (vol[0]?.type !== 'raise' || vol[1]?.type !== 'raise')) return null

  // raise-size sanity: real open, and (3BP) a ~pot-sized 3-bet. Blind-vs-blind
  // opens (SB opener — incl. HU, where the button normalizes to SB) run smaller,
  // so blind openers use the looser floor from the per-game sizing config.
  const openTo = vol[0].amount ?? 0
  const openerPlayer = hand.players.find(p => p.seatNumber === vol[0].seatNumber)
  const openerIsSB = !!openerPlayer && displayPosition(openerPlayer.position, n) === 'SB'
  const sizing = GAMES[gameKind(hand.gameType)].sizing
  if (openTo / hand.bigBlind < (openerIsSB ? sizing.blindOpen : sizing.open)) return null
  if (potType === '3BP') {
    const tb = vol[1]
    const potBefore3bet = computeHandState(hand, hand.actions.indexOf(tb) - 1).pot
    const tbPct = potBefore3bet + openTo > 0 ? ((tb.amount ?? 0) - openTo) / (potBefore3bet + openTo) : 0
    if (tbPct < THREEBET_MIN_POT) return null
  }

  const dealt = new Set(hand.actions.filter(a => a.type === 'deal_hole' && a.seatNumber !== undefined).map(a => a.seatNumber as number))
  const folded = new Set(preflop.filter(a => a.type === 'fold').map(a => a.seatNumber as number))
  const toFlop = [...dealt].filter(s => !folded.has(s))
  if (toFlop.length !== 2) return null
  if (!hand.actions.some(a => a.type === 'deal_flop')) return null

  const flopActsRaw = hand.actions.filter(a => a.street === 'flop' && a.seatNumber !== undefined)
  if (!flopActsRaw.length) return null
  const oopSeat = flopActsRaw[0].seatNumber!          // first to act = OOP
  const ipSeat = toFlop.find(s => s !== oopSeat)
  if (ipSeat === undefined) return null

  const player = (seat: number) => hand.players.find(p => p.seatNumber === seat)!
  // effective stack filter
  if (Math.min(player(oopSeat).startingStack, player(ipSeat).startingStack) / hand.bigBlind < MIN_EFF_BB) return null
  const cardsOf = (seat: number) => hand.actions.find(a => a.type === 'deal_hole' && a.seatNumber === seat)?.cards ?? null
  const flop = hand.actions.find(a => a.type === 'deal_flop')!.cards ?? []

  // normalized action sequence for one street (bet% is relative to the pot)
  const streetActions = (raw: HandAction[]): FlopAction[] => {
    const out: FlopAction[] = []
    let betSeen = false
    let lastAggroAmt = 0   // size of the bet/raise currently being faced
    for (const a of raw) {
      const actor: FlopActor | null = a.seatNumber === oopSeat ? 'oop' : a.seatNumber === ipSeat ? 'ip' : null
      if (!actor) continue
      let type: FlopActType | null = null
      if (a.type === 'check') type = 'check'
      else if (a.type === 'fold') type = 'fold'
      else if (a.type === 'call') type = 'call'
      else if (AGGRO.includes(a.type)) { type = betSeen ? 'raise' : 'bet'; betSeen = true }
      if (!type) continue
      let betPct: number | undefined
      if (type === 'bet' || type === 'raise') {
        const R = a.amount ?? 0                    // total "to" amount
        const potBefore = computeHandState(hand, hand.actions.indexOf(a) - 1).pot
        if (type === 'bet') {
          betPct = potBefore > 0 ? R / potBefore : 0
        } else {
          // raise: extra over the call, vs the pot after the call is made.
          // pot 20, bet 15 (potBefore=35), raise to 60 → (60-15) / (35+15) = 90%.
          const toCall = lastAggroAmt
          const potAfterCall = potBefore + toCall
          betPct = potAfterCall > 0 ? (R - toCall) / potAfterCall : 0
        }
        lastAggroAmt = R
      }
      out.push({ actor, type, betPct })
    }
    return out
  }

  const actions = streetActions(flopActsRaw)
  const turnActsRaw = hand.actions.filter(a => a.street === 'turn' && a.seatNumber !== undefined)
  const turnCard = hand.actions.find(a => a.type === 'deal_turn')?.cards?.[0] ?? null
  const turnActions = turnCard ? streetActions(turnActsRaw) : []
  const riverActsRaw = hand.actions.filter(a => a.street === 'river' && a.seatNumber !== undefined)
  const riverCard = hand.actions.find(a => a.type === 'deal_river')?.cards?.[0] ?? null
  const riverActions = riverCard ? streetActions(riverActsRaw) : []

  const oopCards = cardsOf(oopSeat), ipCards = cardsOf(ipSeat)
  const ok = flop.length === 3
  const game = gameKind(hand.gameType)
  const flopKlass = (c: ParsedCard[] | null) => (c && ok ? classifyFlop(c, flop, game) : undefined)
  const turnKlass = (c: ParsedCard[] | null) => (c && ok && turnCard ? classifyBoard(c, [...flop, turnCard], game) : undefined)
  const riverKlass = (c: ParsedCard[] | null) => (c && ok && turnCard && riverCard ? classifyBoard(c, [...flop, turnCard, riverCard], game) : undefined)
  const turnBoard = turnCard ? [...flop, turnCard] : null
  const riverBoard = turnCard && riverCard ? [...flop, turnCard, riverCard] : null
  return {
    handId: hand.handId, hand, potType,
    oopPos: displayPosition(player(oopSeat).position, n),
    ipPos: displayPosition(player(ipSeat).position, n),
    oopIsHero: player(oopSeat).isMe, ipIsHero: player(ipSeat).isMe,
    oopCards, ipCards, oopClass: flopKlass(oopCards), ipClass: flopKlass(ipCards),
    flop, texture: flopTexture(flop), straighty: straightPossibleBoard(flop), actions,
    flopRanks: [...flop].sort((a, b) => RV[b.rank] - RV[a.rank]).map(c => c.rank),
    turnCard, turnActions, oopTurnClass: turnKlass(oopCards), ipTurnClass: turnKlass(ipCards),
    turnSuits: turnBoard ? boardSuits(turnBoard) : undefined,
    turnPaired: turnBoard ? boardPaired(turnBoard) : undefined,
    turnStraighty: turnBoard ? straightPossibleBoard(turnBoard) : undefined,
    riverCard, riverActions, oopRiverClass: riverKlass(oopCards), ipRiverClass: riverKlass(ipCards),
    riverSuits: riverBoard ? boardSuits(riverBoard) : undefined,
    riverPaired: riverBoard ? boardPaired(riverBoard) : undefined,
    riverStraighty: riverBoard ? straightPossibleBoard(riverBoard) : undefined,
  }
}

// ---- formations + nodes ----
// A FORMATION is a preflop matchup (pot type + the OOP/IP position groups). A
// NODE is one decision point in the flop/turn tree within a formation. The same
// node set applies to every formation; the landing page navigates them.
export type Street = 'flop' | 'turn' | 'river'
export interface PathStep { actor: FlopActor; type: FlopActType }
export interface NodeDef {
  id: string
  label: string           // full label for the detail header
  short: string           // short label for the landing tiles
  street: Street
  path: PathStep[]        // flop prefix; for turn/river nodes this is the EXACT flop closing line
  turnPath?: PathStep[]   // turn prefix (turn nodes); EXACT turn closing line (river nodes)
  riverPath?: PathStep[]  // river prefix (river nodes only)
  acting: FlopActor       // whose decision this node captures
  col?: number            // landing layout column within the acting side (0 = after one action, 1 = after a raise)
}

export interface Formation {
  id: string
  label: string
  kind: TableKind         // 'sixmax' (6-max/full ring) or 'hu' (heads-up)
  potType: 'SRP' | '3BP'
  oopRoles: string[]      // positions the OOP (first-to-act) seat may hold
  ipRoles: string[]       // positions the IP seat may hold
  pfa: FlopActor          // preflop aggressor (SRP = opener, 3BP = 3-bettor)
}

const IP_RFI = ['LJ', 'HJ', 'CO', 'BU']
const OPENERS = ['LJ', 'HJ', 'CO']        // RFI raiser positions (OOP vs an IP caller)
const IP_CALLERS = ['HJ', 'CO', 'BU']     // in-position caller / 3-bettor positions

export const FORMATIONS: Formation[] = [
  { id: 'srp-bb-vs-ip', label: 'SRP BB vs IP', kind: 'sixmax', potType: 'SRP', oopRoles: ['BB'], ipRoles: IP_RFI, pfa: 'ip' },
  { id: 'srp-coldcall', label: 'SRP Cold Call', kind: 'sixmax', potType: 'SRP', oopRoles: OPENERS, ipRoles: IP_CALLERS, pfa: 'oop' },
  { id: 'srp-bvb', label: 'SRP Blind vs Blind', kind: 'sixmax', potType: 'SRP', oopRoles: ['SB'], ipRoles: ['BB'], pfa: 'oop' },
  { id: '3bp-oop', label: '3BP OOP vs RFI', kind: 'sixmax', potType: '3BP', oopRoles: ['SB', 'BB'], ipRoles: IP_RFI, pfa: 'oop' },
  { id: '3bp-ip', label: '3BP IP vs RFI', kind: 'sixmax', potType: '3BP', oopRoles: OPENERS, ipRoles: IP_CALLERS, pfa: 'ip' },
  { id: '3bp-bvb', label: '3BP Blind vs Blind', kind: 'sixmax', potType: '3BP', oopRoles: ['SB'], ipRoles: ['BB'], pfa: 'ip' },
  // Heads-up: SB is the button (acts first preflop), so postflop BB is OOP / SB IP.
  // SRP → SB raised (aggressor is IP); 3BP → BB 3-bet (aggressor is OOP).
  { id: 'hu-srp', label: 'HU SRP (SB vs BB)', kind: 'hu', potType: 'SRP', oopRoles: ['BB'], ipRoles: ['SB'], pfa: 'ip' },
  { id: 'hu-3bp', label: 'HU 3BP (SB vs BB)', kind: 'hu', potType: '3BP', oopRoles: ['BB'], ipRoles: ['SB'], pfa: 'oop' },
]

// Canonical names for a decision node, depending on who the preflop aggressor is.
// (flop: c-bet/donk · vs c-bet/stab/donk · vs check; turn varies by flop line.)
export function nodeLabel(nodeId: string, pfa: FlopActor): string {
  const oopPfa = pfa === 'oop', ipPfa = pfa === 'ip'
  switch (nodeId) {
    case 'flop-initial': return oopPfa ? 'c-bet' : 'donk'
    case 'flop-x': return 'vs check'
    case 'flop-xb': return ipPfa ? 'vs c-bet' : 'vs stab'
    case 'flop-b': return oopPfa ? 'vs c-bet' : 'vs donk'
    case 'flop-xbr': return 'vs check-raise'   // IP cbet, OOP check-raised
    case 'flop-br': return 'vs raise'          // OOP bet, IP raised
    // X-X (check-check) turn
    case 'xx-initial': return 'probe'
    case 'xx-x': return 'vs check'
    case 'xx-xb': return ipPfa ? 'vs delayed c-bet' : 'vs stab'
    case 'xx-b': return 'vs probe'
    // B-C (donk/c-bet line) turn
    case 'bc-initial': return 'double-barrel'
    case 'bc-x': return 'vs check'
    case 'bc-xb': return 'vs re-open'
    case 'bc-b': return 'vs double-barrel'
    // X-B-C (stab/c-bet line) turn
    case 'xbc-initial': return 'turn donk'
    case 'xbc-x': return 'vs check'
    case 'xbc-xb': return 'vs double-barrel'
    case 'xbc-b': return 'vs donk'
  }
  const segs = nodeId.split('-')
  // Turn nodes: `${flopLine}-${key}` (the named lines are handled above).
  if (segs.length === 2) {
    const key = segs[1]
    return key === 'initial' ? 'lead' : key === 'x' ? 'vs check'
      : key === 'xbr' ? 'vs check-raise' : key === 'br' ? 'vs raise' : 'vs bet'
  }
  // River nodes are `${flopLine}-${turnLine}-${key}` (3 segments).
  if (segs.length === 3) {
    const [flopLine, turnLine, key] = segs
    if (key === 'xbr') return 'vs check-raise'
    if (key === 'br') return 'vs raise'
    const line = `${flopLine}-${turnLine}`
    if (line === 'xbc-bc' && key === 'initial') return 'double-barrel'  // OOP donked turn, barrels again
    if (line === 'xbc-xbc') {                                           // IP c-bet flop + turn → river = barrel 3
      if (key === 'initial') return 'river donk'
      if (key === 'xb') return 'vs triple-barrel'
      if (key === 'b') return 'vs river donk'
    }
    if (line === 'xx-xbc') {                                            // IP (delayed) bet turn + river = barrel 2
      if (key === 'initial') return 'river donk'
      if (key === 'xb') return 'vs double-barrel'
      if (key === 'b') return 'vs river donk'
    }
    // OOP leading the river after the turn checked through is a probe.
    if (key === 'initial') return turnLine === 'xx' ? 'river probe' : 'lead'
    return key === 'x' ? 'vs check' : 'vs bet'
  }
  return nodeId
}

// Raw action notation for a closing line, e.g. xx → "X-X", xbc → "X-B-C".
export function lineSeq(lineId: string): string {
  return lineId === 'xx' ? 'X-X' : lineId === 'bc' ? 'B-C' : lineId === 'xbc' ? 'X-B-C'
    : lineId === 'xbrc' ? 'X-B-R-C' : lineId === 'brc' ? 'B-R-C' : lineId
}

// Canonical name for a flop-closing line (the turn-section selector bubbles).
export function lineLabel(lineId: string, pfa: FlopActor): string {
  if (lineId === 'xx') return 'check-check'
  if (lineId === 'bc') return pfa === 'oop' ? 'c-bet line' : 'donk line'
  if (lineId === 'xbc') return pfa === 'ip' ? 'c-bet line' : 'stab line'
  if (lineId === 'xbrc') return 'check-raise line'
  if (lineId === 'brc') return 'raise line'
  return lineId
}

// Canonical name for how the TURN closed, given the flop line (the river-section
// selector bubbles). bc = OOP bet turn; xbc = IP bet turn; xx = checked through.
export function turnLineLabel(flopLineId: string, turnLineId: string, pfa: FlopActor): string {
  if (flopLineId === 'xx' && turnLineId === 'xx') return 'check-down'  // checked through both streets
  if (turnLineId === 'xx') return 'check-check'
  if (turnLineId === 'bc') return nodeLabel(`${flopLineId}-initial`, pfa)        // OOP led the turn
  if (turnLineId === 'xbc') return nodeLabel(`${flopLineId}-xb`, pfa).replace('vs ', '') // IP bet the turn
  return turnLineId
}

// Full name for a flop+turn river line, e.g. "c-bet double-barrel".
export function riverLineLabel(flopLineId: string, turnLineId: string, pfa: FlopActor): string {
  if (flopLineId === 'xx' && turnLineId === 'xx') return 'check-down'
  const flop = lineLabel(flopLineId, pfa).replace(' line', '')
  return `${flop} ${turnLineLabel(flopLineId, turnLineId, pfa)}`
}

const CHK: PathStep = { actor: 'oop', type: 'check' }
const BET: PathStep = { actor: 'oop', type: 'bet' }

const IP_BET: PathStep = { actor: 'ip', type: 'bet' }
const IP_RAISE: PathStep = { actor: 'ip', type: 'raise' }
const OOP_RAISE: PathStep = { actor: 'oop', type: 'raise' }
const IP_CALL: PathStep = { actor: 'ip', type: 'call' }
const OOP_CALL: PathStep = { actor: 'oop', type: 'call' }

// Flop decision nodes. col 0 = after one action, col 1 = after a raise.
const FLOP_NODES: NodeDef[] = [
  { id: 'flop-initial', label: 'Flop — OOP first to act', short: 'first', street: 'flop', path: [], acting: 'oop', col: 0 },
  { id: 'flop-x', label: 'Flop — IP facing a check', short: 'X', street: 'flop', path: [CHK], acting: 'ip', col: 0 },
  { id: 'flop-xb', label: 'Flop — OOP facing a c-bet', short: 'X-B', street: 'flop', path: [CHK, IP_BET], acting: 'oop', col: 0 },
  { id: 'flop-b', label: 'Flop — IP facing a bet', short: 'B', street: 'flop', path: [BET], acting: 'ip', col: 0 },
  { id: 'flop-xbr', label: 'Flop — IP facing a check-raise', short: 'X-B-R', street: 'flop', path: [CHK, IP_BET, OOP_RAISE], acting: 'ip', col: 1 },
  { id: 'flop-br', label: 'Flop — OOP facing a raise', short: 'B-R', street: 'flop', path: [BET, IP_RAISE], acting: 'oop', col: 1 },
]

export interface ClosingLine { id: string; label: string; path: PathStep[] }
// Flop-closing lines (incl. raise lines) — each reaches the turn.
const FLOP_LINES: ClosingLine[] = [
  { id: 'xx', label: 'X-X', path: [CHK, { actor: 'ip', type: 'check' }] },
  { id: 'bc', label: 'B-C', path: [BET, IP_CALL] },
  { id: 'xbc', label: 'X-B-C', path: [CHK, IP_BET, OOP_CALL] },
  { id: 'xbrc', label: 'X-B-R-C', path: [CHK, IP_BET, OOP_RAISE, IP_CALL] },
  { id: 'brc', label: 'B-R-C', path: [BET, IP_RAISE, OOP_CALL] },
]
// Turn-closing lines (no turn raises) — each reaches the river.
const TURN_LINES: ClosingLine[] = FLOP_LINES.slice(0, 3)

// Decision prefixes shared by every street. col 0 = after one action,
// col 1 = facing a raise (vs check-raise for IP, vs raise for OOP).
const DECISIONS: { key: string; short: string; steps: PathStep[]; acting: FlopActor; col: number }[] = [
  { key: 'initial', short: 'first', steps: [], acting: 'oop', col: 0 },
  { key: 'x', short: 'X', steps: [CHK], acting: 'ip', col: 0 },
  { key: 'xb', short: 'X-B', steps: [CHK, IP_BET], acting: 'oop', col: 0 },
  { key: 'b', short: 'B', steps: [BET], acting: 'ip', col: 0 },
  { key: 'xbr', short: 'X-B-R', steps: [CHK, IP_BET, OOP_RAISE], acting: 'ip', col: 1 },
  { key: 'br', short: 'B-R', steps: [BET, IP_RAISE], acting: 'oop', col: 1 },
]

// Turn decision nodes mirror the flop set, one block per flop-closing line.
function turnNodes(cl: ClosingLine): NodeDef[] {
  return DECISIONS.map(d => ({
    id: `${cl.id}-${d.key}`, label: `Turn (${cl.label}) — ${d.key}`, short: d.short,
    street: 'turn' as Street, path: cl.path, turnPath: d.steps, acting: d.acting, col: d.col,
  }))
}

// River decision nodes, one block per (flop line × turn line) pair.
function riverNodes(fl: ClosingLine, tl: ClosingLine): NodeDef[] {
  return DECISIONS.map(d => ({
    id: `${fl.id}-${tl.id}-${d.key}`, label: `River (${fl.label} / ${tl.label}) — ${d.key}`, short: d.short,
    street: 'river' as Street, path: fl.path, turnPath: tl.path, riverPath: d.steps, acting: d.acting, col: d.col,
  }))
}

export const NODES: NodeDef[] = [
  ...FLOP_NODES,
  ...FLOP_LINES.flatMap(turnNodes),
  ...FLOP_LINES.flatMap(fl => TURN_LINES.flatMap(tl => riverNodes(fl, tl))),
]
const NODE_BY_ID = new Map(NODES.map(n => [n.id, n]))
export const getNode = (id: string) => NODE_BY_ID.get(id)

const otherSeat = (a: FlopActor): FlopActor => (a === 'oop' ? 'ip' : 'oop')

// ---- node breakdown ----
// Bet-size buckets by % of pot for the aggressive actions, so the detail bars can
// shade a bet/raise by sizing: [ <40%, 40–70%, >70% ]. Keyed by action ('bet'/'raise').
export type SizeBuckets = Record<string, [number, number, number]>
const sizeBucket = (pct: number) => (pct < 0.4 ? 0 : pct <= 0.7 ? 1 : 2)
function addSize(sizes: SizeBuckets, action: string, betPct: number | undefined) {
  if ((action === 'bet' || action === 'raise') && betPct !== undefined) {
    const arr = sizes[action] ?? [0, 0, 0]
    arr[sizeBucket(betPct)]++
    sizes[action] = arr
  }
}

export interface ClassRow {
  key: string
  counts: Record<string, number>
  sizes: SizeBuckets
  total: number
  sub: { label: string; counts: Record<string, number>; sizes: SizeBuckets; total: number }[]
}
export interface NodeResult {
  label: string
  acting: FlopActor
  total: number
  actionCounts: Record<string, number>  // outcome distribution over ALL reaching spots
  rows: ClassRow[]                        // hand-class breakdown (classified spots only)
  handIds: string[]                       // reaching hands (for drill-down — fetched by id)
}

// Strongest → weakest. Interleaves the PLO ladder (overpair/top/middle/bottom/
// pocket pair) and the Hold'em ladder (overpair/top/underpair/2nd/3rd/weak pair,
// then A-hi/K-hi) — each game only ever emits its own set, so the cross-game
// ordering is cosmetic; both games' internal orders are preserved.
const CLASS_ORDER = [
  'straight flush', 'quads', 'full house', 'flush', 'straight', 'set', 'trips', 'two pair',
  'overpair', 'top pair', 'underpair', '2nd pair', 'middle pair', '3rd pair', 'bottom pair',
  'weak pair', 'pocket pair', 'A-hi', 'K-hi', 'draw', 'air',
]
const sum = (c: Record<string, number>) => Object.values(c).reduce((a, b) => a + b, 0)

function pathMatches(actions: FlopAction[], path: PathStep[]): boolean {
  if (actions.length < path.length) return false
  return path.every((p, i) => actions[i].actor === p.actor && actions[i].type === p.type)
}

// The action stream + the index of this node's decision within it.
const streamOf = (s: FlopSpot, node: NodeDef) =>
  node.street === 'flop' ? s.actions : node.street === 'turn' ? s.turnActions : s.riverActions
const inStreetPath = (node: NodeDef) =>
  node.street === 'flop' ? node.path : node.street === 'turn' ? (node.turnPath ?? []) : (node.riverPath ?? [])
const decisionIndex = (node: NodeDef) => inStreetPath(node).length
// A given actor's hand class at the node's street.
const classFor = (s: FlopSpot, node: NodeDef, actor: FlopActor) =>
  node.street === 'flop' ? (actor === 'oop' ? s.oopClass : s.ipClass)
    : node.street === 'turn' ? (actor === 'oop' ? s.oopTurnClass : s.ipTurnClass)
    : (actor === 'oop' ? s.oopRiverClass : s.ipRiverClass)
const classOf = (s: FlopSpot, node: NodeDef) => classFor(s, node, node.acting)

// Bet the hero faces = the action right before their decision.
export type BetBucket = 'all' | 'sm' | 'md' | 'lg'
const sizeBucketOf = (p?: number): BetBucket | null => (p === undefined ? null : p < 0.4 ? 'sm' : p <= 0.7 ? 'md' : 'lg')
const facedBetPct = (s: FlopSpot, node: NodeDef): number | undefined => {
  const di = decisionIndex(node)
  const a = di > 0 ? streamOf(s, node)[di - 1] : undefined
  return a && (a.type === 'bet' || a.type === 'raise') ? a.betPct : undefined
}

// Does a spot reach this node, with the right player on the clock?
function reaches(s: FlopSpot, node: NodeDef): boolean {
  if (node.street === 'flop') {
    return pathMatches(s.actions, node.path) && s.actions[node.path.length]?.actor === node.acting
  }
  // flop action must be EXACTLY the closing line before the turn opens
  if (!(s.actions.length === node.path.length && pathMatches(s.actions, node.path))) return false
  const tp = node.turnPath ?? []
  if (node.street === 'turn') {
    return pathMatches(s.turnActions, tp) && s.turnActions[tp.length]?.actor === node.acting
  }
  // river node: turn action must be EXACTLY its closing line, then match the river prefix.
  const rp = node.riverPath ?? []
  return s.turnActions.length === tp.length && pathMatches(s.turnActions, tp) &&
    pathMatches(s.riverActions, rp) && s.riverActions[rp.length]?.actor === node.acting
}

function nodeBreakdown(spots: FlopSpot[], node: NodeDef): NodeResult {
  const reaching = spots.filter(s => reaches(s, node))
  const di = decisionIndex(node)

  type Agg = { counts: Record<string, number>; sizes: SizeBuckets }
  const newAgg = (): Agg => ({ counts: {}, sizes: {} })
  const actionCounts: Record<string, number> = {}
  const top = new Map<string, Agg & { subs: Map<string, Agg> }>()
  for (const s of reaching) {
    const act = streamOf(s, node)[di]
    const oc = act.type
    actionCounts[oc] = (actionCounts[oc] || 0) + 1
    const hc = classOf(s, node)
    if (!hc) continue
    const key = hc.made ?? (hc.draws.length ? 'draw' : 'air')
    const t = top.get(key) ?? { ...newAgg(), subs: new Map<string, Agg>() }
    t.counts[oc] = (t.counts[oc] || 0) + 1
    addSize(t.sizes, oc, act.betPct)
    const su = t.subs.get(hc.sub) ?? newAgg()
    su.counts[oc] = (su.counts[oc] || 0) + 1
    addSize(su.sizes, oc, act.betPct)
    t.subs.set(hc.sub, su)
    top.set(key, t)
  }
  const rows = CLASS_ORDER.filter(k => top.has(k)).map(k => {
    const t = top.get(k)!
    const sub = [...t.subs.entries()].map(([label, v]) => ({ label, counts: v.counts, sizes: v.sizes, total: sum(v.counts) })).sort((a, b) => subRank(a.label) - subRank(b.label))
    return { key: k, counts: t.counts, sizes: t.sizes, total: sum(t.counts), sub }
  })
  return { label: node.label, acting: node.acting, total: reaching.length, actionCounts, rows, handIds: reaching.map(s => s.handId) }
}

export type YesNoAny = 'any' | 'yes' | 'no'
export type SuitFilter = SuitTexture | 'any'
export interface PostflopFilter {
  // suit / paired / straight evaluated per street (turn = 4-card board,
  // river = 5-card board); flop fields are the 3-card board.
  suits: SuitFilter
  paired: YesNoAny
  straight: YesNoAny
  turnSuits: SuitFilter
  turnPaired: YesNoAny
  turnStraight: YesNoAny
  riverSuits: SuitFilter
  riverPaired: YesNoAny
  riverStraight: YesNoAny
  // flop card-rank selectors: allowed ranks for the high / 2nd-high / 3rd-high
  // flop card (empty = any). Pairs match either row (QQ2 → Q is both high & mid).
  flopHigh: string[]
  flopMid: string[]
  flopLow: string[]
}
export type PostflopMode = 'hero' | 'population'

export const EMPTY_FILTER: PostflopFilter = {
  suits: 'any', paired: 'any', straight: 'any',
  turnSuits: 'any', turnPaired: 'any', turnStraight: 'any',
  riverSuits: 'any', riverPaired: 'any', riverStraight: 'any',
  flopHigh: [], flopMid: [], flopLow: [],
}

// Filter ⇆ URL query (so board filters survive drill-down / back / refresh).
export function parseFilter(q: URLSearchParams): PostflopFilter {
  const yn = (v: string | null): YesNoAny => (v === 'yes' || v === 'no' ? v : 'any')
  const su = (v: string | null): SuitFilter => (['nofd', 'fd', 'dfd', 'flush'] as const).includes(v as SuitTexture) ? (v as SuitTexture) : 'any'
  const ranks = (v: string | null) => (v ? v.split(',').filter(r => RANKS_DESC.includes(r)) : [])
  return {
    suits: su(q.get('suits')), paired: yn(q.get('paired')), straight: yn(q.get('straight')),
    turnSuits: su(q.get('tsuits')), turnPaired: yn(q.get('tpaired')), turnStraight: yn(q.get('tstraight')),
    riverSuits: su(q.get('rsuits')), riverPaired: yn(q.get('rpaired')), riverStraight: yn(q.get('rstraight')),
    flopHigh: ranks(q.get('fh')), flopMid: ranks(q.get('fm')), flopLow: ranks(q.get('fc')),
  }
}
export function writeFilter(q: URLSearchParams, f: PostflopFilter) {
  if (f.suits !== 'any') q.set('suits', f.suits)
  if (f.paired !== 'any') q.set('paired', f.paired)
  if (f.straight !== 'any') q.set('straight', f.straight)
  if (f.turnSuits !== 'any') q.set('tsuits', f.turnSuits)
  if (f.turnPaired !== 'any') q.set('tpaired', f.turnPaired)
  if (f.turnStraight !== 'any') q.set('tstraight', f.turnStraight)
  if (f.riverSuits !== 'any') q.set('rsuits', f.riverSuits)
  if (f.riverPaired !== 'any') q.set('rpaired', f.riverPaired)
  if (f.riverStraight !== 'any') q.set('rstraight', f.riverStraight)
  if (f.flopHigh.length) q.set('fh', f.flopHigh.join(','))
  if (f.flopMid.length) q.set('fm', f.flopMid.join(','))
  if (f.flopLow.length) q.set('fc', f.flopLow.join(','))
}

// ---- spot extraction + filtering ----
export function extractSpots(hands: ParsedHand[]): FlopSpot[] {
  const out: FlopSpot[] = []
  for (const h of hands) { const s = extractFlopSpot(h); if (s) out.push(s) }
  return out
}
// yes/no filter on an optional flag; when the board hasn't reached that street
// (cond === undefined) an active yes/no filter excludes the spot.
const matchYN = (v: YesNoAny, cond: boolean | undefined) =>
  v === 'any' || (cond !== undefined && cond === (v === 'yes'))
// `fd` is the superset of flush-draw boards, so it also matches double-flush-draw.
const matchSuit = (v: SuitFilter, t: SuitTexture | undefined) =>
  v === 'any' || t === v || (v === 'fd' && t === 'dfd')
const matchRank = (sel: string[], rank: string | undefined) =>
  sel.length === 0 || (rank !== undefined && sel.includes(rank))

function filterFormation(spots: FlopSpot[], f: Formation, filter: PostflopFilter): FlopSpot[] {
  return spots.filter(s =>
    s.potType === f.potType &&
    f.oopRoles.includes(s.oopPos) &&
    f.ipRoles.includes(s.ipPos) &&
    matchSuit(filter.suits, s.texture.suits) &&
    matchYN(filter.paired, s.texture.paired) &&
    matchYN(filter.straight, s.straighty) &&
    matchSuit(filter.turnSuits, s.turnSuits) &&
    matchYN(filter.turnPaired, s.turnPaired) &&
    matchYN(filter.turnStraight, s.turnStraighty) &&
    matchSuit(filter.riverSuits, s.riverSuits) &&
    matchYN(filter.riverPaired, s.riverPaired) &&
    matchYN(filter.riverStraight, s.riverStraighty) &&
    matchRank(filter.flopHigh, s.flopRanks[0]) &&
    matchRank(filter.flopMid, s.flopRanks[1]) &&
    matchRank(filter.flopLow, s.flopRanks[2]))
}
const actingIsMe = (s: FlopSpot, a: FlopActor) => (a === 'oop' ? s.oopIsHero : s.ipIsHero)
const heroInvolved = (s: FlopSpot) => s.oopIsHero || s.ipIsHero
const cardsOf = (s: FlopSpot, a: FlopActor) => (a === 'oop' ? s.oopCards : s.ipCards)

// ---- detail report: one node + its prior / responses (mirrors the old scenarios) ----
function deriveNodes(node: NodeDef): { heroNode: NodeDef; prior?: NodeDef; responses: NodeDef[] } {
  const sp = inStreetPath(node)
  const mk = (steps: PathStep[], acting: FlopActor, id: string, label: string): NodeDef =>
    node.street === 'flop'
      ? { id, label, short: '', street: 'flop', path: steps, acting }
      : node.street === 'turn'
        ? { id, label, short: '', street: 'turn', path: node.path, turnPath: steps, acting }
        : { id, label, short: '', street: 'river', path: node.path, turnPath: node.turnPath, riverPath: steps, acting }
  const vill = otherSeat(node.acting)

  let prior: NodeDef | undefined
  if (sp.length > 0) {
    const last = sp[sp.length - 1]
    const lbl = last.type === 'bet' ? 'Villain — their bet' : last.type === 'raise' ? 'Villain — their raise' : 'Villain — vs the check'
    prior = mk(sp.slice(0, -1), last.actor, `${node.id}~prior`, lbl)
  }

  const responses: NodeDef[] = []
  const betPending = sp.length > 0 && (sp[sp.length - 1].type === 'bet' || sp[sp.length - 1].type === 'raise')
  if (betPending) {
    responses.push(mk([...sp, { actor: node.acting, type: 'raise' }], vill, `${node.id}~r`, 'Villain vs your raise'))
  } else if (sp.length === 0) {
    responses.push(mk([...sp, { actor: node.acting, type: 'check' }], vill, `${node.id}~rc`, 'Villain after your check'))
    responses.push(mk([...sp, { actor: node.acting, type: 'bet' }], vill, `${node.id}~rb`, 'Villain vs your bet'))
  } else {
    responses.push(mk([...sp, { actor: node.acting, type: 'bet' }], vill, `${node.id}~rb`, 'Villain vs your bet'))
  }
  return { heroNode: node, prior, responses }
}

// The RANGE the hero faces: the opponent's hand-class composition over the spots
// reaching the node, strongest→weakest (only classified/showdown hands).
export interface RangeComp { rows: { key: string; count: number }[]; total: number; handIds: string[] }
function rangeComposition(spots: FlopSpot[], node: NodeDef, actor: FlopActor): RangeComp {
  const counts = new Map<string, number>()
  const handIds: string[] = []
  let total = 0
  for (const s of spots) {
    if (!reaches(s, node)) continue
    handIds.push(s.handId)
    const hc = classFor(s, node, actor)
    if (!hc) continue
    const key = hc.made ?? (hc.draws.length ? 'draw' : 'air')
    counts.set(key, (counts.get(key) || 0) + 1); total++
  }
  return { rows: CLASS_ORDER.filter(k => counts.has(k)).map(k => ({ key: k, count: counts.get(k)! })), total, handIds }
}

// Does this node's decision face a bet/raise (vs a check / being first to act)?
export function nodeFacesBet(node: NodeDef): boolean {
  const sp = inStreetPath(node)
  const last = sp[sp.length - 1]
  return !!last && (last.type === 'bet' || last.type === 'raise')
}

export interface ScenarioReport {
  heroNode: NodeResult
  prior?: NodeResult
  responses: NodeResult[]
  facedRange?: RangeComp   // the villain range you're facing (composition), when facing an action
  // hands reaching your node, with YOUR cards/class
  listSpots: { spot: FlopSpot; action: FlopActType; betPct?: number; cards: ParsedCard[] | null; klass?: HandClass }[]
}

export function formationReport(
  spots: FlopSpot[], formationId: string, nodeId: string, mode: PostflopMode, filter: PostflopFilter, facedBet: BetBucket = 'all',
): ScenarioReport {
  const formation = FORMATIONS.find(f => f.id === formationId) ?? FORMATIONS[0]
  const node = NODE_BY_ID.get(nodeId) ?? NODES[0]
  let base = filterFormation(spots, formation, filter)
  const { heroNode, prior, responses } = deriveNodes(node)
  // Bet-size filter: keep only hands where the bet you face is that size, so the
  // preceding/decision/response panels all narrow to that size together.
  if (facedBet !== 'all') base = base.filter(s => reaches(s, node) && sizeBucketOf(facedBetPct(s, node)) === facedBet)

  // Per-DECISION subject: in 'hero' mode the acting player is you; in
  // 'population' mode it's anyone but you (so we keep opponents' decisions even
  // from hands you played). Villain (prior/response) nodes are always the
  // field's decisions (any non-you actor).
  const heroSpots = mode === 'hero' ? base.filter(s => actingIsMe(s, node.acting)) : base.filter(s => !actingIsMe(s, node.acting))
  const villSeat = otherSeat(node.acting)
  const villainSpots = base.filter(s => !actingIsMe(s, villSeat))

  const di = decisionIndex(node)
  const listSpots = heroSpots
    .filter(s => reaches(s, node))
    .map(s => ({ spot: s, action: streamOf(s, node)[di].type, betPct: streamOf(s, node)[di].betPct, cards: cardsOf(s, node.acting), klass: classOf(s, node) }))

  return {
    heroNode: nodeBreakdown(heroSpots, heroNode),
    prior: prior ? nodeBreakdown(villainSpots, prior) : undefined,
    responses: responses.map(r => nodeBreakdown(villainSpots, r)),
    // The range you face = the opponent's cards over the spots reaching your node.
    facedRange: prior ? rangeComposition(base, node, villSeat) : undefined,
    listSpots,
  }
}

// ---- landing tree: every node's count + the line frequencies for drill-down ----
export interface TreeCell { id: string; short: string; acting: FlopActor; col: number; total: number; actionCounts: Record<string, number> }
export interface TreeTurnLine { id: string; freq: number; river: TreeCell[] }  // a flop+turn line → river nodes
export interface TreeLine { id: string; label: string; freq: number; turn: TreeCell[]; turnLines: TreeTurnLine[] }
export interface FormationTree { total: number; flop: TreeCell[]; lines: TreeLine[] }

export function formationTree(spots: FlopSpot[], formationId: string, mode: PostflopMode, filter: PostflopFilter): FormationTree {
  const formation = FORMATIONS.find(f => f.id === formationId) ?? FORMATIONS[0]
  const all = filterFormation(spots, formation, filter)
  const heroM = mode === 'hero'
  // Hands with usable data for this mode: hero = the ones you played; population
  // = every hand, since each has an opponent whose decisions are population data
  // (even hands you were in, just from the one side that isn't you).
  const dataBase = heroM ? all.filter(heroInvolved) : all
  // Per-decision pool: your decisions (hero) vs anyone-but-you's (population).
  const cell = (node: NodeDef): TreeCell => {
    const pool = heroM ? all.filter(s => actingIsMe(s, node.acting)) : all.filter(s => !actingIsMe(s, node.acting))
    const r = nodeBreakdown(pool, node)
    return { id: node.id, short: node.short, acting: node.acting, col: node.col ?? 0, total: r.total, actionCounts: r.actionCounts }
  }
  const lines = FLOP_LINES.map(fl => ({
    id: fl.id,
    label: fl.label,
    // flop line frequency = data hands that followed exactly this flop line and reached the turn
    freq: dataBase.filter(s => s.actions.length === fl.path.length && pathMatches(s.actions, fl.path) && s.turnCard).length,
    turn: turnNodes(fl).map(cell),
    turnLines: TURN_LINES.map(tl => ({
      id: tl.id,
      // turn line frequency = reached the river via exactly this flop line + turn line
      freq: dataBase.filter(s =>
        s.actions.length === fl.path.length && pathMatches(s.actions, fl.path) &&
        s.turnActions.length === tl.path.length && pathMatches(s.turnActions, tl.path) && s.riverCard).length,
      river: riverNodes(fl, tl).map(cell),
    })),
  }))
  return { total: dataBase.length, flop: FLOP_NODES.map(cell), lines }
}
