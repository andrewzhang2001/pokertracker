import type { ParsedCard, ParsedHand, PlayerInfo, HandAction, Street } from '../types'

// ---------------------------------------------------------------------------
// PokerNow CSV log parser.
//
// PokerNow exports a game as a CSV of `entry,at,order` rows — one event per row,
// newest first. A hand is the run of events between "-- starting hand #N … --"
// and "-- ending hand #N --". Amounts are the *total* level a player is at (a
// call says the amount matched-to, a raise says "raises to X"), unlike the
// additional-chips convention Ignition uses; we convert calls to the additional
// amount so computeHandState's stack math stays correct.
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

function bb(amount: number, bigBlind: number): string {
  const v = amount / bigBlind
  return (Number.isInteger(v) ? v : parseFloat(v.toFixed(2))) + 'bb'
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

interface Block { id: string; gameType: string; dealer: string; at: string; lines: string[]; rawLines: string[] }

const START = /^-- starting hand #(\d+) \(id: (\w+)\)\s+(.*?)\s*\(dealer: "([^"]+)"\)/
const END = /^-- ending hand #(\d+)/

function splitBlocks(rows: Row[]): Block[] {
  const blocks: Block[] = []
  let cur: Block | null = null
  for (const r of rows) {
    const s = r.entry.match(START)
    if (s) {
      if (cur) blocks.push(cur)
      cur = { id: s[2], gameType: normalizeGameType(s[3]), dealer: s[4], at: r.at, lines: [], rawLines: [r.raw] }
      continue
    }
    // Don't close on the end marker — PokerNow logs voluntary post-fold shows
    // AFTER "-- ending hand #N --" (before the next hand). Keep collecting into
    // this block until the next "starting hand" so those reveals aren't dropped.
    // rawLines keeps every source row (a faithful, re-parseable CSV of this hand);
    // `lines` is just the action entries the parser walks.
    if (cur) {
      cur.rawLines.push(r.raw)
      if (!END.test(r.entry)) cur.lines.push(r.entry)
    }
  }
  if (cur) blocks.push(cur)
  return blocks
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

// ---- Positions ------------------------------------------------------------

// Seat labels in the app's vocabulary (see positionUtils). Play proceeds from the
// seat after the button: SB, BB, UTG, …. Heads-up the button *is* the SB.
function assignPositions(seats: number[], dealerSeat: number): Map<number, string> {
  const m = new Map<number, string>()
  const n = seats.length
  const bi = seats.indexOf(dealerSeat)
  if (n === 2) {
    m.set(dealerSeat, 'Small Blind')
    m.set(seats[(bi + 1) % 2], 'Big Blind')
    return m
  }
  const labels = ['Small Blind', 'Big Blind', 'UTG', 'UTG+1', 'UTG+2', 'UTG+3', 'UTG+4', 'UTG+5']
  m.set(dealerSeat, 'Dealer')
  for (let k = 1; k < n; k++) m.set(seats[(bi + k) % n], labels[k - 1] ?? `UTG+${k - 3}`)
  return m
}

// ---- One hand -------------------------------------------------------------

const STACKS = /^Player stacks: (.+)$/
const SEAT = /#(\d+) "([^"]+)" \(([\d.,]+)\)/g
const POST = /^"([^"]+)"\s+posts a (small blind|big blind|straddle|missing small blind|missed big blind) of ([\d.,]+)/
const ACTION = /^"([^"]+)"\s+(.+)$/
const UNCALLED = /^Uncalled bet of ([\d.,]+) returned to "([^"]+)"/
const FLOP = /^Flop:.*\[([^\]]+)\]/
const TURN = /^Turn:.*\[([^\]]+)\]/
const RIVER = /^River:.*\[([^\]]+)\]/

