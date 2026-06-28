import type { ParsedCard, ParsedHand, PlayerInfo, HandAction, Street } from '../types'

function parseCard(s: string): ParsedCard {
  return { rank: s.slice(0, -1), suit: s.slice(-1) as ParsedCard['suit'] }
}

function parseCards(s: string): ParsedCard[] {
  return s.trim().split(/\s+/).filter(Boolean).map(parseCard)
}

function normalizeName(s: string): string {
  return s.replace(/\[ME\]/g, '').replace(/\s+/g, ' ').trim()
}

function parseAmt(s: string): number {
  return parseFloat(s.replace(/,/g, ''))
}

// Ignition prints a wall-clock time with no timezone (e.g. "2026-06-24 19:21:58")
// in US Eastern Time. We convert ET -> UTC epoch ms, handling EDT/EST (DST)
// automatically via the IANA tz database (deterministic across machines, no lib).
const ET_ZONE = 'America/New_York'
const etFormatter = new Intl.DateTimeFormat('en-US', {
  timeZone: ET_ZONE, hourCycle: 'h23',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
})

function parsePlayedAt(date: string): number | null {
  const m = date.match(/(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})/)
  if (!m) return null
  const [, y, mo, d, h, mi, s] = m.map(Number) as unknown as number[]
  // Interpret the wall-clock as if it were UTC, see what ET clock that instant
  // shows, and correct by the resulting offset (covers both EDT and EST).
  const guess = Date.UTC(y, mo - 1, d, h, mi, s)
  const parts = etFormatter.formatToParts(new Date(guess))
  const get = (t: string) => Number(parts.find(p => p.type === t)?.value)
  const asET = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
  return guess - (asET - guess) // guess - offset, where offset = asET - guess (negative for ET)
}

function bb(amount: number, bigBlind: number): string {
  const v = amount / bigBlind
  return (Number.isInteger(v) ? v : parseFloat(v.toFixed(2))) + 'bb'
}

const NOISE = /^(Table enter|Table leave|Seat stand|Seat sit|Seat re-join|Re-join|Sit out|Table deposit|Draw for dealer|Set dealer)/

