import { useMemo, useState, useEffect } from 'react'
import type { ParsedHand } from '../lib/types'
import {
  extractSpots, formationTree, FORMATIONS, nodeLabel, lineLabel, turnLineLabel, lineSeq,
  type PostflopFilter, type PostflopMode, type TreeCell, type TreeLine, type FlopActor,
} from '../lib/postflop'

// Mode + board filters + selected formation live in the URL query.
function readState() {
  const q = new URLSearchParams(window.location.search)
  const opt = <T extends string>(v: string | null, allowed: T[], dflt: T): T => (allowed as string[]).includes(v ?? '') ? (v as T) : dflt
  return {
    formationId: FORMATIONS.find(f => f.id === q.get('f'))?.id ?? FORMATIONS[0].id,
    lineId: q.get('l') ?? '',
    turnLineId: q.get('t') ?? '',
    mode: opt<PostflopMode>(q.get('m'), ['hero', 'population'], 'population'),
    filter: {
      suits: opt(q.get('suits'), ['any', 'rainbow', 'twotone', 'mono'], 'any'),
      paired: opt(q.get('paired'), ['any', 'paired', 'unpaired'], 'any'),
      straight: opt(q.get('straight'), ['any', 'yes', 'no'], 'any'),
    } as PostflopFilter,
  }
}

interface Props {
  hands: ParsedHand[]
  onOpen: (formationId: string, nodeId: string) => void
  onBack: () => void
}

// Bucket the raw outcome counts into aggressive / passive / fold for the ratio bar.
function buckets(counts: Record<string, number>) {
  const aggro = (counts.bet || 0) + (counts.raise || 0)
  const passive = (counts.call || 0) + (counts.check || 0)
  const fold = counts.fold || 0
  return { aggro, passive, fold, total: aggro + passive + fold }
}

function RatioBar({ counts }: { counts: Record<string, number> }) {
  const { aggro, passive, fold, total } = buckets(counts)
  if (!total) return <div className="h-1 w-full rounded-full bg-gray-800" />
  const seg = (n: number, c: string) => n > 0 ? <div className={c} style={{ width: `${(n / total) * 100}%` }} /> : null
  return (
    <div className="flex h-1 w-full rounded-full overflow-hidden" title={`aggro ${aggro} · passive ${passive} · fold ${fold}`}>
      {seg(aggro, 'bg-red-500/80')}{seg(passive, 'bg-green-600/80')}{seg(fold, 'bg-blue-500/80')}
    </div>
  )
}

// A node "bubble" — click to open the detail view for that line.
function Bubble({ cell, label, onClick }: { cell: TreeCell; label: string; onClick: () => void }) {
  const dim = cell.total === 0
  return (
    <button
      onClick={onClick}
      className={`w-[96px] shrink-0 rounded-2xl border px-2 py-1.5 flex flex-col items-center gap-1 transition-colors ${dim
        ? 'border-gray-800 bg-gray-900/40 hover:border-gray-600'
        : 'border-gray-700 bg-gray-900 hover:border-yellow-500'}`}
    >
      <span className="text-xs font-medium text-gray-200 text-center leading-tight">{label}</span>
      <span className={`text-[10px] ${dim ? 'text-gray-600' : 'text-gray-400'}`}>{cell.total}</span>
      <RatioBar counts={cell.actionCounts} />
    </button>
  )
}

// Line passivity order (most passive first): check-check < check-bet-call < bet-call.
const LINE_ORDER: Record<string, number> = { xx: 0, xbc: 1, bc: 2 }

// One player's bubbles, grouped into columns by depth (col 0 = after one action,
// col 1 = after a raise); bubbles within a column stack vertically.
function SideColumns({ cells, pfa, onOpen, end }: {
  cells: TreeCell[]; pfa: FlopActor; onOpen: (id: string) => void; end?: boolean
}) {
  const cols = [...new Set(cells.map(c => c.col))].sort((a, b) => a - b)
  return (
    <div className={`flex gap-2 ${end ? 'justify-end' : ''}`}>
      {cols.map(col => (
        <div key={col} className="flex flex-col gap-2">
          {cells.filter(c => c.col === col).map(c => (
            <Bubble key={c.id} cell={c} label={nodeLabel(c.id, pfa)} onClick={() => onOpen(c.id)} />
          ))}
        </div>
      ))}
    </div>
  )
}

