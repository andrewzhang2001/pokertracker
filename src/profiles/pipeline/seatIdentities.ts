import { parseHandHistories } from '../../shared/poker/parsers'

// The PokerNow identity ("name @ token") at each seat of a stored hand, recovered
// by re-parsing its raw_text. Empty when raw_text doesn't parse or carries no
// identities (Ignition, or PokerNow rows stored before raw_text kept the log).
export function seatIdentities(rawText: string, handId: string): Map<number, string> {
  const seats = new Map<number, string>()
  let hand
  try { hand = parseHandHistories(rawText).find(h => h.handId === handId) } catch { return seats }
  for (const p of hand?.players ?? []) if (p.sourceName) seats.set(p.seatNumber, p.sourceName)
  return seats
}
