import { useMemo } from 'react'
import type { ParsedHand } from '../lib/types'
import {
  rfiReport, RFI_POSITIONS, POSITION_NAMES,
  type RfiAction, type RfiEntry,
} from '../lib/reports'
import PlayingCard from './PlayingCard'

const MIN_BB = 75

const ACTION_META: Record<RfiAction, { label: string; color: string; bar: string }> = {
  raise: { label: 'Raised (RFI)', color: 'text-orange-300', bar: 'bg-orange-500' },
  limp:  { label: 'Limped',       color: 'text-blue-300',   bar: 'bg-blue-500' },
  fold:  { label: 'Folded',       color: 'text-gray-400',   bar: 'bg-gray-600' },
}

function fmtPct(n: number) {
  return (Number.isInteger(n) ? n : n.toFixed(1)) + '%'
}

// ---- Reports menu: the list of available reports ----
export function ReportsMenu({ hands, onOpen, onBack }: {
  hands: ParsedHand[]
  onOpen: (position: string) => void
  onBack: () => void
}) {
  const previews = useMemo(() => {
    const map: Record<string, { total: number; raisePct: number }> = {}
    for (const pos of RFI_POSITIONS) {
      const r = rfiReport(hands, { position: pos, minBB: MIN_BB, excludeHero: true })
      map[pos] = { total: r.total, raisePct: r.pct.raise }
    }
    return map
  }, [hands])

  return (
    <div className="min-h-screen flex flex-col items-center p-8 gap-6">
      <div className="w-full max-w-xl flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-xs text-gray-500 hover:text-white border border-gray-700 rounded px-2 py-1 transition-colors"
        >
          ← Home
        </button>
        <h1 className="text-2xl font-bold text-white">Reports</h1>
      </div>

      <div className="w-full max-w-xl">
        <h2 className="text-xs uppercase tracking-wide text-gray-500 mb-2">RFI by position · population · {MIN_BB}bb+</h2>
        <div className="flex flex-col gap-2">
          {RFI_POSITIONS.map(pos => (
            <button
              key={pos}
              onClick={() => onOpen(pos)}
              className="flex items-center justify-between px-4 py-3 rounded-lg border border-gray-700 bg-gray-900 hover:border-yellow-500 hover:bg-gray-800 transition-colors text-left"
            >
              <span className="text-white font-medium">{POSITION_NAMES[pos]} <span className="text-gray-500">({pos})</span> RFI</span>
              <span className="text-xs text-gray-500">
                {previews[pos].total} spots
                {previews[pos].total > 0 && <> · <span className="text-orange-300">{fmtPct(previews[pos].raisePct)} raise</span></>}
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}

// ---- A single RFI report ----
interface Props {
  hands: ParsedHand[]
  position: string
  onChangePosition: (position: string) => void
  onOpenHands: (hands: ParsedHand[], index: number) => void
  onBack: () => void
}

export default function ReportsView({ hands, position, onChangePosition, onOpenHands, onBack }: Props) {
  const report = useMemo(
    () => rfiReport(hands, { position, minBB: MIN_BB, excludeHero: true }),
    [hands, position],
  )

  const actions: RfiAction[] = ['raise', 'limp', 'fold']

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center gap-3 px-4 py-2 bg-black/50 border-b border-gray-800 text-sm">
        <button
          onClick={onBack}
          className="text-xs text-gray-500 hover:text-white border border-gray-700 rounded px-2 py-1 transition-colors"
        >
          ← Reports
        </button>
        <span className="text-white font-semibold">{POSITION_NAMES[position]} RFI</span>
        <span className="text-gray-500 text-xs">population · excludes your hands · {MIN_BB}bb+</span>
        <label className="ml-auto flex items-center gap-1.5 text-xs text-gray-400">
          Position
          <select
            value={position}
            onChange={e => onChangePosition(e.target.value)}
            className="bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-gray-200 focus:outline-none focus:border-yellow-500"
          >
            {RFI_POSITIONS.map(p => <option key={p} value={p}>{p}</option>)}
          </select>
        </label>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar p-4">
        {/* Aggregate */}
        <div className="max-w-2xl mx-auto mb-6">
          <div className="text-center text-gray-400 text-sm mb-2">
            {position} unopened pots ({MIN_BB}bb+): <span className="text-white font-semibold">{report.total}</span>
          </div>
          {report.total === 0 ? (
            <p className="text-center text-gray-600 text-sm">
              No qualifying spots yet. Import &amp; export more hands, or pick another position.
            </p>
          ) : (
            <>
              <div className="flex h-4 rounded overflow-hidden mb-3">
                {actions.map(a => report.pct[a] > 0 && (
                  <div key={a} className={ACTION_META[a].bar} style={{ width: `${report.pct[a]}%` }} title={`${ACTION_META[a].label} ${fmtPct(report.pct[a])}`} />
                ))}
              </div>
              <div className="flex justify-around text-sm">
                {actions.map(a => (
                  <div key={a} className="text-center">
                    <div className={`font-bold ${ACTION_META[a].color}`}>{fmtPct(report.pct[a])}</div>
                    <div className="text-gray-500 text-xs">{ACTION_META[a].label} · {report.counts[a]}</div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>

        {/* Hand lists per bucket */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-5xl mx-auto">
          {actions.map(a => (
            <BucketColumn
              key={a}
              title={ACTION_META[a].label}
              color={ACTION_META[a].color}
              entries={report.entries[a]}
              onOpenHands={onOpenHands}
            />
          ))}
        </div>
      </div>
    </div>
  )
}

function BucketColumn({ title, color, entries, onOpenHands }: {
  title: string
  color: string
  entries: RfiEntry[]
  onOpenHands: (hands: ParsedHand[], index: number) => void
}) {
  const bucketHands = entries.map(e => e.hand)
  return (
    <div className="border border-gray-800 rounded-lg bg-black/20 flex flex-col min-h-0">
      <div className={`px-3 py-2 border-b border-gray-800 text-sm font-semibold ${color}`}>
        {title} <span className="text-gray-600 font-normal">· {entries.length}</span>
      </div>
      <div className="p-1">
        {entries.length === 0 && <div className="text-gray-600 text-xs px-2 py-3 text-center">—</div>}
        {entries.map((e, i) => (
          <button
            key={e.spot.handId}
            onClick={() => onOpenHands(bucketHands, i)}
            className="w-full flex items-center gap-2 px-2 py-1.5 rounded hover:bg-white/5 transition-colors text-left"
          >
            <div className="flex gap-0.5 shrink-0">
              {e.spot.cards
                ? e.spot.cards.map((c, j) => <PlayingCard key={j} card={c} tiny />)
                : <span className="text-gray-600 text-xs">??</span>}
            </div>
            <span className="text-gray-400 text-xs ml-auto shrink-0">{Math.round(e.spot.stackBB)}bb</span>
          </button>
        ))}
      </div>
    </div>
  )
}
