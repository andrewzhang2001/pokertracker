import type { ParsedCard, ParsedHand } from '../types'
import { buildHand, type PokerNowEvent, type PokerNowHand } from './pokernowHand'

// ---------------------------------------------------------------------------
// PokerNow CSV log parser (the older export; pokernowJson.ts reads the newer one).
//
// PokerNow exports a game as a CSV of `entry,at,order` rows — one event per row,
// newest first. A hand is the run of events between "-- starting hand #N … --"
// and "-- ending hand #N --". Each hand is read into a PokerNowHand and built by
// pokernowHand.ts.
//
// The log never names the hero on the "Your hand is …" line, so we identify the
// hero across the whole session by matching those hole cards against the named
// "… shows …" reveals at showdown (see detectHero).
// ---------------------------------------------------------------------------

const SUIT: Record<string, ParsedCard['suit']> = { '♥': 'h', '♦': 'd', '♣': 'c', '♠': 's' }

// "10♥" → {rank:'T',suit:'h'}, "K♦" → {rank:'K',suit:'d'}. Ranks are stored as a
// single char (T, not 10) to match the combo/equity tables.
function parseCard(s: string): ParsedCard | null {
  const t = s.trim()
  const suit = SUIT[t.slice(-1)]
  if (!suit) return null
  let rank = t.slice(0, -1)
  if (rank === '10') rank = 'T'
  return { rank, suit }
}

// A comma-separated card list, e.g. "10♥, 9♥" or "K♦, Q♣, 10♣".
function parseCards(s: string): ParsedCard[] {
  return s.split(',').map(parseCard).filter((c): c is ParsedCard => c !== null)
}

const cardKey = (cs: ParsedCard[]) => cs.map(c => c.rank + c.suit).sort().join()

function parseAmt(s: string): number {
  return parseFloat(s.replace(/,/g, ''))
}

// PokerNow game descriptions ("No Limit Texas Hold'em", "Pot Limit Omaha") don't
// contain the bare token "holdem"/"omaha" the rest of the app keys off (the
// apostrophe in "Hold'em" breaks /holdem/i and the ILIKE '%holdem%' filter), so
// canonicalize to Ignition's "HOLDEM No Limit" / "OMAHA Pot Limit" shape.
function normalizeGameType(raw: string): string {
  const family = /hold\s*'?em/i.test(raw) ? 'HOLDEM' : /omaha/i.test(raw) ? 'OMAHA' : raw.trim().toUpperCase()
  const limit = /no[\s-]*limit/i.test(raw) ? 'No Limit' : /pot[\s-]*limit/i.test(raw) ? 'Pot Limit' : /limit/i.test(raw) ? 'Limit' : ''
  return `${family}${limit ? ' ' + limit : ''}`.trim()
}

// ---- CSV ------------------------------------------------------------------

interface Row { entry: string; at: string; order: number; raw: string }

// One CSV record → [entry, at, order]. Handles quoted fields and "" escaping;
// poker log entries never span lines, so a per-line split is safe.
function splitCsvLine(line: string): string[] {
  const out: string[] = []
  let cur = '', inQ = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (inQ) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++ } else inQ = false
      } else cur += c
    } else if (c === '"') inQ = true
    else if (c === ',') { out.push(cur); cur = '' }
    else cur += c
  }
  out.push(cur)
  return out
}

function parseRows(text: string): Row[] {
  const rows: Row[] = []
  for (const line of text.split(/\r?\n/)) {
    if (!line.trim()) continue
    const f = splitCsvLine(line)
    if (f.length < 3) continue
    if (f[0] === 'entry' && f[1] === 'at') continue // header
    const order = Number(f[2])
    if (!Number.isFinite(order)) continue
    rows.push({ entry: f[0], at: f[1], order, raw: line })
  }
  // Newest-first in the file; sort ascending so each hand reads chronologically.
  rows.sort((a, b) => a.order - b.order)
  return rows
}

// ---- Hand blocks ----------------------------------------------------------

interface Block { id: string; gameType: string; dealer: string | undefined; at: string; ended: boolean; lines: string[]; rawLines: string[] }

// The header ends in (dealer: "name"), or (dead button) when no one holds it.
const START = /^-- starting hand #(\d+) \(id: (\w+)\)\s+(.*?)\s*\((?:dealer: "([^"]+)"|dead button)\)/
const END = /^-- ending hand #(\d+)/

