import { readFileSync } from 'fs'
import { dirname, resolve } from 'path'
import { fileURLToPath } from 'url'
import { describe, expect, it } from 'vitest'
import { parseHandHistories } from '../../shared/poker/parsers'
import { canonicalizeHand } from '../../shared/poker/canonicalHand'
import { seatIdentities } from '../pipeline/seatIdentities'

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), '../../shared/__tests__/fixtures')

// Import-time identities must survive the trip through stored raw_text.
describe.each(['pokernow.csv', 'pokernow.json'])('seatIdentities from %s', file => {
  const hands = parseHandHistories(readFileSync(resolve(fixtures, file), 'utf-8'))

  it('has PokerNow hands to check', () => {
    expect(hands.some(h => h.players.some(p => p.sourceName))).toBe(true)
  })

  it('recovers every seat identity from the stored raw_text', () => {
    for (const hand of hands) {
      const stored = canonicalizeHand(hand).raw_text
      const expected = new Map(hand.players.filter(p => p.sourceName).map(p => [p.seatNumber, p.sourceName]))
      expect(seatIdentities(stored, hand.handId)).toEqual(expected)
    }
  })
})

describe('seatIdentities', () => {
  it('is empty for unparseable raw_text', () => {
    expect(seatIdentities('not a hand history', 'x').size).toBe(0)
  })
})
