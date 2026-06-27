import type { ParsedHand, ParsedCard } from './types'
import { displayPosition } from './positionUtils'

// ---------------------------------------------------------------------------
// Population preflop reports. Aggregated across every seat (not just hero),
// computed client-side from loaded hands — no DB columns/backfill required.
// ---------------------------------------------------------------------------

export const RFI_POSITIONS = ['LJ', 'HJ', 'CO', 'BU', 'SB'] as const
export const VS_RFI_DEFENDERS = ['BB', 'SB', 'BU', 'CO', 'HJ'] as const

export const POSITION_NAMES: Record<string, string> = {
  UTG: 'UTG', 'UTG+1': 'UTG+1', 'UTG+2': 'UTG+2',
  LJ: 'Lojack', HJ: 'Hijack', CO: 'Cutoff', BU: 'Button', SB: 'Small Blind', BB: 'Big Blind',
}

// Preflop action order among the positions we track (earlier = acts first).
const ACT_ORDER = ['UTG', 'UTG+1', 'UTG+2', 'UTG+3', 'UTG+4', 'LJ', 'HJ', 'CO', 'BU', 'SB', 'BB']
const orderIndex = (pos: string) => ACT_ORDER.indexOf(pos)

export const MIN_BB = 75            // depth filter: the acting player's starting stack
export const RFI_OPEN_MIN_BB = 3.0  // a raise must be >= this to count as an RFI

// Which openers a given defender can face an RFI from (anyone earlier to act).
export function openersFor(defender: string): string[] {
  return RFI_POSITIONS.filter(o => orderIndex(o) < orderIndex(defender))
}

// ---- Shared shapes for the generic report view ----
export interface ReportEntry {
  handId: string
  cards: ParsedCard[] | null
  stackBB: number
  isHero: boolean
  hand: ParsedHand
}
export interface ReportBucket {
  label: string
  color: string
  bar: string
  pct: number
  count: number
  entries: ReportEntry[]
}
export interface ReportResult {
  title: string
  subtitle: string
  total: number
  buckets: ReportBucket[]
}
export type ReportSel =
  | { type: 'rfi'; pos: string }
  | { type: 'vsrfi'; defender: string; opener: string }

// raise = red, call/limp = green, fold = blue
const STYLE = {
  aggressive: { color: 'text-red-400',   bar: 'bg-red-500' },
  passive:    { color: 'text-green-400', bar: 'bg-green-500' },
  fold:       { color: 'text-blue-400',  bar: 'bg-blue-500' },
}

function cardsFor(hand: ParsedHand, seat: number): ParsedCard[] | null {
  return hand.actions.find(a => a.type === 'deal_hole' && a.seatNumber === seat)?.cards ?? null
}

// ===========================================================================
// RFI — open raise / limp / fold in an UNOPENED pot.
// ===========================================================================
export type RfiAction = 'raise' | 'limp' | 'fold'

export interface RfiSpot {
  handId: string
  seat: number
  position: string
  displayPos: string
  isHero: boolean
  stackBB: number
  cards: ParsedCard[] | null
  action: RfiAction
}

export function rfiSpots(hand: ParsedHand): RfiSpot[] {
  const tableSize = hand.players.length
  const make = (seat: number, action: RfiAction): RfiSpot | null => {
    const p = hand.players.find(pp => pp.seatNumber === seat)
    if (!p) return null
    return {
      handId: hand.handId, seat, position: p.position,
      displayPos: displayPosition(p.position, tableSize),
      isHero: p.isMe, stackBB: p.startingStack / hand.bigBlind,
      cards: cardsFor(hand, seat), action,
    }
  }

  const spots: RfiSpot[] = []
  for (const a of hand.actions) {
    if (a.street !== 'preflop' || a.seatNumber === undefined) continue
    if (a.type === 'post_blind' || a.type === 'post_ante' || a.type === 'deal_hole') continue
    if (a.type === 'fold') { const s = make(a.seatNumber, 'fold'); if (s) spots.push(s); continue }
    if (a.type === 'raise' || a.type === 'bet' || a.type === 'allin') {
      const s = make(a.seatNumber, 'raise'); if (s) spots.push(s); break
    }
    if (a.type === 'call') { const s = make(a.seatNumber, 'limp'); if (s) spots.push(s); break }
    break
  }
  return spots
}

export interface RfiReport {
  position: string
  total: number
  counts: Record<RfiAction, number>
  pct: Record<RfiAction, number>
  entries: Record<RfiAction, ReportEntry[]>
}

export function rfiReport(
  hands: ParsedHand[],
  opts: { position: string; minBB: number; excludeHero: boolean },
): RfiReport {
  const entries: Record<RfiAction, ReportEntry[]> = { raise: [], limp: [], fold: [] }
  for (const hand of hands) {
    for (const s of rfiSpots(hand)) {
      if (s.displayPos !== opts.position) continue
      if (opts.excludeHero && s.isHero) continue
      if (s.stackBB < opts.minBB) continue
      entries[s.action].push({ handId: s.handId, cards: s.cards, stackBB: s.stackBB, isHero: s.isHero, hand })
    }
  }
  return finalize(opts.position, entries)
}

function finalize<A extends string>(position: string, entries: Record<A, ReportEntry[]>) {
  const counts = {} as Record<A, number>
  let total = 0
  for (const k in entries) { counts[k] = entries[k].length; total += counts[k] }
  const pct = {} as Record<A, number>
  for (const k in entries) pct[k] = total ? (counts[k] / total) * 100 : 0
  return { position, total, counts, pct, entries }
}

