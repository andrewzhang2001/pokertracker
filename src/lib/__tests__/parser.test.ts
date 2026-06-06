import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseHandHistories } from '../parseHandHistory'
import { computeHandState } from '../computeHandState'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../../../')

const hh = readFileSync(resolve(root, 'hh.txt'), 'utf-8')
const hh2 = readFileSync(resolve(root, 'hh2.txt'), 'utf-8')
const hh3 = readFileSync(resolve(root, 'hh3.txt'), 'utf-8')

describe('hh.txt – tournament with antes', () => {
  const hands = parseHandHistories(hh)

  test('parses all hands', () => {
    expect(hands.length).toBeGreaterThanOrEqual(2)
  })

  describe('hand #5304371621 (9-player, antes present)', () => {
    const hand = hands.find(h => h.handId === '5304371621')!

    test('found', () => expect(hand).toBeDefined())
    test('bigBlind is 25, not 5 (ante)', () => expect(hand.bigBlind).toBe(25))
    test('9 players', () => expect(hand.players.length).toBe(9))
    test('Dealer is ME', () => {
      const me = hand.players.find(p => p.isMe)
      expect(me?.position).toBe('Dealer')
    })

    test('ME hole cards are 9s 2h', () => {
      const state = computeHandState(hand, hand.initialStep)
      const me = state.players.find(p => p.isMe)
      expect(me?.holeCards).toEqual([
        { rank: '9', suit: 's' },
        { rank: '2', suit: 'h' },
      ])
    })

    test('final pot is 855 (antes counted, not inflating raise math)', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.pot).toBe(855)
    })

    test('board has 5 cards: 7c 3h Qh 8s Ks', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.communityCards).toEqual([
        { rank: '7', suit: 'c' },
        { rank: '3', suit: 'h' },
        { rank: 'Q', suit: 'h' },
        { rank: '8', suit: 's' },
        { rank: 'K', suit: 's' },
      ])
    })
  })

  describe('hand #5304372288 (showdown + muck)', () => {
    const hand = hands.find(h => h.handId === '5304372288')!

    test('found', () => expect(hand).toBeDefined())

    test('UTG+2 hole cards remain [3h 5h], not overwritten by 5-card showdown combo', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      const utg2 = state.players.find(p => p.position === 'UTG+2')
      expect(utg2?.holeCards).toEqual([
        { rank: '3', suit: 'h' },
        { rank: '5', suit: 'h' },
      ])
    })

    test('UTG+1 hole cards set from Mucks action [9s Qd]', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      const utg1 = state.players.find(p => p.position === 'UTG+1')
      expect(utg1?.holeCards).toEqual([
        { rank: '9', suit: 's' },
        { rank: 'Q', suit: 'd' },
      ])
    })

    test('final pot is 2463', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.pot).toBe(2463)
    })
  })
})

describe('hh2.txt – 6-max tournament', () => {
  const hands = parseHandHistories(hh2)

  test('parses 2 hands', () => expect(hands.length).toBe(2))

  describe('hand #5304372092 (BB [ME] folds, pot 95)', () => {
    const hand = hands.find(h => h.handId === '5304372092')!

    test('found', () => expect(hand).toBeDefined())
    test('bigBlind is 25', () => expect(hand.bigBlind).toBe(25))
    test('6 players', () => expect(hand.players.length).toBe(6))
    test('Big Blind is ME', () => {
      const me = hand.players.find(p => p.isMe)
      expect(me?.position).toBe('Big Blind')
    })

    test('ME hole cards are 8s Ad', () => {
      const state = computeHandState(hand, hand.initialStep)
      const me = state.players.find(p => p.isMe)
      expect(me?.holeCards).toEqual([
        { rank: '8', suit: 's' },
        { rank: 'A', suit: 'd' },
      ])
    })

    test('final pot is 95 (return_bet applied)', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.pot).toBe(95)
    })
  })

  describe('hand #5304372346 (SB [ME] all-in, loses)', () => {
    const hand = hands.find(h => h.handId === '5304372346')!

    test('found', () => expect(hand).toBeDefined())
    test('Small Blind is ME', () => {
      const me = hand.players.find(p => p.isMe)
      expect(me?.position).toBe('Small Blind')
    })

    test('ME hole cards are Ah Jd', () => {
      const state = computeHandState(hand, hand.initialStep)
      const me = state.players.find(p => p.isMe)
      expect(me?.holeCards).toEqual([
        { rank: 'A', suit: 'h' },
        { rank: 'J', suit: 'd' },
      ])
    })

    test('board has 5 cards: 2h 7s Ad Qd 6s', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.communityCards).toEqual([
        { rank: '2', suit: 'h' },
        { rank: '7', suit: 's' },
        { rank: 'A', suit: 'd' },
        { rank: 'Q', suit: 'd' },
        { rank: '6', suit: 's' },
      ])
    })

    test('final pot is 985', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.pot).toBe(985)
    })
  })
})

