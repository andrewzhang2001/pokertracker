import type { ParsedHand } from './types'
import { canonicalizeHand, rowToParsedHand } from './canonicalHand'
import type { GraphRow } from './graph'
import { authHeaders } from './auth'

// Export every parsed hand to the database (bulk, idempotent upsert by hand id).
// Notes are aligned by index with the hands array. The server stamps each row
// with the signed-in account (owner) from the bearer token.
export async function exportHandsToDb(hands: ParsedHand[], notes: string[]): Promise<number> {
  const rows = hands.map((h, i) => canonicalizeHand(h, notes[i]))
  const res = await fetch('/api/hands', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ hands: rows }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Export failed')
  const { inserted } = await res.json() as { inserted: number }
  return inserted
}

// Lightweight graph feed — YOUR precomputed per-hand result numbers (no parsing).
export async function fetchGraphFromDb(): Promise<GraphRow[]> {
  const res = await fetch('/api/hands?view=graph', { headers: await authHeaders() })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load graph')
  const data = await res.json() as { rows?: { played_at: number | null; net_bb: number; adj_net_bb: number | null; rake_bb: number | null }[] }
  return (data.rows ?? []).map(r => ({
    playedAt: r.played_at,
    net: Number(r.net_bb),
    adjNet: r.adj_net_bb !== null ? Number(r.adj_net_bb) : Number(r.net_bb), // fall back to actual if not yet backfilled
    rake: r.rake_bb !== null ? Number(r.rake_bb) : 0,
  }))
}

export type VpipFilter = 'all' | 'yes' | 'no'

export interface HandsPage {
  hands: ParsedHand[]
  notes: string[]
  total: number      // all your hands, ignoring the filter
  filtered: number   // hands matching the filter (i.e. what's paginated)
  limit: number
  offset: number
}

// One page of YOUR hands for the database browser. The VPIP filter is applied
// server-side so a page is always `limit` *matching* hands — filtering after
// paginating would give ragged pages and a wrong count.
export async function fetchHandsPageFromDb(
  { limit, offset, vpip }: { limit: number; offset: number; vpip: VpipFilter },
): Promise<HandsPage> {
  const qs = new URLSearchParams({ view: 'mine', limit: String(limit), offset: String(offset), vpip })
  const res = await fetch(`/api/hands?${qs}`, { headers: await authHeaders() })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load hands')
  const data = await res.json() as {
    hands: { parsed: Omit<ParsedHand, 'rawText'>; raw_text: string; notes: string | null }[]
    total: number; filtered: number; limit: number; offset: number
  }
  return {
    hands: data.hands.map(rowToParsedHand),
    notes: data.hands.map(r => r.notes ?? ''),
    total: data.total,
    filtered: data.filtered,
    limit: data.limit,
    offset: data.offset,
  }
}

// `mine` → just your hands (your-hands review / Leakbuster); otherwise the whole
// pooled sample (population Reports + Postflop spots).
export async function fetchHandsFromDb(mine = false): Promise<{ hands: ParsedHand[]; notes: string[] }> {
  const res = await fetch(mine ? '/api/hands?view=mine' : '/api/hands', { headers: await authHeaders() })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load hands')
  const data = await res.json() as { hands: { parsed: Omit<ParsedHand, 'rawText'>; raw_text: string; notes: string | null }[] }
  return {
    hands: data.hands.map(rowToParsedHand),
    notes: data.hands.map(r => r.notes ?? ''),
  }
}
