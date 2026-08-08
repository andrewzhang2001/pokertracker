import { useEffect, useMemo, useState } from 'react'
import type { ParsedHand } from '../lib/types'
import { fetchProfiles, type Profile } from '../lib/profilesApi'
import { netForSeat } from '../lib/graph'

// One distinct raw site identity across the import, plus the per-hand seat links
// that reference it.
export interface Identity {
  rawName: string        // full "name @ token" — the stable within-file key
  displayName: string    // the recognizable part ("39")
  token: string          // disambiguator when a display name repeats
  isHero: boolean        // this seat is you in at least one hand
  ambiguous: boolean     // another identity shares this display name
}
export interface SeatLink { handId: string; seat: number; rawName: string; isHero: boolean; netBb: number }

// Pull the distinct player identities (and their seat links) out of parsed hands.
// Only hands whose seats carry a sourceName (i.e. PokerNow) contribute; Ignition
// hands are anonymous and yield nothing, so mapping is skipped for them.
export function collectIdentities(hands: ParsedHand[]): { identities: Identity[]; seats: SeatLink[] } {
  const seats: SeatLink[] = []
  const byRaw = new Map<string, { displayName: string; token: string; isHero: boolean }>()
  for (const h of hands) {
    for (const p of h.players) {
      if (!p.sourceName) continue
      seats.push({ handId: h.handId, seat: p.seatNumber, rawName: p.sourceName, isHero: p.isMe, netBb: netForSeat(h, p.seatNumber) })
      const at = p.sourceName.lastIndexOf(' @ ')
      const displayName = at >= 0 ? p.sourceName.slice(0, at) : p.sourceName
      const token = at >= 0 ? p.sourceName.slice(at + 3) : ''
      const prev = byRaw.get(p.sourceName)
      if (prev) prev.isHero ||= p.isMe
      else byRaw.set(p.sourceName, { displayName, token, isHero: p.isMe })
    }
  }
  const nameCounts = new Map<string, number>()
  for (const v of byRaw.values()) nameCounts.set(v.displayName, (nameCounts.get(v.displayName) ?? 0) + 1)
  const identities = [...byRaw.entries()].map(([rawName, v]) => ({
    rawName, displayName: v.displayName, token: v.token, isHero: v.isHero,
    ambiguous: (nameCounts.get(v.displayName) ?? 0) > 1,
  }))
  // Hero rows first, then by display name.
  identities.sort((a, b) => Number(b.isHero) - Number(a.isHero) || a.displayName.localeCompare(b.displayName))
  return { identities, seats }
}

// A per-identity choice. 'existing' → a profile you already have; 'new' → create
// one with `newName`; 'anon' → an anonymous profile named by the identity itself.
type Assign = { kind: 'existing'; existingId: number } | { kind: 'new'; newName: string } | { kind: 'anon' }

export interface Assignment { rawName: string; existingId?: number; newName?: string; isHero?: boolean }

// The gated map step: assign every identity to a profile before anything is
// written. Confirming returns the assignments; the caller commits them alongside
// the hand export in one shot.
// Rebuild the editor state for one identity from a prior saved assignment.
const fromAssignment = (a: Assignment): Assign =>
  a.existingId ? { kind: 'existing', existingId: a.existingId }
    : a.newName ? { kind: 'new', newName: a.newName }
    : { kind: 'anon' }

