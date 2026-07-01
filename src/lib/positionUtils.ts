export const POSITION_RANK: Record<string, number> = {
  'Dealer': 0, 'Small Blind': 1, 'Big Blind': 2,
  'UTG': 3, 'UTG+1': 4, 'UTG+2': 5, 'UTG+3': 6, 'UTG+4': 7, 'UTG+5': 8,
}

// HU (2-handed) vs everything else (6-max / full ring). Reports, the postflop
// formations, and the materialized spots are kept on separate tracks by kind so
// the two populations never mix — a heads-up SB-RFI is a different spot from a
// 6-max SB-RFI even though both display as "SB". (`players.length` = seats dealt
// in, so a 6-max blind-vs-blind hand is still sixmax, not hu.)
export type TableKind = 'hu' | 'sixmax'
export const tableKind = (players: number): TableKind => (players === 2 ? 'hu' : 'sixmax')

export function displayPosition(position: string, totalPlayers: number): string {
  // Heads-up (2 seats): the button posts the small blind and acts first preflop,
  // so it IS the SB regardless of whether the site labels it 'Dealer' or 'Small
  // Blind'. Canonicalize to SB/BB so HU spots don't split across SB/BU.
  if (totalPlayers === 2) return position === 'Big Blind' ? 'BB' : 'SB'
  if (position === 'Dealer') return 'BU'
  if (position === 'Small Blind') return 'SB'
  if (position === 'Big Blind') return 'BB'
  const rank = POSITION_RANK[position]
  if (rank === undefined) return position
  const stepsBeforeDealer = totalPlayers - rank
  if (stepsBeforeDealer === 1) return 'CO'
  if (stepsBeforeDealer === 2) return 'HJ'
  if (stepsBeforeDealer === 3) return 'LJ'
  return position
}
