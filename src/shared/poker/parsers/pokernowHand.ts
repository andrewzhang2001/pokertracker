import type { ParsedCard, ParsedHand, PlayerInfo, HandAction, Street } from '../types'

// ---------------------------------------------------------------------------
// The PokerNow hand builder, shared by the CSV and JSON parsers.
//
// Both exports describe the same hands, so each parser reads its format into a
// PokerNowHand — seats, hole cards, and a normalized event stream — and
// buildHand turns that into a ParsedHand.
//
// Amounts are the *total* level a player is at on the street (a call says the
// amount matched-to, a raise says "raises to X"), unlike the additional-chips
// convention Ignition uses; we convert calls to the additional amount so
// computeHandState's stack math stays correct.
// ---------------------------------------------------------------------------

export interface PokerNowSeat {
  seat: number
  sourceName: string   // "name @ token", the identity MapPlayersModal keys on
  stack: number        // starting stack, before blinds
}

export type PokerNowEvent =
  | { kind: 'post'; seat: number; amount: number; blind: 'small' | 'big' | 'other' }
  | { kind: 'board'; street: 'flop' | 'turn' | 'river'; cards: ParsedCard[]; label: string }
  | { kind: 'fold' | 'check'; seat: number }
  | { kind: 'call'; seat: number; level: number; allin: boolean }   // level: the total matched-to
  | { kind: 'bet'; seat: number; amount: number; allin: boolean }   // first wager on a postflop street
  | { kind: 'raise'; seat: number; total: number; allin: boolean }
  | { kind: 'uncalled'; seat: number; amount: number }
  | { kind: 'collect'; seat: number; amount: number }

export interface PokerNowHand {
  id: string
  gameType: string                    // canonical "HOLDEM No Limit" / "OMAHA Pot Limit" shape
  at: string                          // ISO timestamp of the hand's start
  seats: PokerNowSeat[]
  dealerSeat: number | undefined
  heroSeat: number | undefined
  heroCards: ParsedCard[] | undefined
  shown: Map<number, ParsedCard[]>    // villain hole cards revealed during or after the hand
  events: PokerNowEvent[]
  rawText: string                     // a re-parseable source slice of this one hand
}

function bb(amount: number, bigBlind: number): string {
  const v = amount / bigBlind
  return (Number.isInteger(v) ? v : parseFloat(v.toFixed(2))) + 'bb'
}

// Seat labels in the app's vocabulary (see positionUtils). Play proceeds from the
// seat after the button: SB, BB, UTG, …. Heads-up the button *is* the SB.
function assignPositions(seats: number[], dealerSeat: number): Map<number, string> {
  const m = new Map<number, string>()
  const n = seats.length
  const bi = seats.indexOf(dealerSeat)
  if (n === 2) {
    m.set(dealerSeat, 'Small Blind')
    m.set(seats[(bi + 1) % 2], 'Big Blind')
    return m
  }
  const labels = ['Small Blind', 'Big Blind', 'UTG', 'UTG+1', 'UTG+2', 'UTG+3', 'UTG+4', 'UTG+5']
  m.set(dealerSeat, 'Dealer')
  for (let k = 1; k < n; k++) m.set(seats[(bi + k) % n], labels[k - 1] ?? `UTG+${k - 3}`)
  return m
}

