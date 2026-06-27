import { useMemo, useState, useEffect } from 'react'
import type { ParsedHand } from '../lib/types'
import {
  buildReport, leakProfile, MISTAKE_EPS, RFI_POSITIONS, VS_RFI_DEFENDERS, openersFor,
  type ReportSel, type ReportResult, type ReportBucket, type EvSummary, type SolverTable, type Subject,
} from '../lib/reports'
import { loadSolver, solverUrl } from '../lib/solver'
import PlayingCard from './PlayingCard'

function fmtPct(n: number) {
  return (Number.isInteger(n) ? n : n.toFixed(1)) + '%'
}

// Every report shown in the menu.
const ALL_SELS: ReportSel[] = [
  ...RFI_POSITIONS.map(pos => ({ type: 'rfi', pos }) as ReportSel),
  ...VS_RFI_DEFENDERS.flatMap(d => openersFor(d).map(o => ({ type: 'vsrfi', defender: d, opener: o }) as ReportSel)),
]
const selKey = (sel: ReportSel) => sel.type === 'rfi' ? `rfi:${sel.pos}` : `vsrfi:${sel.defender}:${sel.opener}`

function Swatch({ rgb, label }: { rgb: string; label: string }) {
  return (
    <span className="flex items-center gap-1">
      <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: `rgb(${rgb})` }} />
      {label}
    </span>
  )
}

// Tile background tinted by the population's archetype, shaded by EV/100.
function profileTint(ev: EvSummary): string {
  const { tight, loose, passive, aggressive } = ev.axes
  const isLoose = loose > tight
  const isAggr = aggressive > passive
  const rgb = !isLoose && !isAggr ? '59,130,246'  // tight-passive   → blue
    : isLoose && !isAggr ? '234,179,8'            // loose-passive   → yellow
    : !isLoose && isAggr ? '239,68,68'            // tight-aggressive → red
    : '168,85,247'                                // loose-aggressive → purple
  const a = Math.min(0.32, 0.05 + (ev.perSpotBb * 100) / 12) // shade by severity
  return `linear-gradient(rgba(${rgb},${a}), rgba(${rgb},${a})), #111827`
}

// A diverging meter: left/right segments grow from the center, sized by bb lost.
function Meter({ leftLabel, leftVal, leftColor, rightLabel, rightVal, rightColor, scale }: {
  leftLabel: string; leftVal: number; leftColor: string
  rightLabel: string; rightVal: number; rightColor: string; scale: number
}) {
  const lw = (leftVal / scale) * 50
  const rw = (rightVal / scale) * 50
  return (
    <div className="flex items-center gap-2 text-xs my-1">
      <span className="w-24 text-right text-gray-400">{leftLabel}{leftVal > 0.005 && <span className="text-gray-500"> −{leftVal.toFixed(2)}</span>}</span>
      <div className="relative flex-1 h-3 rounded bg-gray-800/80">
        <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gray-600" />
        <div className="absolute top-0 bottom-0" style={{ right: '50%', width: `${lw}%`, background: leftColor, borderRadius: '2px 0 0 2px' }} />
        <div className="absolute top-0 bottom-0" style={{ left: '50%', width: `${rw}%`, background: rightColor, borderRadius: '0 2px 2px 0' }} />
      </div>
      <span className="w-24 text-gray-400">{rightLabel}{rightVal > 0.005 && <span className="text-gray-500"> −{rightVal.toFixed(2)}</span>}</span>
    </div>
  )
}

