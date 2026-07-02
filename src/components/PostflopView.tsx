import { useMemo, useState, useEffect } from 'react'
import type { ParsedHand, ParsedCard } from '../lib/types'
import {
  formationReport, FORMATIONS, getNode, nodeLabel, nodeFacesBet, parseFilter, writeFilter,
  type FlopSpot, type PostflopFilter, type PostflopMode, type ClassRow, type NodeResult, type FlopActType, type SizeBuckets, type BetBucket, type RangeComp, type MdfSummary, type MdfCell, type NodeSpotRow,
} from '../lib/postflop'
import type { HandClass } from '../lib/ploEval'
import type { GameKind } from '../lib/games'
import { fetchFlopSpots, fetchHandsByIds } from '../lib/handsApi'
import { monthRange } from './MonthRange'
import PlayingCard from './PlayingCard'
import PostflopFilters from './PostflopFilters'
import NotesPanel from './NotesPanel'
import { postflopAnchor } from '../lib/noteAnchor'

// Mode + board filters live in the URL query so they survive drill-down/back/refresh.
// Formation + node come from the path (props).
function readState() {
  const q = new URLSearchParams(window.location.search)
  const opt = <T extends string>(v: string | null, allowed: T[], dflt: T): T => (allowed as string[]).includes(v ?? '') ? (v as T) : dflt
  return {
    mode: opt<PostflopMode>(q.get('m'), ['hero', 'population'], 'hero'),
    filter: parseFilter(q),
  }
}