function parseHand(block: Block, heroName: string | null): ParsedHand | null {
  // Seats + starting stacks (pre-blind), from the "Player stacks:" line.
  const stacksLine = block.lines.find(l => STACKS.test(l))
  if (!stacksLine) return null
  const nameToSeat = new Map<string, number>()
  const seatName = new Map<number, string>()
  const seatStack = new Map<number, number>()
  for (const m of stacksLine.match(STACKS)![1].matchAll(SEAT)) {
    const seat = parseInt(m[1])
    nameToSeat.set(m[2], seat)
    seatName.set(seat, m[2])
    seatStack.set(seat, parseAmt(m[3]))
  }
  if (!nameToSeat.size) return null

  const seats = [...seatStack.keys()].sort((a, b) => a - b)
  const dealerSeat = nameToSeat.get(block.dealer)
  const posOf = dealerSeat !== undefined ? assignPositions(seats, dealerSeat) : new Map<number, string>()

  const players: PlayerInfo[] = seats.map(seat => ({
    seatNumber: seat,
    position: posOf.get(seat) ?? String(seat),
    isMe: heroName !== null && nameToSeat.get(heroName) === seat,
    startingStack: seatStack.get(seat)!,
    sourceName: seatName.get(seat),
  }))
  const heroSeat = heroName !== null ? nameToSeat.get(heroName) : undefined

  // Blind/straddle posts drive the blind levels and open the preflop street.
  let smallBlind = 0, bigBlind = 1
  const posts: { seat: number; amount: number }[] = []
  for (const line of block.lines) {
    const pm = line.match(POST)
    if (!pm) continue
    const seat = nameToSeat.get(pm[1])
    if (seat === undefined) continue
    const amt = parseAmt(pm[3])
    if (pm[2] === 'small blind') smallBlind = amt
    else if (pm[2] === 'big blind') bigBlind = amt
    posts.push({ seat, amount: amt })
  }

  const actions: HandAction[] = []
  // streetBet tracks each seat's committed chips on the current street, so a
  // "call to X" can be converted to the additional X − committed that
  // computeHandState expects. Reset on every street.
  const streetBet = new Map<number, number>()
  let street: Street = 'preflop'
  const nameOf = (seat: number) => players.find(p => p.seatNumber === seat)?.position ?? String(seat)

  // 1) Blinds first, then 2) hero's hole cards — so the replayer opens with the
  // blinds already in the pot (matching the Ignition parser), regardless of where
  // the nameless "Your hand" line fell in the raw order.
  for (const { seat, amount } of posts) {
    streetBet.set(seat, (streetBet.get(seat) ?? 0) + amount)
    actions.push({ type: 'post_blind', seatNumber: seat, amount, street: 'preflop', desc: `${nameOf(seat)} posts ${bb(amount, bigBlind)}` })
  }

  // Hole cards known up front: the hero's (from "Your hand") plus any villain who
  // shows at showdown. Emitted at preflop so the replayer's "opponent cards"
  // toggle can reveal a shown hand for its whole replay, not just the last street
  // (a shown villain never folded, so this can't leak folded holdings).
  const yourHand = block.lines.map(l => l.match(YOUR_HAND)).find(Boolean)
  if (yourHand && heroSeat !== undefined) {
    actions.push({ type: 'deal_hole', seatNumber: heroSeat, cards: parseCards(yourHand[1]), street: 'preflop', desc: `${nameOf(heroSeat)} dealt cards` })
  }
  const shown = new Map<number, ParsedCard[]>()
  for (const line of block.lines) {
    const sh = line.match(SHOWS)
    if (!sh) continue
    const seat = nameToSeat.get(sh[1])
    if (seat === undefined || seat === heroSeat || shown.has(seat)) continue
    const cards = parseCards(sh[2])
    if (cards.length) shown.set(seat, cards)
  }
  for (const [seat, cards] of shown) {
    actions.push({ type: 'deal_hole', seatNumber: seat, cards, street: 'preflop', desc: `${nameOf(seat)} shows` })
  }
  let initialStep = actions.length - 1

  // 3) The rest of the hand, in order: board cards, bets, shows, wins.
  for (const line of block.lines) {
    if (POST.test(line) || YOUR_HAND.test(line) || STACKS.test(line)) continue

    const flopM = line.match(FLOP)
    if (flopM) { street = 'flop'; streetBet.clear(); actions.push({ type: 'deal_flop', cards: parseCards(flopM[1]), street, desc: `Flop [${flopM[1]}]` }); continue }
    const turnM = line.match(TURN)
    if (turnM) { street = 'turn'; streetBet.clear(); actions.push({ type: 'deal_turn', cards: parseCards(turnM[1]), street, desc: `Turn [${turnM[1]}]` }); continue }
    const riverM = line.match(RIVER)
    if (riverM) { street = 'river'; streetBet.clear(); actions.push({ type: 'deal_river', cards: parseCards(riverM[1]), street, desc: `River [${riverM[1]}]` }); continue }

    const unc = line.match(UNCALLED)
    if (unc) {
      const seat = nameToSeat.get(unc[2])
      if (seat !== undefined) {
        const amt = parseAmt(unc[1])
        streetBet.set(seat, (streetBet.get(seat) ?? 0) - amt)
        actions.push({ type: 'return_bet', seatNumber: seat, amount: amt, street, desc: `${nameOf(seat)} uncalled bet returned` })
      }
      continue
    }

    const am = line.match(ACTION)
    if (!am) continue
    const seat = nameToSeat.get(am[1])
    if (seat === undefined) continue
    const act = am[2]
    const allin = /\ball[\s-]?in\b/i.test(act)
    const cur = streetBet.get(seat) ?? 0

    if (/^folds/.test(act)) { actions.push({ type: 'fold', seatNumber: seat, street, desc: `${nameOf(seat)} folds` }); continue }
    if (/^checks/.test(act)) { actions.push({ type: 'check', seatNumber: seat, street, desc: `${nameOf(seat)} checks` }); continue }

    const callM = act.match(/^calls ([\d.,]+)/)
    if (callM) {
      const level = parseAmt(callM[1])          // total matched-to
      const additional = Math.max(0, level - cur)
      streetBet.set(seat, level)
      actions.push({ type: allin ? 'allin' : 'call', seatNumber: seat, amount: allin ? level : additional, street, desc: `${nameOf(seat)} ${allin ? 'all-in' : 'calls'} ${bb(level, bigBlind)}` })
      continue
    }
    const betM = act.match(/^bets ([\d.,]+)/)
    if (betM) {
      const amt = parseAmt(betM[1])
      streetBet.set(seat, cur + amt)
      actions.push({ type: allin ? 'allin' : 'bet', seatNumber: seat, amount: allin ? cur + amt : amt, street, desc: `${nameOf(seat)} ${allin ? 'all-in' : 'bets'} ${bb(amt, bigBlind)}` })
      continue
    }
    const raiseM = act.match(/^raises to ([\d.,]+)/)
    if (raiseM) {
      const total = parseAmt(raiseM[1])
      streetBet.set(seat, total)
      actions.push({ type: allin ? 'allin' : 'raise', seatNumber: seat, amount: total, street, desc: `${nameOf(seat)} ${allin ? 'all-in' : 'raises'} ${bb(total, bigBlind)}` })
      continue
    }
    if (/^shows?\b/.test(act)) continue // hole cards already emitted at preflop
    const collM = act.match(/^collected ([\d.,]+) from pot/)
    if (collM) {
      const amt = parseAmt(collM[1])
      actions.push({ type: 'result', seatNumber: seat, amount: amt, street, desc: `${nameOf(seat)} wins ${bb(amt, bigBlind)}` })
      continue
    }
  }

  return {
    handId: block.id,
    tableId: '',
    site: 'pokernow',
    date: block.at,
    playedAt: Number.isFinite(Date.parse(block.at)) ? Date.parse(block.at) : null,
    gameType: block.gameType,
    currency: 'USD',
    players,
    smallBlind,
    bigBlind,
    actions,
    initialStep,
    // Faithful source slice for this hand (with a CSV header), so raw_text stays
    // a lossless, re-parseable record — the basis for clean future backfills.
    rawText: `entry,at,order\n${block.rawLines.join('\n')}`,
    // No rake in PokerNow home games — leaving totalPot undefined yields rake 0.
  }
}

export function detect(text: string): boolean {
  return /^entry,at,order/m.test(text) || /-- starting hand #\d+ \(id: \w+\)/.test(text)
}

export function parse(text: string): ParsedHand[] {
  const blocks = splitBlocks(parseRows(text))
  if (!blocks.length) return []
  const hero = detectHero(blocks)
  return blocks.map(b => parseHand(b, hero)).filter((h): h is ParsedHand => h !== null)
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

export default { name: 'PokerNow', detect, parse, diagnose }