function splitBlocks(rows: Row[]): Block[] {
  const blocks: Block[] = []
  let cur: Block | null = null
  for (const r of rows) {
    const s = r.entry.match(START)
    if (s) {
      if (cur) blocks.push(cur)
      cur = { id: s[2], gameType: normalizeGameType(s[3]), dealer: s[4], at: r.at, ended: false, lines: [], rawLines: [r.raw] }
      continue
    }
    // Don't close on the end marker — PokerNow logs voluntary post-fold shows
    // AFTER "-- ending hand #N --" (before the next hand). Keep collecting into
    // this block until the next "starting hand" so those reveals aren't dropped.
    // rawLines keeps every source row (a faithful, re-parseable CSV of this hand);
    // `lines` is just the action entries the parser walks.
    if (cur) {
      cur.rawLines.push(r.raw)
      if (END.test(r.entry)) cur.ended = true
      else cur.lines.push(r.entry)
    }
  }
  if (cur) blocks.push(cur)
  // A hand still in progress when the log was exported has no end marker.
  return blocks.filter(b => b.ended)
}

// ---- Hero detection -------------------------------------------------------

const YOUR_HAND = /^Your hand is (.+?)\.?$/
const SHOWS = /^"([^"]+)"\s+shows? (?:a )?(.+?)\.?$/

// The hero is the account whose hole cards the "Your hand is …" line reveals, but
// that line is nameless. Every hand where the hero reaches showdown also prints
// "<hero> shows <same cards>", so we tally, per player, how often their revealed
// cards equal that hand's "Your hand" — the winner is the hero. Falls back to the
// most-seen player if the hero never showed (small sessions).
//
// Crucially, if the log contains NO "Your hand is …" line at all, the exporter
// wasn't seated (e.g. a railed/observed table) — there is no hero, so we return
// null and mark no seat as `isMe`, rather than forcing the most-seen villain in.
function detectHero(blocks: Block[]): string | null {
  const votes = new Map<string, number>()
  const seen = new Map<string, number>()
  let sawHeroHand = false
  for (const b of blocks) {
    let hero: string | null = null
    for (const line of b.lines) {
      const yh = line.match(YOUR_HAND)
      if (yh) { hero = cardKey(parseCards(yh[1])); sawHeroHand = true; continue }
      const nameM = line.match(/^"([^"]+)"/)
      if (nameM) seen.set(nameM[1], (seen.get(nameM[1]) ?? 0) + 1)
    }
    if (!hero) continue
    for (const line of b.lines) {
      const sh = line.match(SHOWS)
      if (sh && cardKey(parseCards(sh[2])) === hero) votes.set(sh[1], (votes.get(sh[1]) ?? 0) + 1)
    }
  }
  if (!sawHeroHand) return null
  const pick = (m: Map<string, number>) => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  return pick(votes) ?? pick(seen)
}

// ---- One hand -------------------------------------------------------------

const STACKS = /^Player stacks: (.+)$/
const SEAT = /#(\d+) "([^"]+)" \(([\d.,]+)\)/g
const POST = /^"([^"]+)"\s+posts an? (ante|small blind|big blind|straddle|missing small blind|missed big blind) of ([\d.,]+)/
const ACTION = /^"([^"]+)"\s+(.+)$/
const UNCALLED = /^Uncalled bet of ([\d.,]+) returned to "([^"]+)"/
const BOARD: ['flop' | 'turn' | 'river', RegExp][] = [
  ['flop', /^Flop:.*\[([^\]]+)\]/],
  ['turn', /^Turn:.*\[([^\]]+)\]/],
  ['river', /^River:.*\[([^\]]+)\]/],
]
const BLIND_KIND: Record<string, 'small' | 'big'> = { 'small blind': 'small', 'big blind': 'big' }