// One street row: a left-hand label, then OOP columns on the left / IP on the right.
function NodeRow({ label, sub, cells, pfa, onOpen }: {
  label: string; sub?: string; cells: TreeCell[]; pfa: FlopActor; onOpen: (id: string) => void
}) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-20 shrink-0 text-right pt-1">
        <div className="text-sm font-semibold text-gray-200">{label}</div>
        {sub && <div className="text-[10px] text-gray-600">{sub}</div>}
      </div>
      <div className="flex-1 grid grid-cols-2 gap-3">
        <SideColumns cells={cells.filter(c => c.acting === 'oop')} pfa={pfa} onOpen={onOpen} />
        <SideColumns cells={cells.filter(c => c.acting === 'ip')} pfa={pfa} onOpen={onOpen} end />
      </div>
    </div>
  )
}

export default function PostflopMenu({ hands, onOpen, onBack }: Props) {
  const init = readState()
  const [formationId, setFormationId] = useState(init.formationId)
  const [lineId, setLineId] = useState(init.lineId)
  const [turnLineId, setTurnLineId] = useState(init.turnLineId)
  const [mode, setMode] = useState<PostflopMode>(init.mode)
  const [filter, setFilter] = useState<PostflopFilter>(init.filter)
  const pfa = (FORMATIONS.find(f => f.id === formationId) ?? FORMATIONS[0]).pfa

  const spots = useMemo(() => extractSpots(hands), [hands])
  // Spot count per formation (for the selector bubbles) + the selected tree.
  const counts = useMemo(
    () => new Map(FORMATIONS.map(f => [f.id, formationTree(spots, f.id, mode, filter).total])),
    [spots, mode, filter],
  )
  const tree = useMemo(() => formationTree(spots, formationId, mode, filter), [spots, formationId, mode, filter])
  // Order lines most-passive → most-aggressive (by first action): check-check,
  // then check-bet-call, then bet-call.
  const lines: TreeLine[] = useMemo(() => [...tree.lines].sort((a, b) => LINE_ORDER[a.id] - LINE_ORDER[b.id]), [tree])
  const selectedLine = lines.find(l => l.id === lineId) ?? lines[0]
  const turnLines = useMemo(() => [...(selectedLine?.turnLines ?? [])].sort((a, b) => LINE_ORDER[a.id] - LINE_ORDER[b.id]), [selectedLine])
  const selectedTurnLine = turnLines.find(t => t.id === turnLineId) ?? turnLines[0]

  useEffect(() => {
    const q = new URLSearchParams({ f: formationId, m: mode })
    if (lineId) q.set('l', lineId)
    if (turnLineId) q.set('t', turnLineId)
    if (filter.suits !== 'any') q.set('suits', filter.suits)
    if (filter.paired !== 'any') q.set('paired', filter.paired)
    if (filter.straight !== 'any') q.set('straight', filter.straight)
    history.replaceState(null, '', `/postflop?${q}`)
  }, [formationId, lineId, turnLineId, mode, filter])

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

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-4 py-2 bg-black/50 border-b border-gray-800 text-sm flex-wrap">
        <button onClick={onBack} className="text-xs text-gray-500 hover:text-white border border-gray-700 rounded px-2 py-1 transition-colors">← Home</button>
        <span className="text-white font-semibold">Postflop</span>
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

      <div className="flex-1 overflow-y-auto no-scrollbar p-5">
        <div className="max-w-4xl mx-auto flex flex-col gap-6">
          {/* Formation selector bubbles — SRP on one line, 3BP on the next */}
          <div className="flex flex-col gap-2">
            {(['SRP', '3BP'] as const).map(pot => (
              <div key={pot} className="flex flex-wrap items-center gap-2">
                <span className="w-10 shrink-0 text-xs uppercase tracking-wide text-gray-600">{pot}</span>
                {FORMATIONS.filter(f => f.potType === pot).map(f => {
                  const active = f.id === formationId
                  return (
                    <button
                      key={f.id}
                      onClick={() => setFormationId(f.id)}
                      className={`rounded-full border px-4 py-2 text-sm transition-colors ${active
                        ? 'border-yellow-500 bg-yellow-500/15 text-yellow-200'
                        : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-500'}`}
                    >
                      {f.label}
                      <span className={`ml-2 text-xs ${active ? 'text-yellow-400/70' : 'text-gray-600'}`}>{counts.get(f.id) ?? 0}</span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>

          {/* Column legend */}
          <div className="flex items-center gap-3 text-[11px] text-gray-500">
            <div className="w-20 shrink-0" />
            <div className="flex-1 grid grid-cols-2 gap-3">
              <div>OOP <span className="text-gray-600">— first to act / vs a bet</span></div>
              <div className="text-right">IP <span className="text-gray-600">— vs a check / vs a bet</span></div>
            </div>
          </div>

          {/* Flop decision nodes */}
          <div className="flex flex-col gap-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">Flop</div>
            <NodeRow label="Flop" cells={tree.flop} pfa={pfa} onOpen={id => onOpen(formationId, id)} />
          </div>

          {/* Turn — pick a flop line, then see that line's turn nodes */}
          <div className="flex flex-col gap-3">
            <div className="text-xs uppercase tracking-wide text-gray-500">Turn <span className="normal-case text-gray-600">— pick a flop line</span></div>
            <div className="flex flex-wrap gap-2">
              {lines.map(line => {
                const active = selectedLine?.id === line.id
                return (
                  <button
                    key={line.id}
                    onClick={() => setLineId(line.id)}
                    className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${active
                      ? 'border-yellow-500 bg-yellow-500/15 text-yellow-200'
                      : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-500'}`}
                  >
                    {lineLabel(line.id, pfa)}
                    <span className="rounded bg-black/40 px-1 font-mono text-xs text-gray-400">{lineSeq(line.id)}</span>
                    <span className={`text-xs ${active ? 'text-yellow-400/70' : 'text-gray-600'}`}>{line.freq}</span>
                  </button>
                )
              })}
            </div>
            {selectedLine && (
              <NodeRow label="Turn" cells={selectedLine.turn} pfa={pfa} onOpen={id => onOpen(formationId, id)} />
            )}
          </div>

          {/* River — pick how the turn closed (within the chosen flop line) */}
          {selectedLine && (
            <div className="flex flex-col gap-3">
              <div className="text-xs uppercase tracking-wide text-gray-500">
                River <span className="normal-case text-gray-600">— {lineLabel(selectedLine.id, pfa)} → pick a turn line</span>
              </div>
              <div className="flex flex-wrap gap-2">
                {turnLines.map(tl => {
                  const active = selectedTurnLine?.id === tl.id
                  return (
                    <button
                      key={tl.id}
                      onClick={() => setTurnLineId(tl.id)}
                      className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${active
                        ? 'border-yellow-500 bg-yellow-500/15 text-yellow-200'
                        : 'border-gray-700 bg-gray-900 text-gray-300 hover:border-gray-500'}`}
                    >
                      {turnLineLabel(selectedLine.id, tl.id, pfa)}
                      <span className="rounded bg-black/40 px-1 font-mono text-xs text-gray-400">{lineSeq(selectedLine.id)} {lineSeq(tl.id)}</span>
                      <span className={`text-xs ${active ? 'text-yellow-400/70' : 'text-gray-600'}`}>{tl.freq}</span>
                    </button>
                  )
                })}
              </div>
              {selectedTurnLine && (
                <NodeRow label="River" cells={selectedTurnLine.river} pfa={pfa} onOpen={id => onOpen(formationId, id)} />
              )}
            </div>
          )}

          <div className="text-[10px] text-gray-600">
            bubble = <span className="text-red-400">aggro</span>/<span className="text-green-400">passive</span>/<span className="text-blue-400">fold</span> · number = spots
          </div>
        </div>
      </div>
    </div>
  )
}