function LeakProfile({ ev }: { ev: EvSummary }) {
  const { tight, loose, passive, aggressive } = ev.axes
  const scale = Math.max(tight, loose, passive, aggressive, 0.0001)
  const { label, nickname } = leakProfile(ev.axes)
  return (
    <div className="max-w-md mx-auto mt-3">
      <div className="text-center text-sm mb-1">
        <span className="text-gray-400">Profile: </span>
        <span className="font-semibold text-white">{label}{nickname && ` (${nickname})`}</span>
      </div>
      <Meter leftLabel="Tight" leftVal={tight} leftColor="#6b7280" rightLabel="Loose" rightVal={loose} rightColor="#f59e0b" scale={scale} />
      {ev.aggressionAxis && (
        <Meter leftLabel="Passive" leftVal={passive} leftColor="#3b82f6" rightLabel="Aggressive" rightVal={aggressive} rightColor="#ef4444" scale={scale} />
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Reports menu — horizontal rows of report tiles (room to add more sets).
// ---------------------------------------------------------------------------
export function ReportsMenu({ hands, onOpen, onBack, subject = 'population', title = 'Reports' }: {
  hands: ParsedHand[]
  onOpen: (sel: ReportSel) => void
  onBack: () => void
  subject?: Subject
  title?: string
}) {
  // Load all solver tables once (cached) so tiles can show profile + EV/100.
  const [tables, setTables] = useState<Map<string, SolverTable>>(new Map())
  useEffect(() => {
    let cancelled = false
    Promise.all(ALL_SELS.map(async sel => {
      try { return [solverUrl(sel), await loadSolver(sel)] as const } catch { return null }
    })).then(rows => {
      if (cancelled) return
      const m = new Map<string, SolverTable>()
      for (const r of rows) if (r) m.set(r[0], r[1])
      setTables(m)
    })
    return () => { cancelled = true }
  }, [])

  // Build every report (with solver EVs once tables load).
  const previews = useMemo(() => {
    const m = new Map<string, ReportResult>()
    for (const sel of ALL_SELS) m.set(selKey(sel), buildReport(hands, sel, tables.get(solverUrl(sel)), subject))
    return m
  }, [hands, tables, subject])

  const Tile = ({ sel, label }: { sel: ReportSel; label: string }) => {
    const r = previews.get(selKey(sel))!
    const tinted = !!r.ev && r.total > 0
    return (
      <button
        onClick={() => onOpen(sel)}
        style={tinted ? { background: profileTint(r.ev!) } : undefined}
        className={`shrink-0 w-28 rounded-lg border border-gray-700 hover:border-yellow-500 transition-colors px-3 py-2 text-left ${tinted ? '' : 'bg-gray-900 hover:bg-gray-800'}`}
      >
        <div className="text-white text-sm font-medium">{label}</div>
        <div className="text-gray-500 text-xs mt-0.5">{r.total} spots</div>
        {r.total > 0 && (
          <div className="text-xs font-semibold mt-0.5">
            {r.buckets.map((b, i) => (
              <span key={b.label}>
                {i > 0 && <span className="text-gray-600">/</span>}
                <span className={b.color}>{Math.round(b.pct)}</span>
              </span>
            ))}
          </div>
        )}
        {r.ev && r.total > 0 && (
          <div className="text-red-300 text-xs mt-0.5">−{(r.ev.perSpotBb * 100).toFixed(1)} bb/100</div>
        )}
      </button>
    )
  }

  const Row = ({ label, children }: { label: string; children: React.ReactNode }) => (
    <div className="flex items-center gap-3">
      <div className="w-28 shrink-0 text-xs uppercase tracking-wide text-gray-500 text-right">{label}</div>
      <div className="flex gap-2 overflow-x-auto no-scrollbar py-1">{children}</div>
    </div>
  )

  return (
    <div className="min-h-screen flex flex-col p-6 gap-6">
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-xs text-gray-500 hover:text-white border border-gray-700 rounded px-2 py-1 transition-colors"
        >
          ← Home
        </button>
        <h1 className="text-2xl font-bold text-white">{title}</h1>
        <span className="text-gray-600 text-xs">{subject === 'hero' ? 'your hands' : 'population · excludes your hands'} · 75bb+</span>
        <span className="ml-auto text-xs text-gray-600">
          ratio = <span className="text-red-400">raise</span>/<span className="text-green-400">call</span>/<span className="text-blue-400">fold</span>
        </span>
      </div>

      {/* Tile color legend */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-gray-500">
        <span className="text-gray-600">tile = avg profile:</span>
        <Swatch rgb="59,130,246" label="tight-passive" />
        <Swatch rgb="234,179,8" label="loose-passive" />
        <Swatch rgb="239,68,68" label="tight-aggressive" />
        <Swatch rgb="168,85,247" label="loose-aggressive" />
        <span className="text-gray-600">· intensity = EV/100</span>
      </div>

      <div className="flex flex-col gap-3">
        <Row label="RFI (open)">
          {RFI_POSITIONS.map(pos => <Tile key={pos} sel={{ type: 'rfi', pos }} label={pos} />)}
        </Row>
        {VS_RFI_DEFENDERS.map(def => (
          <Row key={def} label={`${def} vs RFI`}>
            {openersFor(def).map(op => (
              <Tile key={op} sel={{ type: 'vsrfi', defender: def, opener: op }} label={`vs ${op}`} />
            ))}
          </Row>
        ))}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Generic report renderer — aggregate bar + per-bucket hand lists.
// ---------------------------------------------------------------------------
interface Props {
  result: ReportResult
  onOpenHands: (hands: ParsedHand[], index: number) => void
  onBack: () => void
}

export default function ReportsView({ result, onOpenHands, onBack }: Props) {
  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 bg-black/50 border-b border-gray-800 text-sm">
        <button
          onClick={onBack}
          className="text-xs text-gray-500 hover:text-white border border-gray-700 rounded px-2 py-1 transition-colors"
        >
          ← Reports
        </button>
        <span className="text-white font-semibold">{result.title}</span>
        <span className="text-gray-500 text-xs">{result.subtitle}</span>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar p-4">
        <div className="max-w-2xl mx-auto mb-6">
          <div className="text-center text-gray-400 text-sm mb-2">
            Qualifying spots: <span className="text-white font-semibold">{result.total}</span>
          </div>
          {result.total === 0 ? (
            <p className="text-center text-gray-600 text-sm">
              No qualifying spots yet. Import &amp; export more hands.
            </p>
          ) : (
            <>
              <div className="flex h-4 rounded overflow-hidden mb-3">
                {result.buckets.map(b => b.pct > 0 && (
                  <div key={b.label} className={b.bar} style={{ width: `${b.pct}%` }} title={`${b.label} ${fmtPct(b.pct)}`} />
                ))}
              </div>
              <div className="flex justify-around text-sm">
                {result.buckets.map(b => (
                  <div key={b.label} className="text-center">
                    <div className={`font-bold ${b.color}`}>{fmtPct(b.pct)}</div>
                    <div className="text-gray-500 text-xs">{b.label} · {b.count}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* GTO EV analysis */}
        {result.total > 0 && (
          <div className="max-w-2xl mx-auto mb-6">
            {!result.ev ? (
              <p className="text-center text-gray-600 text-xs">Loading GTO EVs…</p>
            ) : result.ev.spots > 0 && (
              <>
                <div className="text-center text-sm">
                  <span className="text-gray-400">EV loss vs GTO: </span>
                  <span className="text-red-400 font-semibold">−{(result.ev.perSpotBb * 100).toFixed(2)} bb/100</span>
                  <span className="text-gray-600"> · total −{result.ev.totalBb.toFixed(1)} bb over {result.ev.spots} spots</span>
                </div>
                <LeakProfile ev={result.ev} />
                {result.ev.directions.length > 0 && (
                  <div className="mt-3">
                    <div className="text-xs uppercase tracking-wide text-gray-500 mb-1 text-center">
                      Mistake directions (chose → GTO best · by EV lost)
                    </div>
                    <div className="flex flex-col gap-1 max-w-md mx-auto">
                      {result.ev.directions.map(d => (
                        <div key={d.label} className="flex justify-between text-xs px-2 py-1 rounded bg-black/30">
                          <span className="text-gray-300">{d.label}</span>
                          <span className="text-gray-500">{d.count}× · <span className="text-red-400">−{d.bbLost.toFixed(2)} bb</span></span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </>
            )}
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-5xl mx-auto">
          {result.buckets.map(b => (
            <BucketColumn key={b.label} bucket={b} onOpenHands={onOpenHands} />
          ))}
        </div>
      </div>
    </div>
  )
}

function BucketColumn({ bucket, onOpenHands }: {
  bucket: ReportBucket
  onOpenHands: (hands: ParsedHand[], index: number) => void
}) {
  const bucketHands = bucket.entries.map(e => e.hand)
  return (
    <div className="border border-gray-800 rounded-lg bg-black/20 flex flex-col min-h-0">
      <div className={`px-3 py-2 border-b border-gray-800 text-sm font-semibold ${bucket.color}`}>
        {bucket.label} <span className="text-gray-600 font-normal">· {bucket.count}</span>
      </div>
      <div className="p-1">
        {bucket.entries.length === 0 && <div className="text-gray-600 text-xs px-2 py-3 text-center">—</div>}
        {bucket.entries.map((e, i) => (
          <button
            key={`${e.handId}-${i}`}
            onClick={() => onOpenHands(bucketHands, i)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 transition-colors text-left"
          >
            <div className="flex gap-0.5 shrink-0">
              {e.cards
                ? e.cards.map((c, j) => <PlayingCard key={j} card={c} tiny />)
                : <span className="text-gray-600 text-xs">??</span>}
            </div>
            <span className="text-xs ml-auto shrink-0">
              {e.evLossBb !== undefined && e.evLossBb > MISTAKE_EPS && (
                <span className="text-red-400 mr-2" title="EV lost vs GTO · GTO-best action">
                  −{e.evLossBb.toFixed(2)}{e.bestAction && ` (${e.bestAction})`}
                </span>
              )}
              <span className="text-gray-400">{Math.round(e.stackBB)}bb</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  )
}
