import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseHandHistories } from '../parseHandHistory'
import {
  handGame, filterHandsByGame, filterByGame, parseGame, writeGame, gameLabel, type GameKey,
} from '../games'
import { computeGraphFromRows, graphGameCounts, type GraphRow } from '../graph'
import type { ParsedHand } from '../types'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../../../')

const plo = parseHandHistories(readFileSync(resolve(root, 'hh_plo.txt'), 'utf-8'))   // OMAHA Pot Limit
const nlhe = parseHandHistories(readFileSync(resolve(root, 'hh3.txt'), 'utf-8'))     // HOLDEM No Limit
const mtt = parseHandHistories(readFileSync(resolve(root, 'hh.txt'), 'utf-8'))       // HOLDEM tournament

function fakeHand(over: Partial<ParsedHand>): ParsedHand {
  return {
    handId: 'x', tableId: '', site: 'ignition', date: '', playedAt: 0,
    gameType: 'HOLDEM No Limit', currency: 'USD', players: [], smallBlind: 0.02,
    bigBlind: 0.05, actions: [], initialStep: 0, rawText: '', ...over,
  }
}

describe('handGame – naming the variant', () => {
  test('OMAHA cash → plo', () => {
    for (const h of plo) expect(handGame(h)).toBe('plo')
  })

  test("hold'em cash → nlhe", () => {
    for (const h of nlhe) expect(handGame(h)).toBe('nlhe')
  })

  test('tournament headers (empty game type) fall back to the header line', () => {
    // The Ignition tournament header doesn't match the game-type pattern, so the
    // variant has to come from the raw text — "HOLDEM Tournament #…".
    expect(mtt[0].gameType).toBe('')
    for (const h of mtt) expect(handGame(h)).toBe('nlhe')
  })

  test('anything else → other', () => {
    expect(handGame(fakeHand({ gameType: 'STUD Limit' }))).toBe('other')
    expect(handGame(fakeHand({ gameType: '', rawText: '' }))).toBe('other')
  })
})

describe('filterHandsByGame', () => {
  const hands = [...plo, ...nlhe]

  test("'all' is a no-op (same array back)", () => {
    expect(filterHandsByGame(hands, 'all')).toBe(hands)
  })

  test('a variant keeps only its own hands', () => {
    expect(filterHandsByGame(hands, 'plo').length).toBe(plo.length)
    expect(filterHandsByGame(hands, 'nlhe').length).toBe(nlhe.length)
  })

  test('a variant with no hands yields nothing', () => {
    expect(filterHandsByGame(plo, 'nlhe')).toEqual([])
  })

  test('the variants partition the sample', () => {
    const sizes = (['nlhe', 'plo', 'other'] as GameKey[])
      .reduce((n, k) => n + filterHandsByGame(hands, k).length, 0)
    expect(sizes).toBe(hands.length)
  })
})

describe('game selection ⇆ URL query', () => {
  const q = (s: string) => new URLSearchParams(s)

  test('no param = all games', () => expect(parseGame(q(''))).toBe('all'))
  test('parses and lowercases a known variant', () => expect(parseGame(q('game=PLO'))).toBe('plo'))
  test('an unknown variant falls back to all', () => expect(parseGame(q('game=razz'))).toBe('all'))
  test('round-trips through writeGame', () => {
    const out = new URLSearchParams()
    writeGame(out, 'plo')
    expect(out.toString()).toBe('game=plo')
    expect(parseGame(out)).toBe('plo')
  })
  test("'all' drops the param", () => {
    const out = q('game=plo')
    writeGame(out, 'all')
    expect(out.toString()).toBe('')
  })
})

describe('gameLabel', () => {
  test('all games', () => expect(gameLabel('all')).toBe('all games'))
  test('a variant', () => expect(gameLabel('plo')).toBe('PLO'))
})

describe('graph rows split by variant', () => {
  const row = (game: GameKey, net: number, playedAt: number): GraphRow =>
    ({ playedAt, net, adjNet: net, rake: 0, game })
  const rows = [row('nlhe', 1, 1), row('plo', -4, 2), row('nlhe', 3, 3), row('plo', 10, 4)]

  test('counts per variant drive the filter pills', () => {
    expect(graphGameCounts(rows)).toEqual({ nlhe: 2, plo: 2, other: 0 })
  })

  test('each variant gets its own curve from zero, not a slice of the pooled one', () => {
    expect(computeGraphFromRows(rows, 'all').totalNetBB).toBe(10)
    const ploOnly = computeGraphFromRows(rows, 'plo')
    expect(ploOnly.hands).toBe(2)
    expect(ploOnly.totalNetBB).toBe(6)
    expect(ploOnly.points.map(p => p.cum)).toEqual([-4, 6]) // starts at zero
    expect(ploOnly.bbPer100).toBe(300)
  })

  test('a variant with no hands is an empty graph, not an error', () => {
    const g = computeGraphFromRows(rows, 'other')
    expect(g.hands).toBe(0)
    expect(g.bbPer100).toBe(0)
    expect(g.points).toEqual([])
  })
})

describe('filterByGame – the generic form used for graph rows', () => {
  const items = [{ g: 'plo' as GameKey }, { g: 'nlhe' as GameKey }]
  test('picks by the caller-supplied key', () => {
    expect(filterByGame(items, 'plo', i => i.g)).toEqual([{ g: 'plo' }])
  })
})
