import { useMemo, useState, useEffect } from 'react'
import type { ParsedHand } from '../lib/types'
import {
  buildReportFromGrid, leakProfile, MISTAKE_EPS, RFI_POSITIONS, VS_RFI_DEFENDERS, openersFor,
  VS3BET_REPORTS, VS3BET_OPENERS, vs3betTagLabel, LIMP_ISO_TAGS, limpIsoTagLabel,
  type ReportSel, type ReportResult, type ReportBucket, type EvSummary, type SolverTable, type Subject,
  type ReportGridRow,
} from '../lib/reports'
import type { TableKind } from '../lib/positionUtils'
import type { GameKind } from '../lib/games'
import { KindToggle } from './KindToggle'
import { GameToggle } from './GameToggle'
import { MonthRange } from './MonthRange'
import { loadSolver, solverUrl } from '../lib/solver'
import PlayingCard from './PlayingCard'
import NotesPanel from './NotesPanel'
import { reportAnchor } from '../lib/noteAnchor'
import { fetchNoteAnchors } from '../lib/notesApi'

function fmtPct(n: number) {
  return (Number.isInteger(n) ? n : n.toFixed(1)) + '%'
}

// Every 6-max report shown in the menu.
const ALL_SELS: ReportSel[] = [
  ...RFI_POSITIONS.map(pos => ({ type: 'rfi', pos }) as ReportSel),
  ...VS_RFI_DEFENDERS.flatMap(d => openersFor(d).map(o => ({ type: 'vsrfi', defender: d, opener: o }) as ReportSel)),
  ...VS3BET_REPORTS.map(r => ({ type: 'vs3bet', opener: r.opener, tag: r.tag }) as ReportSel),
  ...LIMP_ISO_TAGS.map(iso => ({ type: 'limpiso', iso, multiway: 'all' }) as ReportSel),
]

// Heads-up reports: the only matchup is SB (button) vs BB. Frequency-only (no
// HU GTO solver). Limp/iso is omitted (HU SB-completes aren't tracked yet).
const HU_SELS: ReportSel[] = [
  { type: 'rfi', pos: 'SB' },
  { type: 'vsrfi', defender: 'BB', opener: 'SB' },
  { type: 'vs3bet', opener: 'SB', tag: 'bb' },
]
const selsFor = (kind: TableKind) => (kind === 'hu' ? HU_SELS : ALL_SELS)
const selKey = (sel: ReportSel) =>
  sel.type === 'rfi' ? `rfi:${sel.pos}`
    : sel.type === 'vsrfi' ? `vsrfi:${sel.defender}:${sel.opener}`
    : sel.type === 'vs3bet' ? `vs3bet:${sel.opener}:${sel.tag}`
    : `limpiso:${sel.iso}`

const TIGHT_C = '#9ca3af', LOOSE_C = '#f59e0b', PASSIVE_C = '#3b82f6', AGGRO_C = '#ef4444'

// The leak profile as 4 arrows from a center — up = aggressive, right = loose,
// down = passive, left = tight — each arrow's length sized by its OWN EV lost.
// Every direction shows independently, so a player who errs badly both ways has
// two long arrows (no cancelled-out "neutral"). RFI has no aggression axis, so
// only the left/right (tight/loose) arrows show.
function ArrowGlyph({ ev, size = 34, labels = false }: { ev: EvSummary; size?: number; labels?: boolean }) {
  const { tight, loose, passive, aggressive } = ev.axes
  const scale = Math.max(tight, loose, passive, aggressive, 0.0001)
  const MAX = 30 // max LINE length in the 100×100 viewBox (center at 50,50); the
                 // arrowhead sits beyond it, so the line length = the magnitude.
  const arrow = (val: number, dx: number, dy: number, color: string) => {
    const len = (val / scale) * MAX
    if (len < 2) return null
    const ex = 50 + dx * len, ey = 50 + dy * len          // end of the line (= magnitude)
    const hl = 12, hw = 8.5
    const tipx = ex + dx * hl, tipy = ey + dy * hl          // arrowhead tip, beyond the line
    const px = -dy, py = dx // perpendicular
    return (
      <g stroke={color} fill={color} strokeWidth={9} strokeLinecap="round">
        <line x1={50} y1={50} x2={ex} y2={ey} />
        <polygon stroke="none" points={`${tipx},${tipy} ${ex + px * hw},${ey + py * hw} ${ex - px * hw},${ey - py * hw}`} />
      </g>
    )
  }
  const svg = (
    <svg width={size} height={size} viewBox="0 0 100 100" className="shrink-0 overflow-visible">
      <circle cx={50} cy={50} r={5} fill="#6b7280" />
      {arrow(loose, 1, 0, LOOSE_C)}
      {arrow(tight, -1, 0, TIGHT_C)}
      {ev.aggressionAxis && arrow(aggressive, 0, -1, AGGRO_C)}
      {ev.aggressionAxis && arrow(passive, 0, 1, PASSIVE_C)}
    </svg>
  )
  if (!labels) return svg
  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size + 56, height: size + 30 }}>
      {svg}
      <span className="absolute left-1/2 -translate-x-1/2 top-0 text-[10px] text-red-300/90">aggressive</span>
      <span className="absolute left-1/2 -translate-x-1/2 bottom-0 text-[10px] text-blue-300/90">passive</span>
      <span className="absolute left-0 top-1/2 -translate-y-1/2 text-[10px] text-gray-400">tight</span>
      <span className="absolute right-0 top-1/2 -translate-y-1/2 text-[10px] text-yellow-300/90">loose</span>
    </div>
  )
}

