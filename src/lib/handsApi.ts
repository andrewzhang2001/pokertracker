import type { ParsedHand } from './types'
import { canonicalizeHand, rowToParsedHand } from './canonicalHand'

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

export async function fetchHandsFromDb(): Promise<{ hands: ParsedHand[]; notes: string[] }> {
  const res = await fetch('/api/hands')
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load hands')
  const data = await res.json() as { hands: { parsed: Omit<ParsedHand, 'rawText'>; raw_text: string; notes: string | null }[] }
  return {
    hands: data.hands.map(rowToParsedHand),
    notes: data.hands.map(r => r.notes ?? ''),
  }
}
