import type { ParsedHand } from './types'
import { analyzeHand, type HandAnalysis } from './analyzeHand'
import { displayPosition } from './positionUtils'
import { handStat } from './graph'

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
  adj_net_bb: number | null   // all-in adjusted net (sims computed once, stored)
  rake_bb: number | null      // rake attributed to hero
  pot_type: string
  hero_vpip: boolean          // analysis.heroVpip, promoted to a column so the
                              // database view can filter+paginate it in SQL
  analysis: HandAnalysis
  parsed: Omit<ParsedHand, 'rawText'>
  raw_text: string
  notes: string | null
}

export function canonicalizeHand(hand: ParsedHand, notes?: string): HandRow {
  const analysis = analyzeHand(hand)
  const hero = hand.players.find(p => p.isMe)
  const stat = handStat(hand)
  const { rawText, ...parsedNoRaw } = hand
  // Drop the transient per-seat raw identities before persisting — the shared
  // `parsed` blob (served to population views) must stay anonymous. Seat→profile
  // mapping is kept separately in the owner-scoped profile tables.
  const parsed = { ...parsedNoRaw, players: parsedNoRaw.players.map(({ sourceName, ...p }) => p) }
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
    net_bb: stat?.net ?? null,
    adj_net_bb: stat?.adjNet ?? null,
    rake_bb: stat?.rake ?? null,
    pot_type: analysis.potType,
    hero_vpip: analysis.heroVpip,
    analysis,
    parsed,
    raw_text: rawText,
    notes: notes?.trim() ? notes.trim() : null,
  }
}

// Reconstruct a ParsedHand from a stored row (parsed JSONB [+ raw_text]). The
// list queries omit raw_text to save egress — nothing in the UI reads it (it
// stays in the DB as the backfill source of truth), so rawText falls back to ''.
export function rowToParsedHand(row: { parsed: Omit<ParsedHand, 'rawText'>; raw_text?: string }): ParsedHand {
  return { ...row.parsed, rawText: row.raw_text ?? '' }
}
