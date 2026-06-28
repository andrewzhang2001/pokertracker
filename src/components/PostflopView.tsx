import { useMemo, useState, useEffect } from 'react'
import type { ParsedHand, ParsedCard } from '../lib/types'
import {
  extractSpots, formationReport, FORMATIONS, getNode, nodeLabel,
  type PostflopFilter, type PostflopMode, type ClassRow, type NodeResult, type FlopActType,
} from '../lib/postflop'
import PlayingCard from './PlayingCard'

// Mode + board filters live in the URL query so they survive drill-down/back/refresh.
// Formation + node come from the path (props).
function readState() {
  const q = new URLSearchParams(window.location.search)
  const opt = <T extends string>(v: string | null, allowed: T[], dflt: T): T => (allowed as string[]).includes(v ?? '') ? (v as T) : dflt
  return {
    mode: opt<PostflopMode>(q.get('m'), ['hero', 'population'], 'hero'),
    filter: {
      suits: opt(q.get('suits'), ['any', 'rainbow', 'twotone', 'mono'], 'any'),
      paired: opt(q.get('paired'), ['any', 'paired', 'unpaired'], 'any'),
      straight: opt(q.get('straight'), ['any', 'yes', 'no'], 'any'),
    } as PostflopFilter,
  }
}

interface Props {
  hands: ParsedHand[]
  formationId: string
  nodeId: string
  onOpenHands: (hands: ParsedHand[], index: number) => void
  onBack: () => void
}

function pct(n: number) { return (Number.isInteger(n) ? n : n.toFixed(1)) + '%' }

// aggressive = red, passive (call/check) = green, fold = blue
const ACTION_ORDER: FlopActType[] = ['bet', 'raise', 'call', 'check', 'fold']
const ACTION_COLOR: Record<string, string> = {
  bet: 'bg-red-500/75', raise: 'bg-red-500/75', call: 'bg-green-600/70', check: 'bg-green-600/70', fold: 'bg-blue-500/70',
}
const actionText = (a?: string) =>
  a === 'fold' ? 'text-blue-400' : a === 'call' || a === 'check' ? 'text-green-400' : a === 'bet' || a === 'raise' ? 'text-red-400' : 'text-gray-500'

function segmentsOf(rows: ClassRow[]) {
  const keys = new Set<string>()
  for (const r of rows) for (const k of Object.keys(r.counts)) keys.add(k)
  return ACTION_ORDER.filter(k => keys.has(k)).map(k => ({ key: k, color: ACTION_COLOR[k] }))
}

function StackedBar({ counts, segments }: { counts: Record<string, number>; segments: { key: string; color: string }[] }) {
  const total = segments.reduce((a, s) => a + (counts[s.key] || 0), 0)
  if (!total) return <div className="flex-1 h-4 rounded bg-gray-800" />
  const label = segments.filter(s => (counts[s.key] || 0) > 0).map(s => Math.round((counts[s.key] || 0) / total * 100)).join('/')
  return (
    <div className="flex-1 h-4 rounded overflow-hidden flex relative" title={segments.map(s => `${s.key} ${Math.round((counts[s.key] || 0) / total * 100)}%`).join(' · ')}>
      {segments.map(s => { const w = (counts[s.key] || 0) / total * 100; return w > 0 ? <div key={s.key} className={s.color} style={{ width: `${w}%` }} /> : null })}
      <span className="absolute inset-0 flex items-center justify-center text-[10px] text-white/90">{label}</span>
    </div>
  )
}

