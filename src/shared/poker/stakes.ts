import type { ParsedHand } from './types'

// ---------------------------------------------------------------------------
// Stakes — the blind level a hand was played at, named the way players say it:
// a $0.10/$0.25 PLO game is "PLO25", $0.02/$0.05 hold'em is "5NL" (100bb of the
// big blind). Derived client-side from the loaded hands, so the stakes offered
// as filters are exactly the ones present in the database — no extra column or
// backfill needed (big_blind is already stored, but reports read `parsed`).
// ---------------------------------------------------------------------------

export interface Stake {
  key: string        // URL-safe id, e.g. 'plo25' / 'nl5' / 'mtt'
  label: string      // display name, e.g. 'PLO25' / '5NL' / 'Tournament'
  bigBlind: number   // 0 for the tournament / unknown buckets (sorted last)
}

export interface StakeOption {
  stake: Stake
  hands: number      // how many loaded hands were played at it
}

// Tournament hands share one bucket: their blinds are levels, not a stake.
const TOURNAMENT: Stake = { key: 'mtt', label: 'Tournament', bigBlind: 0 }
const UNKNOWN: Stake = { key: 'unknown', label: 'Unknown', bigBlind: 0 }

function isTournament(hand: ParsedHand): boolean {
  if (/tournament/i.test(hand.gameType)) return true
  // Ignition tournament headers carry "Tournament #… Level n (15/25)" where a
  // cash header has the game type, so gameType parses empty — check the header.
  return /tournament/i.test(hand.rawText.slice(0, 200))
}

// The stake number is 100 big blinds in the table's currency ($0.05 BB → 5).
const stakeNumber = (bigBlind: number) => Math.round(bigBlind * 10000) / 100

function computeStake(hand: ParsedHand): Stake {
  if (isTournament(hand)) return TOURNAMENT
  if (!(hand.bigBlind > 0)) return UNKNOWN
  const n = stakeNumber(hand.bigBlind)
  if (/omaha/i.test(hand.gameType)) return { key: `plo${n}`, label: `PLO${n}`, bigBlind: hand.bigBlind }
  if (/hold/i.test(hand.gameType)) return { key: `nl${n}`, label: `${n}NL`, bigBlind: hand.bigBlind }
  // Unrecognized game — name it by the blind itself rather than guessing NL/PLO.
  return { key: `bb${n}`, label: `${hand.bigBlind} BB`, bigBlind: hand.bigBlind }
}

// Reports rebuild on every filter change and re-derive the stake per hand, so
// memoize per hand object (hands are immutable once parsed / loaded).
const cache = new WeakMap<ParsedHand, Stake>()
export function handStake(hand: ParsedHand): Stake {
  let s = cache.get(hand)
  if (!s) { s = computeStake(hand); cache.set(hand, s) }
  return s
}

// Every stake present in the sample, smallest first (tournament/unknown last).
export function stakesIn(hands: ParsedHand[]): StakeOption[] {
  const byKey = new Map<string, StakeOption>()
  for (const hand of hands) {
    const stake = handStake(hand)
    const opt = byKey.get(stake.key)
    if (opt) opt.hands++
    else byKey.set(stake.key, { stake, hands: 1 })
  }
  const rank = (s: Stake) => (s.bigBlind > 0 ? s.bigBlind : Number.MAX_VALUE)
  return [...byKey.values()].sort((a, b) =>
    rank(a.stake) - rank(b.stake) || a.stake.key.localeCompare(b.stake.key))
}

// An empty selection means "all stakes" — no filtering.
export function filterByStake(hands: ParsedHand[], keys: string[]): ParsedHand[] {
  if (!keys.length) return hands
  const want = new Set(keys)
  return hands.filter(h => want.has(handStake(h).key))
}

// Selection ⇆ URL query (?stake=plo25,plo50), so it survives drill-down/refresh.
export const STAKE_PARAM = 'stake'

export function parseStakes(q: URLSearchParams): string[] {
  const raw = q.get(STAKE_PARAM)
  if (!raw) return []
  return [...new Set(raw.split(',').map(s => s.trim().toLowerCase()).filter(Boolean))]
}

export function writeStakes(q: URLSearchParams, keys: string[]) {
  if (keys.length) q.set(STAKE_PARAM, keys.join(','))
  else q.delete(STAKE_PARAM)
}

// Human-readable summary of the selection, e.g. "all stakes" / "PLO25 + PLO50".
export function stakeSelectionLabel(keys: string[], options: StakeOption[]): string {
  if (!keys.length) return 'all stakes'
  const labels = keys.map(k => options.find(o => o.stake.key === k)?.stake.label ?? k)
  return labels.join(' + ')
}
