import type { ParsedCard, ParsedHand } from '../types'
import { buildHand, type PokerNowEvent, type PokerNowHand } from './pokernowHand'

// ---------------------------------------------------------------------------
// PokerNow JSON export parser (the newer export; pokernow.ts reads the CSV one).
//
// The file is `{ playerId, gameId, hands: [...] }`. Each hand lists its players
// (id, seat, name, starting stack, and the exporter's hole cards) and an
// `events` array of `{ at, payload: { type, … } }`. Amounts
// follow the CSV's total-level convention, so both read into a PokerNowHand and
// share pokernowHand.ts's builder.
//
// The exporter is named outright by `playerId`, so no hero detection is needed.
// ---------------------------------------------------------------------------

interface JsonPlayer { id: string; seat: number; name: string; stack: number; hand?: (string | null)[] }
interface JsonPayload { type: number; seat?: number; value?: number; allIn?: boolean; turn?: number; run?: number; cards?: (string | null)[] }
interface JsonHand {
  id: string
  gameType: string
  dealerSeat: number
  startedAt: number
  players: JsonPlayer[]
  events: { at: number; payload: JsonPayload }[]
}
interface JsonExport { playerId: string; gameId?: string; hands: JsonHand[] }

// payload.type codes, named from what each one does in real exports.
const EV = {
  check: 0,
  bigBlind: 2,
  smallBlind: 3,
  missedBigBlind: 4,
  missingSmallBlind: 5,
  straddle: 6,
  call: 7,
  betOrRaise: 8,
  board: 9,
  collect: 10,
  fold: 11,
  show: 12,
  ante: 13,
  runItTwiceVote: 14,   // approved/denied seats; moves no chips, so ignored
  handEnd: 15,
  uncalled: 16,
} as const

const BOARD_STREET: Record<number, 'flop' | 'turn' | 'river'> = { 1: 'flop', 2: 'turn', 3: 'river' }

// Hand.gameType codes → the canonical "HOLDEM No Limit" shape. Unknown codes
// pass through uppercased.
const GAME_TYPES: Record<string, string> = { th: 'HOLDEM No Limit' }

const SUIT_SYMBOL: Record<ParsedCard['suit'], string> = { h: '♥', d: '♦', c: '♣', s: '♠' }

// "Th" → {rank:'T',suit:'h'}. Null entries are cards a player chose not to show.
function parseCards(cards: (string | null)[] | undefined): ParsedCard[] {
  return (cards ?? []).flatMap(card => {
    if (!card) return []
    const suit = card.slice(-1)
    if (!(suit in SUIT_SYMBOL)) return []
    const rank = card.slice(0, -1)
    return [{ rank: rank === '10' ? 'T' : rank, suit: suit as ParsedCard['suit'] }]
  })
}

// The CSV log's card text ("10♣, K♦"), used for the board action labels.
const cardLabel = (cards: ParsedCard[]) =>
  cards.map(c => (c.rank === 'T' ? '10' : c.rank) + SUIT_SYMBOL[c.suit]).join(', ')

function readExport(text: string): JsonExport | null {
  try {
    const data = JSON.parse(text)
    return Array.isArray(data?.hands) ? data : null
  } catch {
    return null
  }
}