describe('hh3.txt – cash game ($0.50/$1)', () => {
  const hands = parseHandHistories(hh3)

  test('parses at least 5 hands', () => {
    expect(hands.length).toBeGreaterThanOrEqual(5)
  })

  describe('hand #4809511473 (dead blind / straddle, 3-bet pot)', () => {
    const hand = hands.find(h => h.handId === '4809511473')!

    test('found', () => expect(hand).toBeDefined())
    test('bigBlind is 1', () => expect(hand.bigBlind).toBe(1))
    test('Dealer is ME', () => {
      const me = hand.players.find(p => p.isMe)
      expect(me?.position).toBe('Dealer')
    })

    test('ME hole cards are Th 9s', () => {
      const state = computeHandState(hand, hand.initialStep)
      const me = state.players.find(p => p.isMe)
      expect(me?.holeCards).toEqual([
        { rank: 'T', suit: 'h' },
        { rank: '9', suit: 's' },
      ])
    })

    test('final pot is 59.74 (dead blind + 3-bet + multi-street)', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.pot).toBeCloseTo(59.74, 2)
    })

    test('board has 5 cards: 4c 2c Jd Tc 9c', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.communityCards).toEqual([
        { rank: '4', suit: 'c' },
        { rank: '2', suit: 'c' },
        { rank: 'J', suit: 'd' },
        { rank: 'T', suit: 'c' },
        { rank: '9', suit: 'c' },
      ])
    })
  })

  describe('hand #4809512096 (UTG+1 [ME] folds, SB vs Dealer all-in)', () => {
    const hand = hands.find(h => h.handId === '4809512096')!

    test('found', () => expect(hand).toBeDefined())
    test('UTG+1 is ME', () => {
      const me = hand.players.find(p => p.isMe)
      expect(me?.position).toBe('UTG+1')
    })

    test('ME hole cards are Qs 4c', () => {
      const state = computeHandState(hand, hand.initialStep)
      const me = state.players.find(p => p.isMe)
      expect(me?.holeCards).toEqual([
        { rank: 'Q', suit: 's' },
        { rank: '4', suit: 'c' },
      ])
    })

    test('Small Blind hole cards are As Kh', () => {
      const state = computeHandState(hand, hand.initialStep)
      const sb = state.players.find(p => p.position === 'Small Blind')
      expect(sb?.holeCards).toEqual([
        { rank: 'A', suit: 's' },
        { rank: 'K', suit: 'h' },
      ])
    })

    test('board has 5 cards: 2s 4s Qd Ad 2d', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.communityCards).toEqual([
        { rank: '2', suit: 's' },
        { rank: '4', suit: 's' },
        { rank: 'Q', suit: 'd' },
        { rank: 'A', suit: 'd' },
        { rank: '2', suit: 'd' },
      ])
    })

    test('final pot is 261.28 (multi-street, all-in)', () => {
      const state = computeHandState(hand, hand.actions.length - 1)
      expect(state.pot).toBeCloseTo(261.28, 2)
    })
  })
})
