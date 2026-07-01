import { useEffect, useMemo, useState } from 'react'
import { computeGraphFromRows, type GraphRow, type GraphStats } from '../lib/graph'
import { fetchGraphFromDb } from '../lib/handsApi'

interface Props {
  onBack: () => void
}

const fmt = (n: number, dp = 1) => (n >= 0 ? '+' : '') + n.toFixed(dp)
const tone = (n: number) => (n >= 0 ? 'text-green-400' : 'text-red-400')

function Stat({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-3 min-w-[150px]">
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className={`text-2xl font-bold ${color ?? 'text-white'}`}>{value}</div>
      {sub && <div className="text-xs text-gray-600 mt-0.5">{sub}</div>}
    </div>
  )
}

// SVG line chart: x = hands played, y = cumulative BB. Two lines: actual + all-in adjusted.
function Chart({ points }: { points: { i: number; cum: number; cumAdj: number }[] }) {
  const W = 900, H = 360, PAD_L = 56, PAD_B = 28, PAD_T = 12, PAD_R = 12
  if (points.length < 2) return <div className="text-gray-600 text-sm text-center py-12">Not enough hands to plot yet.</div>

  const n = points[points.length - 1].i
  const ys = points.flatMap(p => [p.cum, p.cumAdj])
  const yMin = Math.min(0, ...ys), yMax = Math.max(0, ...ys)
  const yPad = (yMax - yMin) * 0.08 || 1
  const lo = yMin - yPad, hi = yMax + yPad
  const x = (i: number) => PAD_L + ((i - 1) / Math.max(1, n - 1)) * (W - PAD_L - PAD_R)
  const y = (v: number) => PAD_T + (1 - (v - lo) / (hi - lo)) * (H - PAD_T - PAD_B)

  const path = (key: 'cum' | 'cumAdj') => points.map((p, j) => `${j ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p[key]).toFixed(1)}`).join(' ')

  // y gridlines at a few round values
  const ticks = 4
  const yTicks = Array.from({ length: ticks + 1 }, (_, k) => lo + ((hi - lo) * k) / ticks)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ maxHeight: 380 }}>
      {yTicks.map((t, k) => (
        <g key={k}>
          <line x1={PAD_L} x2={W - PAD_R} y1={y(t)} y2={y(t)} stroke="#1f2937" strokeWidth={1} />
          <text x={PAD_L - 6} y={y(t) + 3} textAnchor="end" fontSize={11} fill="#6b7280">{Math.round(t)}</text>
        </g>
      ))}
      {/* zero line emphasized */}
      <line x1={PAD_L} x2={W - PAD_R} y1={y(0)} y2={y(0)} stroke="#4b5563" strokeWidth={1.5} />
      <path d={path('cumAdj')} fill="none" stroke="#22d3ee" strokeWidth={1.5} strokeOpacity={0.85} strokeDasharray="4 3" />
      <path d={path('cum')} fill="none" stroke="#eab308" strokeWidth={2} />
      <text x={PAD_L} y={H - 8} fontSize={11} fill="#6b7280">0</text>
      <text x={W - PAD_R} y={H - 8} textAnchor="end" fontSize={11} fill="#6b7280">{n} hands</text>
    </svg>
  )
}

type GameFilter = 'all' | 'plo' | 'nlhe'

export default function GraphView({ onBack }: Props) {
  const [rows, setRows] = useState<GraphRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [game, setGame] = useState<GameFilter>('all')

  useEffect(() => {
    let cancelled = false
    setRows(null); setError(null)
    fetchGraphFromDb(game === 'all' ? undefined : game)
      .then(r => { if (!cancelled) setRows(r) })
      .catch(e => { if (!cancelled) setError(String((e as Error).message ?? e)) })
    return () => { cancelled = true }
  }, [game])

  const g: GraphStats | null = useMemo(() => (rows ? computeGraphFromRows(rows) : null), [rows])

  return (
    <div className="min-h-screen flex flex-col p-6 gap-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-xs text-gray-500 hover:text-white border border-gray-700 rounded px-2 py-1 transition-colors">← Home</button>
        <h1 className="text-2xl font-bold text-white">Graph</h1>
        <div className="flex rounded-full border border-gray-700 overflow-hidden text-xs">
          {(['all', 'plo', 'nlhe'] as GameFilter[]).map(gk => (
            <button key={gk} onClick={() => setGame(gk)}
              className={`px-3 py-1 transition-colors ${game === gk ? 'bg-yellow-500/20 text-yellow-300' : 'text-gray-400 hover:text-white'}`}>
              {gk === 'all' ? 'All' : gk === 'plo' ? 'PLO' : 'NLHE'}
            </button>
          ))}
        </div>
        {g && <span className="text-gray-600 text-xs">{g.hands} hands · BB won/lost over time</span>}
      </div>

      {error && <div className="text-red-400 text-sm">Couldn't load graph: {error}</div>}
      {!g && !error && <div className="text-gray-500 text-sm">Loading…</div>}

      {g && (
        <>
          <div className="flex flex-wrap gap-3">
            <Stat label="BB / 100" value={fmt(g.bbPer100, 2)} color={tone(g.bbPer100)} sub="actual winrate" />
            <Stat label="All-in adj BB / 100" value={fmt(g.adjBbPer100, 2)} color={tone(g.adjBbPer100)} sub="all-ins by equity" />
            <Stat label="Total BB" value={fmt(g.totalNetBB, 1)} color={tone(g.totalNetBB)} sub="won / lost" />
            <Stat label="Rake paid" value={`−${g.totalRakeBB.toFixed(1)}`} color="text-orange-300" sub="BB attributed" />
          </div>

          <div className="rounded-xl border border-gray-800 bg-black/20 p-4">
            <div className="flex items-center gap-4 text-xs mb-2">
              <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0.5 bg-yellow-500" />actual</span>
              <span className="flex items-center gap-1.5"><span className="inline-block w-4 h-0.5" style={{ background: '#22d3ee' }} />all-in adjusted</span>
            </div>
            <Chart points={g.points} />
          </div>
        </>
      )}
    </div>
  )
}
