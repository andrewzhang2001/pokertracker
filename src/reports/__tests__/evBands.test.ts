import { describe, test, expect } from 'vitest'
import { readFileSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { parseHandHistories } from '../../shared/poker/parsers'
import { rfiSpots } from '../../shared/poker/reports'
import { netForSeat } from '../../shared/poker/graph'
import {
  comboWeights, openingRangeBands, assignOpensToBands, bandIndexForEv, TOTAL_PLO_HANDS,
} from '../evBands'
import type { SolverTable } from '../../shared/poker/reports'
import type { ParsedHand } from '../../shared/poker/types'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '../../../')
const fixtures = resolve(root, 'src/shared/__tests__/fixtures')
const lj = JSON.parse(readFileSync(resolve(root, 'public/solver/rfi/lj.json'), 'utf-8')) as SolverTable

describe('comboWeights', () => {
  test('enumerates every canonical PLO combo with correct total multiplicity', () => {
    const w = comboWeights()
    expect(w.size).toBe(16432)
    let total = 0
    for (const n of w.values()) total += n
    expect(total).toBe(TOTAL_PLO_HANDS) // C(52,4)
  })
})

describe('openingRangeBands (LJ RFI)', () => {
  const bands = openingRangeBands(lj)

  test('four equal-weight quartiles spanning the +EV opening range', () => {
    expect(bands).toHaveLength(4)
    const totalW = bands.reduce((s, b) => s + b.weight, 0)
    // LJ opens ~17.7% of all hands.
    expect(totalW / TOTAL_PLO_HANDS).toBeGreaterThan(0.15)
    expect(totalW / TOTAL_PLO_HANDS).toBeLessThan(0.2)
    // Each band ~= 25% of the range weight.
    for (const b of bands) {
      expect(b.weight / totalW).toBeGreaterThan(0.24)
      expect(b.weight / totalW).toBeLessThan(0.26)
    }
    expect(bands.reduce((s, b) => s + b.handPct, 0)).toBeCloseTo((totalW / TOTAL_PLO_HANDS) * 100, 6)
  })

  test('bands are ordered strongest → most marginal by EV', () => {
    for (let i = 1; i < bands.length; i++) {
      expect(bands[i].avgEv).toBeLessThan(bands[i - 1].avgEv)   // strictly weaker
      expect(bands[i].hiEv).toBeLessThanOrEqual(bands[i - 1].loEv) // contiguous, non-overlapping
    }
    expect(bands[bands.length - 1].loEv).toBeGreaterThan(0) // whole range is +EV
  })

  test('bandIndexForEv places an EV into its quartile', () => {
    expect(bandIndexForEv(bands, bands[0].hiEv)).toBe(0)        // premium open → top band
    expect(bandIndexForEv(bands, bands[3].loEv)).toBe(3)        // marginal open → bottom band
    expect(bandIndexForEv(bands, 999)).toBe(0)                  // above range clamps up
    expect(bandIndexForEv(bands, -999)).toBe(3)                 // below range clamps down
  })
})

describe('assignOpensToBands', () => {
  const bands = openingRangeBands(lj)

  test('every hero LJ open is accounted for, with net = per-hand netForSeat', () => {
    const hands: ParsedHand[] = ['hh_plo.txt']
      .flatMap(f => parseHandHistories(readFileSync(resolve(fixtures, f), 'utf-8')))
    // Hero's actual LJ opens (raise) from the fixture.
    const entries = hands.flatMap(hand =>
      rfiSpots(hand)
        .filter(s => s.displayPos === 'LJ' && s.isHero && s.action === 'raise')
        .map(() => ({ hand, cards: hand.actions.find(a => a.type === 'deal_hole' && a.seatNumber === hand.players.find(p => p.isMe)?.seatNumber)?.cards ?? null })),
    )
    const res = assignOpensToBands(entries, bands, lj)
    const placed = res.bands.reduce((s, b) => s + b.opens, 0) + res.offRange.opens
    expect(placed).toBe(entries.length)
    // Total net across placed opens equals the direct per-hand sum.
    const directNet = entries.reduce((s, e) => {
      const seat = e.hand.players.find(p => p.isMe)!.seatNumber
      return s + netForSeat(e.hand, seat)
    }, 0)
    const tallied = res.bands.reduce((s, b) => s + b.netSum, 0) + res.offRange.netSum
    expect(tallied).toBeCloseTo(directNet, 6)
    // Per-band averages are consistent with sums.
    for (const b of res.bands) {
      if (b.opens) expect(b.netAvg).toBeCloseTo(b.netSum / b.opens, 6)
      else expect(b.netAvg).toBe(0)
    }
  })
})
