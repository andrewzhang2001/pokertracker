import type { ParsedHand } from './types'

// ---------------------------------------------------------------------------
// Game variant — PLO vs NLHE. Distinct from the stake (the blind level): the
// same account plays both, and pooling them hides the winrate of each, so the
// database browser and the graph both filter on it.
//
// The variant is stored as a `game` column server-side (like hero_vpip) because
// the database view filters while paginating — that can't be done client-side.
// `handGame` is the single source of truth for the rule; the SQL backfill in
// api/hands.ts mirrors it.
// ---------------------------------------------------------------------------

export type GameKey = 'nlhe' | 'plo' | 'other'
export type GameFilter = 'all' | GameKey

// Display order for the filter pills — 'other' last (stud, mixed, unparsed).
export const GAME_KEYS: readonly GameKey[] = ['nlhe', 'plo', 'other']

export const GAME_LABELS: Record<GameKey, string> = {
  nlhe: 'NLHE',
  plo: 'PLO',
  other: 'Other',
}

// The header text that names the variant. Ignition cash headers put it in the
// game-type field ("OMAHA Pot Limit"); tournament headers don't match the
// game-type pattern at all, so fall back to the header line itself, which still
// carries "HOLDEM Tournament #…".
function variantSource(hand: ParsedHand): string {
  return hand.gameType || hand.rawText.slice(0, 200)
}

function computeGame(hand: ParsedHand): GameKey {
  const src = variantSource(hand)
  if (/omaha/i.test(src)) return 'plo'
  if (/hold/i.test(src)) return 'nlhe'
  return 'other'
}

// Memoized per hand object, like handStake — filters re-derive on every change.
const cache = new WeakMap<ParsedHand, GameKey>()
export function handGame(hand: ParsedHand): GameKey {
  let g = cache.get(hand)
  if (!g) { g = computeGame(hand); cache.set(hand, g) }
  return g
}

// 'all' means no filtering.
export function filterByGame<T>(items: T[], game: GameFilter, keyOf: (item: T) => GameKey): T[] {
  if (game === 'all') return items
  return items.filter(item => keyOf(item) === game)
}

export function filterHandsByGame(hands: ParsedHand[], game: GameFilter): ParsedHand[] {
  return filterByGame(hands, game, handGame)
}

// Selection ⇆ URL query (?game=plo), so a filtered graph is a shareable link
// and survives refresh / back-forward.
export const GAME_PARAM = 'game'

export function parseGame(q: URLSearchParams): GameFilter {
  const raw = q.get(GAME_PARAM)?.trim().toLowerCase()
  return (GAME_KEYS as readonly string[]).includes(raw ?? '') ? (raw as GameKey) : 'all'
}

export function writeGame(q: URLSearchParams, game: GameFilter) {
  if (game === 'all') q.delete(GAME_PARAM)
  else q.set(GAME_PARAM, game)
}

export function gameLabel(game: GameFilter): string {
  return game === 'all' ? 'all games' : GAME_LABELS[game]
}
