import type { ParsedHand, ParsedCard } from './types'
import { displayPosition } from './positionUtils'
import { ploCombo } from './ploCombo'

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

// Solver lookup: combo -> EVs (bb) per action.
//   RFI:   [foldEv, raiseEv]
//   vs-RFI:[foldEv, callEv, raiseEv]
export type SolverTable = Record<string, number[]>

// EV loss below this (bb) is GTO-indifferent noise, not a "mistake".
const MISTAKE_EPS = 0.05

export interface EvSummary {
  spots: number
  totalBb: number       // total EV lost across spots (bb)
  perSpotBb: number     // average EV lost per spot (bb)
  directions: { label: string; count: number; bbLost: number }[] // sorted by bbLost desc
}

// ---- Shared shapes for the generic report view ----
export interface ReportEntry {
  handId: string
  cards: ParsedCard[] | null
  stackBB: number
  isHero: boolean
  hand: ParsedHand
  evLossBb?: number     // EV given up vs the GTO-best action (bb); set when solver loaded
  bestAction?: string   // the GTO-best action for this hand (e.g. 'fold', 'call', '3-bet')
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
  ev?: EvSummary        // set when a solver table is supplied
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
// Spec for one bucket: which raw action, its label/style, and the solver array
// index whose EV the population's choice realizes (RFI limp uses the raise EV).
interface BucketSpec { key: string; label: string; style: { color: string; bar: string }; solverIdx: number }

const RFI_ACTION_NAME = (i: number) => (i === 0 ? 'fold' : 'raise')
const VSRFI_ACTION_NAME = (i: number) => (i === 0 ? 'fold' : i === 1 ? 'call' : '3-bet')

function assemble(
  kind: 'rfi' | 'vsrfi',
  title: string, subtitle: string,
  r: { total: number; counts: Record<string, number>; pct: Record<string, number>; entries: Record<string, ReportEntry[]> },
  specs: BucketSpec[],
  solver?: SolverTable,
): ReportResult {
  const actionName = kind === 'rfi' ? RFI_ACTION_NAME : VSRFI_ACTION_NAME
  let totalLoss = 0, spots = 0
  const dir = new Map<string, { count: number; bbLost: number }>()

  const buckets: ReportBucket[] = specs.map(spec => {
    const entries = r.entries[spec.key].map(e => {
      if (!solver || !e.cards) return e
      const evs = solver[ploCombo(e.cards)]
      if (!evs) return e
      let bestIdx = 0
      for (let i = 1; i < evs.length; i++) if (evs[i] > evs[bestIdx]) bestIdx = i
      const loss = evs[bestIdx] - evs[spec.solverIdx]
      totalLoss += loss; spots++
      if (loss > MISTAKE_EPS && bestIdx !== spec.solverIdx) {
        const label = `${actionName(spec.solverIdx)} → ${actionName(bestIdx)}`
        const d = dir.get(label) ?? { count: 0, bbLost: 0 }
        d.count++; d.bbLost += loss; dir.set(label, d)
      }
      return { ...e, evLossBb: loss, bestAction: actionName(bestIdx) }
    })
    return { label: spec.label, color: spec.style.color, bar: spec.style.bar, pct: r.pct[spec.key], count: r.counts[spec.key], entries }
  })

  const ev: EvSummary | undefined = solver ? {
    spots, totalBb: totalLoss, perSpotBb: spots ? totalLoss / spots : 0,
    directions: [...dir.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.bbLost - a.bbLost),
  } : undefined

  return { title, subtitle, total: r.total, buckets, ev }
}

export function buildReport(hands: ParsedHand[], sel: ReportSel, solver?: SolverTable): ReportResult {
  if (sel.type === 'rfi') {
    const r = rfiReport(hands, { position: sel.pos, minBB: MIN_BB, excludeHero: true })
    return assemble('rfi',
      `${POSITION_NAMES[sel.pos]} RFI`,
      `population · excludes you · ${MIN_BB}bb+ · unopened pots`,
      r,
      [
        { key: 'raise', label: 'Raise (RFI)', style: STYLE.aggressive, solverIdx: 1 },
        { key: 'limp', label: 'Limp', style: STYLE.passive, solverIdx: 1 }, // limp ≈ raise EV
        { key: 'fold', label: 'Fold', style: STYLE.fold, solverIdx: 0 },
      ],
      solver)
  }
  const r = vsRfiReport(hands, { defender: sel.defender, opener: sel.opener, minBB: MIN_BB, excludeHero: true })
  return assemble('vsrfi',
    `${POSITION_NAMES[sel.defender]} vs ${POSITION_NAMES[sel.opener]} RFI`,
    `population · excludes you · ${MIN_BB}bb+ · vs a single ≥${RFI_OPEN_MIN_BB}bb open`,
    r,
    [
      { key: 'raise', label: '3-Bet', style: STYLE.aggressive, solverIdx: 2 },
      { key: 'call', label: 'Call', style: STYLE.passive, solverIdx: 1 },
      { key: 'fold', label: 'Fold', style: STYLE.fold, solverIdx: 0 },
    ],
    solver)
}
