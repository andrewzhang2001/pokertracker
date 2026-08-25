import type { ParsedCard } from './types'

// Map a dealt 2-card Hold'em hand to its 169-hand key: "AA", "AKs", "AKo", "72o".
// High rank first; "s" when the two cards share a suit, "o" otherwise; a pair is
// just the two rank chars. There are 169 such keys (13 pairs + 78 suited + 78
// offsuit) — the 13×13 grid.
const RANK_VAL: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14,
}

export function holdemCombo(cards: ParsedCard[]): string {
  if (cards.length < 2) return ''
  const [a, b] = [cards[0], cards[1]]
  if (RANK_VAL[a.rank] === undefined || RANK_VAL[b.rank] === undefined) return ''
  const [hi, lo] = RANK_VAL[a.rank] >= RANK_VAL[b.rank] ? [a, b] : [b, a]
  if (hi.rank === lo.rank) return hi.rank + lo.rank            // pair, e.g. "AA"
  return `${hi.rank}${lo.rank}${hi.suit === lo.suit ? 's' : 'o'}`
}
