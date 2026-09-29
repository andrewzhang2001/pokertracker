import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseHandHistories } from '../poker/parsers'
import type { ParsedHand } from '../poker/types'
import { netForSeat } from '../poker/graph'

// pokernow.json is four hands from a real JSON export (names and ids replaced);
// pokernow.csv is the same four hands as the CSV log.
const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), 'fixtures')
const jsonText = readFileSync(resolve(fixtures, 'pokernow.json'), 'utf-8')
const csvText = readFileSync(resolve(fixtures, 'pokernow.csv'), 'utf-8')
const fromJson = parseHandHistories(jsonText)
const fromCsv = parseHandHistories(csvText)

const withoutRawText = ({ rawText, ...hand }: ParsedHand) => hand
const handNumbered = (n: number) => fromJson[n - 1]
const heroOf = (hand: ParsedHand) => hand.players.find(p => p.isMe)

describe('PokerNow JSON export', () => {
  test('parses every hand', () => {
    expect(fromJson).toHaveLength(4)
    expect(fromJson.every(h => h.site === 'pokernow' && h.gameType === 'HOLDEM No Limit')).toBe(true)
  })

  test('the exporter is the hero in every hand, with their hole cards dealt', () => {
    for (const hand of fromJson) {
      const hero = heroOf(hand)
      expect(hero?.sourceName).toBe('Hero @ player0')
      expect(hand.actions.some(a => a.type === 'deal_hole' && a.seatNumber === hero?.seatNumber)).toBe(true)
    }
  })

  test('seat identities use the CSV "name @ id" shape', () => {
    const names = new Set(fromJson.flatMap(h => h.players.map(p => p.sourceName)))
    expect([...names].every(n => /^.+ @ player\d$/.test(n ?? ''))).toBe(true)
  })

  test('the first postflop wager is a bet and later ones are raises', () => {
    const turnWagers = handNumbered(1).actions.filter(a => a.street === 'turn' && (a.type === 'bet' || a.type === 'raise'))
    expect(turnWagers.map(a => a.type)).toEqual(['bet'])
    const preflopWagers = handNumbered(1).actions.filter(a => a.street === 'preflop' && (a.type === 'bet' || a.type === 'raise'))
    expect(preflopWagers.map(a => a.type)).toEqual(['raise'])
  })

  test('a missing small blind is dead money that leaves the blind levels alone', () => {
    const hand = fromJson.find(h => h.actions.some(a => a.type === 'post_ante'))!
    expect([hand.smallBlind, hand.bigBlind]).toEqual([10, 20])
    expect(hand.players.reduce((sum, p) => sum + netForSeat(hand, p.seatNumber), 0)).toBeCloseTo(0)
  })

  test('rawText re-parses to the same hand, hero included', () => {
    for (const hand of fromJson) {
      expect(parseHandHistories(hand.rawText)).toEqual([hand])
    }
  })
})

// One three-handed hand with a 10-chip ante, blinds 10/20, and a 40 straddle.
// PokerNow records each stack after the ante is taken (990 of 1000).
const anteExport = JSON.stringify({
  playerId: 'p1',
  hands: [{
    id: 'ante1', number: '1', gameType: 'th', smallBlind: 10, bigBlind: 20, ante: 10,
    dealerSeat: 1, straddleSeat: 1, startedAt: 1789946879125,
    players: [
      { id: 'p1', name: 'Hero', seat: 1, stack: 990, hand: ['Ah', 'Kh'] },
      { id: 'p2', name: 'Sam', seat: 2, stack: 990 },
      { id: 'p3', name: 'Lee', seat: 3, stack: 990 },
    ],
    events: [
      { type: 13, seat: 1, value: 10 }, { type: 13, seat: 2, value: 10 }, { type: 13, seat: 3, value: 10 },
      { type: 3, seat: 2, value: 10 }, { type: 2, seat: 3, value: 20 }, { type: 6, seat: 1, value: 40 },
      { type: 7, seat: 2, value: 40 }, { type: 11, seat: 3 },
      { type: 9, turn: 1, run: 1, cards: ['2c', '7d', '9s'] },
      { type: 0, seat: 2 }, { type: 0, seat: 1 },
      { type: 15 },
      { type: 10, seat: 1, value: 130, pot: 130 },
    ].map((payload, at) => ({ at, payload })),
  }],
})

describe('PokerNow JSON antes and straddles', () => {
  const [hand] = parseHandHistories(anteExport)

  test('each ante is a dead post and is added back onto the recorded stack', () => {
    expect(hand.actions.filter(a => a.type === 'post_ante').map(a => a.seatNumber)).toEqual([1, 2, 3])
    expect(hand.players.map(p => p.startingStack)).toEqual([1000, 1000, 1000])
  })

  test('the straddle is a live post, so every seat nets its real result', () => {
    expect(hand.players.map(p => netForSeat(hand, p.seatNumber))).toEqual([4, -2.5, -1.5])
  })

  test('rawText re-parses to the same hand', () => {
    expect(parseHandHistories(hand.rawText)).toEqual([hand])
  })
})

describe('PokerNow CSV and JSON exports of the same hands', () => {
  test('parse to identical hands apart from rawText', () => {
    expect(fromCsv.map(withoutRawText)).toEqual(fromJson.map(withoutRawText))
  })
})