function NodeChart({ node, onView }: { node: NodeResult; onView?: () => void }) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (k: string) => setOpen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const segs = segmentsOf(node.rows)
  return (
    <div className="mb-4">
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1 flex justify-between items-baseline">
        <span>{node.label}</span>
        <span className="text-gray-600 normal-case">
          {segs.map((s, i) => <span key={s.key}>{i > 0 && ' '}<span className={actionText(s.key)}>{s.key}</span></span>)} · {node.total}
        </span>
      </div>
      {node.rows.length === 0 ? <p className="text-gray-600 text-xs">no sample</p> : (
        <div className="space-y-1">
          {node.rows.map(row => {
            const expandable = row.sub.length > 1
            const isOpen = open.has(row.key)
            return (
              <div key={row.key}>
                <button onClick={() => expandable && toggle(row.key)}
                  className={`w-full flex items-center gap-2 text-xs rounded px-1 py-0.5 ${expandable ? 'hover:bg-white/5 cursor-pointer' : 'cursor-default'}`}>
                  <span className="w-3 text-gray-500">{expandable ? (isOpen ? '▾' : '▸') : ''}</span>
                  <span className="w-24 text-gray-300 text-left truncate">{row.key}</span>
                  <StackedBar counts={row.counts} segments={segs} />
                  <span className="w-8 text-right text-gray-500">{row.total}</span>
                </button>
                {isOpen && row.sub.map(s => (
                  <div key={s.label} className="flex items-center gap-2 text-xs pl-4">
                    <span className="w-3" /><span className="w-24 text-gray-500 text-left truncate" title={s.label}>{s.label}</span>
                    <StackedBar counts={s.counts} segments={segs} />
                    <span className="w-8 text-right text-gray-600">{s.total}</span>
                  </div>
                ))}
              </div>
            )
          })}
        </div>
      )}
      {onView && node.hands.length > 0 && (
        <button onClick={onView} className="mt-1 text-xs text-blue-400 hover:text-blue-300">
          ▶ Review these {node.hands.length} hands
        </button>
      )}
    </div>
  )
}

