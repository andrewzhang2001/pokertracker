import { authHeaders } from './auth'
import { rowToParsedHand } from '../poker/canonicalHand'
import type { ParsedHand } from '../poker/types'

// A per-account player profile plus the viewer's aggregate data on that person.
export interface Profile {
  id: number
  name: string
  isHero: boolean
  anonymous: boolean
  hands: number      // distinct hands played together
  netBb: number      // your net (bb) in hands involving this person
}

// Minimal profile shape returned by create (no aggregates yet).
export interface NewProfile { id: number; name: string; isHero: boolean; anonymous: boolean }

async function post<T>(body: Record<string, unknown>): Promise<T> {
  const res = await fetch('/api/profiles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Request failed')
  return res.json() as Promise<T>
}

const rowToProfile = (p: Record<string, unknown>): Profile => ({
  id: Number(p.id),
  name: String(p.name),
  isHero: !!p.is_hero,
  anonymous: !!p.anonymous,
  hands: Number(p.hands ?? 0),
  netBb: Number(p.net_bb ?? 0),
})

const rowToNew = (p: Record<string, unknown>): NewProfile => ({
  id: Number(p.id), name: String(p.name), isHero: !!p.is_hero, anonymous: !!p.anonymous,
})

// The roster + your data on each person (the Profiles page).
export async function fetchProfiles(): Promise<Profile[]> {
  const res = await fetch('/api/profiles', { headers: await authHeaders() })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load profiles')
  const data = await res.json() as { profiles?: Record<string, unknown>[] }
  return (data.profiles ?? []).map(rowToProfile)
}

// One profile's hands with the seat they occupied — the input to per-person
// stats. Your own hands only; the parsed blob is anonymous, so `seat` is what
// ties each hand back to this person.
export async function fetchProfileHands(id: number): Promise<{ hand: ParsedHand; seat: number }[]> {
  const res = await fetch(`/api/profiles?view=hands&id=${id}`, { headers: await authHeaders() })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load hands')
  const data = await res.json() as { hands: { parsed: ParsedHand; seat: number }[] }
  return (data.hands ?? []).map(r => ({ hand: rowToParsedHand({ parsed: r.parsed }), seat: Number(r.seat) }))
}

// Create a profile. Without force, a same-name (case-insensitive) profile yields
// `{ duplicate }` and nothing is inserted, so the caller can warn.
export async function createProfile(opts: { name?: string; isHero?: boolean; anonymous?: boolean; force?: boolean }): Promise<{ profile?: NewProfile; duplicate?: NewProfile[] }> {
  const r = await post<{ profile?: Record<string, unknown>; duplicate?: Record<string, unknown>[] }>({ op: 'create', ...opts })
  return {
    profile: r.profile ? rowToNew(r.profile) : undefined,
    duplicate: r.duplicate?.map(rowToNew),
  }
}

export async function renameProfile(id: number, name: string): Promise<void> {
  await post({ op: 'rename', id, name })
}

export async function deleteProfile(id: number): Promise<void> {
  await post({ op: 'delete', id })
}

// Merge one profile into another (reassigns its hands, deletes it) — how you
// unify a person's different-token identities across sessions.
export async function mergeProfiles(from: number, into: number): Promise<void> {
  await post({ op: 'merge', from, into })
}

// The single write behind the import map step. `assignments` maps each raw
// identity to an existing profile, a new named one, or (omitted) an anonymous
// profile named by the identity. `seats` are the per-hand seat links to stamp.
export async function commitMapping(
  assignments: { rawName: string; existingId?: number; newName?: string; isHero?: boolean }[],
  seats: { handId: string; seat: number; rawName: string; isHero?: boolean; netBb?: number }[],
): Promise<void> {
  await post({ op: 'commit', assignments, seats })
}
