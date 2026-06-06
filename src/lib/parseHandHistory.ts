import type { ParsedCard, ParsedHand, PlayerInfo, HandAction, Street } from './types'

function parseCard(s: string): ParsedCard {
  return { rank: s.slice(0, -1), suit: s.slice(-1) as ParsedCard['suit'] }
}

function parseCards(s: string): ParsedCard[] {
  return s.trim().split(/\s+/).filter(Boolean).map(parseCard)
}

function normalizeName(s: string): string {
  return s.replace(/\[ME\]/g, '').replace(/\s+/g, ' ').trim()
}

function bb(amount: number, bigBlind: number): string {
  const v = amount / bigBlind
  return (Number.isInteger(v) ? v : parseFloat(v.toFixed(2))) + 'bb'
}

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

  // Noise
  if (/^(Table enter|Table leave|Seat stand|Seat sit|Seat re-join|Table deposit|Draw for dealer|Set dealer|Return uncalled)/.test(act)) {
    // Handle return separately below
    if (!act.startsWith('Return uncalled')) return null
  }

  const A = (type: HandAction['type'], amount?: number, cards?: ParsedCard[], desc?: string): HandAction =>
    ({ type, seatNumber: sn, amount, cards, street, desc: desc ?? '' })

  // Return uncalled bet
  const retM = act.match(/^Return uncalled portion of bet \$?([\d.]+)/)
  if (retM) return A('return_bet', parseFloat(retM[1]), undefined, `${name} uncalled bet returned`)

  // Ante
  const anteM = act.match(/^(?:Ante chip|Posts chip) \$?([\d.]+)/i)
  if (anteM) return A('post_ante', parseFloat(anteM[1]), undefined, `${name} ante ${bb(parseFloat(anteM[1]), bigBlind)}`)

  // Small blind
  const sbM = act.match(/^Small blind \$?([\d.]+)/i)
  if (sbM) return A('post_blind', parseFloat(sbM[1]), undefined, `${name} posts SB ${bb(parseFloat(sbM[1]), bigBlind)}`)

  // Big blind
  const bbM = act.match(/^Big blind \$?([\d.]+)/i)
  if (bbM) return A('post_blind', parseFloat(bbM[1]), undefined, `${name} posts BB ${bb(parseFloat(bbM[1]), bigBlind)}`)

  // Hole cards
  const cardsM = act.match(/^Card dealt to a spot \[([^\]]+)\]/)
  if (cardsM) return A('deal_hole', undefined, parseCards(cardsM[1]), `${name} dealt cards`)

  // Fold
  if (/^Fold/.test(act)) return A('fold', undefined, undefined, `${name} folds`)

  // Check
  if (/^Checks/.test(act)) return A('check', undefined, undefined, `${name} checks`)

  // Call
  const callM = act.match(/^Calls \$?([\d.]+)/i)
  if (callM) {
    const amt = parseFloat(callM[1])
    return A('call', amt, undefined, `${name} calls ${bb(amt, bigBlind)}`)
  }

  // Raise X to Y
  const raiseM = act.match(/[Rr]aises \$?([\d.]+) to \$?([\d.]+)/)
  if (raiseM) {
    const total = parseFloat(raiseM[2])
    return A('raise', total, undefined, `${name} raises to ${bb(total, bigBlind)}`)
  }
  // Raise X (no "to")
  const raiseSimM = act.match(/^[Rr]aises \$?([\d.]+)$/)
  if (raiseSimM) {
    const total = parseFloat(raiseSimM[1])
    return A('raise', total, undefined, `${name} raises to ${bb(total, bigBlind)}`)
  }

  // Bet
  const betM = act.match(/^Bets \$?([\d.]+)/)
  if (betM) {
    const amt = parseFloat(betM[1])
    return A('bet', amt, undefined, `${name} bets ${bb(amt, bigBlind)}`)
  }

  // All-in
  const allinM = act.match(/^All-in \$?([\d.]+)/)
  if (allinM) {
    const amt = parseFloat(allinM[1])
    return A('allin', amt, undefined, `${name} all-in ${bb(amt, bigBlind)}`)
  }

  // Showdown: may show 5-card combo; hole cards are first 2 separated by '-'
  const showM = act.match(/^Showdown \[([^\]]+)\]\s*\(([^)]+)\)/)
  if (showM) {
    const raw = showM[1]
    const holeStr = raw.includes('-') ? raw.split('-')[0] : raw
    return A('showdown', undefined, parseCards(holeStr), `${name} shows ${showM[2]}`)
  }

  // Does not show
  const muckM = act.match(/^Does not show \[([^\]]+)\]/)
  if (muckM) return A('doesnotshow', undefined, parseCards(muckM[1]), `${name} mucks`)

  // Hand result (case-insensitive)
  const resultM = act.match(/^Hand [Rr]esult \$?([\d.]+)/)
  if (resultM) {
    const amt = parseFloat(resultM[1])
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

  const players: PlayerInfo[] = []
  let i = 1
  while (i < lines.length) {
    const m = lines[i].match(/^Seat (\d+): (.+?)(\s+\[ME\])?\s+\(\$?([\d.]+) in chips\)/)
    if (!m) break
    players.push({
      seatNumber: parseInt(m[1]),
      position: m[2].trim(),
      isMe: !!m[3],
      startingStack: parseFloat(m[4]),
    })
    i++
  }
  if (!players.length) return null

  // Determine BB from the big blind posting line
  let bigBlind = 1
  for (let j = i; j < lines.length; j++) {
    const m = lines[j].match(/Big blind[^\d]*\$?([\d.]+)/i)
    if (m) { bigBlind = parseFloat(m[1]); break }
  }

  let currentStreet: Street = 'preflop'
  const actions: HandAction[] = []

  for (; i < lines.length; i++) {
    const line = lines[i]

    if (/^\*\*\* SUMMARY \*\*\*/.test(line)) continue
    if (/^(Total Pot|Board |Seat\+)/.test(line)) continue
    if (line === '*** HOLE CARDS ***') continue

    const flopM = line.match(/^\*\*\* FLOP \*\*\* \[([^\]]+)\]/)
    if (flopM) {
      currentStreet = 'flop'
      actions.push({ type: 'deal_flop', cards: parseCards(flopM[1]), street: 'flop', desc: `Flop  [${flopM[1]}]` })
      continue
    }
    const turnM = line.match(/^\*\*\* TURN \*\*\* \[[^\]]+\] \[([^\]]+)\]/)
    if (turnM) {
      currentStreet = 'turn'
      actions.push({ type: 'deal_turn', cards: parseCards(turnM[1]), street: 'turn', desc: `Turn  [${turnM[1]}]` })
      continue
    }
    const riverM = line.match(/^\*\*\* RIVER \*\*\* \[[^\]]+\] \[([^\]]+)\]/)
    if (riverM) {
      currentStreet = 'river'
      actions.push({ type: 'deal_river', cards: parseCards(riverM[1]), street: 'river', desc: `River  [${riverM[1]}]` })
      continue
    }

    const action = parseActionLine(line, currentStreet, players, bigBlind)
    if (action) actions.push(action)
  }

  // Default starting step: after the last deal_hole so all cards are visible
  let initialStep = -1
  for (let k = actions.length - 1; k >= 0; k--) {
    if (actions[k].type === 'deal_hole') { initialStep = k; break }
  }

  return { handId, tableId, date, players, bigBlind, actions, initialStep, rawText: text }
}

export function parseHandHistories(text: string): ParsedHand[] {
  const chunks = text.split(/(?=Ignition Hand #\d+)/).filter(s => s.trim())
  return chunks.map(parseHand).filter((h): h is ParsedHand => h !== null)
}
