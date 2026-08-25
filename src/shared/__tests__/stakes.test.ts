import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseHandHistories } from '../poker/parsers'
import {
  handStake, stakesIn, filterByStake, parseStakes, writeStakes, stakeSelectionLabel,
} from '../poker/stakes'
import type { ParsedHand } from '../poker/types'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(__dirname, 'fixtures')

const plo = parseHandHistories(readFileSync(resolve(fixtures, 'hh_plo.txt'), 'utf-8'))   // OMAHA $0.10/$0.25
const nlhe = parseHandHistories(readFileSync(resolve(fixtures, 'hh3.txt'), 'utf-8'))     // HOLDEM $0.50/$1
const mtt = parseHandHistories(readFileSync(resolve(fixtures, 'hh.txt'), 'utf-8'))       // tournament (15/25)

// Minimal hand for the cases the fixtures don't cover (micro blinds, odd games).
function fakeHand(over: Partial<ParsedHand>): ParsedHand {
  return {
    handId: 'x', tableId: '', site: 'ignition', date: '', playedAt: 0,
    gameType: 'HOLDEM No Limit', currency: 'USD', players: [], smallBlind: 0.02,
    bigBlind: 0.05, actions: [], initialStep: 0, rawText: '', ...over,
  }
}

describe('handStake – naming the blind level', () => {
  test('PLO cash $0.10/$0.25 → PLO25', () => {
    expect(handStake(plo[0])).toEqual({ key: 'plo25', label: 'PLO25', bigBlind: 0.25 })
  })

  test("hold'em cash $0.50/$1 → 100NL", () => {
    expect(handStake(nlhe[0])).toEqual({ key: 'nl100', label: '100NL', bigBlind: 1 })
  })

  test('micro hold\'em $0.02/$0.05 → 5NL (no float dust in the label)', () => {
    expect(handStake(fakeHand({})).label).toBe('5NL')
    expect(handStake(fakeHand({ handId: 'y', bigBlind: 0.25 })).label).toBe('25NL')
  })

  test('tournament hands share one bucket, whatever the level', () => {
    for (const h of mtt) expect(handStake(h)).toEqual({ key: 'mtt', label: 'Tournament', bigBlind: 0 })
  })

  test('unrecognized game is named by its blind, not guessed as NL/PLO', () => {
    expect(handStake(fakeHand({ gameType: 'STUD Limit', bigBlind: 0.1 })).label).toBe('0.1 BB')
  })

  test('missing blinds → Unknown', () => {
    expect(handStake(fakeHand({ gameType: '', bigBlind: 0 })).key).toBe('unknown')
  })
})

describe('stakesIn – the stakes present in a sample', () => {
  const hands = [...plo, ...nlhe, ...mtt]
  const opts = stakesIn(hands)

  test('one entry per stake, smallest first, tournaments last', () => {
    expect(opts.map(o => o.stake.key)).toEqual(['plo25', 'nl100', 'mtt'])
  })

  test('counts every hand exactly once', () => {
    expect(opts.reduce((n, o) => n + o.hands, 0)).toBe(hands.length)
    expect(opts.find(o => o.stake.key === 'plo25')!.hands).toBe(plo.length)
    expect(opts.find(o => o.stake.key === 'mtt')!.hands).toBe(mtt.length)
  })
})

describe('filterByStake', () => {
  const hands = [...plo, ...nlhe, ...mtt]

  test('empty selection = all stakes (same array back)', () => {
    expect(filterByStake(hands, [])).toBe(hands)
  })

  test('single stake keeps only that stake', () => {
    const only = filterByStake(hands, ['plo25'])
    expect(only.length).toBe(plo.length)
    expect(only.every(h => handStake(h).key === 'plo25')).toBe(true)
  })

  test('multiple stakes pool together', () => {
    expect(filterByStake(hands, ['plo25', 'nl100']).length).toBe(plo.length + nlhe.length)
  })

  test('a stake with no hands yields nothing', () => {
    expect(filterByStake(hands, ['plo5'])).toEqual([])
  })
})

describe('stake selection ⇆ URL query', () => {
  const q = (s: string) => new URLSearchParams(s)

  test('no param = all stakes', () => expect(parseStakes(q(''))).toEqual([]))
  test('parses, lowercases and dedupes', () => {
    expect(parseStakes(q('stake=PLO25, plo50 ,plo25'))).toEqual(['plo25', 'plo50'])
  })
  test('round-trips through writeStakes', () => {
    const out = new URLSearchParams()
    writeStakes(out, ['plo25', 'plo50'])
    expect(out.toString()).toBe('stake=plo25%2Cplo50')
    expect(parseStakes(out)).toEqual(['plo25', 'plo50'])
  })
  test('empty selection drops the param', () => {
    const out = q('stake=plo25')
    writeStakes(out, [])
    expect(out.toString()).toBe('')
  })
})

describe('stakeSelectionLabel', () => {
  const opts = stakesIn([...plo, ...nlhe])

  test('nothing selected', () => expect(stakeSelectionLabel([], opts)).toBe('all stakes'))
  test('one stake', () => expect(stakeSelectionLabel(['plo25'], opts)).toBe('PLO25'))
  test('pooled stakes', () => expect(stakeSelectionLabel(['plo25', 'nl100'], opts)).toBe('PLO25 + 100NL'))
})
