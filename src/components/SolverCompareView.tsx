import { useEffect, useMemo, useState } from 'react'
import { fetchProfiles, fetchProfileHands } from '../lib/profilesApi'
import { preflopNodeByCombo } from '../lib/profileStats'
import { loadGtoNode, type GtoNode } from '../lib/gtoRange'
import { tableKind } from '../lib/positionUtils'
import type { ParsedHand } from '../lib/types'

// The HU 100bb preflop tree the user exported. `level` = raises faced when the
// hero acts (see preflopNodeByCombo); it also picks the hero's seat by parity.
const NODES = [
  { key: 'rfi', label: 'RFI (SB open)', url: '/solver-nlhe/hu/rfi.json', level: 0 },
  { key: 'vsrfi', label: 'BB vs Open', url: '/solver-nlhe/hu/vs-rfi.json', level: 1 },
  { key: 'vs3b', label: 'SB vs 3-Bet', url: '/solver-nlhe/hu/vs-3bet.json', level: 2 },
  { key: 'vs4b', label: 'BB vs 4-Bet', url: '/solver-nlhe/hu/vs-4bet.json', level: 3 },
  { key: 'vsjam', label: 'SB vs Jam', url: '/solver-nlhe/hu/vs-jam.json', level: 4 },
] as const

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
const cellCombo = (r: number, c: number) => r === c ? RANKS[r] + RANKS[r] : r < c ? `${RANKS[r]}${RANKS[c]}s` : `${RANKS[c]}${RANKS[r]}o`
const comboWeight = (h: string) => (h.length === 2 ? 6 : h.endsWith('s') ? 4 : 12)

// A cell's action split, 0..1. null = no data (empty on your side).
interface Split { raise: number; call: number; fold: number; n?: number }

// GTO-Wizard-style fill: raise orange, call green, fold blue (left→right).
function fill(s: Split | null): string {
  if (!s) return 'rgba(255,255,255,0.05)'
  const R = s.raise * 100, C = s.call * 100
  return `linear-gradient(to right, #f97316 0 ${R}%, #22c55e ${R}% ${R + C}%, #3b82f6 ${R + C}% 100%)`
}

function RangeGrid({ title, sub, cell }: { title: string; sub?: string; cell: (combo: string) => Split | null }) {
  return (
    <div>
      <div className="text-sm font-semibold text-white mb-0.5">{title}</div>
      <div className="text-[11px] text-gray-500 mb-1.5 h-4">{sub}</div>
      <div className="inline-block border border-black/50">
        {RANKS.map((_, r) => (
          <div key={r} className="flex">
            {RANKS.map((__, c) => {
              const combo = cellCombo(r, c)
              const s = cell(combo)
              return (
                <div key={c} className="w-[34px] h-[34px] border border-black/30 flex flex-col items-center justify-center leading-none"
                  style={{ background: fill(s) }}
                  title={s ? `${combo}: raise ${Math.round(s.raise * 100)}%${s.call ? ` · call ${Math.round(s.call * 100)}%` : ''} · fold ${Math.round(s.fold * 100)}%${s.n !== undefined ? ` (${s.n})` : ''}` : `${combo}: no opens yet`}>
                  <span className="text-[9px] font-semibold text-white/95" style={{ textShadow: '0 1px 1px rgba(0,0,0,0.7)' }}>{combo}</span>
                  {s?.n !== undefined && s.n > 0 && <span className="text-[8px] text-white/80" style={{ textShadow: '0 1px 1px rgba(0,0,0,0.8)' }}>{Math.round(s.raise * 100)}·{s.n}</span>}
                </div>
              )
            })}
          </div>
        ))}
      </div>
    </div>
  )
}

