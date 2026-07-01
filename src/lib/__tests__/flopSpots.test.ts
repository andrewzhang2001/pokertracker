import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseHandHistories } from '../parseHandHistory'
import {
  extractSpots, extractFlopSpot, formationTree, formationReport, FORMATIONS, NODES, EMPTY_FILTER,
  type FlopSpot, type PostflopFilter, type PostflopMode,
} from '../postflop'
import { slimFlopSpot, type FlopSpotRow } from '../canonicalFlopSpots'
import type { ParsedHand } from '../types'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../../../')
const hands: ParsedHand[] = ['hh.txt', 'hh2.txt', 'hh3.txt', 'hh_plo.txt']
  .flatMap(f => parseHandHistories(readFileSync(resolve(root, f), 'utf-8')))

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
          expect(b.heroNode).toEqual(a.heroNode)
          expect(b.prior).toEqual(a.prior)
          expect(b.responses).toEqual(a.responses)
          // listSpots carries the spot object; compare the fields the UI reads
          // (the slim spot has no `hand`, so don't compare the raw spot).
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
