import { useMemo, useState } from 'react'
import { comboActionMap, reportTitle, type ReportGridRow, type ReportSel, type Subject } from '../shared/poker/reports'
import type { TableKind } from '../shared/poker/positionUtils'
import NotesPanel from '../shared/ui/NotesPanel'

// NLHE report as the classic 13×13 starting-hand grid: pairs on the diagonal,
// suited upper-right, offsuit lower-left. Each cell is filled by its action mix
// (raise red / call green / fold blue, weighted by frequency) with the combo count.
// Frequency-only — no GTO EV (there's no NLHE solver).

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']

// combo key for the cell at (row r, col c) — matches holdemCombo()'s output.
function cellCombo(r: number, c: number): string {
  if (r === c) return RANKS[r] + RANKS[r]                 // pair
  return r < c ? `${RANKS[r]}${RANKS[c]}s` : `${RANKS[c]}${RANKS[r]}o` // suited above / offsuit below
}

// action → color; ordered strongest-aggression first so the fill reads consistently.
const ACTIONS: { key: string; color: string }[] = [
  { key: 'raise', color: '#ef4444' }, // red
  { key: 'call', color: '#22c55e' },  // green
  { key: 'limp', color: '#14b8a6' },  // teal (RFI limp)
  { key: 'fold', color: '#3b82f6' },  // blue
]

export default function HandGrid({ grid, sel, subject, kind, title, onBack, onOpenCell, noteAnchor }: {
  grid: ReportGridRow[]
  sel: ReportSel
  subject: Subject
  kind: TableKind
  title: string
  onBack: () => void
  onOpenCell: (combo: string) => void
  noteAnchor?: string
}) {
  const map = useMemo(() => comboActionMap(grid, sel, subject, kind, 'nlhe'), [grid, sel, subject, kind])
  const [hover, setHover] = useState<string | null>(null)

  const totalSpots = useMemo(() => {
    let n = 0
    for (const am of map.values()) for (const c of Object.values(am)) n += c
    return n
  }, [map])

  const Cell = ({ r, c }: { r: number; c: number }) => {
    const combo = cellCombo(r, c)
    const am = map.get(combo)
    const total = am ? Object.values(am).reduce((a, b) => a + b, 0) : 0
    // horizontal fill split by action frequency
    const segs = total ? ACTIONS.filter(a => (am![a.key] ?? 0) > 0).map(a => ({ color: a.color, w: ((am![a.key] ?? 0) / total) * 100 })) : []
    const isPair = r === c
    return (
      <button
        disabled={!total}
        onClick={() => total && onOpenCell(combo)}
        onMouseEnter={() => setHover(total ? combo : null)}
        className={`relative aspect-square min-w-0 overflow-hidden rounded-sm border text-[9px] font-medium leading-none
          ${total ? 'border-gray-700 hover:ring-1 hover:ring-yellow-400 cursor-pointer' : 'border-gray-800/60 cursor-default'}
          ${isPair ? 'ring-1 ring-gray-600/50' : ''}`}
        title={total ? `${combo} · ${total} · ${ACTIONS.filter(a => am![a.key]).map(a => `${a.key} ${Math.round((am![a.key] / total) * 100)}%`).join(' / ')}` : `${combo} · no data`}
      >
        <div className="absolute inset-0 flex bg-gray-900">
          {segs.map((s, i) => <div key={i} style={{ width: `${s.w}%`, backgroundColor: s.color, opacity: 0.75 }} />)}
        </div>
        <span className="absolute inset-0 flex items-center justify-center text-white/90 mix-blend-plus-lighter">{combo}</span>
      </button>
    )
  }

  return (
    <div className="min-h-screen flex flex-col p-6 gap-4">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-xs text-gray-500 hover:text-white border border-gray-700 rounded px-2 py-1 transition-colors">← {title}</button>
        <h1 className="text-xl font-bold text-white">{reportTitle(sel)}</h1>
        <span className="text-gray-500 text-xs">NLHE · {kind === 'hu' ? 'HU' : '6-max'} · {subject === 'hero' ? 'your hands' : 'population'} · 75bb+ · {totalSpots} spots</span>
        <span className="ml-auto text-xs text-gray-500 flex items-center gap-2">
          {ACTIONS.map(a => <span key={a.key} className="flex items-center gap-1"><span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ backgroundColor: a.color }} />{a.key}</span>)}
        </span>
        {noteAnchor && <NotesPanel anchor={noteAnchor} />}
      </div>

      <div className="max-w-3xl w-full">
        <div className="grid gap-0.5" style={{ gridTemplateColumns: `repeat(${RANKS.length}, minmax(0, 1fr))` }}>
          {RANKS.map((_, r) => RANKS.map((__, c) => <Cell key={`${r}-${c}`} r={r} c={c} />))}
        </div>
        <p className="text-gray-600 text-xs mt-2">
          {hover ? `${hover} — click to review these hands` : 'Diagonal = pairs · above = suited · below = offsuit. Click a cell to review its hands.'}
        </p>
      </div>
    </div>
  )
}