function readEvents(hand: JsonHand): PokerNowEvent[] {
  const events: PokerNowEvent[] = []
  // A postflop street's first wager is a bet; every later one (and every one
  // preflop, over the blinds) is a raise.
  let streetHasWager = false
  const post = (seat: number, amount: number, blind: 'small' | 'big' | 'other') => {
    streetHasWager = true
    events.push({ kind: 'post', seat, amount, blind })
  }

  for (const { payload: p } of hand.events) {
    const seat = p.seat ?? -1
    const value = p.value ?? 0
    const allin = !!p.allIn
    switch (p.type) {
      case EV.smallBlind: post(seat, value, 'small'); break
      case EV.bigBlind: post(seat, value, 'big'); break
      case EV.missedBigBlind:
      case EV.straddle: post(seat, value, 'other'); break
      case EV.missingSmallBlind: events.push({ kind: 'dead', seat, amount: value, what: 'small blind' }); break
      case EV.ante: events.push({ kind: 'dead', seat, amount: value, what: 'ante' }); break
      case EV.fold: events.push({ kind: 'fold', seat }); break
      case EV.check: events.push({ kind: 'check', seat }); break
      case EV.call: events.push({ kind: 'call', seat, level: value, allin }); break
      case EV.betOrRaise:
        events.push(streetHasWager ? { kind: 'raise', seat, total: value, allin } : { kind: 'bet', seat, amount: value, allin })
        streetHasWager = true
        break
      case EV.board: {
        const street = BOARD_STREET[p.turn ?? 0]
        if (!street || p.run !== 1) break // second run of a run-it-twice board
        const cards = parseCards(p.cards)
        events.push({ kind: 'board', street, cards, label: cardLabel(cards) })
        streetHasWager = false
        break
      }
      case EV.uncalled: events.push({ kind: 'uncalled', seat, amount: value }); break
      case EV.collect: events.push({ kind: 'collect', seat, amount: value }); break
    }
  }
  return events
}

// Villain hole cards, in the order they were revealed: voluntary shows, and the
// cards a winner shows when collecting at showdown.
function readShown(hand: JsonHand, heroSeat: number | undefined): Map<number, ParsedCard[]> {
  const shown = new Map<number, ParsedCard[]>()
  for (const { payload: p } of hand.events) {
    if (p.type !== EV.show && p.type !== EV.collect) continue
    if (p.seat === undefined || p.seat === heroSeat || shown.has(p.seat)) continue
    const cards = parseCards(p.cards)
    if (cards.length) shown.set(p.seat, cards)
  }
  return shown
}

// Chips each seat paid in antes this hand.
function antesBySeat(hand: JsonHand): Map<number, number> {
  const paid = new Map<number, number>()
  for (const { payload: p } of hand.events) {
    if (p.type === EV.ante && p.seat !== undefined) paid.set(p.seat, (paid.get(p.seat) ?? 0) + (p.value ?? 0))
  }
  return paid
}

function readHand(hand: JsonHand, exp: JsonExport): PokerNowHand {
  const hero = hand.players.find(p => p.id === exp.playerId)
  // PokerNow records each player's stack after the ante is taken; add it back
  // so the stack is the one the hand started with.
  const antes = antesBySeat(hand)
  return {
    id: hand.id,
    gameType: GAME_TYPES[hand.gameType] ?? hand.gameType.toUpperCase(),
    at: new Date(hand.startedAt).toISOString(),
    seats: hand.players.map(p => ({ seat: p.seat, sourceName: `${p.name} @ ${p.id}`, stack: p.stack + (antes.get(p.seat) ?? 0) })),
    dealerSeat: hand.dealerSeat,
    heroSeat: hero?.seat,
    heroCards: hero ? parseCards(hero.hand) : undefined,
    shown: readShown(hand, hero?.seat),
    events: readEvents(hand),
    // This hand alone, in the export's own shape, so raw_text re-parses (hero included).
    rawText: JSON.stringify({ playerId: exp.playerId, gameId: exp.gameId, hands: [hand] }),
  }
}

export function detect(text: string): boolean {
  return /^\s*\{/.test(text) && readExport(text) !== null
}

export function parse(text: string): ParsedHand[] {
  const exp = readExport(text)
  if (!exp) return []
  return exp.hands.map(h => buildHand(readHand(h, exp)))
}

export function diagnose(text: string): string {
  const exp = readExport(text)
  if (!exp) return 'Could not read this as a PokerNow JSON export (expected an object with a "hands" array).'
  if (!exp.hands.length) return 'The PokerNow JSON export contains no hands.'
  return `Found ${exp.hands.length} hands but all failed an unknown parse step.`
}

export default { name: 'PokerNow (JSON)', detect, parse, diagnose }
