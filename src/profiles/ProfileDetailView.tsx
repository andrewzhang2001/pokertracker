import { useEffect, useMemo, useState } from 'react'
import { fetchProfileHands, fetchProfiles, type Profile } from '../shared/api/profilesApi'
import { computeProfileStats, pct, type Rate, type PosStats } from '../shared/poker/profileStats'
import { netForSeat } from '../shared/poker/graph'
import { tableKind } from '../shared/poker/positionUtils'
import { gameKind, GAMES } from '../shared/poker/games'
import type { ParsedHand } from '../shared/poker/types'
import HandReplayer from '../shared/replayer/HandReplayer'

const fmtPct = (r: Rate) => (r.opp ? `${Math.round(pct(r))}%` : '—')
const fmtNet = (n: number) => (n >= 0 ? '+' : '') + n.toFixed(1)
const tone = (n: number) => (n >= 0 ? 'text-green-400' : 'text-red-400')

// A profile's hands split into game-type categories — PLO vs NLHE × heads-up vs
// full ring — so a person's HU and full-ring reads never blur together. Non-HU
// (any 3–10 handed) is "full ring"; PokerNow cash tables fill and empty, so the
// bucket spans short-handed through 10-max.
function category(hand: ParsedHand): { key: string; label: string } {
  const g = gameKind(hand.gameType)
  const hu = tableKind(hand.players.length) === 'hu'
  return { key: `${g}:${hu ? 'hu' : 'fr'}`, label: `${GAMES[g].label} (${hu ? 'heads-up' : 'full ring'})` }
}