export default function MapPlayersModal({ identities, initial, confirmLabel = 'Save & export', onCancel, onConfirm }: {
  identities: Identity[]
  initial?: Assignment[]         // seed from a prior pass so edits persist across opens
  confirmLabel?: string
  onCancel: () => void
  onConfirm: (assignments: Assignment[]) => void
}) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [assign, setAssign] = useState<Record<string, Assign>>({})

  useEffect(() => {
    fetchProfiles().then(ps => {
      setProfiles(ps)
      const hero = ps.find(p => p.isHero)
      const prior = new Map((initial ?? []).map(a => [a.rawName, a]))
      // Default: hero → your self profile (or a new one named after your handle);
      // everyone else → anonymous (the "don't care" path), still one click to
      // change. A prior saved assignment wins over the default.
      const init: Record<string, Assign> = {}
      for (const id of identities) {
        const p = prior.get(id.rawName)
        if (p) init[id.rawName] = fromAssignment(p)
        else if (id.isHero) init[id.rawName] = hero ? { kind: 'existing', existingId: hero.id } : { kind: 'new', newName: id.displayName }
        else init[id.rawName] = { kind: 'anon' }
      }
      setAssign(init)
    }).catch(() => setProfiles([]))
  }, [identities, initial])

  const anyAmbiguous = identities.some(i => i.ambiguous)
  const nameSet = useMemo(() => new Set((profiles ?? []).map(p => p.name.toLowerCase())), [profiles])

  const set = (rawName: string, a: Assign) => setAssign(prev => ({ ...prev, [rawName]: a }))

  const confirm = () => {
    const out: Assignment[] = identities.map(id => {
      const a = assign[id.rawName] ?? { kind: 'anon' }
      if (a.kind === 'existing') return { rawName: id.rawName, existingId: a.existingId }
      if (a.kind === 'new') return { rawName: id.rawName, newName: a.newName.trim(), isHero: id.isHero }
      return { rawName: id.rawName, isHero: id.isHero }
    })
    onConfirm(out)
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div className="w-full max-w-xl max-h-[85vh] overflow-y-auto rounded-xl border border-gray-700 bg-gray-900 p-5 flex flex-col gap-4">
        <div>
          <h2 className="text-lg font-bold text-white">Assign players to profiles</h2>
          <p className="text-xs text-gray-500 mt-1">Map each PokerNow player before saving. Nothing is written until you confirm.</p>
        </div>

        {anyAmbiguous && (
          <div className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/30 rounded px-3 py-2">
            ⚠️ Two players share a display name in this file — they're different accounts (shown with their token). Assign each separately, or the same profile if it's one person who rejoined.
          </div>
        )}

        {!profiles ? (
          <div className="text-gray-500 text-sm">Loading profiles…</div>
        ) : (
          <div className="flex flex-col gap-2">
            {identities.map(id => {
              const a = assign[id.rawName] ?? { kind: 'anon' }
              const dupNew = a.kind === 'new' && a.newName.trim() !== '' && nameSet.has(a.newName.trim().toLowerCase())
              return (
                <div key={id.rawName} className="flex flex-col gap-1 border border-gray-800 rounded-lg px-3 py-2">
                  <div className="flex items-center gap-2">
                    <div className="min-w-0 flex-1">
                      <span className="text-white font-medium">{id.displayName}</span>
                      {id.ambiguous && <span className="ml-1.5 text-[11px] text-gray-500 font-mono">…{id.token.slice(-6)}</span>}
                      {id.isHero && <span className="ml-2 text-[10px] uppercase tracking-wide text-yellow-400 border border-yellow-500/40 rounded px-1">you</span>}
                    </div>
                    <select
                      value={a.kind === 'existing' ? `p:${a.existingId}` : a.kind}
                      onChange={e => {
                        const v = e.target.value
                        if (v === 'new') set(id.rawName, { kind: 'new', newName: id.displayName })
                        else if (v === 'anon') set(id.rawName, { kind: 'anon' })
                        else set(id.rawName, { kind: 'existing', existingId: Number(v.slice(2)) })
                      }}
                      className="bg-gray-950 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 focus:outline-none focus:border-yellow-500 [color-scheme:dark]"
                    >
                      {profiles.map(p => <option key={p.id} value={`p:${p.id}`}>{p.name}{p.isHero ? ' (you)' : ''}</option>)}
                      <option value="new">＋ New profile…</option>
                      <option value="anon">Anonymous (keep as “{id.displayName}”)</option>
                    </select>
                  </div>
                  {a.kind === 'new' && (
                    <div className="flex flex-col gap-0.5 pl-1">
                      <input
                        autoFocus value={a.newName}
                        onChange={e => set(id.rawName, { kind: 'new', newName: e.target.value })}
                        placeholder="Profile name, e.g. Alan Zhu"
                        className="bg-black/40 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-yellow-500"
                      />
                      {dupNew && <span className="text-[11px] text-amber-300/90">You already have a profile named “{a.newName.trim()}” — pick it from the list, or keep this to make a separate one.</span>}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button onClick={onCancel} className="text-sm px-3 py-1.5 rounded-lg border border-gray-700 text-gray-300 hover:text-white transition-colors">Cancel</button>
          <button
            onClick={confirm}
            disabled={!profiles || identities.some(id => { const a = assign[id.rawName]; return a?.kind === 'new' && !a.newName.trim() })}
            className="text-sm px-4 py-1.5 rounded-lg bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold transition-colors"
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