function parseActionLine(
  line: string,
  street: Street,
  players: PlayerInfo[],
  bigBlind: number,
): HandAction | null {
  const ci = line.indexOf(' : ')
  if (ci === -1) return null
  const playerPart = normalizeName(line.slice(0, ci))
  const act = line.slice(ci + 3).trim()
  const player = players.find(p => normalizeName(p.position) === playerPart)
  const sn = player?.seatNumber
  const name = player?.position ?? playerPart

  if (NOISE.test(act)) return null

  const A = (type: HandAction['type'], amount?: number, cards?: ParsedCard[], desc?: string): HandAction =>
    ({ type, seatNumber: sn, amount, cards, street, desc: desc ?? '' })

  const retM = act.match(/^Return uncalled portion of bet \$?([\d,.]+)/)
  if (retM) return A('return_bet', parseAmt(retM[1]), undefined, `${name} uncalled bet returned`)

  const anteM = act.match(/^Ante chip \$?([\d,.]+)/i)
  if (anteM) return A('post_ante', parseAmt(anteM[1]), undefined, `${name} ante ${bb(parseAmt(anteM[1]), bigBlind)}`)

  const postM = act.match(/^Posts chip \$?([\d,.]+)/i)
  if (postM) return A('post_blind', parseAmt(postM[1]), undefined, `${name} posts ${bb(parseAmt(postM[1]), bigBlind)}`)

  const sbM = act.match(/^Small blind \$?([\d,.]+)/i)
  if (sbM) return A('post_blind', parseAmt(sbM[1]), undefined, `${name} posts SB ${bb(parseAmt(sbM[1]), bigBlind)}`)

  const bbM = act.match(/^Big blind \$?([\d,.]+)/i)
  if (bbM) return A('post_blind', parseAmt(bbM[1]), undefined, `${name} posts BB ${bb(parseAmt(bbM[1]), bigBlind)}`)

  const cardsM = act.match(/^Card dealt to a spot \[([^\]]+)\]/)
  if (cardsM) return A('deal_hole', undefined, parseCards(cardsM[1]), `${name} dealt cards`)

  if (/^Fold/.test(act)) return A('fold', undefined, undefined, `${name} folds`)

  if (/^Checks?/.test(act)) return A('check', undefined, undefined, `${name} checks`)

  const callM = act.match(/^Calls? \$?([\d,.]+)/i)
  if (callM) {
    const amt = parseAmt(callM[1])
    return A('call', amt, undefined, `${name} calls ${bb(amt, bigBlind)}`)
  }

  const raiseM = act.match(/[Rr]aises? \$?([\d,.]+) to \$?([\d,.]+)/) ?? act.match(/^All-in\([^)]+\) \$?([\d,.]+) to \$?([\d,.]+)/)
  if (raiseM) {
    const total = parseAmt(raiseM[2])
    return A('raise', total, undefined, `${name} raises to ${bb(total, bigBlind)}`)
  }
  const raiseSimM = act.match(/^[Rr]aises? \$?([\d,.]+)$/)
  if (raiseSimM) {
    const total = parseAmt(raiseSimM[1])
    return A('raise', total, undefined, `${name} raises to ${bb(total, bigBlind)}`)
  }

  const betM = act.match(/^Bets? (?:chip info\([^)]+\) )?\$?([\d,.]+)/)
  if (betM) {
    const amt = parseAmt(betM[1])
    return A('bet', amt, undefined, `${name} bets ${bb(amt, bigBlind)}`)
  }

  const allinM = act.match(/^All-in \$?([\d,.]+)/)
  if (allinM) {
    const amt = parseAmt(allinM[1])
    return A('allin', amt, undefined, `${name} all-in ${bb(amt, bigBlind)}`)
  }

  // Showdown shows the 5-card best hand in Ignition (not just hole cards).
  // We still parse it but computeHandState ignores the cards — hole cards
  // are already set from deal_hole and we never want to overwrite them.
  const showM = act.match(/^Showdown \[([^\]]+)\]\s*\(([^)]+)\)/)
  if (showM) {
    const raw = showM[1]
    const holeStr = raw.includes('-') ? raw.split('-')[0] : raw
    return A('showdown', undefined, parseCards(holeStr), `${name} shows ${showM[2]}`)
  }

  const muckM = act.match(/^(?:Does not show|Mucks) \[([^\]]+)\]/)
  if (muckM) return A('doesnotshow', undefined, parseCards(muckM[1]), `${name} mucks`)

  const resultM = act.match(/^Hand [Rr]esult \$?([\d,.]+)/)
  if (resultM) {
    const amt = parseAmt(resultM[1])
    return A('result', amt, undefined, `${name} wins ${bb(amt, bigBlind)}`)
  }

  return null
}