export default function ProfileDetailView({ id, onBack }: { id: number; onBack: () => void }) {
  const [profile, setProfile] = useState<Profile | null>(null)
  const [hands, setHands] = useState<{ hand: ParsedHand; seat: number }[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [cat, setCat] = useState<string | null>(null)
  // Reviewing = the hand replayer takes over, browsing this profile's hands in
  // the current game category (the same viewer as "View Database"). Notes are
  // ephemeral here — the profile-hands feed doesn't carry saved notes.
  const [reviewing, setReviewing] = useState(false)
  const [reviewNotes, setReviewNotes] = useState<string[]>([])

  useEffect(() => {
    let cancelled = false
    setHands(null); setError(null)
    Promise.all([fetchProfiles(), fetchProfileHands(id)])
      .then(([ps, hs]) => { if (!cancelled) { setProfile(ps.find(p => p.id === id) ?? null); setHands(hs) } })
      .catch(e => { if (!cancelled) setError(String((e as Error).message ?? e)) })
    return () => { cancelled = true }
  }, [id])

  // The game-type categories this profile actually has hands in, most-played
  // first; default the view to the biggest one.
  const cats = useMemo(() => {
    const m = new Map<string, { key: string; label: string; n: number }>()
    for (const { hand } of hands ?? []) {
      const c = category(hand)
      const e = m.get(c.key) ?? { ...c, n: 0 }
      e.n++; m.set(c.key, e)
    }
    return [...m.values()].sort((a, b) => b.n - a.n)
  }, [hands])
  useEffect(() => { if (cats.length) setCat(c => (c && cats.some(x => x.key === c) ? c : cats[0].key)) }, [cats])

  const forCat = useMemo(() => (hands ?? []).filter(h => category(h.hand).key === cat), [hands, cat])
  const stats = useMemo(() => computeProfileStats(forCat), [forCat])
  const net = useMemo(() => forCat.reduce((s, h) => s + netForSeat(h.hand, h.seat), 0), [forCat])
  const catLabel = cats.find(c => c.key === cat)?.label ?? ''

  const spot = (key: string) => stats.spots.find(s => s.key === key)!
  const rate = (key: string): Rate => { const s = spot(key); return { made: s.raise, opp: s.n } }

  // Hand review: hand off to the shared replayer over this category's hands.
  if (reviewing) {
    return (
      <HandReplayer
        key={`profile-${id}-${cat}-${forCat.length}`}
        hands={forCat.map(h => h.hand)}
        handNotes={reviewNotes}
        onUpdateNote={(idx, value) => setReviewNotes(prev => { const n = [...prev]; n[idx] = value; return n })}
        onBack={() => setReviewing(false)}
        backLabel={`← ${profile?.name ?? 'Profile'}`}
      />
    )
  }

  return (
    <div className="min-h-screen flex flex-col p-6 gap-5">
      <div className="flex items-center gap-3 flex-wrap">
        <button onClick={onBack} className="text-xs text-gray-500 hover:text-white border border-gray-700 rounded px-2 py-1 transition-colors">← Profiles</button>
        <h1 className="text-2xl font-bold text-white">{profile?.name ?? 'Profile'}</h1>
        {profile?.isHero && <span className="text-[10px] uppercase tracking-wide text-yellow-400 border border-yellow-500/40 rounded px-1">you</span>}
        {cats.length > 0 && (
          <div className="flex rounded-full border border-gray-700 overflow-hidden text-xs">
            {cats.map(c => (
              <button
                key={c.key}
                onClick={() => setCat(c.key)}
                className={`px-3 py-1 transition-colors ${cat === c.key ? 'bg-yellow-500/20 text-yellow-300' : 'text-gray-400 hover:text-white'}`}
              >
                {c.label} <span className="text-gray-600">{c.n}</span>
              </button>
            ))}
          </div>
        )}
        {hands && (
          <span className="text-gray-600 text-xs">
            {stats.hands} hands · net <span className={tone(net)}>{fmtNet(net)} bb</span>
          </span>
        )}
        {hands && stats.hands > 0 && (
          <button
            onClick={() => { setReviewNotes(forCat.map(() => '')); setReviewing(true) }}
            className="ml-auto text-xs px-3 py-1 rounded-full border border-yellow-600 text-yellow-400 bg-yellow-600/10 hover:bg-yellow-600/20 transition-colors"
            title={`Replay these ${catLabel} hands in the hand viewer`}
          >
            ▶ Review hands
          </button>
        )}
      </div>

      {error && <div className="text-red-400 text-sm">Couldn't load: {error}</div>}
      {!hands && !error && <div className="text-gray-500 text-sm">Loading…</div>}

      {hands && stats.hands === 0 && <div className="text-gray-500 text-sm">No {catLabel || 'matching'} hands for this profile.</div>}

      {hands && stats.hands > 0 && (
        <>
          <div className="flex flex-wrap gap-3">
            <Stat label="RFI" r={rate('open')} />
            <Stat label="3-Bet" r={rate('vsOpen')} />
            <Stat label="4-Bet" r={rate('vs3bet')} />
            <Stat label="Flop CBet" r={stats.flopCbet} />
          </div>

          <PositionPanel rows={stats.byPosition} />

          <div className="max-w-xl w-full">
            <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">Preflop tree</div>
            <table className="w-full text-sm">
              <thead>
                <tr className="text-xs uppercase tracking-wide text-gray-500 text-left border-b border-gray-800">
                  <th className="py-1.5 pr-4">Spot</th>
                  <th className="py-1.5 pr-4 text-right">Spots</th>
                  <th className="py-1.5 pr-4 text-right">Raise</th>
                  <th className="py-1.5 pr-4 text-right">Call</th>
                  <th className="py-1.5 text-right">Fold</th>
                </tr>
              </thead>
              <tbody>
                {stats.spots.filter(s => s.n > 0).map(s => (
                  <tr key={s.key} className="border-b border-gray-900">
                    <td className="py-1.5 pr-4 text-white font-medium">{s.label}</td>
                    <td className="py-1.5 pr-4 text-right text-gray-400">{s.n}</td>
                    <td className="py-1.5 pr-4 text-right text-amber-300" title={`${s.raiseLabel} · ${s.raise}/${s.n}`}>{Math.round((s.raise / s.n) * 100)}%</td>
                    <td className="py-1.5 pr-4 text-right text-green-300" title={`${s.call}/${s.n}`}>{Math.round((s.call / s.n) * 100)}%</td>
                    <td className="py-1.5 text-right text-blue-300" title={`${s.fold}/${s.n}`}>{Math.round((s.fold / s.n) * 100)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="text-xs text-gray-600 mt-2">Raise column = <span className="text-amber-300">RFI / 3-bet / 4-bet / 5-bet</span> at each node. Hover for counts.</p>
          </div>

          <div className="text-xs text-gray-600">
            VPIP <span className="text-gray-400">{fmtPct(stats.vpip)}</span> · PFR <span className="text-gray-400">{fmtPct(stats.pfr)}</span>
            <span className="text-gray-700"> (secondary — the position table above is the primary read)</span>
          </div>
        </>
      )}
    </div>
  )
}

function Stat({ label, r }: { label: string; r: Rate }) {
  return (
    <div className="rounded-lg border border-gray-800 bg-gray-900/60 px-4 py-3 min-w-[104px]" title={`${r.made}/${r.opp}`}>
      <div className="text-xs uppercase tracking-wide text-gray-500">{label}</div>
      <div className="text-2xl font-bold text-white">{fmtPct(r)}</div>
      <div className="text-[11px] text-gray-600 mt-0.5">{r.opp} spots</div>
    </div>
  )
}

// Per-position preflop tendencies, grouped into the three situations a player is
// first put in: opening (first in), facing a raise, and facing limp(s). Each cell
// is a percentage of that spot's opportunities; hover for the raw count.
function PositionPanel({ rows }: { rows: PosStats[] }) {
  if (!rows.length) return null
  const p = (num: number, den: number) => (den ? `${Math.round((num / den) * 100)}%` : '—')
  return (
    <div className="w-full overflow-x-auto">
      <div className="text-xs uppercase tracking-wide text-gray-500 mb-2">By position</div>
      <table className="text-sm min-w-[640px]">
        <thead>
          <tr className="text-xs uppercase tracking-wide text-gray-500 border-b border-gray-800">
            <th className="py-1.5 pr-4 text-left">Pos</th>
            <th className="py-1.5 px-2 text-center border-l border-gray-800" colSpan={4}>Open (first in)</th>
            <th className="py-1.5 px-2 text-center border-l border-gray-800" colSpan={4}>vs Raise</th>
            <th className="py-1.5 px-2 text-center border-l border-gray-800" colSpan={4}>vs Limp</th>
          </tr>
          <tr className="text-[11px] uppercase tracking-wide text-gray-600 border-b border-gray-800">
            <th className="pb-1 pr-4"></th>
            <th className="pb-1 px-2 text-right border-l border-gray-800">n</th>
            <th className="pb-1 px-2 text-right text-amber-300/80">RFI</th>
            <th className="pb-1 px-2 text-right text-green-300/80">Limp</th>
            <th className="pb-1 px-2 text-right text-blue-300/80">Fold</th>
            <th className="pb-1 px-2 text-right border-l border-gray-800">n</th>
            <th className="pb-1 px-2 text-right text-amber-300/80">Raise</th>
            <th className="pb-1 px-2 text-right text-green-300/80">Call</th>
            <th className="pb-1 px-2 text-right text-blue-300/80">Fold</th>
            <th className="pb-1 px-2 text-right border-l border-gray-800">n</th>
            <th className="pb-1 px-2 text-right text-amber-300/80">Iso</th>
            <th className="pb-1 px-2 text-right text-green-300/80">Over</th>
            <th className="pb-1 px-2 text-right text-blue-300/80">Fold</th>
          </tr>
        </thead>
        <tbody>
          {rows.map(r => (
            <tr key={r.pos} className="border-b border-gray-900">
              <td className="py-1.5 pr-4 text-white font-medium">{r.pos}</td>
              <td className="py-1.5 px-2 text-right text-gray-500 border-l border-gray-800">{r.open.n}</td>
              <td className="py-1.5 px-2 text-right text-amber-300" title={`${r.open.raise}/${r.open.n}`}>{p(r.open.raise, r.open.n)}</td>
              <td className="py-1.5 px-2 text-right text-green-300" title={`${r.open.limp}/${r.open.n}`}>{p(r.open.limp, r.open.n)}</td>
              <td className="py-1.5 px-2 text-right text-blue-300" title={`${r.open.fold}/${r.open.n}`}>{p(r.open.fold, r.open.n)}</td>
              <td className="py-1.5 px-2 text-right text-gray-500 border-l border-gray-800">{r.vsRaise.n}</td>
              <td className="py-1.5 px-2 text-right text-amber-300" title={`${r.vsRaise.raise}/${r.vsRaise.n}`}>{p(r.vsRaise.raise, r.vsRaise.n)}</td>
              <td className="py-1.5 px-2 text-right text-green-300" title={`${r.vsRaise.call}/${r.vsRaise.n}`}>{p(r.vsRaise.call, r.vsRaise.n)}</td>
              <td className="py-1.5 px-2 text-right text-blue-300" title={`${r.vsRaise.fold}/${r.vsRaise.n}`}>{p(r.vsRaise.fold, r.vsRaise.n)}</td>
              <td className="py-1.5 px-2 text-right text-gray-500 border-l border-gray-800">{r.vsLimp.n}</td>
              <td className="py-1.5 px-2 text-right text-amber-300" title={`${r.vsLimp.iso}/${r.vsLimp.n}`}>{p(r.vsLimp.iso, r.vsLimp.n)}</td>
              <td className="py-1.5 px-2 text-right text-green-300" title={`${r.vsLimp.overlimp}/${r.vsLimp.n}`}>{p(r.vsLimp.overlimp, r.vsLimp.n)}</td>
              <td className="py-1.5 px-2 text-right text-blue-300" title={`${r.vsLimp.fold}/${r.vsLimp.n}`}>{p(r.vsLimp.fold, r.vsLimp.n)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-xs text-gray-600 mt-2">Each block is a % of that spot's opportunities (first voluntary decision only). Hover a cell for the count. Over = overlimp.</p>
    </div>
  )
}
