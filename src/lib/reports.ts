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
export const THREEBET_MIN_BB = 10.0 // a re-raise must be >= this to count as a real 3-bet

// Whose decisions a report covers.
export type Subject = 'population' | 'hero' | 'all'
const includeSpot = (subject: Subject, isHero: boolean) =>
  subject === 'all' ? true : subject === 'hero' ? isHero : !isHero

// Which openers a given defender can face an RFI from (anyone earlier to act).
export function openersFor(defender: string): string[] {
  return RFI_POSITIONS.filter(o => orderIndex(o) < orderIndex(defender))
}

// Solver lookup: combo -> EVs (bb) per action.
//   RFI:   [foldEv, raiseEv]
//   vs-RFI:[foldEv, callEv, raiseEv]
export type SolverTable = Record<string, number[]>

// EV loss at/below this (bb) is GTO-indifferent / rounding noise, not a mistake.
// (Solver EVs are rounded to 0.001, and true mixed-strategy actions tie in EV,
// so this only filters noise — genuine small preflop errors still count.)
export const MISTAKE_EPS = 0.01

export interface EvSummary {
  spots: number
  totalBb: number       // total EV lost across spots (bb)
  perSpotBb: number     // average EV lost per spot (bb)
  directions: { label: string; count: number; bbLost: number }[] // sorted by bbLost desc
  // EV lost on two INDEPENDENT axes (bb) from mistakes; a single mistake can
  // count on both (e.g. raise→fold is loose AND aggressive):
  //   VPIP:       tight = folded when should continue; loose = continued when should fold
  //   Aggression: passive = didn't raise when should; aggressive = raised when should call/fold
  axes: { tight: number; loose: number; passive: number; aggressive: number }
  aggressionAxis: boolean // false for RFI (single VPIP axis)
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
  outOfRange?: boolean  // solver loaded but combo absent (opener opened off-range) → no EV
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
  solverless?: boolean  // true for reports with no GTO baseline (don't show/await EVs)
}
export type Vs3betTag = 'ip' | 'oop' | 'bb'
export type LimpIsoTag = 'ip' | 'oop'
export type LimpMultiway = 'all' | 'hu' | 'multi'
export type ReportSel =
  | { type: 'rfi'; pos: string }
  | { type: 'vsrfi'; defender: string; opener: string }
  | { type: 'limpiso'; iso: LimpIsoTag; multiway: LimpMultiway }
  | { type: 'vs3bet'; opener: string; tag: Vs3betTag }

// The vs-3-bet reports we keep: openers LJ/HJ/CO each get an IP- and an
// OOP-3-bettor report; BU only faces OOP (blinds); SB only faces BB.
export const VS3BET_REPORTS: { opener: string; tag: Vs3betTag }[] = [
  { opener: 'LJ', tag: 'ip' }, { opener: 'LJ', tag: 'oop' },
  { opener: 'HJ', tag: 'ip' }, { opener: 'HJ', tag: 'oop' },
  { opener: 'CO', tag: 'ip' }, { opener: 'CO', tag: 'oop' },
  { opener: 'BU', tag: 'oop' },
  { opener: 'SB', tag: 'bb' },
]
export const VS3BET_OPENERS = ['LJ', 'HJ', 'CO', 'BU', 'SB'] as const
export const vs3betTagLabel = (tag: Vs3betTag) => (tag === 'ip' ? 'IP' : tag === 'oop' ? 'OOP' : 'BB')

export const LIMP_ISO_TAGS: LimpIsoTag[] = ['ip', 'oop']
export const limpIsoTagLabel = (t: LimpIsoTag) => (t === 'ip' ? 'IP' : 'OOP')

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
  stackBB: number       // the RFI player's starting stack (bb)
  bbStackBB: number     // the Big Blind's starting stack (bb) — the key effective stack
  cards: ParsedCard[] | null
  action: RfiAction
}

