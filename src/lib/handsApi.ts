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

// ---- Aggregate feed (Reports / Postflop / Leakbuster) -----------------------
// These read the whole sample, which one response can no longer carry: Neon
// caps a query response at 64 MB and the pool passed that, so the endpoint
// serves the sample in chunks and we stitch them together here.

// Hands run ~4-5 KB each, so a chunk is a couple of MB — small enough to stay
// well inside the serverless response limit, large enough that a big sample
// isn't hundreds of round-trips.
const CHUNK_SIZE = 500
// A few requests in flight at once: the chunks are independent, and fetching
// ~40 of them one after another would be seconds of idle waiting.
const CHUNK_CONCURRENCY = 4

async function fetchHandChunk(
  mine: boolean, offset: number,
): Promise<{ hands: ParsedHand[]; total: number }> {
  const qs = new URLSearchParams({ chunk: String(CHUNK_SIZE), offset: String(offset) })
  if (mine) qs.set('view', 'mine')
  const res = await fetch(`/api/hands?${qs}`, { headers: await authHeaders() })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load hands')
  const data = await res.json() as {
    hands: { parsed: Omit<ParsedHand, 'rawText'>; raw_text: string }[]
    total?: number
  }
  return { hands: data.hands.map(rowToParsedHand), total: data.total ?? 0 }
}

// `mine` → just your hands (your-hands review / Leakbuster); otherwise the whole
// pooled sample (population Reports + Postflop spots). `onProgress` fires as
// chunks land, so a slow load can show how far along it is.
export async function fetchHandsFromDb(
  mine = false,
  onProgress?: (loaded: number, total: number) => void,
): Promise<ParsedHand[]> {
  const first = await fetchHandChunk(mine, 0)
  const total = first.total
  onProgress?.(first.hands.length, total)

  // Chunks are collected by index rather than appended, so the assembled sample
  // keeps the server's newest-first order no matter what order they arrive in.
  const pages: ParsedHand[][] = [first.hands]
  const offsets: number[] = []
  for (let o = CHUNK_SIZE; o < total; o += CHUNK_SIZE) offsets.push(o)

  let loaded = first.hands.length
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(CHUNK_CONCURRENCY, offsets.length) }, async () => {
      while (next < offsets.length) {
        const i = next++
        const chunk = await fetchHandChunk(mine, offsets[i])
        pages[i + 1] = chunk.hands
        loaded += chunk.hands.length
        onProgress?.(loaded, total)
      }
    }),
  )

  // Each chunk is its own snapshot, so a hand exported while the load is in
  // flight can shift across a boundary and land in two of them. Hand ids are
  // the table's primary key, so de-duping on them keeps the reports from
  // double-counting a spot.
  const seen = new Set<string>()
  const hands: ParsedHand[] = []
  for (const hand of pages.flat()) {
    if (seen.has(hand.handId)) continue
    seen.add(hand.handId)
    hands.push(hand)
  }
  return hands
}
