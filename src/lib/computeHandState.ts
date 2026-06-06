import type { ParsedCard, ParsedHand, HandState, PlayerState, Street } from './types'

function bbStr(amount: number, bigBlind: number): string {
  const v = amount / bigBlind
  return (Number.isInteger(v) ? String(v) : v.toFixed(2)) + 'bb'
}

export function computeHandState(hand: ParsedHand, stepIndex: number): HandState {
  const board: ParsedCard[] = []
  let pot = 0
  let street: Street = 'preflop'

  const playerMap = new Map<number, PlayerState>()
  for (const p of hand.players) {
    playerMap.set(p.seatNumber, {
      seatNumber: p.seatNumber,
      position: p.position,
      isMe: p.isMe,
      stack: p.startingStack,
      holeCards: null,
      folded: false,
      streetAction: null,
      streetBet: 0,
    })
  }

  const maxStep = Math.min(stepIndex, hand.actions.length - 1)

  for (let i = 0; i <= maxStep; i++) {
    const action = hand.actions[i]
    const p = action.seatNumber !== undefined ? playerMap.get(action.seatNumber) : undefined

    switch (action.type) {
      case 'post_ante':
      case 'post_blind':
        if (p && action.amount !== undefined) {
          p.stack -= action.amount
          p.streetBet += action.amount
          pot += action.amount
        }
        break

      case 'deal_hole':
        if (p && action.cards) p.holeCards = action.cards
        break

      case 'deal_flop':
      case 'deal_turn':
      case 'deal_river':
        if (action.cards) board.push(...action.cards)
        street = action.type === 'deal_flop' ? 'flop' : action.type === 'deal_turn' ? 'turn' : 'river'
        for (const ps of playerMap.values()) {
          ps.streetBet = 0
          ps.streetAction = null
        }
        break

      case 'fold':
        if (p) { p.folded = true; p.streetAction = 'Fold' }
        break

      case 'check':
        if (p) p.streetAction = 'Check'
        break

      case 'call':
        if (p && action.amount !== undefined) {
          p.stack -= action.amount
          p.streetBet += action.amount
          pot += action.amount
          p.streetAction = `Call ${bbStr(action.amount, hand.bigBlind)}`
        }
        break

      case 'raise': {
        if (p && action.amount !== undefined) {
          const additional = Math.max(0, action.amount - p.streetBet)
          p.stack -= additional
          pot += additional
          p.streetBet = action.amount
          p.streetAction = `Raise ${bbStr(action.amount, hand.bigBlind)}`
        }
        break
      }

      case 'bet':
        if (p && action.amount !== undefined) {
          p.stack -= action.amount
          p.streetBet += action.amount
          pot += action.amount
          p.streetAction = `Bet ${bbStr(action.amount, hand.bigBlind)}`
        }
        break

      case 'allin': {
        if (p && action.amount !== undefined) {
          const additional = Math.max(0, action.amount - p.streetBet)
          p.stack -= additional
          pot += additional
          p.streetBet = action.amount
          p.streetAction = `All-in ${bbStr(action.amount, hand.bigBlind)}`
        }
        break
      }

      case 'return_bet':
        if (p && action.amount !== undefined) {
          p.stack += action.amount
          pot -= action.amount
        }
        break

      case 'showdown':
      case 'doesnotshow':
        if (p && action.cards) p.holeCards = action.cards
        break

      case 'result':
        if (p && action.amount !== undefined) {
          p.stack += action.amount
        }
        break
    }
  }

  const lastAction = maxStep >= 0 ? (hand.actions[maxStep] ?? null) : null

  return {
    communityCards: board,
    street,
    players: Array.from(playerMap.values()),
    pot,
    lastAction,
  }
}
