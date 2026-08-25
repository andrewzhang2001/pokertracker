import type { ParsedCard } from './types'

// Map a dealt 4-card PLO hand to the solver's suit-isomorphic combo key, e.g.
// "4c Jh Kc 5s" -> "[KJ]... ". Cards that share a suit are grouped in brackets;
// groups are ordered by their rank list (highest first, longer wins on a tie).
// Verified against all C(52,4) hands: produces exactly prelo's 16,432 combos.
const RANK_VAL: Record<string, number> = {
  '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9,
  T: 10, J: 11, Q: 12, K: 13, A: 14,
}
const VAL_CHAR: Record<number, string> = Object.fromEntries(
  Object.entries(RANK_VAL).map(([c, v]) => [v, c]),
)

export function ploCombo(cards: ParsedCard[]): string {
  const bySuit = new Map<string, number[]>()
  for (const c of cards) {
    const v = RANK_VAL[c.rank]
    if (v === undefined) return ''
    const g = bySuit.get(c.suit)
    if (g) g.push(v); else bySuit.set(c.suit, [v])
  }
  const groups = [...bySuit.values()].map(g => g.sort((a, b) => b - a))
  groups.sort((a, b) => {
    const n = Math.min(a.length, b.length)
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) return b[i] - a[i]
    return b.length - a.length // equal prefix → longer group first
  })
  let out = ''
  for (const g of groups) {
    const s = g.map(v => VAL_CHAR[v]).join('')
    out += g.length >= 2 ? `[${s}]` : s
  }
  return out
}