export function buildHand(hand: PokerNowHand): ParsedHand {
  const seats = hand.seats.map(s => s.seat).sort((a, b) => a - b)
  const seatInfo = new Map(hand.seats.map(s => [s.seat, s]))
  const dealerIsSeated = hand.dealerSeat !== undefined && seatInfo.has(hand.dealerSeat)
  const posOf = dealerIsSeated ? assignPositions(seats, hand.dealerSeat!) : new Map<number, string>()

  const players: PlayerInfo[] = seats.map(seat => ({
    seatNumber: seat,
    position: posOf.get(seat) ?? String(seat),
    isMe: seat === hand.heroSeat,
    startingStack: seatInfo.get(seat)!.stack,
    sourceName: seatInfo.get(seat)!.sourceName,
  }))

  // Blind/straddle posts drive the blind levels and open the preflop street.
  const posts = hand.events.filter((e): e is Extract<PokerNowEvent, { kind: 'post' }> => e.kind === 'post')
  let smallBlind = 0, bigBlind = 1
  for (const p of posts) {
    if (p.blind === 'small') smallBlind = p.amount
    else if (p.blind === 'big') bigBlind = p.amount
  }

  const actions: HandAction[] = []
  // streetBet tracks each seat's committed chips on the current street, so a
  // "call to X" can be converted to the additional X − committed that
  // computeHandState expects. Reset on every street.
  const streetBet = new Map<number, number>()
  let street: Street = 'preflop'
  const nameOf = (seat: number) => players.find(p => p.seatNumber === seat)?.position ?? String(seat)

  // 1) Blinds first, then 2) hole cards — so the replayer opens with the blinds
  // already in the pot (matching the Ignition parser), regardless of where the
  // hero's cards fell in the source order.
  for (const { seat, amount } of posts) {
    streetBet.set(seat, (streetBet.get(seat) ?? 0) + amount)
    actions.push({ type: 'post_blind', seatNumber: seat, amount, street: 'preflop', desc: `${nameOf(seat)} posts ${bb(amount, bigBlind)}` })
  }

  // Hole cards known up front: the hero's plus any villain who shows. Emitted at
  // preflop so the replayer's "opponent cards" toggle can reveal a shown hand for
  // its whole replay, not just the last street.
  if (hand.heroCards && hand.heroSeat !== undefined) {
    actions.push({ type: 'deal_hole', seatNumber: hand.heroSeat, cards: hand.heroCards, street: 'preflop', desc: `${nameOf(hand.heroSeat)} dealt cards` })
  }
  for (const [seat, cards] of hand.shown) {
    actions.push({ type: 'deal_hole', seatNumber: seat, cards, street: 'preflop', desc: `${nameOf(seat)} shows` })
  }
  const initialStep = actions.length - 1

  // 3) The rest of the hand, in order: board cards, bets, wins.
  for (const e of hand.events) {
    switch (e.kind) {
      case 'post':
        break
      case 'board':
        street = e.street
        streetBet.clear()
        actions.push({ type: `deal_${e.street}`, cards: e.cards, street, desc: `${e.street[0].toUpperCase()}${e.street.slice(1)} [${e.label}]` })
        break
      case 'uncalled':
        streetBet.set(e.seat, (streetBet.get(e.seat) ?? 0) - e.amount)
        actions.push({ type: 'return_bet', seatNumber: e.seat, amount: e.amount, street, desc: `${nameOf(e.seat)} uncalled bet returned` })
        break
      case 'fold':
        actions.push({ type: 'fold', seatNumber: e.seat, street, desc: `${nameOf(e.seat)} folds` })
        break
      case 'check':
        actions.push({ type: 'check', seatNumber: e.seat, street, desc: `${nameOf(e.seat)} checks` })
        break
      case 'call': {
        const additional = Math.max(0, e.level - (streetBet.get(e.seat) ?? 0))
        streetBet.set(e.seat, e.level)
        actions.push({ type: e.allin ? 'allin' : 'call', seatNumber: e.seat, amount: e.allin ? e.level : additional, street, desc: `${nameOf(e.seat)} ${e.allin ? 'all-in' : 'calls'} ${bb(e.level, bigBlind)}` })
        break
      }
      case 'bet': {
        const cur = streetBet.get(e.seat) ?? 0
        streetBet.set(e.seat, cur + e.amount)
        actions.push({ type: e.allin ? 'allin' : 'bet', seatNumber: e.seat, amount: e.allin ? cur + e.amount : e.amount, street, desc: `${nameOf(e.seat)} ${e.allin ? 'all-in' : 'bets'} ${bb(e.amount, bigBlind)}` })
        break
      }
      case 'raise':
        streetBet.set(e.seat, e.total)
        actions.push({ type: e.allin ? 'allin' : 'raise', seatNumber: e.seat, amount: e.total, street, desc: `${nameOf(e.seat)} ${e.allin ? 'all-in' : 'raises'} ${bb(e.total, bigBlind)}` })
        break
      case 'collect':
        actions.push({ type: 'result', seatNumber: e.seat, amount: e.amount, street, desc: `${nameOf(e.seat)} wins ${bb(e.amount, bigBlind)}` })
        break
    }
  }

  const playedAt = Date.parse(hand.at)
  return {
    handId: hand.id,
    tableId: '',
    site: 'pokernow',
    date: hand.at,
    playedAt: Number.isFinite(playedAt) ? playedAt : null,
    gameType: hand.gameType,
    currency: 'USD',
    players,
    smallBlind,
    bigBlind,
    actions,
    initialStep,
    rawText: hand.rawText,
    // No rake in PokerNow home games — leaving totalPot undefined yields rake 0.
  }
}