// POC: heads-up SB RFI — your open range side by side with the GTO solve. We only
// know your own cards, so this compares frequencies (raise vs fold).
export default function SolverCompareView({ onBack }: { onBack: () => void }) {
  const [nodeKey, setNodeKey] = useState<typeof NODES[number]['key']>('rfi')
  const node = NODES.find(n => n.key === nodeKey)!
  const [gto, setGto] = useState<GtoNode | null>(null)
  const [huHands, setHuHands] = useState<{ hand: ParsedHand; seat: number }[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Hero's HU hands load once; the node's GTO file loads (cached) per selection.
  useEffect(() => {
    let cancelled = false
    fetchProfiles().then(ps => {
      const hero = ps.find(p => p.isHero)
      return hero ? fetchProfileHands(hero.id) : Promise.resolve([] as { hand: ParsedHand; seat: number }[])
    }).then(hs => { if (!cancelled) setHuHands(hs.filter(h => tableKind(h.hand.players.length) === 'hu')) })
      .catch(e => { if (!cancelled) setError(String((e as Error).message ?? e)) })
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    let cancelled = false
    setGto(null)
    loadGtoNode(node.url).then(g => { if (!cancelled) setGto(g) }).catch(e => { if (!cancelled) setError(String((e as Error).message ?? e)) })
    return () => { cancelled = true }
  }, [node.url])

  const obs = useMemo(() => huHands ? preflopNodeByCombo(huHands, node.level) : null, [huHands, node.level])
  const hands = huHands?.length ?? 0

  const summary = useMemo(() => {
    let n = 0, yr = 0, yc = 0, yf = 0
    for (const t of obs?.values() ?? []) { n += t.n; yr += t.raise; yc += t.call; yf += t.fold }
    let gw = 0, gr = 0, gc = 0, gf = 0
    if (gto) for (const [h, f] of Object.entries(gto.byCombo)) { const w = comboWeight(h); gw += w; gr += f.raise * w; gc += f.call * w; gf += f.fold * w }
    return {
      n,
      you: n ? { raise: yr / n, call: yc / n, fold: yf / n } : null,
      gto: gw ? { raise: gr / gw, call: gc / gw, fold: gf / gw } : null,
    }
  }, [obs, gto])
  const split = (s: { raise: number; call: number; fold: number }) =>
    `${Math.round(s.raise * 100)}% raise · ${s.call > 0.005 ? `${Math.round(s.call * 100)}% call · ` : ''}${Math.round(s.fold * 100)}% fold`

  const yourCell = (combo: string): Split | null => {
    const t = obs?.get(combo)
    if (!t || !t.n) return null
    return { raise: t.raise / t.n, call: t.call / t.n, fold: t.fold / t.n, n: t.n }
  }
  const gtoCell = (combo: string): Split | null => gto?.byCombo[combo] ?? null

  return (
    <div className="min-h-screen flex flex-col p-6 gap-4">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={onBack} className="text-xs text-gray-500 hover:text-white border border-gray-700 rounded px-2 py-1 transition-colors">← Home</button>
        <h1 className="text-2xl font-bold text-white">Range vs Solver — HU</h1>
        <span className="text-gray-600 text-xs">POC · 100bb rakeless</span>
        <div className="flex rounded-full border border-gray-700 overflow-hidden text-xs ml-1">
          {NODES.map(n => (
            <button key={n.key} onClick={() => setNodeKey(n.key)}
              className={`px-3 py-1 transition-colors ${nodeKey === n.key ? 'bg-yellow-500/20 text-yellow-300' : 'text-gray-400 hover:text-white'}`}>
              {n.label}
            </button>
          ))}
        </div>
      </div>

      {error && <div className="text-red-400 text-sm">Couldn't load: {error}</div>}
      {(!gto || !obs) && !error && <div className="text-gray-500 text-sm">Loading…</div>}

      {gto && obs && (
        <>
          <div className="flex items-center gap-6 text-sm flex-wrap">
            <span className="text-gray-400">You: {summary.you ? <span className="text-white font-semibold">{split(summary.you)}</span> : <span className="text-gray-600">no spots yet</span>} <span className="text-gray-600">({summary.n} spots / {hands} HU hands)</span></span>
            <span className="text-gray-400">GTO: {summary.gto && <span className="text-white font-semibold">{split(summary.gto)}</span>}</span>
            <span className="text-xs text-gray-600 flex items-center gap-2 ml-auto">
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#f97316' }} />raise</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#22c55e' }} />call</span>
              <span className="flex items-center gap-1"><span className="inline-block w-3 h-3 rounded-sm" style={{ background: '#3b82f6' }} />fold</span>
            </span>
          </div>

          <div className="flex gap-8 flex-wrap">
            <RangeGrid title={`Your range — ${node.label}`} sub="cell shows raise% · spots" cell={yourCell} />
            <RangeGrid title="GTO solution" cell={gtoCell} />
          </div>
          <p className="text-xs text-gray-600 max-w-3xl">Blank cells on your side = no hands played this spot yet. Deeper nodes (vs 4-bet, vs jam) are rare, so your side will be sparse — the overall split up top is the reliable read until you've imported more sessions.</p>
        </>
      )}
    </div>
  )
}
