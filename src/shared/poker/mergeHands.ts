import type { ParsedHand } from './types'

// Merge hands from one or more sources: drop duplicate hand ids (overlapping
// exports) and order chronologically by playedAt. Hands are self-describing
// (own stakes/game/table), so mixing files/stakes/formats is safe — the only
// real concerns when combining sources are duplicates and ordering.
export function dedupeAndSort(hands: ParsedHand[]): ParsedHand[] {
  const seen = new Set<string>()
  const unique = hands.filter(h => (seen.has(h.handId) ? false : (seen.add(h.handId), true)))
  return unique.sort((a, b) => (a.playedAt ?? Infinity) - (b.playedAt ?? Infinity))
}
