import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseHandHistories } from '../poker/parsers'
import {
  extractSpots, extractFlopSpot, formationTree, formationReport, FORMATIONS, NODES, EMPTY_FILTER,
  type FlopSpot, type PostflopFilter, type PostflopMode,
} from '../poker/postflop'
import { slimFlopSpot, type FlopSpotRow } from '../poker/canonicalFlopSpots'
import type { ParsedHand } from '../poker/types'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixtures = resolve(__dirname, 'fixtures')
const hands: ParsedHand[] = ['hh.txt', 'hh2.txt', 'hh3.txt', 'hh_plo.txt']
  .flatMap(f => parseHandHistories(readFileSync(resolve(fixtures, f), 'utf-8')))

const rows: FlopSpotRow[] = hands.map(slimFlopSpot).filter((r): r is FlopSpotRow => r !== null)
// Rehydrate exactly as the API does: the stored `spot` JSONB round-tripped.
const slimSpots: FlopSpot[] = rows.map(r => JSON.parse(JSON.stringify(r.spot)) as FlopSpot)
const fullSpots: FlopSpot[] = extractSpots(hands)

const FILTERS: PostflopFilter[] = [
  EMPTY_FILTER,
  { ...EMPTY_FILTER, suits: 'twotone' },
  { ...EMPTY_FILTER, paired: 'yes' },
  { ...EMPTY_FILTER, straight: 'no' },
  { ...EMPTY_FILTER, turnPaired: 'yes', turnSuits: 'mono' },
  { ...EMPTY_FILTER, riverStraight: 'yes' },
  { ...EMPTY_FILTER, flopHigh: ['A', 'K'], flopLow: ['2', '3', '4', '5'] },
]
const MODES: PostflopMode[] = ['hero', 'population']

describe('slimFlopSpot is a lossless projection of extractFlopSpot', () => {
  test('stored spot equals extractFlopSpot minus hand', () => {
    for (const h of hands) {
      const full = extractFlopSpot(h)
      const row = slimFlopSpot(h)
      if (!row) continue
      const { hand: _omit, ...expected } = full!
      expect(row.spot).toEqual(expected)
    }
  })

  test('found postflop spots to compare', () => {
    expect(rows.length).toBeGreaterThan(0)
  })
})

describe('MDF is computed on every bet/raise', () => {
  const allActions = fullSpots.flatMap(s => [...s.actions, ...s.turnActions, ...s.riverActions])
  const aggro = allActions.filter(a => a.type === 'bet' || a.type === 'raise')

  test('found bets/raises to check', () => {
    expect(aggro.length).toBeGreaterThan(0)
    for (const a of aggro) expect(a.mdf).toBeDefined()
  })

  test('bet MDF equals 1/(1+betPct)', () => {
    // For a plain bet, betPct = bet/potBefore = x, so MDF = potBefore/(potBefore+bet) = 1/(1+x).
    for (const a of aggro.filter(a => a.type === 'bet')) {
      expect(a.mdf!).toBeCloseTo(1 / (1 + (a.betPct ?? 0)), 10)
    }
  })

  test('all MDFs are valid frequencies in (0,1]', () => {
    for (const a of aggro) {
      expect(a.mdf!).toBeGreaterThan(0)
      expect(a.mdf!).toBeLessThanOrEqual(1)
    }
  })

  test('raise MDF is lower than the same-pct bet would be (raiser risks more)', () => {
    // A raise imposes a stricter (lower) MDF than a bet of the same betPct, since
    // the raiser commits R over a pot that already holds the bet being raised.
    for (const a of aggro.filter(a => a.type === 'raise')) {
      expect(a.mdf!).toBeLessThan(1 / (1 + (a.betPct ?? 0)) + 1e-9)
    }
  })
})

