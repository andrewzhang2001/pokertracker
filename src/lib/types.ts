export interface ParsedCard {
  rank: string
  suit: 'h' | 'd' | 'c' | 's'
}

export interface PlayerInfo {
  seatNumber: number
  position: string
  isMe: boolean
  startingStack: number
}

export type Street = 'preflop' | 'flop' | 'turn' | 'river'

export type ActionType =
  | 'post_ante' | 'post_blind'
  | 'deal_hole'
  | 'fold' | 'check' | 'call' | 'raise' | 'bet' | 'allin'
  | 'deal_flop' | 'deal_turn' | 'deal_river'
  | 'showdown' | 'doesnotshow'
  | 'result' | 'return_bet'

export interface HandAction {
  type: ActionType
  seatNumber?: number
  amount?: number        // for calls/bets: additional; for raises: total "to" amount
  cards?: ParsedCard[]
  street: Street
  desc: string           // human-readable in BB
}

export interface ParsedHand {
  handId: string
  tableId: string
  date: string
  players: PlayerInfo[]
  bigBlind: number
  actions: HandAction[]
  initialStep: number    // step index to start at (after hole cards dealt)
  rawText: string
}

// Computed live state at a given step
export interface PlayerState {
  seatNumber: number
  position: string
  isMe: boolean
  stack: number
  holeCards: ParsedCard[] | null
  folded: boolean
  streetAction: string | null
  streetBet: number
}

export interface HandState {
  communityCards: ParsedCard[]
  street: Street
  players: PlayerState[]
  pot: number
  lastAction: HandAction | null
}