export function rfiSpots(hand: ParsedHand): RfiSpot[] {
  const tableSize = hand.players.length
  const bb = hand.players.find(p => p.position === 'Big Blind')
  const bbStackBB = bb ? bb.startingStack / hand.bigBlind : Infinity
  const make = (seat: number, action: RfiAction): RfiSpot | null => {
    const p = hand.players.find(pp => pp.seatNumber === seat)
    if (!p) return null
    return {
      handId: hand.handId, seat, position: p.position,
      displayPos: displayPosition(p.position, tableSize),
      isHero: p.isMe, stackBB: p.startingStack / hand.bigBlind, bbStackBB,
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
  opts: { position: string; minBB: number; subject: Subject },
): RfiReport {
  const entries: Record<RfiAction, ReportEntry[]> = { raise: [], limp: [], fold: [] }
  for (const hand of hands) {
    for (const s of rfiSpots(hand)) {
      if (s.displayPos !== opts.position) continue
      if (!includeSpot(opts.subject, s.isHero)) continue
      // both the opener and the BB (the key effective stack) must be 75bb+
      if (s.stackBB < opts.minBB || s.bbStackBB < opts.minBB) continue
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
  stackBB: number          // defender's starting stack (bb)
  openerStackBB: number    // opener's starting stack (bb)
  cards: ParsedCard[] | null
  action: VsRfiAction
}

export function vsRfiSpots(hand: ParsedHand, minOpenBB = RFI_OPEN_MIN_BB): VsRfiSpot[] {
  const tableSize = hand.players.length
  const playerBy = (seat: number) => hand.players.find(p => p.seatNumber === seat)

  let openerPos: string | null = null
  let openerStackBB = 0
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
        openerStackBB = p.startingStack / hand.bigBlind
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
      openerStackBB, cards: cardsFor(hand, a.seatNumber!), action,
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
  opts: { defender: string; opener: string; minBB: number; subject: Subject },
): VsRfiReport {
  const entries: Record<VsRfiAction, ReportEntry[]> = { raise: [], call: [], fold: [] }
  for (const hand of hands) {
    for (const s of vsRfiSpots(hand)) {
      if (s.defenderPos !== opts.defender || s.openerPos !== opts.opener) continue
      if (!includeSpot(opts.subject, s.isHero)) continue
      // both players must be deep enough — the 100bb solver baseline only holds
      // when the effective stack (min of opener & defender) is 75bb+.
      if (s.stackBB < opts.minBB || s.openerStackBB < opts.minBB) continue
      entries[s.action].push({ handId: s.handId, cards: s.cards, stackBB: s.stackBB, isHero: s.isHero, hand })
    }
  }
  const base = finalize(`${opts.defender} vs ${opts.opener}`, entries)
  return { defender: opts.defender, opener: opts.opener, ...base }
}

// ===========================================================================
// vs-3-bet — the original opener (clean RFI) faces a single ≥10bb 3-bet, with
// only folds between the open and the 3-bet and only folds between the 3-bet
// and the opener's response (no squeezes, cold-calls, or 4-bets by a 3rd seat).
// The opener's response: 4-bet (raise) / call / fold.
//   IP/OOP is the 3-bettor's position relative to the opener postflop: a blind
//   3-bettor is OOP; any other (later) seat is IP. SB-opener-vs-BB is its own
//   tag ('bb'). We map every spot onto a representative solver (vs BU / vs SB).
// ===========================================================================
export type Vs3betAction = 'raise' | 'call' | 'fold'   // raise = 4-bet

const BLINDS = ['SB', 'BB']
function threeBetTag(openerPos: string, threeBettorPos: string): Vs3betTag {
  if (BLINDS.includes(threeBettorPos)) return openerPos === 'SB' ? 'bb' : 'oop'
  return 'ip'
}

export interface Vs3betSpot {
  handId: string
  openerSeat: number
  openerPos: string
  threeBettorPos: string
  tag: Vs3betTag
  isHero: boolean          // the opener (the decision-maker) is hero
  stackBB: number          // opener's starting stack (bb)
  threeBettorStackBB: number
  cards: ParsedCard[] | null
  action: Vs3betAction
}

export function vs3betSpots(hand: ParsedHand, minOpenBB = RFI_OPEN_MIN_BB, min3betBB = THREEBET_MIN_BB): Vs3betSpot[] {
  const tableSize = hand.players.length
  const playerBy = (seat: number) => hand.players.find(p => p.seatNumber === seat)

  let phase: 'open' | 'threebet' | 'response' = 'open'
  let openerSeat = -1, openerPos = '', openerStackBB = 0
  let threeBettorPos = '', threeBettorStackBB = 0

  for (const a of hand.actions) {
    if (a.street !== 'preflop' || a.seatNumber === undefined) continue
    if (a.type === 'post_blind' || a.type === 'post_ante' || a.type === 'deal_hole') continue
    const p = playerBy(a.seatNumber)
    if (!p) return []

    if (phase === 'open') {
      if (a.type === 'fold') continue
      if (a.type === 'raise') {
        if ((a.amount ?? 0) / hand.bigBlind < minOpenBB) return [] // open too small
        openerSeat = a.seatNumber
        openerPos = displayPosition(p.position, tableSize)
        openerStackBB = p.startingStack / hand.bigBlind
        phase = 'threebet'; continue
      }
      return [] // first voluntary action was a limp/call → not a pure RFI
    }

    if (phase === 'threebet') {
      if (a.type === 'fold') continue
      if (a.type === 'raise' || a.type === 'allin') {
        if ((a.amount ?? 0) / hand.bigBlind < min3betBB) return [] // 3-bet too small to count
        threeBettorPos = displayPosition(p.position, tableSize)
        threeBettorStackBB = p.startingStack / hand.bigBlind
        phase = 'response'; continue
      }
      return [] // a call before the 3-bet → flat/squeeze pot, not a clean vs-3-bet
    }

    // response phase: only the opener may act before us; a 3rd seat entering
    // (cold-call or 4-bet) makes it a different, multiway node.
    if (a.seatNumber !== openerSeat) {
      if (a.type === 'fold') continue
      return []
    }
    const mk = (action: Vs3betAction): Vs3betSpot => ({
      handId: hand.handId, openerSeat, openerPos, threeBettorPos,
      tag: threeBetTag(openerPos, threeBettorPos), isHero: p.isMe,
      stackBB: openerStackBB, threeBettorStackBB, cards: cardsFor(hand, openerSeat), action,
    })
    if (a.type === 'fold') return [mk('fold')]
    if (a.type === 'call') return [mk('call')]
    if (a.type === 'raise' || a.type === 'allin') return [mk('raise')]
    return []
  }
  return []
}

export interface Vs3betReport {
  opener: string
  tag: Vs3betTag
  total: number
  counts: Record<Vs3betAction, number>
  pct: Record<Vs3betAction, number>
  entries: Record<Vs3betAction, ReportEntry[]>
}

export function vs3betReport(
  hands: ParsedHand[],
  opts: { opener: string; tag: Vs3betTag; minBB: number; subject: Subject },
): Vs3betReport {
  const entries: Record<Vs3betAction, ReportEntry[]> = { raise: [], call: [], fold: [] }
  for (const hand of hands) {
    for (const s of vs3betSpots(hand)) {
      if (s.openerPos !== opts.opener || s.tag !== opts.tag) continue
      if (!includeSpot(opts.subject, s.isHero)) continue
      // both players 75bb+ (the 100bb solver baseline)
      if (s.stackBB < opts.minBB || s.threeBettorStackBB < opts.minBB) continue
      entries[s.action].push({ handId: s.handId, cards: s.cards, stackBB: s.stackBB, isHero: s.isHero, hand })
    }
  }
  const base = finalize(`${opts.opener} vs ${opts.tag}`, entries)
  return { opener: opts.opener, tag: opts.tag, ...base }
}

// ===========================================================================
// limp vs iso — an open-limped pot where a later player iso-raises and the
// ORIGINAL limper then responds (4-bet/raise / call / fold). Other limpers and
// callers may be present; `multiway` flags ≥2 limps before the iso. A re-raise
// by a 3rd seat before the limper acts makes it a different node → excluded.
// Only IP open positions (LJ–BU) count as limpers — SB completes are ignored.
// No GTO baseline exists for limped pots, so this report is frequency-only.
// ===========================================================================
export type LimpIsoAction = 'raise' | 'call' | 'fold'
export const ISO_MIN_BB = 3.0   // an iso raise must be ≥ this (a real raise over the limps)
const LIMP_POSITIONS = ['LJ', 'HJ', 'CO', 'BU']  // who counts as a limper (no blinds)

// IP/OOP is the iso-raiser relative to the limper by POSTFLOP action order.
const POSTFLOP_ORDER = ['SB', 'BB', 'LJ', 'HJ', 'CO', 'BU']
const isoTag = (limperPos: string, isoPos: string): LimpIsoTag =>
  POSTFLOP_ORDER.indexOf(isoPos) > POSTFLOP_ORDER.indexOf(limperPos) ? 'ip' : 'oop'

export interface LimpIsoSpot {
  handId: string
  limperSeat: number
  limperPos: string
  isoPos: string
  tag: LimpIsoTag
  multiway: boolean        // ≥2 limpers before the iso
  isHero: boolean          // the original limper is hero
  stackBB: number          // limper's starting stack (bb)
  isoStackBB: number
  cards: ParsedCard[] | null
  action: LimpIsoAction
}

export function limpVsIsoSpots(hand: ParsedHand, minIsoBB = ISO_MIN_BB): LimpIsoSpot[] {
  const tableSize = hand.players.length
  const playerBy = (seat: number) => hand.players.find(p => p.seatNumber === seat)

  let phase: 'limp' | 'response' = 'limp'
  const limperSeats: number[] = []
  let firstLimpSeat = -1, firstLimpPos = '', firstLimpStackBB = 0
  let isoPos = '', isoStackBB = 0, multiway = false

  for (const a of hand.actions) {
    if (a.street !== 'preflop' || a.seatNumber === undefined) continue
    if (a.type === 'post_blind' || a.type === 'post_ante' || a.type === 'deal_hole') continue
    const p = playerBy(a.seatNumber)
    if (!p) return []

    if (phase === 'limp') {
      if (a.type === 'call') {                       // a limp — only LJ–BU count (no SB completes)
        const pos = displayPosition(p.position, tableSize)
        if (!LIMP_POSITIONS.includes(pos)) continue  // ignore SB completes / blinds
        limperSeats.push(a.seatNumber)
        if (firstLimpSeat === -1) {
          firstLimpSeat = a.seatNumber
          firstLimpPos = pos
          firstLimpStackBB = p.startingStack / hand.bigBlind
        }
        continue
      }
      if (a.type === 'raise' || a.type === 'allin') {
        if (limperSeats.length === 0) return []      // a raise with no limps in front = RFI, not an iso
        if ((a.amount ?? 0) / hand.bigBlind < minIsoBB) return [] // not a real iso
        isoPos = displayPosition(p.position, tableSize)
        isoStackBB = p.startingStack / hand.bigBlind
        multiway = limperSeats.length >= 2
        phase = 'response'; continue
      }
      if (a.type === 'fold' || a.type === 'check') continue  // folds / BB checking its option
      return []
    }

    // response phase: only the ORIGINAL limper's reaction matters. Folds/calls
    // by others (incl. other limpers) are fine; a re-raise changes the node.
    if (a.seatNumber !== firstLimpSeat) {
      if (a.type === 'raise' || a.type === 'allin') return []
      continue
    }
    const mk = (action: LimpIsoAction): LimpIsoSpot => ({
      handId: hand.handId, limperSeat: firstLimpSeat, limperPos: firstLimpPos, isoPos,
      tag: isoTag(firstLimpPos, isoPos), multiway, isHero: p.isMe,
      stackBB: firstLimpStackBB, isoStackBB, cards: cardsFor(hand, firstLimpSeat), action,
    })
    if (a.type === 'fold') return [mk('fold')]
    if (a.type === 'call') return [mk('call')]
    if (a.type === 'raise' || a.type === 'allin') return [mk('raise')]
    return []
  }
  return []
}

export interface LimpIsoReport {
  iso: LimpIsoTag
  total: number
  counts: Record<LimpIsoAction, number>
  pct: Record<LimpIsoAction, number>
  entries: Record<LimpIsoAction, ReportEntry[]>
}

export function limpVsIsoReport(
  hands: ParsedHand[],
  opts: { iso: LimpIsoTag; multiway: LimpMultiway; minBB: number; subject: Subject },
): LimpIsoReport {
  const entries: Record<LimpIsoAction, ReportEntry[]> = { raise: [], call: [], fold: [] }
  for (const hand of hands) {
    for (const s of limpVsIsoSpots(hand)) {
      if (s.tag !== opts.iso) continue
      if (opts.multiway === 'hu' && s.multiway) continue
      if (opts.multiway === 'multi' && !s.multiway) continue
      if (!includeSpot(opts.subject, s.isHero)) continue
      if (s.stackBB < opts.minBB || s.isoStackBB < opts.minBB) continue
      entries[s.action].push({ handId: s.handId, cards: s.cards, stackBB: s.stackBB, isHero: s.isHero, hand })
    }
  }
  const base = finalize(`limp vs ${opts.iso} iso`, entries)
  return { iso: opts.iso, ...base }
}

// ===========================================================================
// Generic builder for the report view + menu previews.
// ===========================================================================
// Spec for one bucket: which raw action, its label/style, and the solver array
// index whose EV the population's choice realizes (RFI limp uses the raise EV).
interface BucketSpec { key: string; label: string; style: { color: string; bar: string }; solverIdx: number }

type ReportKind = 'rfi' | 'vsrfi' | 'vs3bet' | 'limpiso'
const RFI_ACTION_NAME = (i: number) => (i === 0 ? 'fold' : 'raise')
const VSRFI_ACTION_NAME = (i: number) => (i === 0 ? 'fold' : i === 1 ? 'call' : '3-bet')
const VS3BET_ACTION_NAME = (i: number) => (i === 0 ? 'fold' : i === 1 ? 'call' : '4-bet')
const LIMPISO_ACTION_NAME = (i: number) => (i === 0 ? 'fold' : i === 1 ? 'call' : 'raise')

function assemble(
  kind: ReportKind,
  title: string, subtitle: string,
  r: { total: number; counts: Record<string, number>; pct: Record<string, number>; entries: Record<string, ReportEntry[]> },
  specs: BucketSpec[],
  solver?: SolverTable,
): ReportResult {
  const actionName = kind === 'rfi' ? RFI_ACTION_NAME : kind === 'vsrfi' ? VSRFI_ACTION_NAME
    : kind === 'vs3bet' ? VS3BET_ACTION_NAME : LIMPISO_ACTION_NAME
  const hasAggro = kind !== 'rfi' // call/raise aggression axis (vs-RFI & vs-3-bet)
  let totalLoss = 0, spots = 0
  const dir = new Map<string, { count: number; bbLost: number }>()
  const axes = { tight: 0, loose: 0, passive: 0, aggressive: 0 }

  const buckets: ReportBucket[] = specs.map(spec => {
    const entries = r.entries[spec.key].map(e => {
      if (!solver || !e.cards) return e
      const evs = solver[ploCombo(e.cards)]
      // Combo absent = the opener entered with a hand outside the GTO RFI range,
      // so the solver has no EV for it. Flag it (shown red, "not in range") but
      // keep it out of the EV/100 math; it still counts in the action %s.
      if (!evs) return { ...e, outOfRange: true }
      let bestIdx = 0
      for (let i = 1; i < evs.length; i++) if (evs[i] > evs[bestIdx]) bestIdx = i
      const loss = evs[bestIdx] - evs[spec.solverIdx]
      spots++
      // Count toward the total only what we'd also itemize, so the headline EV
      // loss always equals the sum of the mistake directions (no phantom loss).
      if (loss > MISTAKE_EPS && bestIdx !== spec.solverIdx) {
        totalLoss += loss
        const label = `${actionName(spec.solverIdx)} → ${actionName(bestIdx)}`
        const d = dir.get(label) ?? { count: 0, bbLost: 0 }
        d.count++; d.bbLost += loss; dir.set(label, d)
        const chose = spec.solverIdx, best = bestIdx
        const RAISE = kind === 'rfi' ? 1 : 2
        // VPIP axis (fold vs continue) — all report types
        if (chose === 0 && best !== 0) axes.tight += loss
        else if (chose !== 0 && best === 0) axes.loose += loss
        // Aggression axis (raise vs not) — vs-RFI & vs-3-bet
        if (hasAggro) {
          if (chose !== RAISE && best === RAISE) axes.passive += loss
          else if (chose === RAISE && best !== RAISE) axes.aggressive += loss
        }
      }
      return { ...e, evLossBb: loss, bestAction: actionName(bestIdx) }
    })
    return { label: spec.label, color: spec.style.color, bar: spec.style.bar, pct: r.pct[spec.key], count: r.counts[spec.key], entries }
  })

  const ev: EvSummary | undefined = solver ? {
    spots, totalBb: totalLoss, perSpotBb: spots ? totalLoss / spots : 0,
    directions: [...dir.entries()].map(([label, v]) => ({ label, ...v })).sort((a, b) => b.bbLost - a.bbLost),
    axes,
    aggressionAxis: hasAggro,
  } : undefined

  return { title, subtitle, total: r.total, buckets, ev }
}

// Derive the archetype label from the two axes (by EV lost on each side).
export function leakProfile(axes: EvSummary['axes']): { label: string; nickname: string } {
  const EPS = 0.01
  const tightLoose = axes.loose - axes.tight       // + = loose, − = tight
  const passiveAggr = axes.aggressive - axes.passive // + = aggressive, − = passive
  const t = Math.abs(tightLoose) < EPS ? '' : tightLoose > 0 ? 'Loose' : 'Tight'
  const a = Math.abs(passiveAggr) < EPS ? '' : passiveAggr > 0 ? 'Aggressive' : 'Passive'
  const nickname =
    t === 'Loose' && a === 'Passive' ? 'station' :
    t === 'Loose' && a === 'Aggressive' ? 'maniac' :
    t === 'Tight' && a === 'Passive' ? 'nit' :
    t === 'Tight' && a === 'Aggressive' ? 'TAG' : ''
  return { label: [t, a].filter(Boolean).join('-') || '≈ GTO', nickname }
}

function subtitle(kind: ReportKind, subject: Subject): string {
  const who = subject === 'hero' ? 'your hands' : 'population · excludes you'
  const base = `${who} · ${MIN_BB}bb+`
  return kind === 'rfi' ? `${base} · unopened pots`
    : kind === 'vsrfi' ? `${base} · vs a single ≥${RFI_OPEN_MIN_BB}bb open`
    : kind === 'vs3bet' ? `${base} · open then vs a single ≥${THREEBET_MIN_BB}bb 3-bet`
    : `${base} · limped pot, original limper vs a ≥${ISO_MIN_BB}bb iso`
}

export function buildReport(hands: ParsedHand[], sel: ReportSel, solver?: SolverTable, subject: Subject = 'population'): ReportResult {
  if (sel.type === 'rfi') {
    const r = rfiReport(hands, { position: sel.pos, minBB: MIN_BB, subject })
    return assemble('rfi',
      `${POSITION_NAMES[sel.pos]} RFI`,
      subtitle('rfi', subject),
      r,
      [
        { key: 'raise', label: 'Raise (RFI)', style: STYLE.aggressive, solverIdx: 1 },
        { key: 'limp', label: 'Limp', style: STYLE.passive, solverIdx: 1 }, // limp ≈ raise EV
        { key: 'fold', label: 'Fold', style: STYLE.fold, solverIdx: 0 },
      ],
      solver)
  }
  if (sel.type === 'vsrfi') {
    const r = vsRfiReport(hands, { defender: sel.defender, opener: sel.opener, minBB: MIN_BB, subject })
    return assemble('vsrfi',
      `${POSITION_NAMES[sel.defender]} vs ${POSITION_NAMES[sel.opener]} RFI`,
      subtitle('vsrfi', subject),
      r,
      [
        { key: 'raise', label: '3-Bet', style: STYLE.aggressive, solverIdx: 2 },
        { key: 'call', label: 'Call', style: STYLE.passive, solverIdx: 1 },
        { key: 'fold', label: 'Fold', style: STYLE.fold, solverIdx: 0 },
      ],
      solver)
  }
  if (sel.type === 'limpiso') {
    const r = limpVsIsoReport(hands, { iso: sel.iso, multiway: sel.multiway, minBB: MIN_BB, subject })
    const mw = sel.multiway === 'hu' ? ' · heads-up iso' : sel.multiway === 'multi' ? ' · multiway iso' : ''
    return {
      ...assemble('limpiso',
        `Limp vs ${limpIsoTagLabel(sel.iso)} iso`,
        subtitle('limpiso', subject) + mw,
        r,
        [
          { key: 'raise', label: 'Raise', style: STYLE.aggressive, solverIdx: 2 },
          { key: 'call', label: 'Call', style: STYLE.passive, solverIdx: 1 },
          { key: 'fold', label: 'Fold', style: STYLE.fold, solverIdx: 0 },
        ]),
      solverless: true,
    }
  }
  const r = vs3betReport(hands, { opener: sel.opener, tag: sel.tag, minBB: MIN_BB, subject })
  return assemble('vs3bet',
    `${POSITION_NAMES[sel.opener]} vs ${vs3betTagLabel(sel.tag)} 3-bet`,
    subtitle('vs3bet', subject),
    r,
    [
      { key: 'raise', label: '4-Bet', style: STYLE.aggressive, solverIdx: 2 },
      { key: 'call', label: 'Call', style: STYLE.passive, solverIdx: 1 },
      { key: 'fold', label: 'Fold', style: STYLE.fold, solverIdx: 0 },
    ],
    solver)
}