export default function PostflopView({ hands, formationId, nodeId, onOpenHands, onBack }: Props) {
  const init = readState()
  const [mode, setMode] = useState<PostflopMode>(init.mode)
  const [filter, setFilter] = useState<PostflopFilter>(init.filter)
  const formation = FORMATIONS.find(f => f.id === formationId) ?? FORMATIONS[0]
  const node = getNode(nodeId) ?? undefined
  const street = node?.street ?? 'flop'
  const boardOf = (s: { flop: ParsedCard[]; turnCard: ParsedCard | null; riverCard: ParsedCard | null }) =>
    street === 'flop' ? s.flop
      : street === 'turn' ? [...s.flop, ...(s.turnCard ? [s.turnCard] : [])]
      : [...s.flop, ...(s.turnCard ? [s.turnCard] : []), ...(s.riverCard ? [s.riverCard] : [])]
  const spots = useMemo(() => extractSpots(hands), [hands])
  const r = useMemo(() => formationReport(spots, formationId, nodeId, mode, filter), [spots, formationId, nodeId, mode, filter])

  // Mirror state into the URL (replace, so it doesn't spam history) so back/refresh restore it.
  useEffect(() => {
    const q = new URLSearchParams({ m: mode })
    if (filter.suits !== 'any') q.set('suits', filter.suits)
    if (filter.paired !== 'any') q.set('paired', filter.paired)
    if (filter.straight !== 'any') q.set('straight', filter.straight)
    history.replaceState(null, '', `/postflop/${formationId}/${nodeId}?${q}`)
  }, [formationId, nodeId, mode, filter])

  const set = (patch: Partial<PostflopFilter>) => setFilter(f => ({ ...f, ...patch }))
  const Select = <K extends keyof PostflopFilter>({ label, k, opts }: { label: string; k: K; opts: [PostflopFilter[K], string][] }) => (
    <label className="flex items-center gap-1.5 text-xs text-gray-400">
      {label}
      <select value={filter[k] as string} onChange={e => set({ [k]: e.target.value } as Partial<PostflopFilter>)}
        className="bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-gray-200 focus:outline-none focus:border-yellow-500">
        {opts.map(([v, lbl]) => <option key={String(v)} value={String(v)}>{lbl}</option>)}
      </select>
    </label>
  )

  const handList = r.listSpots.map(x => x.spot.hand)

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 bg-black/50 border-b border-gray-800 text-sm flex-wrap">
        <button onClick={onBack} className="text-xs text-gray-500 hover:text-white border border-gray-700 rounded px-2 py-1 transition-colors">← Postflop</button>
        <span className="text-white font-semibold">{formation.label}</span>
        <span className="text-gray-300 text-xs">{node ? `${node.street} · ${nodeLabel(nodeId, formation.pfa)}` : nodeId}</span>
        <div className="flex rounded-full border border-gray-700 overflow-hidden text-xs">
          {(['hero', 'population'] as PostflopMode[]).map(m => (
            <button key={m} onClick={() => setMode(m)} className={`px-3 py-1 transition-colors ${mode === m ? 'bg-yellow-500/20 text-yellow-300' : 'text-gray-400 hover:text-white'}`}>
              {m === 'hero' ? 'My decisions' : 'Population'}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-3 flex-wrap">
          <Select label="Suits" k="suits" opts={[['any', 'any'], ['rainbow', 'rainbow'], ['twotone', 'two-tone'], ['mono', 'monotone']]} />
          <Select label="Board" k="paired" opts={[['any', 'any'], ['unpaired', 'unpaired'], ['paired', 'paired']]} />
          <Select label="Straight" k="straight" opts={[['any', 'any'], ['yes', 'possible'], ['no', 'no straight']]} />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar p-4">
        <div className="flex gap-6 max-w-7xl mx-auto items-start flex-wrap">
          {/* Left: preceding villain action (population) */}
          {r.prior && (
            <div className="w-72 shrink-0">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">← Preceding (villain, pop)</div>
              <NodeChart node={r.prior} onView={() => onOpenHands(r.prior!.hands, 0)} />
            </div>
          )}

          {/* Center: YOUR decision + hands */}
          <div className="flex-1 min-w-[360px]">
            <div className="text-xs text-yellow-300/80 mb-2">{mode === 'hero' ? 'Your decision — range & action' : 'Field — range & action'}</div>
            <NodeChart node={r.heroNode} />

            {r.listSpots.length > 0 && (
              <div className="border border-gray-800 rounded-lg bg-black/20 mt-3">
                <div className="px-3 py-2 border-b border-gray-800 text-xs text-gray-500 flex gap-3">
                  <span className="w-28">{mode === 'hero' ? 'your hand' : 'hand'}</span>
                  <span className="w-32">{street}</span>
                  <span className="w-16">action</span>
                  <span className="min-w-0 flex-1">hand class</span>
                </div>
                {r.listSpots.map((x, i) => (
                  <button key={x.spot.handId} onClick={() => onOpenHands(handList, i)}
                    className="w-full flex items-center gap-3 px-3 py-1.5 hover:bg-white/5 transition-colors text-left text-xs">
                    <span className="w-28 flex gap-0.5">{x.cards?.map((c, j) => <PlayingCard key={j} card={c} tiny />)}</span>
                    <span className="w-32 flex gap-0.5">
                      {boardOf(x.spot).map((c, j) => <PlayingCard key={j} card={c} tiny />)}
                    </span>
                    <span className={`w-16 ${actionText(x.action)}`}>{x.action}{x.betPct !== undefined ? ` ${pct(x.betPct * 100)}` : ''}</span>
                    <span className="min-w-0 flex-1 text-gray-300 truncate" title={x.klass?.label}>{x.klass?.label ?? '—'}</span>
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Right: resulting villain responses (population) */}
          {r.responses.length > 0 && (
            <div className="w-72 shrink-0">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Resulting (villain, pop) →</div>
              {r.responses.map((n, i) => <NodeChart key={i} node={n} onView={() => onOpenHands(n.hands, 0)} />)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
