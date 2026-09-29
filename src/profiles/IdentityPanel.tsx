import { useEffect, useState } from 'react'
import { fetchIdentities, mergeProfiles, moveIdentity, type Identity, type MoveTarget, type Profile } from '../shared/api/profilesApi'
import { renameOrMerge } from './renameOrMerge'

const inputClass = 'bg-gray-950 border border-gray-700 rounded px-2 py-1 text-sm text-gray-200 placeholder-gray-600 focus:outline-none focus:border-yellow-500 [color-scheme:dark]'
const buttonClass = 'text-xs px-2.5 py-1 rounded border border-gray-700 text-gray-300 hover:text-white hover:border-gray-500 disabled:opacity-40 transition-colors'

// A profile's PokerNow identities and the actions that reshape who owns them:
// name an anonymous profile, merge this profile into a named one, or move one
// identity to another profile. `onChanged` gets the profile id to show next (this one, or
// wherever it ended up when this profile was merged or emptied away).
export default function IdentityPanel({ profile, profiles, onChanged }: {
  profile: Profile
  profiles: Profile[]
  onChanged: (showId: number) => void
}) {
  const [identities, setIdentities] = useState<Identity[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    fetchIdentities(profile.id)
      .then(ids => { if (!cancelled) setIdentities(ids) })
      .catch(e => { if (!cancelled) setError(String((e as Error).message ?? e)) })
    return () => { cancelled = true }
  }, [profile.id])

  const namedOthers = profiles.filter(p => !p.anonymous && p.id !== profile.id)

  const run = async (action: () => Promise<number | null>) => {
    setError(null)
    try {
      const showId = await action()
      if (showId != null) onChanged(showId)
    } catch (e) {
      setError(String((e as Error).message ?? e))
    }
  }

  // A moved identity whose profile is anonymous empties and deletes that
  // profile, so follow the identity to where it landed.
  const move = (rawName: string, target: MoveTarget) => run(async () => {
    const landed = await moveIdentity(rawName, target)
    return profile.anonymous ? landed : profile.id
  })

  return (
    <div className="flex flex-col gap-2 max-w-xl">
      <div className="text-xs uppercase tracking-wide text-gray-500">PokerNow identities</div>

      {profile.anonymous && <NameProfile onSave={name => run(() => renameOrMerge(profile.id, name))} />}

      {!identities && !error && <div className="text-gray-500 text-sm">Loading…</div>}
      {identities && (
        <div className="rounded-lg border border-gray-800 divide-y divide-gray-900">
          {identities.map(identity => (
            <IdentityRow
              key={identity.rawName ?? ''}
              identity={identity}
              fallbackName={profile.name}
              targets={namedOthers}
              canSplitOff={!profile.anonymous}
              onMove={target => identity.rawName && move(identity.rawName, target)}
            />
          ))}
        </div>
      )}

      {!profile.isHero && namedOthers.length > 0 && (
        <MergeInto
          targets={namedOthers}
          onMerge={into => run(async () => {
            if (!confirm(`Merge "${profile.name}" into "${into.name}"? This profile is deleted. Its identities can be moved back out later, except older hands listed without one.`)) return null
            await mergeProfiles(profile.id, into.id)
            return into.id
          })}
        />
      )}

      {error && <div className="text-red-400 text-xs">{error}</div>}
    </div>
  )
}

function NameProfile({ onSave }: { onSave: (name: string) => void }) {
  const [name, setName] = useState('')
  const save = () => { if (name.trim()) onSave(name.trim()) }
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400">Name this player</span>
      <input
        value={name}
        onChange={e => setName(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save() }}
        placeholder="e.g. Alan Zhu"
        className={inputClass}
      />
      <button onClick={save} disabled={!name.trim()} className={buttonClass}>Save</button>
    </div>
  )
}

const NEW = 'new', ANONYMOUS = 'anon'

function IdentityRow({ identity, fallbackName, targets, canSplitOff, onMove }: {
  identity: Identity
  fallbackName: string
  targets: Profile[]
  canSplitOff: boolean
  onMove: (target: MoveTarget) => void
}) {
  const [newName, setNewName] = useState<string | null>(null)
  const label = identity.rawName ?? `${fallbackName} (older hands)`

  const choose = (value: string) => {
    if (value === NEW) { setNewName(''); return }
    if (value === ANONYMOUS) {
      if (confirm(`Split "${label}" off into its own anonymous profile?`)) onMove({ anonymous: true })
      return
    }
    const target = targets.find(p => p.id === Number(value))
    if (target && confirm(`Move "${label}" (${identity.hands} hands) to "${target.name}"?`)) onMove({ id: target.id })
  }

  // A new name matching an existing profile offers that profile instead.
  const saveNew = () => {
    const name = newName?.trim()
    if (!name) return
    const clash = targets.find(p => p.name.toLowerCase() === name.toLowerCase())
    if (clash && confirm(`You already have "${clash.name}". Move "${label}" there instead?`)) onMove({ id: clash.id })
    else if (!clash) onMove({ newName: name })
    setNewName(null)
  }

  return (
    <div className="flex flex-col gap-1.5 px-3 py-1.5">
      <div className="flex items-center gap-3">
        <span className={`flex-1 min-w-0 truncate text-sm ${identity.rawName ? 'font-mono text-gray-200' : 'text-gray-500'}`}>{label}</span>
        <span className="text-xs text-gray-600">{identity.hands} hands</span>
        {identity.rawName
          ? (
            <select value="" onChange={e => choose(e.target.value)} className={inputClass}>
              <option value="" disabled>Move to…</option>
              {targets.map(p => <option key={p.id} value={p.id}>{p.name}{p.isHero ? ' (you)' : ''}</option>)}
              <option value={NEW}>＋ New profile…</option>
              {canSplitOff && <option value={ANONYMOUS}>Its own anonymous profile</option>}
            </select>
          )
          : <span className="text-xs text-gray-700" title="These seats were imported before identities were recorded">can't move</span>}
      </div>
      {newName !== null && (
        <div className="flex items-center gap-2">
          <input
            autoFocus
            value={newName}
            onChange={e => setNewName(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') saveNew(); if (e.key === 'Escape') setNewName(null) }}
            placeholder="New profile name"
            className={`flex-1 ${inputClass}`}
          />
          <button onClick={saveNew} disabled={!newName.trim()} className={buttonClass}>Move</button>
          <button onClick={() => setNewName(null)} className={buttonClass}>Cancel</button>
        </div>
      )}
    </div>
  )
}

function MergeInto({ targets, onMerge }: { targets: Profile[]; onMerge: (into: Profile) => void }) {
  return (
    <div className="flex items-center gap-2">
      <span className="text-xs text-gray-400">Merge this profile into</span>
      <select
        value=""
        onChange={e => { const into = targets.find(p => p.id === Number(e.target.value)); if (into) onMerge(into) }}
        className={inputClass}
      >
        <option value="" disabled>Choose a profile…</option>
        {targets.map(p => <option key={p.id} value={p.id}>{p.name}{p.isHero ? ' (you)' : ''}</option>)}
      </select>
    </div>
  )
}
