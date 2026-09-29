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

// Where a name's first character sorts: letters, then digits, then anything else.
const nameGroup = (name: string) => (/^[a-z]/i.test(name) ? 0 : /^[0-9]/.test(name) ? 1 : 2)

// Roster order: your own profile first, then by name — letters A–Z ignoring
// case, then names starting with a digit, then everything else. Digit runs
// compare as numbers ("Player 2" before "Player 10").
export function rosterOrder(a: { name: string; isHero: boolean }, b: { name: string; isHero: boolean }): number {
  return Number(b.isHero) - Number(a.isHero)
    || nameGroup(a.name) - nameGroup(b.name)
    || a.name.localeCompare(b.name, 'en', { sensitivity: 'base', numeric: true })
    || a.name.localeCompare(b.name)
}

// The roster + your data on each person (the Profiles page), in rosterOrder.
export async function fetchProfiles(): Promise<Profile[]> {
  const res = await fetch('/api/profiles', { headers: await authHeaders() })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load profiles')
  const data = await res.json() as { profiles?: Record<string, unknown>[] }
  return (data.profiles ?? []).map(rowToProfile).sort(rosterOrder)
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

// Rename a profile; naming an anonymous profile makes it a named one. Without
// force, a same-name (case-insensitive) clash yields `{ duplicate }` and nothing
// changes.
export async function renameProfile(id: number, name: string, force = false): Promise<{ duplicate?: NewProfile[] }> {
  const r = await post<{ duplicate?: Record<string, unknown>[] }>({ op: 'rename', id, name, force })
  return { duplicate: r.duplicate?.map(rowToNew) }
}

// One PokerNow identity on a profile. `rawName` is null for older seats whose
// identity wasn't recorded.
export interface Identity { rawName: string | null; hands: number }

export async function fetchIdentities(id: number): Promise<Identity[]> {
  const res = await fetch(`/api/profiles?view=identities&id=${id}`, { headers: await authHeaders() })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load identities')
  const data = await res.json() as { identities?: { raw_name: string | null; hands: number }[] }
  return (data.identities ?? []).map(r => ({ rawName: r.raw_name, hands: Number(r.hands) }))
}

// Where a moved identity goes: a named profile, a new named profile, or its own
// anonymous profile.
export type MoveTarget = { id: number } | { newName: string } | { anonymous: true }

// Move an identity (all its seats) to another profile; resolves to the profile
// it landed on.
export async function moveIdentity(rawName: string, target: MoveTarget): Promise<number> {
  const r = await post<{ profileId: number }>({ op: 'move', rawName, target })
  return Number(r.profileId)
}

// The profile each already-imported identity belongs to, for preselecting the
// map step.
export async function lookupIdentities(rawNames: string[]): Promise<Map<string, { profileId: number; anonymous: boolean }>> {
  const r = await post<{ known: { raw_name: string; profile_id: number; anonymous: boolean }[] }>({ op: 'lookup', rawNames })
  return new Map(r.known.map(k => [k.raw_name, { profileId: Number(k.profile_id), anonymous: !!k.anonymous }]))
}

export async function deleteProfile(id: number): Promise<void> {
  await post({ op: 'delete', id })
}

// Merge one profile into another (moves all its identities, deletes it). Each
// identity can be moved back out afterwards.
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
