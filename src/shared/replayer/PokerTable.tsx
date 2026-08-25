import { useRef, useState, useLayoutEffect, useMemo } from 'react'
import type { ParsedHand, ParsedCard, HandState, PlayerInfo } from '../poker/types'
import { computeEquities } from '../poker/equity'
import { classifyBoard } from '../poker/ploEval'
import { POSITION_RANK, displayPosition } from '../poker/positionUtils'
import { gameKind } from '../poker/games'
import PlayerSeat from './PlayerSeat'
import PlayingCard from './PlayingCard'
import ChipStack from './ChipStack'

interface Props {
  hand: ParsedHand
  state: HandState
  showOpponentCards: boolean
}

// The table is laid out at a fixed "design" size (felt = BASE_W × BASE_H) so
// that the percentage-positioned seats and the fixed-pixel cards keep a constant
// proportion. We then scale the whole thing to fit the available container in
// BOTH dimensions. MARGIN_* reserve room for seat boxes / hole cards that
// overhang the felt, so nothing gets clipped on small screens.
const BASE_W = 1000
const BASE_H = 600
const MARGIN_X = 100
const MARGIN_Y = 95

// No outward push — box centered on the oval rim
const PUSH_X = 0
const PUSH_Y = 0

function getLayout(players: PlayerInfo[]) {
  if (!players.length) return { seats: {} as Record<number, { x: number; y: number }>, chips: {} as Record<number, { x: number; y: number }> }

  // Anchor seat = the hero (sat at the bottom). Railed/observed hands have no
  // hero, so fall back to the lowest seat number — a stable anchor so the table
  // still renders and the layout is deterministic across a session's hands.
  const anchor = players.find(p => p.isMe) ?? [...players].sort((a, b) => a.seatNumber - b.seatNumber)[0]

  const total = players.length
  const anchorRank = POSITION_RANK[anchor.position] ?? 0

  const others = [...players]
    .filter(p => p !== anchor)
    .sort((a, b) => {
      const ai = ((POSITION_RANK[a.position] ?? 0) - anchorRank + total) % total
      const bi = ((POSITION_RANK[b.position] ?? 0) - anchorRank + total) % total
      return ai - bi
    })

  const all = [anchor, ...others]
  const n = all.length
  const cx = 50, cy = 50, rx = 46, ry = 46

  const seats: Record<number, { x: number; y: number }> = {}
  const chips: Record<number, { x: number; y: number }> = {}

  all.forEach((p, idx) => {
    const deg = 180 + idx * (360 / n)
    const rad = (deg * Math.PI) / 180
    const x = cx + rx * Math.sin(rad)
    const y = cy - ry * Math.cos(rad)
    seats[p.seatNumber] = { x, y }
    // bet chips: 28% of way from player toward center — close to the player
    chips[p.seatNumber] = {
      x: x + (cx - x) * 0.28,
      y: y + (cy - y) * 0.28,
    }
  })

  return { seats, chips }
}

function bbStr(amount: number, bigBlind: number): string {
  const v = amount / bigBlind
  return (Number.isInteger(v) ? String(v) : v.toFixed(1)) + 'bb'
}

function actionColor(streetAction: string): string {
  if (streetAction === 'Fold') return 'bg-gray-700 text-gray-400'
  if (streetAction.startsWith('Raise') || streetAction.startsWith('Bet') || streetAction.startsWith('All-in'))
    return 'bg-orange-700 text-orange-200'
  if (streetAction.startsWith('Call')) return 'bg-blue-800 text-blue-200'
  return 'bg-slate-700 text-slate-300'
}

// The dealer button — a small ivory disc, the classic at-a-glance position anchor.
function DealerButton() {
  return (
    <div
      className="rounded-full flex items-center justify-center font-extrabold select-none"
      style={{
        width: 24, height: 24, fontSize: 12, letterSpacing: '-0.5px', color: '#8a1c1c',
        background: 'radial-gradient(circle at 35% 30%, #ffffff 0%, #efe9d8 60%, #d8cfb4 100%)',
        border: '1.5px solid rgba(0,0,0,0.3)',
        boxShadow: '0 2px 4px rgba(0,0,0,0.55), inset 0 1px 1px rgba(255,255,255,0.8)',
      }}
    >
      D
    </div>
  )
}

