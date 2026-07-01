import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseHandHistories } from '../parseHandHistory'
import {
  buildReport, buildReportFromGrid, MIN_BB,
  RFI_POSITIONS, VS_RFI_DEFENDERS, openersFor, VS3BET_REPORTS, LIMP_ISO_TAGS,
  type ReportSel, type ReportGridRow, type Subject, type SolverTable, type ReportResult,
} from '../reports'
import { spotsForHand } from '../canonicalSpots'
import { tableKind, type TableKind } from '../positionUtils'
import type { ParsedHand } from '../types'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../../../')
const hands: ParsedHand[] = ['hh.txt', 'hh2.txt', 'hh3.txt', 'hh_plo.txt']
  .flatMap(f => parseHandHistories(readFileSync(resolve(root, f), 'utf-8')))

// Reproduce the server-side GROUP BY (api/hands.ts view=reports) from the same
// spot extractor, so the test exercises the real client/server contract. In a
// single-user fixture every owned spot is the viewer's, so hero = is_hero count.
function gridFromHands(hs: ParsedHand[]): ReportGridRow[] {
  const map = new Map<string, ReportGridRow>()
  for (const h of hs) {
    for (const s of spotsForHand(h)) {
      if (s.stack_bb < MIN_BB || s.key_stack_bb < MIN_BB) continue // matches SQL WHERE
      const key = `${s.table_kind}|${s.report_type}|${s.pos_a}|${s.pos_b}|${s.multiway}|${s.combo}|${s.action}`
      let row = map.get(key)
      if (!row) {
        row = { table_kind: s.table_kind, report_type: s.report_type, pos_a: s.pos_a, pos_b: s.pos_b, multiway: s.multiway, combo: s.combo, action: s.action, hero: 0, pop: 0 }
        map.set(key, row)
      }
      if (s.is_hero) row.hero++; else row.pop++
    }
  }
  return [...map.values()]
}

const grid = gridFromHands(hands)

// Every 6-max report tile shown in the menu.
const SELS_6MAX: ReportSel[] = [
  ...RFI_POSITIONS.map(pos => ({ type: 'rfi', pos }) as ReportSel),
  ...VS_RFI_DEFENDERS.flatMap(d => openersFor(d).map(o => ({ type: 'vsrfi', defender: d, opener: o }) as ReportSel)),
  ...VS3BET_REPORTS.map(r => ({ type: 'vs3bet', opener: r.opener, tag: r.tag }) as ReportSel),
  ...LIMP_ISO_TAGS.flatMap(iso => (['all', 'hu', 'multi'] as const).map(mw => ({ type: 'limpiso', iso, multiway: mw }) as ReportSel)),
]
const SELS_HU: ReportSel[] = [
  { type: 'rfi', pos: 'SB' },
  { type: 'vsrfi', defender: 'BB', opener: 'SB' },
  { type: 'vs3bet', opener: 'SB', tag: 'bb' },
]

// A fake solver covering every combo present, so the EV/leak math is exercised
// (with arbitrary-but-deterministic EVs) on both paths and must agree.
function fakeSolver(): SolverTable {
  const table: SolverTable = {}
  let i = 0
  for (const r of grid) {
    if (!r.combo || table[r.combo]) continue
    const a = (i % 7) - 3, b = ((i * 3) % 5) - 2, c = ((i * 2) % 4) - 1
    table[r.combo] = [a * 0.1, b * 0.1, c * 0.1] // [fold, call/mid, raise]
    i++
  }
  return table
}
const solver = fakeSolver()

// Compare the fields the menu/detail actually read off a ReportResult.
function sameResult(a: ReportResult, b: ReportResult) {
  expect(b.total).toBe(a.total)
  expect(b.title).toBe(a.title)
  expect(b.subtitle).toBe(a.subtitle)
  expect(b.solverless ?? false).toBe(a.solverless ?? false)
  expect(b.buckets.map(x => [x.label, x.count, x.pct])).toEqual(a.buckets.map(x => [x.label, x.count, x.pct]))
  if (a.ev || b.ev) {
    expect(b.ev).toBeDefined(); expect(a.ev).toBeDefined()
    expect(b.ev!.spots).toBe(a.ev!.spots)
    expect(b.ev!.aggressionAxis).toBe(a.ev!.aggressionAxis)
    expect(b.ev!.totalBb).toBeCloseTo(a.ev!.totalBb, 9)
    expect(b.ev!.perSpotBb).toBeCloseTo(a.ev!.perSpotBb, 9)
    // axes/directions agree mathematically; float-accumulation order differs
    // (per-spot sum vs loss*count), so compare numerically rather than exactly.
    for (const k of ['tight', 'loose', 'passive', 'aggressive'] as const) {
      expect(b.ev!.axes[k]).toBeCloseTo(a.ev!.axes[k], 9)
    }
    expect(b.ev!.directions.map(d => [d.label, d.count])).toEqual(a.ev!.directions.map(d => [d.label, d.count]))
    for (let i = 0; i < a.ev!.directions.length; i++) {
      expect(b.ev!.directions[i].bbLost).toBeCloseTo(a.ev!.directions[i].bbLost, 9)
    }
  }
}

describe('buildReportFromGrid matches buildReport', () => {
  const subjects: Subject[] = ['population', 'hero']
  const cases: { sel: ReportSel; kind: TableKind }[] = [
    ...SELS_6MAX.map(sel => ({ sel, kind: 'sixmax' as TableKind })),
    ...SELS_HU.map(sel => ({ sel, kind: 'hu' as TableKind })),
  ]
  for (const { sel, kind } of cases) {
    // buildReport doesn't filter by table kind, so feed it only this kind's hands
    // (the app does the same via the kind-scoped report-hands endpoint).
    const kHands = hands.filter(h => tableKind(h.players.length) === kind)
    for (const subject of subjects) {
      const solverless = sel.type === 'limpiso' || kind === 'hu'
      const slv = solverless ? undefined : solver
      const name = `${kind} · ${JSON.stringify(sel)} · ${subject}`
      test(name, () => {
        const fromHands = buildReport(kHands, sel, slv, subject, kind)
        const fromGrid = buildReportFromGrid(grid, sel, slv, subject, kind)
        sameResult(fromHands, fromGrid)
      })
    }
  }

  test('grid has spots to compare', () => {
    expect(grid.length).toBeGreaterThan(0)
  })
})