// ===========================================================================
// vs-RFI — a defender facing a PURE single RFI (open is first voluntary action
// & is >= RFI_OPEN_MIN_BB; only folds between opener and defender).
// Defender's response: 3-bet (raise) / call / fold.
// ===========================================================================
export type VsRfiAction = 'raise' | 'call' | 'fold'

export interface VsRfiSpot {
  handId: string
  defenderSeat: number
  defenderPos: string
  openerPos: string
  isHero: boolean
  stackBB: number
  cards: ParsedCard[] | null
  action: VsRfiAction
}

export function vsRfiSpots(hand: ParsedHand, minOpenBB = RFI_OPEN_MIN_BB): VsRfiSpot[] {
  const tableSize = hand.players.length
  const playerBy = (seat: number) => hand.players.find(p => p.seatNumber === seat)

  let openerPos: string | null = null
  const spots: VsRfiSpot[] = []

  for (const a of hand.actions) {
    if (a.street !== 'preflop' || a.seatNumber === undefined) continue
    if (a.type === 'post_blind' || a.type === 'post_ante' || a.type === 'deal_hole') continue

    if (openerPos === null) {
      // unopened phase — looking for the RFI
      if (a.type === 'fold') continue
      if (a.type === 'raise') {
        if ((a.amount ?? 0) / hand.bigBlind < minOpenBB) return [] // open too small to count as RFI
        const p = playerBy(a.seatNumber)
        if (!p) return []
        openerPos = displayPosition(p.position, tableSize)
        continue
      }
      return [] // first voluntary action was a limp/check — not a pure RFI
    }

    // vs-RFI phase — defenders facing the single raise
    const p = playerBy(a.seatNumber)
    if (!p) break
    const mk = (action: VsRfiAction): VsRfiSpot => ({
      handId: hand.handId, defenderSeat: a.seatNumber!, defenderPos: displayPosition(p.position, tableSize),
      openerPos: openerPos!, isHero: p.isMe, stackBB: p.startingStack / hand.bigBlind,
      cards: cardsFor(hand, a.seatNumber!), action,
    })
    if (a.type === 'fold') { spots.push(mk('fold')); continue }
    if (a.type === 'call') { spots.push(mk('call')); break }            // pot multiway → chain ends
    if (a.type === 'raise' || a.type === 'allin') { spots.push(mk('raise')); break } // 3-bet ends it
    break
  }
  return spots
}

export interface VsRfiReport {
  defender: string
  opener: string
  total: number
  counts: Record<VsRfiAction, number>
  pct: Record<VsRfiAction, number>
  entries: Record<VsRfiAction, ReportEntry[]>
}

export function vsRfiReport(
  hands: ParsedHand[],
  opts: { defender: string; opener: string; minBB: number; excludeHero: boolean },
): VsRfiReport {
  const entries: Record<VsRfiAction, ReportEntry[]> = { raise: [], call: [], fold: [] }
  for (const hand of hands) {
    for (const s of vsRfiSpots(hand)) {
      if (s.defenderPos !== opts.defender || s.openerPos !== opts.opener) continue
      if (opts.excludeHero && s.isHero) continue
      if (s.stackBB < opts.minBB) continue
      entries[s.action].push({ handId: s.handId, cards: s.cards, stackBB: s.stackBB, isHero: s.isHero, hand })
    }
  }
  const base = finalize(`${opts.defender} vs ${opts.opener}`, entries)
  return { defender: opts.defender, opener: opts.opener, ...base }
}

// ===========================================================================
// Generic builder for the report view + menu previews.
// ===========================================================================
function bucket(label: string, style: { color: string; bar: string }, r: { counts: any; pct: any; entries: any }, key: string): ReportBucket {
  return { label, color: style.color, bar: style.bar, pct: r.pct[key], count: r.counts[key], entries: r.entries[key] }
}

export function buildReport(hands: ParsedHand[], sel: ReportSel): ReportResult {
  if (sel.type === 'rfi') {
    const r = rfiReport(hands, { position: sel.pos, minBB: MIN_BB, excludeHero: true })
    return {
      title: `${POSITION_NAMES[sel.pos]} RFI`,
      subtitle: `population · excludes you · ${MIN_BB}bb+ · unopened pots`,
      total: r.total,
      buckets: [
        bucket('Raise (RFI)', STYLE.aggressive, r, 'raise'),
        bucket('Limp', STYLE.passive, r, 'limp'),
        bucket('Fold', STYLE.fold, r, 'fold'),
      ],
    }
  }
  const r = vsRfiReport(hands, { defender: sel.defender, opener: sel.opener, minBB: MIN_BB, excludeHero: true })
  return {
    title: `${POSITION_NAMES[sel.defender]} vs ${POSITION_NAMES[sel.opener]} RFI`,
    subtitle: `population · excludes you · ${MIN_BB}bb+ · vs a single ≥${RFI_OPEN_MIN_BB}bb open`,
    total: r.total,
    buckets: [
      bucket('3-Bet', STYLE.aggressive, r, 'raise'),
      bucket('Call', STYLE.passive, r, 'call'),
      bucket('Fold', STYLE.fold, r, 'fold'),
    ],
  }
}