export default function PokerTable({ hand, state, showOpponentCards }: Props) {
  const { seats, chips } = getLayout(hand.players)
  const holeCount = gameKind(hand.gameType) === 'plo' ? 4 : 2
  // Postflop showdown equity, recomputed per step (board / live set change).
  const equities = useMemo(() => computeEquities(hand, state), [hand, state])
  // A player's hand class from their own cards + the public board: the made-hand
  // name, else the draw(s) (flush draw / OESD / gutshot / wrap), else "air".
  const madeOf = (cards: ParsedCard[] | null): string | null => {
    if (state.communityCards.length < 3 || !cards) return null
    const hc = classifyBoard(cards, state.communityCards)
    return hc.made ?? hc.label
  }
  const containerRef = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)

  useLayoutEffect(() => {
    const el = containerRef.current
    if (!el) return
    const update = () => {
      const { width, height } = el.getBoundingClientRect()
      if (!width || !height) return
      // Scale against the design size plus overhang margins so seats never clip.
      const s = Math.min(width / (BASE_W + MARGIN_X * 2), height / (BASE_H + MARGIN_Y * 2))
      setScale(Math.min(s, 1)) // never enlarge beyond the design size
    }
    update()
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  return (
    <div ref={containerRef} className="w-full h-full flex items-center justify-center">
      <div
        style={{
          width: BASE_W,
          height: BASE_H,
          flexShrink: 0,
          transform: `scale(${scale})`,
          transformOrigin: 'center',
        }}
      >
        <div className="relative w-full h-full">
      {/* Table felt */}
      <div
        className="absolute inset-0 rounded-[50%] border-8 border-yellow-900"
        style={{
          background: 'radial-gradient(ellipse at center, #1a6b35 0%, #145228 60%, #0f3d1e 100%)',
          boxShadow: 'inset 0 0 60px rgba(0,0,0,0.5), 0 0 40px rgba(0,0,0,0.8)',
        }}
      />

      {/* Bet chips + action text — just inside the oval near each player.
          Chips stay anchored toward the table; the action label sits on the
          side of the chips facing the table CENTER, so it never overlaps that
          player's own hole cards (which are on the rim side of the chips). */}
      {state.players.map(player => {
        const pos = chips[player.seatNumber]
        const seatPos = seats[player.seatNumber]
        if (!pos || !seatPos) return null
        const hasChips = player.streetBet > 0 && !player.folded
        const action = player.streetAction
        if (!hasChips && !action) return null
        // Players in the lower half sit below center, so "toward center" is up.
        const labelAbove = seatPos.y > 50
        return (
          <div
            key={`chips-${player.seatNumber}`}
            className="absolute z-10"
            style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}
          >
            <div className="relative flex flex-col items-center">
              {hasChips && <ChipStack amountBB={player.streetBet / hand.bigBlind} />}
              {action && (
                <div
                  className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-xs px-1.5 py-0.5 rounded-full font-medium ${actionColor(action)}`}
                  style={labelAbove
                    ? { bottom: '100%', marginBottom: hasChips ? 2 : 0 }
                    : { top: '100%', marginTop: hasChips ? 2 : 0 }}
                >
                  {action}
                </div>
              )}
            </div>
          </div>
        )
      })}

      {/* Dealer button — sits just to the side of the button seat's chip area,
          offset perpendicular so it never lands on top of the bet chips. */}
      {(() => {
        const btn = state.players.find(p => p.position === 'Dealer')
          ?? (state.players.length === 2 ? state.players.find(p => p.position === 'Small Blind') : undefined)
        const sp = btn ? seats[btn.seatNumber] : undefined
        const cp = btn ? chips[btn.seatNumber] : undefined
        if (!sp || !cp) return null
        const dx = sp.x - 50, dy = sp.y - 50
        const dist = Math.hypot(dx, dy) || 1
        const nx = dx / dist, ny = dy / dist
        // perpendicular to the radial line, nudged toward the felt center
        const bx = cp.x + (-ny) * 9 - nx * 3
        const by = cp.y + nx * 9 - ny * 3
        return (
          <div className="absolute z-10" style={{ left: `${bx}%`, top: `${by}%`, transform: 'translate(-50%, -50%)' }}>
            <DealerButton />
          </div>
        )
      })()}

      {/* Center: pot chips (left) + community cards (right, always 5 slots).
          Like a real table, chips still wagered this street sit in front of each
          player, so the middle pot excludes them until the street is collected. */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex items-center gap-5">
          {(() => {
            const inFront = state.players.reduce((s, p) => s + (p.folded ? 0 : p.streetBet), 0)
            const middlePot = state.pot - inFront
            return middlePot > 0 ? (
            <div className="flex flex-col items-center gap-1">
              <ChipStack amountBB={middlePot / hand.bigBlind} />
              <span className="text-yellow-300 font-bold bg-black/40 px-1.5 rounded" style={{ fontSize: 11 }}>
                {bbStr(middlePot, hand.bigBlind)}
              </span>
            </div>
            ) : null
          })()}
          {state.communityCards.length > 0 && (
            <div className="flex gap-1.5">
              {[0, 1, 2, 3, 4].map(i =>
                state.communityCards[i]
                  ? <PlayingCard key={i} card={state.communityCards[i]} medium />
                  : <div key={i} style={{ width: 45, height: 63 }} />
              )}
            </div>
          )}
        </div>
      </div>

      {/* Player seats — whole element (cards + box) pushed outward onto the rail */}
      {state.players.map(player => {
        const seatPos = seats[player.seatNumber]
        if (!seatPos) return null
        const { x, y } = seatPos

        // Outward unit vector from center to player
        const dx = x - 50, dy = y - 50
        const dist = Math.sqrt(dx * dx + dy * dy) || 1
        const nx = dx / dist, ny = dy / dist

        // Push whole element outward — asymmetric: more vertical than horizontal
        const px = x + nx * PUSH_X
        const py = y + ny * PUSH_Y

        // Reveal real faces for the hero or when the toggle is on — even if the
        // player folded, so a voluntarily-shown mucked hand (e.g. a PokerNow
        // post-fold show) is visible. PlayerSeat dims folded seats.
        const showHoleCards = player.isMe || showOpponentCards

        return (
          <PlayerSeat
            key={player.seatNumber}
            player={player}
            posLabel={displayPosition(player.position, hand.players.length)}
            bigBlind={hand.bigBlind}
            showHoleCards={showHoleCards}
            holeCount={holeCount}
            made={showHoleCards && !player.folded ? madeOf(player.holeCards) : null}
            equity={showOpponentCards && !player.folded ? equities[player.seatNumber] : undefined}
            x={px}
            y={py}
          />
        )
      })}
        </div>
      </div>
    </div>
  )
}