function parseHand(text: string): ParsedHand | null {
  const lines = text.split('\n').map(l => l.trim()).filter(Boolean)
  if (!lines.length) return null

  const headerM = lines[0].match(/Ignition Hand #(\d+).*?-\s*(.+)$/)
  if (!headerM) return null
  const handId = headerM[1]
  const date = headerM[2].trim()
  const tableId = lines[0].match(/TBL#(\d+)/)?.[1] ?? ''

  // "Ignition Hand #ID TBL#TID GAME TYPE - date"
  const gameTypeM = lines[0].match(/TBL#\w+ (.+?) - \d{4}-\d{2}-\d{2}/)
  const gameType = gameTypeM ? gameTypeM[1].trim() : ''
  const playedAt = parsePlayedAt(date)

  const players: PlayerInfo[] = []
  let i = 1
  while (i < lines.length) {
    const m = lines[i].match(/^Seat (\d+): (.+?)(\s+\[ME\])?\s+\(\$?([\d,.]+) in chips\)/)
    if (!m) break
    players.push({
      seatNumber: parseInt(m[1]),
      position: m[2].trim(),
      isMe: !!m[3],
      startingStack: parseAmt(m[4]),
    })
    i++
  }
  if (!players.length) return null

  let bigBlind = 1
  let smallBlind = 0
  for (let j = i; j < lines.length; j++) {
    const ci = lines[j].indexOf(' : ')
    if (ci === -1) continue
    const actionText = lines[j].slice(ci + 3).trim()
    const sbm = actionText.match(/^Small blind \$?([\d,.]+)/i)
    if (sbm) smallBlind = parseAmt(sbm[1])
    // SB is posted before BB, so by the time we hit BB we have both.
    const bbm = actionText.match(/^Big blind \$?([\d,.]+)/i)
    if (bbm) { bigBlind = parseAmt(bbm[1]); break }
  }

  let currentStreet: Street = 'preflop'
  const actions: HandAction[] = []
  let totalPot: number | undefined

  for (; i < lines.length; i++) {
    const line = lines[i]

    if (/^\*\*\* SUMMARY \*\*\*/.test(line)) continue
    const potM = line.match(/^Total Pot\(\$?([\d,.]+)\)/)
    if (potM) { totalPot = parseAmt(potM[1]); continue }
    if (/^(Total Pot|Board |Seat\+)/.test(line)) continue
    if (line === '*** HOLE CARDS ***') continue

    const flopM = line.match(/^\*\*\* FLOP \*\*\* \[([^\]]+)\]/)
    if (flopM) {
      currentStreet = 'flop'
      actions.push({ type: 'deal_flop', cards: parseCards(flopM[1]), street: 'flop', desc: `Flop [${flopM[1]}]` })
      continue
    }
    const turnM = line.match(/^\*\*\* TURN \*\*\* \[[^\]]+\] \[([^\]]+)\]/)
    if (turnM) {
      currentStreet = 'turn'
      actions.push({ type: 'deal_turn', cards: parseCards(turnM[1]), street: 'turn', desc: `Turn [${turnM[1]}]` })
      continue
    }
    const riverM = line.match(/^\*\*\* RIVER \*\*\* \[[^\]]+\] \[([^\]]+)\]/)
    if (riverM) {
      currentStreet = 'river'
      actions.push({ type: 'deal_river', cards: parseCards(riverM[1]), street: 'river', desc: `River [${riverM[1]}]` })
      continue
    }

    const action = parseActionLine(line, currentStreet, players, bigBlind)
    if (action) actions.push(action)
  }

  let initialStep = -1
  for (let k = actions.length - 1; k >= 0; k--) {
    if (actions[k].type === 'deal_hole') { initialStep = k; break }
  }

  return {
    handId, tableId, site: 'ignition', date, playedAt, gameType, currency: 'USD',
    players, smallBlind, bigBlind, actions, initialStep, rawText: text, totalPot,
  }
}

export function detect(text: string): boolean {
  return /Ignition Hand #\d+/.test(text)
}

export function parse(text: string): ParsedHand[] {
  const chunks = text.split(/(?=Ignition Hand #\d+)/).filter(s => s.trim())
  return chunks.map(parseHand).filter((h): h is ParsedHand => h !== null)
}

export function diagnose(text: string): string {
  const chunks = text.split(/(?=Ignition Hand #\d+)/).filter(s => s.trim())
  if (!chunks.length) return 'No "Ignition Hand #" headers found. Make sure this is from Ignition/Bovada (NLHE and PLO supported).'

  let failed = 0
  const reasons: string[] = []
  for (const chunk of chunks.slice(0, 3)) {
    const lines = chunk.split('\n').map(l => l.trim()).filter(Boolean)
    const header = lines[0]?.match(/Ignition Hand #(\d+).*?-\s*(.+)$/)
    if (!header) { failed++; reasons.push(`Unrecognized header: "${lines[0]?.slice(0, 60)}"`) ; continue }

    let hasSeats = false
    for (const l of lines.slice(1, 15)) {
      if (/^Seat \d+:/.test(l)) { hasSeats = true; break }
    }
    if (!hasSeats) { failed++; reasons.push('No seat lines found after header') }
  }

  if (failed === 0) return `Found ${chunks.length} hands but all failed an unknown parse step.`
  return reasons[0] ?? `Found ${chunks.length} hand chunks but failed to parse them.`
}

export default { name: 'Ignition/Bovada', detect, parse, diagnose }
