import { useEffect, useMemo, useState } from 'react'
import type { ReportEntry, SolverTable } from '../lib/reports'
import { openingRangeBands, assignOpensToBands, comboWeights, type BandsResult } from '../lib/evBands'

// ---------------------------------------------------------------------------
// Leakbuster RFI: your actual opens, bucketed into solver EV quartiles. For each
// band (strongest 25% of the opening range → most marginal 25%) we show the
// solver's expected EV vs your realized net — "how do my premium vs marginal
// opens perform relative to expectation?".
// ---------------------------------------------------------------------------

const bb = (n: number, digits = 2) => `${n >= 0 ? '+' : ''}${n.toFixed(digits)}`

// Green when you're beating the solver's expectation, red when below.
const deltaColor = (n: number) => (n > 0.005 ? 'text-green-400' : n < -0.005 ? 'text-red-400' : 'text-gray-400')

export default function EvBandsPanel({ solver, raiseEntries }: {
  solver: SolverTable
  raiseEntries: ReportEntry[]
}) {
  // Combo weights need a one-time C(52,4) enumeration; compute off the render
  // path so the first paint isn't blocked. Memoized globally, so it's only ever
  // slow once per session.
  const [ready, setReady] = useState(false)
  useEffect(() => {
    let cancelled = false
    // Yield a frame so the "computing…" note can paint first.
    const id = setTimeout(() => { comboWeights(); if (!cancelled) setReady(true) }, 0)
    return () => { cancelled = true; clearTimeout(id) }
  }, [])

  const result: BandsResult | null = useMemo(() => {
    if (!ready) return null
    const bands = openingRangeBands(solver)
    return assignOpensToBands(raiseEntries.map(e => ({ hand: e.hand, cards: e.cards })), bands, solver)
  }, [ready, solver, raiseEntries])

  const totalOpens = (result?.bands.reduce((s, b) => s + b.opens, 0) ?? 0)

  return (
    <div className="max-w-2xl mx-auto mb-6">
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1 text-center">
        Opens by solver EV band <span className="text-gray-600 normal-case">· your realized net vs expectation</span>
      </div>
      {!result ? (
        <p className="text-center text-gray-600 text-xs">Computing bands…</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="text-gray-500 border-b border-gray-800">
                  <th className="text-left font-medium py-1 pr-2">Band</th>
                  <th className="text-right font-medium py-1 px-2" title="share of ALL dealt hands this band spans · open-EV range (bb)">% hands · EV</th>
                  <th className="text-right font-medium py-1 px-2" title="solver's weight-weighted expected open EV (bb)">Solver EV</th>
                  <th className="text-right font-medium py-1 px-2" title="how many of your opens landed in this band">Opens</th>
                  <th className="text-right font-medium py-1 px-2" title="your realized net per open (bb)">Net/open</th>
                  <th className="text-right font-medium py-1 pl-2" title="realized net/open − solver expected EV (bb)">Δ vs exp</th>
                </tr>
              </thead>
              <tbody>
                {result.bands.map(({ band, opens, netAvg }) => {
                  const delta = opens ? netAvg - band.avgEv : 0
                  return (
                    <tr key={band.idx} className="border-b border-gray-900">
                      <td className="py-1.5 pr-2 text-gray-200 font-medium whitespace-nowrap">{band.label}</td>
                      <td className="py-1.5 px-2 text-right text-gray-500 whitespace-nowrap">
                        {band.handPct.toFixed(1)}% · {band.loEv.toFixed(2)}–{band.hiEv.toFixed(2)}
                      </td>
                      <td className="py-1.5 px-2 text-right text-gray-300 whitespace-nowrap">{bb(band.avgEv)}</td>
                      <td className="py-1.5 px-2 text-right text-gray-300">{opens || <span className="text-gray-600">—</span>}</td>
                      <td className="py-1.5 px-2 text-right whitespace-nowrap">
                        {opens ? <span className={deltaColor(netAvg)}>{bb(netAvg)}</span> : <span className="text-gray-600">—</span>}
                      </td>
                      <td className="py-1.5 pl-2 text-right whitespace-nowrap">
                        {opens ? <span className={deltaColor(delta)}>{bb(delta)}</span> : <span className="text-gray-600">—</span>}
                      </td>
                    </tr>
                  )
                })}
                {result.offRange.opens > 0 && (
                  <tr className="border-b border-gray-900" title="opens the solver folds (outside the +EV range) — no band; shown for reference">
                    <td className="py-1.5 pr-2 text-red-300/80 font-medium whitespace-nowrap">Off-range</td>
                    <td className="py-1.5 px-2 text-right text-gray-600 whitespace-nowrap">solver folds</td>
                    <td className="py-1.5 px-2 text-right text-gray-600">—</td>
                    <td className="py-1.5 px-2 text-right text-gray-300">
                      {result.offRange.opens}{result.offRange.unknown > 0 && <span className="text-gray-600"> ({result.offRange.unknown} ??)</span>}
                    </td>
                    <td className="py-1.5 px-2 text-right whitespace-nowrap"><span className={deltaColor(result.offRange.netAvg)}>{bb(result.offRange.netAvg)}</span></td>
                    <td className="py-1.5 pl-2 text-right text-gray-600">—</td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-600 mt-2 text-center">
            {totalOpens} +EV opens across bands. Realized net is your whole-hand result (incl. postflop &amp; rake) vs a
            rakeless solver EV — noisy at low sample; the sign of Δ over many opens is the read.
          </p>
        </>
      )}
    </div>
  )
}
