import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseHandHistories } from '../poker/parsers'
import type { ParsedHand } from '../poker/types'

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

  test('a missing small blind post leaves the blind levels alone', () => {
    const hand = fromJson.find(h => h.actions.filter(a => a.type === 'post_blind').length === 3)!
    expect([hand.smallBlind, hand.bigBlind]).toEqual([10, 20])
  })

  test('rawText re-parses to the same hand, hero included', () => {
    for (const hand of fromJson) {
      expect(parseHandHistories(hand.rawText)).toEqual([hand])
    }
  })
})

describe('PokerNow CSV and JSON exports of the same hands', () => {
  test('parse to identical hands apart from rawText', () => {
    expect(fromCsv.map(withoutRawText)).toEqual(fromJson.map(withoutRawText))
  })
})
