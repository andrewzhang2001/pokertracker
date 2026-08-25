import { useEffect, useState } from 'react'
import { fetchProfiles, renameProfile, deleteProfile, type Profile } from '../shared/api/profilesApi'

const fmt = (n: number, dp = 1) => (n >= 0 ? '+' : '') + n.toFixed(dp)
const tone = (n: number) => (n >= 0 ? 'text-green-400' : 'text-red-400')

// Per-account PokerNow player roster — the people you've tagged, with your data
// on each (hands played together and your net vs them). Profiles are created by
// the map-players step after an upload; this page views and manages them.
export default function ProfilesView({ onBack, onOpen }: { onBack: () => void; onOpen: (id: number) => void }) {
  const [profiles, setProfiles] = useState<Profile[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [editing, setEditing] = useState<number | null>(null)
  const [draft, setDraft] = useState('')

  const load = () => {
    setError(null)
    fetchProfiles().then(setProfiles).catch(e => setError(String((e as Error).message ?? e)))
  }
  useEffect(load, [])

  const saveRename = async (id: number) => {
    const name = draft.trim()
    setEditing(null)
    if (name) { await renameProfile(id, name); load() }
  }
  const remove = async (p: Profile) => {
    if (!confirm(`Delete profile "${p.name}"? Its hands stay, but lose this tag.`)) return
    await deleteProfile(p.id); load()
  }

  return (
    <div className="min-h-screen flex flex-col p-6 gap-5">
      <div className="flex items-center gap-3">
        <button onClick={onBack} className="text-xs text-gray-500 hover:text-white border border-gray-700 rounded px-2 py-1 transition-colors">← Home</button>
        <h1 className="text-2xl font-bold text-white">PokerNow Profiles</h1>
        {profiles && <span className="text-gray-600 text-xs">{profiles.length} people · your private roster</span>}
      </div>

      {error && <div className="text-red-400 text-sm">Couldn't load profiles: {error}</div>}
      {!profiles && !error && <div className="text-gray-500 text-sm">Loading…</div>}

      {profiles && profiles.length === 0 && (
        <div className="text-gray-500 text-sm max-w-lg">
          No profiles yet. Import a PokerNow CSV and assign the players to profiles — they'll show up here with your data on each person.
        </div>
      )}

      {profiles && profiles.length > 0 && (
        <div className="max-w-3xl w-full">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-xs uppercase tracking-wide text-gray-500 text-left border-b border-gray-800">
                <th className="py-2 pr-4">Name</th>
                <th className="py-2 pr-4 text-right">Hands</th>
                <th className="py-2 pr-4 text-right">Net (bb)</th>
                <th className="py-2"></th>
              </tr>
            </thead>
            <tbody>
              {profiles.map(p => (
                <tr key={p.id} className="border-b border-gray-900 hover:bg-white/5">
                  <td className="py-2 pr-4">
                    {editing === p.id ? (
                      <input
                        autoFocus value={draft}
                        onChange={e => setDraft(e.target.value)}
                        onBlur={() => saveRename(p.id)}
                        onKeyDown={e => { if (e.key === 'Enter') saveRename(p.id); if (e.key === 'Escape') setEditing(null) }}
                        className="bg-black/40 border border-gray-700 rounded px-2 py-0.5 text-gray-200 focus:outline-none focus:border-yellow-500"
                      />
                    ) : (
                      <span className="flex items-center gap-1.5">
                        <button className="text-left text-white font-medium hover:text-yellow-300" onClick={() => onOpen(p.id)} title="view stats">{p.name}</button>
                        {p.isHero && <span className="text-[10px] uppercase tracking-wide text-yellow-400 border border-yellow-500/40 rounded px-1">you</span>}
                        {p.anonymous && <span className="text-[10px] uppercase tracking-wide text-gray-500 border border-gray-700 rounded px-1">anon</span>}
                        <button className="text-gray-600 hover:text-yellow-300 text-xs" onClick={() => { setEditing(p.id); setDraft(p.name) }} title="rename">✎</button>
                      </span>
                    )}
                  </td>
                  <td className="py-2 pr-4 text-right text-gray-300">{p.hands}</td>
                  <td className={`py-2 pr-4 text-right ${tone(p.netBb)}`}>{fmt(p.netBb)}</td>
                  <td className="py-2 text-right">
                    {!p.isHero && <button onClick={() => remove(p)} className="text-xs text-gray-600 hover:text-red-400" title="delete profile">✕</button>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-gray-600 mt-3">Net (bb) = this person's own result across your imported hands (zero-sum at the table). Click a name to rename.</p>
        </div>
      )}
    </div>
  )
}