describe('node-walk is identical over rehydrated slim spots', () => {
  for (const f of FORMATIONS) {
    for (const mode of MODES) {
      for (let fi = 0; fi < FILTERS.length; fi++) {
        test(`formationTree · ${f.id} · ${mode} · filter${fi}`, () => {
          const a = formationTree(fullSpots, f.id, mode, FILTERS[fi])
          const b = formationTree(slimSpots, f.id, mode, FILTERS[fi])
          expect(b).toEqual(a)
        })
      }
    }
  }

  // A spread of nodes across streets for the detail report.
  const sampleNodes = NODES.filter((_, i) => i % 7 === 0).map(n => n.id)
  for (const f of FORMATIONS) {
    test(`formationReport · ${f.id} · sample nodes`, () => {
      for (const nodeId of sampleNodes) {
        for (const mode of MODES) {
          const a = formationReport(fullSpots, f.id, nodeId, mode, EMPTY_FILTER)
          const b = formationReport(slimSpots, f.id, nodeId, mode, EMPTY_FILTER)
          // `list` carries raw spot objects (slim spots lack `hand`), so strip it
          // from the node compare and check its UI-visible fields separately.
          type NR = NonNullable<typeof a.prior>
          const bare = (n?: NR) => n && { ...n, list: undefined }
          const projList = (l?: NR['list']) => (l ?? []).map(x => ({ handId: x.spot.handId, action: x.action, betPct: x.betPct, cards: x.cards, klass: x.klass }))
          const cmp = (bn?: NR, an?: NR) => { expect(bare(bn)).toEqual(bare(an)); expect(projList(bn?.list)).toEqual(projList(an?.list)) }
          cmp(b.heroNode, a.heroNode)
          cmp(b.prior, a.prior)
          b.responses.forEach((n, i) => cmp(n, a.responses[i]))
          expect(b.responses.length).toEqual(a.responses.length)
          const proj = (r: typeof a) => r.listSpots.map(x => ({ handId: x.spot.handId, action: x.action, betPct: x.betPct, cards: x.cards, klass: x.klass }))
          expect(proj(b)).toEqual(proj(a))
        }
      }
    })
  }
})

// Mirror of the SQL counts predicate (api/hands.ts view=flop-counts) — must
// reproduce filterFormation membership, so the menu's per-formation tile counts
// match formationTree.total. In a single-user fixture every spot is the viewer's.
function countMatch(row: FlopSpotRow, filter: PostflopFilter, heroMode: boolean): boolean {
  if (heroMode && !(row.oop_is_hero || row.ip_is_hero)) return false
  const su = (f: string, col: string | null) => f === 'any' || col === f
  const yn = (f: string, col: boolean | null) => f === 'any' || (col != null && col === (f === 'yes'))
  const rk = (sel: string[], col: string | null) => sel.length === 0 || (col != null && sel.includes(col))
  return su(filter.suits, row.flop_suits) && yn(filter.paired, row.flop_paired) && yn(filter.straight, row.flop_straighty)
    && su(filter.turnSuits, row.turn_suits) && yn(filter.turnPaired, row.turn_paired) && yn(filter.turnStraight, row.turn_straighty)
    && su(filter.riverSuits, row.river_suits) && yn(filter.riverPaired, row.river_paired) && yn(filter.riverStraight, row.river_straighty)
    && rk(filter.flopHigh, row.flop_high) && rk(filter.flopMid, row.flop_mid) && rk(filter.flopLow, row.flop_low)
}

describe('counts predicate matches formationTree.total', () => {
  for (const mode of MODES) {
    for (let fi = 0; fi < FILTERS.length; fi++) {
      test(`${mode} · filter${fi}`, () => {
        for (const f of FORMATIONS) {
          const sqlCount = rows.filter(r => r.formation_id === f.id && countMatch(r, FILTERS[fi], mode === 'hero')).length
          const treeTotal = formationTree(slimSpots, f.id, mode, FILTERS[fi]).total
          expect(sqlCount).toBe(treeTotal)
        }
      })
    }
  }
})
