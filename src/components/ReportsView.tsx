import { useMemo } from 'react'
import type { ParsedHand } from '../lib/types'
import {
  buildReport, RFI_POSITIONS, VS_RFI_DEFENDERS, openersFor,
  type ReportSel, type ReportResult, type ReportBucket,
} from '../lib/reports'
import PlayingCard from './PlayingCard'

function fmtPct(n: number) {
  return (Number.isInteger(n) ? n : n.toFixed(1)) + '%'
}

// ---------------------------------------------------------------------------
// Reports menu — horizontal rows of report tiles (room to add more sets).
// ---------------------------------------------------------------------------
export function ReportsMenu({ hands, onOpen, onBack }: {
  hands: ParsedHand[]
  onOpen: (sel: ReportSel) => void
  onBack: () => void
}) {
  // Build every report once for the preview stats.
  const previews = useMemo(() => {
    const m = new Map<string, ReportResult>()
    for (const pos of RFI_POSITIONS) m.set(`rfi:${pos}`, buildReport(hands, { type: 'rfi', pos }))
    for (const d of VS_RFI_DEFENDERS) for (const o of openersFor(d))
      m.set(`vsrfi:${d}:${o}`, buildReport(hands, { type: 'vsrfi', defender: d, opener: o }))
    return m
  }, [hands])

  const Tile = ({ sel, label }: { sel: ReportSel; label: string }) => {
    const key = sel.type === 'rfi' ? `rfi:${sel.pos}` : `vsrfi:${sel.defender}:${sel.opener}`
    const r = previews.get(key)!
    return (
      <button
        onClick={() => onOpen(sel)}
        className="shrink-0 w-28 rounded-lg border border-gray-700 bg-gray-900 hover:border-yellow-500 hover:bg-gray-800 transition-colors px-3 py-2 text-left"
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
        <h1 className="text-2xl font-bold text-white">Reports</h1>
        <span className="text-gray-600 text-xs">population · excludes your hands · 75bb+</span>
        <span className="ml-auto text-xs text-gray-600">
          ratio = <span className="text-red-400">raise</span>/<span className="text-green-400">call</span>/<span className="text-blue-400">fold</span>
        </span>
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
            <span className="text-gray-400 text-xs ml-auto shrink-0">{Math.round(e.stackBB)}bb</span>
          </button>
        ))}
      </div>
    </div>
  )
}
