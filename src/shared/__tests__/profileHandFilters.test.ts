import { describe, expect, it } from 'vitest'
import { sawFlop } from '../poker/profileStats'
import { voluntarilyEntered } from '../poker/analyzeHand'
import type { HandAction, ParsedHand } from '../poker/types'

const act = (type: HandAction['type'], street: HandAction['street'], seatNumber?: number): HandAction =>
  ({ type, street, seatNumber, desc: '' })

const hand = (actions: HandAction[]): ParsedHand => ({
  handId: 'h', tableId: 't', site: 'pokernow', date: '', playedAt: null, gameType: 'HOLDEM No Limit',
  currency: 'play', players: [], smallBlind: 1, bigBlind: 2, actions, initialStep: 0, rawText: '',
})

// Seat 1 = SB, seat 2 = BB, seat 3 = BTN.
const blinds = [act('post_blind', 'preflop', 1), act('post_blind', 'preflop', 2)]

describe('voluntarilyEntered', () => {
  it('counts a call or raise', () => {
    const h = hand([...blinds, act('raise', 'preflop', 3), act('call', 'preflop', 1), act('fold', 'preflop', 2)])
    expect(voluntarilyEntered(h, 3)).toBe(true)
    expect(voluntarilyEntered(h, 1)).toBe(true)
  })

  it('ignores blind posts and the BB check', () => {
    const h = hand([...blinds, act('fold', 'preflop', 3), act('call', 'preflop', 1), act('check', 'preflop', 2), act('deal_flop', 'flop')])
    expect(voluntarilyEntered(h, 2)).toBe(false)
  })

  it('counts a postflop bet after a free BB check', () => {
    const h = hand([...blinds, act('call', 'preflop', 1), act('check', 'preflop', 2), act('deal_flop', 'flop'), act('check', 'flop', 1), act('bet', 'flop', 2)])
    expect(voluntarilyEntered(h, 2)).toBe(true)
  })
})

describe('sawFlop', () => {
  const h = hand([...blinds, act('fold', 'preflop', 3), act('call', 'preflop', 1), act('check', 'preflop', 2), act('deal_flop', 'flop'), act('bet', 'flop', 1), act('fold', 'flop', 2)])

  it('is true for seats still in when the flop is dealt', () => {
    expect(sawFlop(h, 1)).toBe(true)
    expect(sawFlop(h, 2)).toBe(true)
  })

  it('is false for a preflop fold', () => {
    expect(sawFlop(h, 3)).toBe(false)
  })

  it('is false when no flop was dealt', () => {
    expect(sawFlop(hand([...blinds, act('raise', 'preflop', 3), act('fold', 'preflop', 1), act('fold', 'preflop', 2)]), 3)).toBe(false)
  })
})
