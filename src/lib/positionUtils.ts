export const POSITION_RANK: Record<string, number> = {
  'Dealer': 0, 'Small Blind': 1, 'Big Blind': 2,
  'UTG': 3, 'UTG+1': 4, 'UTG+2': 5, 'UTG+3': 6, 'UTG+4': 7, 'UTG+5': 8,
}

export function displayPosition(position: string, totalPlayers: number): string {
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