// Equal-length reference glyph for the legend (all four directions the same).
const LEGEND_EV = { axes: { tight: 1, loose: 1, passive: 1, aggressive: 1 }, aggressionAxis: true } as EvSummary

// ---------------------------------------------------------------------------
// Reports menu — horizontal rows of report tiles (room to add more sets).
// ---------------------------------------------------------------------------
export function ReportsMenu({ grid, kind, onKind, game, onGame, monthFrom, monthTo, onMonths, onOpen, onBack, subject = 'population', title = 'Reports' }: {
  grid: ReportGridRow[]
  kind: TableKind
  onKind: (k: TableKind) => void
  game: GameKind
  onGame: (g: GameKind) => void
  monthFrom: string
  monthTo: string
  onMonths: (from: string, to: string) => void
  onOpen: (sel: ReportSel) => void
  onBack: () => void
  subject?: Subject
  title?: string
}) {
  const hu = kind === 'hu'
  // Load the active kind's solver tables once (cached) so tiles show profile +
  // EV/100. HU has its own SB-vs-BB solutions under /solver/hu/.
  const [tables, setTables] = useState<Map<string, SolverTable>>(new Map())
  useEffect(() => {
    let cancelled = false
    Promise.all(selsFor(kind).filter(sel => solverUrl(sel, kind)).map(async sel => {
      try { return [solverUrl(sel, kind), await loadSolver(sel, kind)] as const } catch { return null }
    })).then(rows => {
      if (cancelled) return
      const m = new Map<string, SolverTable>()
      for (const r of rows) if (r) m.set(r[0], r[1])
      setTables(m)
    })
    return () => { cancelled = true }
  }, [kind])

  // Which report tiles the user has notes on — one bulk fetch, refreshed when the
  // subject changes (Reports vs Leakbuster keep separate notes). game/kind are in
  // the anchor too, but they're derivable client-side so no refetch is needed.
  const [notedAnchors, setNotedAnchors] = useState<Set<string>>(new Set())
  useEffect(() => {
    let cancelled = false
    fetchNoteAnchors().then(s => { if (!cancelled) setNotedAnchors(s) }).catch(() => {})
    return () => { cancelled = true }
  }, [subject])

  // Build every report from the compact grid (with solver EVs once tables load).
  const previews = useMemo(() => {
    const m = new Map<string, ReportResult>()
    for (const sel of selsFor(kind)) m.set(selKey(sel), buildReportFromGrid(grid, sel, tables.get(solverUrl(sel, kind)), subject, kind, game))
    return m
  }, [grid, tables, subject, kind, game])

  const Tile = ({ sel, label }: { sel: ReportSel; label: string }) => {
    const r = previews.get(selKey(sel))!
    const hasEv = !!r.ev && r.ev.spots > 0 && r.total > 0
    const hasNote = notedAnchors.has(reportAnchor(game, kind, subject, sel))
    return (
      <button
        onClick={() => onOpen(sel)}
        className="shrink-0 w-28 rounded-lg border border-gray-700 hover:border-yellow-500 transition-colors px-3 py-2 text-left bg-gray-900 hover:bg-gray-800"
      >
        <div className="flex items-start justify-between gap-1">
          <div className="min-w-0">
            <div className="flex items-center gap-1 min-w-0">
              {hasNote && <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" title="has notes" />}
              <div className="text-white text-sm font-medium truncate">{label}</div>
            </div>
            <div className="text-gray-500 text-xs mt-0.5">{r.total} spots</div>
          </div>
          {hasEv && <ArrowGlyph ev={r.ev!} size={34} />}
        </div>
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
        {hasEv && (
          <div className="text-red-300 text-xs mt-0.5">−{(r.ev!.perSpotBb * 100).toFixed(1)} bb/100</div>
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
        <GameToggle game={game} onChange={onGame} />
        <KindToggle kind={kind} onChange={onKind} />
        <MonthRange from={monthFrom} to={monthTo} onChange={onMonths} />
        <span className="text-gray-600 text-xs">{subject === 'hero' ? 'your hands' : 'population · excludes your hands'} · 75bb+</span>
        <span className="ml-auto text-xs text-gray-600">
          ratio = <span className="text-red-400">raise</span>/<span className="text-green-400">call</span>/<span className="text-blue-400">fold</span>
        </span>
      </div>

      {/* Profile-arrows legend: one compass showing the 4 leak directions.
          Each tile's arrows are the leak profile; arrow length = EV lost that
          way, so every direction shows independently. */}
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span className="text-gray-600">tile arrows:</span>
        <ArrowGlyph ev={LEGEND_EV} size={48} labels />
        <span className="text-gray-600">arrow length = EV lost that way</span>
      </div>

      {hu ? (
        // Heads-up: a single SB (button) vs BB matchup — frequency only.
        <div className="flex flex-col gap-3">
          <div className="text-xs uppercase tracking-wide text-gray-600 pl-[7.75rem]">SB (button) vs BB</div>
          <Row label="SB open (RFI)">
            <Tile sel={{ type: 'rfi', pos: 'SB' }} label="SB RFI" />
          </Row>
          <Row label="BB vs SB open">
            <Tile sel={{ type: 'vsrfi', defender: 'BB', opener: 'SB' }} label="BB vs SB" />
          </Row>
          <Row label="SB vs BB 3-bet">
            <Tile sel={{ type: 'vs3bet', opener: 'SB', tag: 'bb' }} label="vs 3-bet" />
          </Row>
        </div>
      ) : (
      <div className="flex gap-8 items-start flex-wrap">
        {/* SRP — opens + defending vs a single raise */}
        <div className="flex flex-col gap-3">
          <div className="text-xs uppercase tracking-wide text-gray-600 pl-[7.75rem]">SRP</div>
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

        {/* 3BP — the opener facing a 3-bet */}
        <div className="flex flex-col gap-3">
          <div className="text-xs uppercase tracking-wide text-gray-600 pl-[7.75rem]">vs 3-bet (3BP)</div>
          {VS3BET_OPENERS.map(op => (
            <Row key={op} label={`${op} vs 3-bet`}>
              {VS3BET_REPORTS.filter(r => r.opener === op).map(r => (
                <Tile key={r.tag} sel={{ type: 'vs3bet', opener: op, tag: r.tag }} label={`vs ${vs3betTagLabel(r.tag)}`} />
              ))}
            </Row>
          ))}
        </div>

        {/* Limped pots — the original limper facing an iso-raise */}
        <div className="flex flex-col gap-3">
          <div className="text-xs uppercase tracking-wide text-gray-600 pl-[7.75rem]">limp vs iso</div>
          <Row label="limper vs iso">
            {LIMP_ISO_TAGS.map(iso => (
              <Tile key={iso} sel={{ type: 'limpiso', iso, multiway: 'all' }} label={`vs ${limpIsoTagLabel(iso)}`} />
            ))}
          </Row>
        </div>
      </div>
      )}
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
  headerExtra?: React.ReactNode
  noteAnchor?: string
}

export default function ReportsView({ result, onOpenHands, onBack, headerExtra, noteAnchor }: Props) {
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
        <div className="ml-auto flex items-center gap-3">
          {headerExtra}
          {noteAnchor && <NotesPanel anchor={noteAnchor} />}
        </div>
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

        {/* GTO EV analysis (skipped for solverless reports, e.g. limp vs iso) */}
        {result.total > 0 && !result.solverless && (
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
                <div className="mt-3 flex flex-col items-center gap-1">
                  <ArrowGlyph ev={result.ev} size={90} labels />
                  {(() => { const { label, nickname } = leakProfile(result.ev.axes); return (
                    <div className="text-sm font-semibold text-white">{label}{nickname && <span className="text-gray-500 font-normal"> ({nickname})</span>}</div>
                  ) })()}
                </div>
                {result.ev.directions.length > 0 && (
                  <div className="mt-3 max-w-md mx-auto">
                    <div className="text-xs uppercase tracking-wide text-gray-500 mb-1 text-center">
                      Mistake directions (<span className="text-red-400">did</span> → <span className="text-green-400">should</span> · by EV lost)
                    </div>
                    <div className="flex flex-col gap-1">
                      {result.ev.directions.map(d => {
                        const [chose, best] = d.label.split(' → ')
                        return (
                          <div key={d.label} className="flex justify-between items-baseline text-xs px-2 py-1 rounded bg-black/30">
                            <span><span className="text-red-400">{chose}</span> <span className="text-gray-600">→</span> <span className="text-green-400">{best}</span></span>
                            <span className="text-gray-500">{d.count}× · <span className="text-red-400">−{d.bbLost.toFixed(2)} bb</span></span>
                          </div>
                        )
                      })}
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
              {e.outOfRange ? (
                <span className="text-red-400 mr-2" title="opened a hand outside the GTO RFI range — no solver EV, excluded from EV/100">
                  not in range
                </span>
              ) : e.evLossBb !== undefined && e.evLossBb > MISTAKE_EPS && (
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
