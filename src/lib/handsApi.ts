import type { ParsedHand } from './types'
import { canonicalizeHand, rowToParsedHand } from './canonicalHand'
import type { GraphRow } from './graph'

// Export every parsed hand to the database (bulk, idempotent upsert by hand id).
// Notes are aligned by index with the hands array.
export async function exportHandsToDb(hands: ParsedHand[], notes: string[]): Promise<number> {
  const rows = hands.map((h, i) => canonicalizeHand(h, notes[i]))
  const res = await fetch('/api/hands', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ hands: rows }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Export failed')
  const { inserted } = await res.json() as { inserted: number }
  return inserted
}

// Lightweight graph feed — precomputed per-hand result numbers (no parsing/sims).
// The full dataset always lives in the DB, so this is the only source.
export async function fetchGraphFromDb(): Promise<GraphRow[]> {
  const res = await fetch('/api/hands?view=graph')
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load graph')
  const data = await res.json() as { rows?: { played_at: number | null; net_bb: number; adj_net_bb: number | null; rake_bb: number | null }[] }
  return (data.rows ?? []).map(r => ({
    playedAt: r.played_at,
    net: Number(r.net_bb),
    adjNet: r.adj_net_bb !== null ? Number(r.adj_net_bb) : Number(r.net_bb), // fall back to actual if not yet backfilled
    rake: r.rake_bb !== null ? Number(r.rake_bb) : 0,
  }))
}

export async function fetchHandsFromDb(): Promise<{ hands: ParsedHand[]; notes: string[] }> {
  const res = await fetch('/api/hands')
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load hands')
  const data = await res.json() as { hands: { parsed: Omit<ParsedHand, 'rawText'>; raw_text: string; notes: string | null }[] }
  return {
    hands: data.hands.map(rowToParsedHand),
    notes: data.hands.map(r => r.notes ?? ''),
  }
}
