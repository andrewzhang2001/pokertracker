import type { ParsedHand } from './types'
import { analyzeHand, type HandAnalysis } from './analyzeHand'
import { computeHandState } from './computeHandState'
import { displayPosition } from './positionUtils'

// A row as stored in the `hands` table. snake_case keys match the SQL column
// names so the API can insert via jsonb_to_recordset without remapping.
// The derived layer (analysis, net_bb, …) is reproducible from raw_text, so it
// is safe to overwrite on re-export — raw_text is the source of truth.
export interface HandRow {
  id: string
  site: string
  game_type: string
  table_size: number
  small_blind: number | null
  big_blind: number
  currency: string
  played_at: number | null      // epoch ms
  hero_position: string | null
  net_bb: number | null
  pot_type: string
  analysis: HandAnalysis
  parsed: Omit<ParsedHand, 'rawText'>
  raw_text: string
  notes: string | null
}

function heroNetBB(hand: ParsedHand): number | null {
  const hero = hand.players.find(p => p.isMe)
  if (!hero) return null
  const final = computeHandState(hand, hand.actions.length - 1)
  const heroFinal = final.players.find(p => p.isMe)
  if (!heroFinal) return null
  return (heroFinal.stack - hero.startingStack) / hand.bigBlind
}

export function canonicalizeHand(hand: ParsedHand, notes?: string): HandRow {
  const analysis = analyzeHand(hand)
  const hero = hand.players.find(p => p.isMe)
  const { rawText, ...parsedNoRaw } = hand
  return {
    id: hand.handId,
    site: hand.site,
    game_type: hand.gameType,
    table_size: hand.players.length,
    small_blind: hand.smallBlind || null,
    big_blind: hand.bigBlind,
    currency: hand.currency,
    played_at: hand.playedAt,
    hero_position: hero ? displayPosition(hero.position, hand.players.length) : null,
    net_bb: heroNetBB(hand),
    pot_type: analysis.potType,
    analysis,
    parsed: parsedNoRaw,
    raw_text: rawText,
    notes: notes?.trim() ? notes.trim() : null,
  }
}

// Reconstruct a ParsedHand from a stored row (parsed JSONB + raw_text column).
export function rowToParsedHand(row: { parsed: Omit<ParsedHand, 'rawText'>; raw_text: string }): ParsedHand {
  return { ...row.parsed, rawText: row.raw_text }
}