interface Props {
  formationId: string
  nodeId: string
  game: GameKind
  monthFrom: string
  monthTo: string
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

// Bet/raise segments are shaded by size (% of pot): <40% yellow, 40–70% orange,
// >70% red — so bet-sizing trends by hand class are visible at a glance.
const SIZE_COLORS = ['bg-yellow-500/80', 'bg-orange-500/80', 'bg-red-500/75']

function StackedBar({ counts, sizes, segments }: { counts: Record<string, number>; sizes?: SizeBuckets; segments: { key: string; color: string }[] }) {
  const total = segments.reduce((a, s) => a + (counts[s.key] || 0), 0)
  if (!total) return <div className="flex-1 h-4 rounded bg-gray-800" />
  // Segment WIDTHS are proportional (the visual mix); the label is RAW COUNTS.
  const label = segments.filter(s => (counts[s.key] || 0) > 0).map(s => counts[s.key] || 0).join('/')
  return (
    <div className="flex-1 h-4 rounded overflow-hidden flex relative" title={segments.map(s => `${s.key} ${counts[s.key] || 0} (${Math.round((counts[s.key] || 0) / total * 100)}%)`).join(' · ')}>
      {segments.map(s => {
        const c = counts[s.key] || 0
        if (c <= 0) return null
        const sz = sizes?.[s.key]
        if (sz && (s.key === 'bet' || s.key === 'raise')) {
          // split the aggressive segment into <40 / 40–70 / >70 size buckets
          const parts = sz.map((n, i) => n > 0 ? <div key={`${s.key}-${i}`} className={SIZE_COLORS[i]} style={{ width: `${(n / total) * 100}%` }} /> : null)
          const rest = c - (sz[0] + sz[1] + sz[2]) // bets missing a size (rare) keep the default color
          if (rest > 0) parts.push(<div key={`${s.key}-rest`} className={s.color} style={{ width: `${(rest / total) * 100}%` }} />)
          return parts
        }
        return <div key={s.key} className={s.color} style={{ width: `${(c / total) * 100}%` }} />
      })}
      <span className="absolute inset-0 flex items-center justify-center text-[10px] text-white/90">{label}</span>
    </div>
  )
}

// MDF vs actual defense, per faced-bet size. req = the game-theory floor set by
// the sizing (mean over spots); def = how often the player actually continued
// (call+raise). gap = def − req: negative ⇒ overfolding = exploitable (bet/bluff
// more into this player), so it's flagged red; positive (defending enough) green.
function MdfPanel({ mdf }: { mdf: MdfSummary }) {
  const rows: { label: string; cell: MdfCell }[] = [
    { label: '<40%', cell: mdf.buckets[0] }, { label: '40–70%', cell: mdf.buckets[1] },
    { label: '>70%', cell: mdf.buckets[2] }, { label: 'all', cell: mdf.all },
  ]
  return (
    <div className="mb-4">
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">MDF vs actual <span className="text-gray-600 normal-case">· defend = call + raise</span></div>
      <div className="space-y-0.5 text-xs">
        <div className="flex items-center gap-2 text-[10px] text-gray-600"><span className="w-14">size</span><span className="w-8 text-right">n</span><span className="w-12 text-right">req</span><span className="w-12 text-right">def</span><span className="flex-1 text-right">gap</span></div>
        {rows.map(({ label, cell }) => {
          if (cell.n === 0) return (
            <div key={label} className={`flex items-center gap-2 ${label === 'all' ? 'border-t border-gray-800 pt-0.5 text-gray-400' : 'text-gray-600'}`}>
              <span className="w-14">{label}</span><span className="w-8 text-right">0</span><span className="flex-1 text-right text-gray-700">—</span>
            </div>
          )
          const req = cell.sumMdf / cell.n, def = cell.defends / cell.n, gap = def - req
          const gapColor = Math.abs(gap) < 0.03 ? 'text-gray-500' : gap < 0 ? 'text-red-400' : 'text-green-400'
          return (
            <div key={label} className={`flex items-center gap-2 ${label === 'all' ? 'border-t border-gray-800 pt-0.5 text-gray-300' : 'text-gray-400'}`}>
              <span className="w-14">{label}</span>
              <span className="w-8 text-right text-gray-500">{cell.n}</span>
              <span className="w-12 text-right text-gray-400">{pct(Math.round(req * 100))}</span>
              <span className="w-12 text-right text-gray-300">{pct(Math.round(def * 100))}</span>
              <span className={`flex-1 text-right ${gapColor}`} title={gap < 0 ? 'overfolds — exploitable' : 'defends enough'}>{gap >= 0 ? '+' : '−'}{pct(Math.round(Math.abs(gap) * 100))}</span>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// The per-hand table (hand · board · action · class). Shared by the center
// decision list and the side-by-side compare panel so they line up exactly.
function HandsTable({ rows, handLabel, street, boardOf, onRow, header, compact }: {
  rows: NodeSpotRow[]; handLabel: string; street: string
  boardOf: (s: NodeSpotRow['spot']) => ParsedCard[]; onRow: (i: number) => void; header?: React.ReactNode; compact?: boolean
}) {
  // Compact variant fits the table inside a w-80 side column (no layout shift).
  const wHand = compact ? 'w-24' : 'w-28', wBoard = compact ? 'w-28' : 'w-32'
  const wAct = compact ? 'w-14' : 'w-16', gap = compact ? 'gap-2' : 'gap-3'
  return (
    <div className="border border-gray-800 rounded-lg bg-black/20">
      {header}
      <div className={`px-3 py-2 border-b border-gray-800 text-xs text-gray-500 flex ${gap}`}>
        <span className={wHand}>{handLabel}</span>
        <span className={wBoard}>{street}</span>
        <span className={wAct}>action</span>
        <span className="min-w-0 flex-1">hand class</span>
      </div>
      {rows.map((x, i) => (
        <button key={`${x.spot.handId}-${i}`} onClick={() => onRow(i)}
          className={`w-full flex items-center ${gap} px-3 py-1.5 hover:bg-white/5 transition-colors text-left text-xs`}>
          <span className={`${wHand} flex gap-0.5`}>{x.cards?.map((c, j) => <PlayingCard key={j} card={c} tiny />)}</span>
          <span className={`${wBoard} flex gap-0.5`}>{boardOf(x.spot).map((c, j) => <PlayingCard key={j} card={c} tiny />)}</span>
          <span className={`${wAct} ${actionText(x.action)}`}>{x.action}{x.betPct !== undefined ? ` ${pct(x.betPct * 100)}` : ''}</span>
          <span className="min-w-0 flex-1 text-gray-300 truncate" title={x.klass?.label}>{x.klass?.label ?? '—'}</span>
        </button>
      ))}
    </div>
  )
}

export type Sel = { made: string; sub?: string }

// Drop the redundant parent-category prefix from a sub-row label under its row —
// e.g. "overpair · flush draw" under the overpair row shows just "flush draw",
// and the plain "overpair" sub shows "no draw". Tier labels (top set, nut flush)
// are kept as-is.
const subLabel = (rowKey: string, sub: string) =>
  sub === rowKey ? 'no draw' : sub.startsWith(rowKey + ' · ') ? sub.slice(rowKey.length + 3) : sub

function NodeChart({ node, onView, selected, onSelect, cumulative }: {
  node: NodeResult; onView?: () => void; selected?: Sel | null; onSelect?: (s: Sel) => void; cumulative?: boolean
}) {
  const [open, setOpen] = useState<Set<string>>(new Set())
  const toggle = (k: string) => setOpen(s => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n })
  const segs = segmentsOf(node.rows)
  const rowSel = (k: string) => !!selected && selected.made === k && !selected.sub
  const subSel = (k: string, sub: string) => !!selected && selected.made === k && selected.sub === sub
  // Cumulative % of the shown range from the strongest class down (rows are already
  // ordered strongest→weakest), mirroring the "range you're facing" top% column.
  const grand = node.rows.reduce((a, r) => a + r.total, 0) || 1
  const cumByKey = new Map<string, number>()
  { let run = 0; for (const r of node.rows) { run += r.total; cumByKey.set(r.key, run / grand) } }
  return (
    <div className="mb-4">
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1 flex justify-between items-baseline">
        <span>{node.label}</span>
        <span className="text-gray-600 normal-case" title={segs.map(s => `${s.key} ${node.actionCounts[s.key] || 0} (${Math.round((node.actionCounts[s.key] || 0) / (node.total || 1) * 100)}%)`).join(' · ')}>
          {segs.map((s, i) => <span key={s.key}>{i > 0 && <span className="text-gray-600">/</span>}<span className={actionText(s.key)}>{Math.round((node.actionCounts[s.key] || 0) / (node.total || 1) * 100)}</span></span>)} <span className="text-gray-600">· {node.total}</span>
        </span>
      </div>
      {node.rows.length === 0 ? <p className="text-gray-600 text-xs">no sample</p> : (
        <div className="space-y-1">
          {cumulative && (
            <div className="w-full flex items-center gap-2 text-[10px] text-gray-600 px-1">
              <span className="w-3" />
              <div className="flex-1 flex items-center gap-2 min-w-0"><span className="w-36" /><span className="flex-1 text-right pr-1">action</span><span className="w-8 text-right">n</span></div>
              <span className="w-10 text-right">top%</span>
            </div>
          )}
          {node.rows.map(row => {
            const expandable = row.sub.length > 1
            const isOpen = open.has(row.key)
            return (
              <div key={row.key}>
                {/* caret = expand · body = filter (one action per click) */}
                <div className={`w-full flex items-center gap-2 text-xs rounded px-1 py-0.5 ${rowSel(row.key) ? 'bg-yellow-500/15 ring-1 ring-yellow-500/40' : ''}`}>
                  <button onClick={() => expandable && toggle(row.key)} className={`w-3 shrink-0 text-gray-500 ${expandable ? 'cursor-pointer hover:text-white' : 'cursor-default'}`}>{expandable ? (isOpen ? '▾' : '▸') : ''}</button>
                  <button onClick={() => (onSelect ? onSelect({ made: row.key }) : expandable && toggle(row.key))}
                    className={`flex-1 flex items-center gap-2 min-w-0 rounded ${onSelect || expandable ? 'hover:bg-white/5 cursor-pointer' : 'cursor-default'}`}>
                    <span className="w-36 text-gray-300 text-left truncate">{row.key}</span>
                    <StackedBar counts={row.counts} sizes={row.sizes} segments={segs} />
                    <span className="w-8 text-right text-gray-500">{row.total}</span>
                  </button>
                  {cumulative && <span className="w-10 text-right text-gray-400" title="share of this range, this class or stronger">{Math.round((cumByKey.get(row.key) ?? 0) * 100)}%</span>}
                </div>
                {isOpen && row.sub.map(s => {
                  const inner = (
                    <>
                      <span className="w-3" /><span className="w-32 text-gray-500 text-left truncate" title={s.label}>{subLabel(row.key, s.label)}</span>
                      <StackedBar counts={s.counts} sizes={s.sizes} segments={segs} />
                      <span className="w-8 text-right text-gray-600">{s.total}</span>
                    </>
                  )
                  return onSelect ? (
                    <button key={s.label} onClick={() => onSelect({ made: row.key, sub: s.label })}
                      className={`w-full flex items-center gap-2 text-xs pl-4 rounded hover:bg-white/5 ${subSel(row.key, s.label) ? 'bg-yellow-500/15 ring-1 ring-yellow-500/40' : ''}`}>{inner}</button>
                  ) : (
                    <div key={s.label} className="flex items-center gap-2 text-xs pl-4">{inner}</div>
                  )
                })}
              </div>
            )
          })}
        </div>
      )}
      {node.mdf && <div className="mt-2"><MdfPanel mdf={node.mdf} /></div>}
      {onView && node.handIds.length > 0 && (
        <button onClick={onView} className="mt-1 text-xs text-blue-400 hover:text-blue-300">
          ▶ Review these {node.handIds.length} hands
        </button>
      )}
    </div>
  )
}

// The range you're facing: hand-class composition (bar = combos relative to the
// range) with a cumulative % from the strongest class down.
function FacingRange({ comp, barColor, onView }: { comp: RangeComp; barColor: string; onView?: () => void }) {
  const total = comp.total || 1
  const maxCount = Math.max(1, ...comp.rows.map(r => r.count)) // normalize bars to the biggest class
  let running = 0
  const rows = comp.rows.map(row => { running += row.count; return { ...row, cum: running / total } })
  return (
    <div className="mb-4">
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-1">range you're facing <span className="text-gray-600 normal-case">· {comp.total} shown</span></div>
      {rows.length === 0 ? <p className="text-gray-600 text-xs">no showdowns in sample</p> : (
        <div className="space-y-1">
          <div className="flex items-center gap-2 text-[10px] text-gray-600"><span className="w-36" /><span className="flex-1">combos</span><span className="w-8 text-right">n</span><span className="w-10 text-right">top%</span></div>
          {rows.map(row => (
            <div key={row.key} className="flex items-center gap-2 text-xs">
              <span className="w-36 text-gray-300 text-left truncate" title={row.key}>{row.key}</span>
              <div className="flex-1 h-3 rounded bg-gray-800/80 overflow-hidden" title={`${Math.round((row.count / total) * 100)}% of range`}>
                <div className={`h-full ${barColor}`} style={{ width: `${(row.count / maxCount) * 100}%` }} />
              </div>
              <span className="w-8 text-right text-gray-500">{row.count}</span>
              <span className="w-10 text-right text-gray-400">{Math.round(row.cum * 100)}%</span>
            </div>
          ))}
        </div>
      )}
      {onView && comp.handIds.length > 0 && (
        <button onClick={onView} className="mt-1 text-xs text-blue-400 hover:text-blue-300">▶ Review these {comp.handIds.length} hands</button>
      )}
    </div>
  )
}

export default function PostflopView({ formationId, nodeId, game, monthFrom, monthTo, onOpenHands, onBack }: Props) {
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
  // Only this formation's spots are loaded; the node report (texture/node/mode)
  // is computed client-side. Drill-down resolves hand ids on demand.
  const [spots, setSpots] = useState<FlopSpot[]>([])
  useEffect(() => { let live = true; fetchFlopSpots(formationId, monthRange(monthFrom, monthTo), mode, game).then(s => { if (live) setSpots(s) }).catch(() => {}); return () => { live = false } }, [formationId, monthFrom, monthTo, mode, game])
  // Bet-size filter (only when facing a bet): narrows all panels to that faced size.
  const facesBet = node ? nodeFacesBet(node) : false
  const [facedBet, setFacedBet] = useState<BetBucket>('all')
  // Made-bet filter (nodes where the acting player bets — first-to-act / vs check):
  // slice the range by the size THEY bet, to read betting-range construction by size.
  const canBet = !!node && !facesBet
  const [madeBet, setMadeBet] = useState<BetBucket>('all')
  useEffect(() => { setFacedBet('all'); setMadeBet('all') }, [nodeId, formationId])
  const r = useMemo(() => formationReport(spots, formationId, nodeId, mode, filter, facesBet ? facedBet : 'all', canBet ? madeBet : 'all'), [spots, formationId, nodeId, mode, filter, facesBet, facedBet, canBet, madeBet])
  const openHands = async (ids: string[], index: number) => onOpenHands(await fetchHandsByIds(ids), index)

  // Side-by-side compare: a "review" button opens that panel's hand table on the
  // right instead of the replayer. Stored as a reference into `r` (not a snapshot)
  // so it stays live as filters change; indices are stable per node.
  type CompareSel = { kind: 'prior' } | { kind: 'response'; i: number }
  const [compareSel, setCompareSel] = useState<CompareSel | null>(null)
  const [compareSelClass, setCompareSelClass] = useState<Sel | null>(null)
  useEffect(() => { setCompareSel(null); setCompareSelClass(null) }, [nodeId, formationId])
  const compareNode: NodeResult | undefined =
    compareSel?.kind === 'response' ? r.responses[compareSel.i]
    : compareSel?.kind === 'prior' ? r.prior : undefined
  // The reviewed panel's hands as a table, dropped underneath its own section —
  // filterable by hand class (click a class in the chart) like the middle list.
  const renderCompare = (n: NodeResult) => {
    const list = n.list ?? []
    const cShown = compareSelClass ? list.filter(x => topKey(x.klass) === compareSelClass.made && (!compareSelClass.sub || x.klass?.sub === compareSelClass.sub)) : list
    const ids = cShown.map(x => x.spot.handId)
    return (
      <div className="mt-3">
        <div className="text-xs uppercase tracking-wide text-gray-500 mb-1 flex items-center gap-2">
          <span className="truncate">hands · {n.label}</span>
          <span className="text-gray-600 normal-case shrink-0">{cShown.length}</span>
          <button onClick={() => setCompareSel(null)} className="ml-auto text-gray-500 hover:text-white shrink-0">close ✕</button>
        </div>
        {list.length > 0
          ? <HandsTable rows={cShown} handLabel="villain hand" street={street} boardOf={boardOf} onRow={i => openHands(ids, i)} compact
              header={compareSelClass && (
                <div className="px-3 py-1.5 border-b border-gray-800 text-xs flex items-center gap-2 bg-yellow-500/5">
                  <span className="text-gray-400">showing</span>
                  <span className="text-yellow-300 truncate">{compareSelClass.sub ?? compareSelClass.made}</span>
                  <button onClick={() => setCompareSelClass(null)} className="ml-auto text-gray-500 hover:text-white shrink-0">clear ✕</button>
                </div>
              )} />
          : <p className="text-gray-600 text-xs">no hands in sample</p>}
      </div>
    )
  }

  // Click a category/subcategory in your decision chart to filter the hands list.
  const [sel, setSel] = useState<Sel | null>(null)
  useEffect(() => { setSel(null) }, [nodeId, formationId]) // reset when the node changes
  const pickSel = (s: Sel) => setSel(cur => (cur && cur.made === s.made && cur.sub === s.sub) ? null : s)
  const topKey = (k?: HandClass) => (k ? (k.made ?? (k.draws.length ? 'draw' : 'air')) : 'air')
  const shown = sel ? r.listSpots.filter(x => topKey(x.klass) === sel.made && (!sel.sub || x.klass?.sub === sel.sub)) : r.listSpots

  // Mirror state into the URL (replace, so it doesn't spam history) so back/refresh restore it.
  useEffect(() => {
    const q = new URLSearchParams({ m: mode })
    writeFilter(q, filter)
    history.replaceState(null, '', `/postflop/${formationId}/${nodeId}?${q}`)
  }, [formationId, nodeId, mode, filter])

  const set = (patch: Partial<PostflopFilter>) => setFilter(f => ({ ...f, ...patch }))

  const handList = shown.map(x => x.spot.handId)

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
        {facesBet && (
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <span>facing</span>
            <div className="flex rounded-full border border-gray-700 overflow-hidden">
              {([['all', 'all'], ['sm', '<40%'], ['md', '40–70%'], ['lg', '>70%']] as [BetBucket, string][]).map(([b, l]) => (
                <button key={b} onClick={() => setFacedBet(b)} className={`px-2.5 py-1 transition-colors ${facedBet === b ? 'bg-yellow-500/20 text-yellow-300' : 'text-gray-400 hover:text-white'}`}>{l}</button>
              ))}
            </div>
          </div>
        )}
        {canBet && (
          <div className="flex items-center gap-1 text-xs text-gray-500">
            <span>bet size</span>
            <div className="flex rounded-full border border-gray-700 overflow-hidden">
              {([['all', 'all'], ['sm', '<40%'], ['md', '40–70%'], ['lg', '>70%']] as [BetBucket, string][]).map(([b, l]) => (
                <button key={b} onClick={() => setMadeBet(b)} className={`px-2.5 py-1 transition-colors ${madeBet === b ? 'bg-yellow-500/20 text-yellow-300' : 'text-gray-400 hover:text-white'}`}>{l}</button>
              ))}
            </div>
          </div>
        )}
        <div className="ml-auto flex items-center gap-3">
          <PostflopFilters filter={filter} onChange={set} />
          <NotesPanel
            anchor={postflopAnchor(game, formationId, nodeId)}
            widthClass="w-[38rem]"
            rows={12}
            minHeightClass="min-h-[10rem]"
          />
        </div>
      </div>

      <div className="flex-1 overflow-y-auto no-scrollbar p-4">
        <div className="flex gap-6 mx-auto items-start flex-wrap max-w-[1600px]">
          {/* Left: the villain range you're facing (composition, not their action).
              Bar color: green vs a check, red vs a bet, or the size color when a
              specific faced size is selected (<40 yellow / 40–70 orange / >70 red). */}
          {r.facedRange && (
            <div className="flex-[4] min-w-[20rem]">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">← Facing (villain)</div>
              <FacingRange
                comp={r.facedRange}
                barColor={!facesBet ? 'bg-green-600/70'
                  : facedBet === 'sm' ? 'bg-yellow-500/80'
                  : facedBet === 'md' ? 'bg-orange-500/80'
                  : 'bg-red-500/75'}
                onView={() => { setCompareSel(r.prior ? { kind: 'prior' } : null); setCompareSelClass(null) }}
              />
              {compareSel?.kind === 'prior' && r.prior && renderCompare(r.prior)}
            </div>
          )}

          {/* Center: YOUR decision + hands */}
          <div className="flex-[5] min-w-[24rem]">
            <div className="text-xs text-yellow-300/80 mb-2">{mode === 'hero' ? 'Your decision — range & action' : 'Field — range & action'}</div>
            <NodeChart node={r.heroNode} selected={sel} onSelect={pickSel}
              cumulative={(facesBet && facedBet !== 'all') || (canBet && madeBet !== 'all')} />

            {r.listSpots.length > 0 && (
              <div className="mt-3">
                <HandsTable
                  rows={shown} handLabel={mode === 'hero' ? 'your hand' : 'hand'} street={street} boardOf={boardOf}
                  onRow={i => openHands(handList, i)}
                  header={sel && (
                    <div className="px-3 py-1.5 border-b border-gray-800 text-xs flex items-center gap-2 bg-yellow-500/5">
                      <span className="text-gray-400">showing</span>
                      <span className="text-yellow-300">{sel.sub ?? sel.made}</span>
                      <span className="text-gray-600">· {shown.length} hands</span>
                      <button onClick={() => setSel(null)} className="ml-auto text-gray-500 hover:text-white">clear ✕</button>
                    </div>
                  )}
                />
              </div>
            )}
          </div>

          {/* Right: resulting villain responses (population). Review drops that
              response's hands as a table directly underneath this section. */}
          {r.responses.length > 0 && (
            <div className="flex-[4] min-w-[20rem]">
              <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Resulting (villain, pop) →</div>
              {r.responses.map((n, i) => (
                <NodeChart key={i} node={n}
                  onView={() => { setCompareSel({ kind: 'response', i }); setCompareSelClass(null) }}
                  selected={compareSel?.kind === 'response' && compareSel.i === i ? compareSelClass : null}
                  onSelect={s => {
                    setCompareSel({ kind: 'response', i })
                    setCompareSelClass(cur => (compareSel?.kind === 'response' && compareSel.i === i && cur && cur.made === s.made && cur.sub === s.sub) ? null : s)
                  }} />
              ))}
              {compareSel?.kind === 'response' && compareNode && renderCompare(compareNode)}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