// One log entry → the normalized event it describes, or null for lines that
// carry no action (shows, "Your hand", stacks, chat, …).
function lineEvent(line: string, nameToSeat: Map<string, number>): PokerNowEvent | null {
  const pm = line.match(POST)
  if (pm) {
    const seat = nameToSeat.get(pm[1])
    if (seat === undefined) return null
    const amount = parseAmt(pm[3])
    if (pm[2] === 'ante') return { kind: 'dead', seat, amount, what: 'ante' }
    if (pm[2] === 'missing small blind') return { kind: 'dead', seat, amount, what: 'small blind' }
    return { kind: 'post', seat, amount, blind: BLIND_KIND[pm[2]] ?? 'other' }
  }
  for (const [street, re] of BOARD) {
    const bm = line.match(re)
    if (bm) return { kind: 'board', street, cards: parseCards(bm[1]), label: bm[1] }
  }
  const unc = line.match(UNCALLED)
  if (unc) {
    const seat = nameToSeat.get(unc[2])
    return seat === undefined ? null : { kind: 'uncalled', seat, amount: parseAmt(unc[1]) }
  }

  const am = line.match(ACTION)
  if (!am) return null
  const seat = nameToSeat.get(am[1])
  if (seat === undefined) return null
  const act = am[2]
  const allin = /\ball[\s-]?in\b/i.test(act)
  if (/^folds/.test(act)) return { kind: 'fold', seat }
  if (/^checks/.test(act)) return { kind: 'check', seat }
  const callM = act.match(/^calls ([\d.,]+)/)
  if (callM) return { kind: 'call', seat, level: parseAmt(callM[1]), allin }
  const betM = act.match(/^bets ([\d.,]+)/)
  if (betM) return { kind: 'bet', seat, amount: parseAmt(betM[1]), allin }
  const raiseM = act.match(/^raises to ([\d.,]+)/)
  if (raiseM) return { kind: 'raise', seat, total: parseAmt(raiseM[1]), allin }
  const collM = act.match(/^collected ([\d.,]+) from pot/)
  if (collM) return { kind: 'collect', seat, amount: parseAmt(collM[1]) }
  return null
}

function readHand(block: Block, heroName: string | null): PokerNowHand | null {
  // Seats + starting stacks (pre-blind), from the "Player stacks:" line.
  const stacksLine = block.lines.find(l => STACKS.test(l))
  if (!stacksLine) return null
  const seats = [...stacksLine.match(STACKS)![1].matchAll(SEAT)].map(m => ({ seat: parseInt(m[1]), sourceName: m[2], stack: parseAmt(m[3]) }))
  if (!seats.length) return null
  const nameToSeat = new Map(seats.map(s => [s.sourceName, s.seat]))
  const heroSeat = heroName !== null ? nameToSeat.get(heroName) : undefined

  const yourHand = block.lines.map(l => l.match(YOUR_HAND)).find(Boolean)
  const shown = new Map<number, ParsedCard[]>()
  for (const line of block.lines) {
    const sh = line.match(SHOWS)
    if (!sh) continue
    const seat = nameToSeat.get(sh[1])
    if (seat === undefined || seat === heroSeat || shown.has(seat)) continue
    const cards = parseCards(sh[2])
    if (cards.length) shown.set(seat, cards)
  }

  return {
    id: block.id,
    gameType: block.gameType,
    at: block.at,
    seats,
    dealerSeat: block.dealer === undefined ? undefined : nameToSeat.get(block.dealer),
    heroSeat,
    heroCards: yourHand ? parseCards(yourHand[1]) : undefined,
    shown,
    events: block.lines.map(l => lineEvent(l, nameToSeat)).filter((e): e is PokerNowEvent => e !== null),
    // Faithful source slice for this hand (with a CSV header), so raw_text stays
    // a lossless, re-parseable record — the basis for clean future backfills.
    rawText: `entry,at,order\n${block.rawLines.join('\n')}`,
  }
}

export function detect(text: string): boolean {
  return /^entry,at,order/m.test(text) || /-- starting hand #\d+ \(id: \w+\)/.test(text)
}

export function parse(text: string): ParsedHand[] {
  const blocks = splitBlocks(parseRows(text))
  if (!blocks.length) return []
  const hero = detectHero(blocks)
  return blocks.map(b => readHand(b, hero)).filter((h): h is PokerNowHand => h !== null).map(buildHand)
}

export function diagnose(text: string): string {
  const rows = parseRows(text)
  if (!rows.length) return 'No CSV rows found. Export the PokerNow game log as CSV (entry,at,order).'
  const blocks = splitBlocks(rows)
  if (!blocks.length) return 'No "-- starting hand #… --" markers found. This does not look like a PokerNow log export.'
  const withStacks = blocks.filter(b => b.lines.some(l => STACKS.test(l)))
  if (!withStacks.length) return `Found ${blocks.length} hand blocks but none had a "Player stacks:" line to read seats from.`
  return `Found ${blocks.length} hands but all failed an unknown parse step.`
}

export default { name: 'PokerNow (CSV)', detect, parse, diagnose }
