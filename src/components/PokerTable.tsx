import type { ParsedHand, HandState, PlayerInfo } from '../lib/types'
import { POSITION_RANK, displayPosition } from '../lib/positionUtils'
import PlayerSeat from './PlayerSeat'
import PlayingCard from './PlayingCard'
import ChipStack from './ChipStack'

interface Props {
  hand: ParsedHand
  state: HandState
  showOpponentCards: boolean
}

// No outward push — box centered on the oval rim
const PUSH_X = 0
const PUSH_Y = 0

function getLayout(players: PlayerInfo[]) {
  const me = players.find(p => p.isMe)
  if (!me) return { seats: {} as Record<number, { x: number; y: number }>, chips: {} as Record<number, { x: number; y: number }> }

  const total = players.length
  const meRank = POSITION_RANK[me.position] ?? 0

  const others = [...players]
    .filter(p => !p.isMe)
    .sort((a, b) => {
      const ai = ((POSITION_RANK[a.position] ?? 0) - meRank + total) % total
      const bi = ((POSITION_RANK[b.position] ?? 0) - meRank + total) % total
      return ai - bi
    })

  const all = [me, ...others]
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

export default function PokerTable({ hand, state, showOpponentCards }: Props) {
  const { seats, chips } = getLayout(hand.players)

  return (
    <div className="relative w-full" style={{ paddingBottom: '60%' }}>
      {/* Table felt */}
      <div
        className="absolute inset-0 rounded-[50%] border-8 border-yellow-900"
        style={{
          background: 'radial-gradient(ellipse at center, #1a6b35 0%, #145228 60%, #0f3d1e 100%)',
          boxShadow: 'inset 0 0 60px rgba(0,0,0,0.5), 0 0 40px rgba(0,0,0,0.8)',
        }}
      />

      {/* Player bet chip stacks — just inside the oval near each player */}
      {state.players.map(player => {
        if (player.streetBet <= 0 || player.folded) return null
        const pos = chips[player.seatNumber]
        if (!pos) return null
        return (
          <div
            key={`chips-${player.seatNumber}`}
            className="absolute z-10"
            style={{ left: `${pos.x}%`, top: `${pos.y}%`, transform: 'translate(-50%, -50%)' }}
          >
            <ChipStack amountBB={player.streetBet / hand.bigBlind} />
          </div>
        )
      })}

      {/* Center: pot chips (left) + community cards (right, always 5 slots) */}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex items-center gap-5">
          {state.pot > 0 && (
            <div className="flex flex-col items-center gap-1">
              <ChipStack amountBB={state.pot / hand.bigBlind} />
              <span className="text-yellow-300 font-bold bg-black/40 px-1.5 rounded" style={{ fontSize: 11 }}>
                {bbStr(state.pot, hand.bigBlind)}
              </span>
            </div>
          )}
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

        const showHoleCards = (!player.folded && player.isMe) || (showOpponentCards && !player.folded)

        return (
          <PlayerSeat
            key={player.seatNumber}
            player={player}
            posLabel={displayPosition(player.position, hand.players.length)}
            bigBlind={hand.bigBlind}
            showHoleCards={showHoleCards}
            x={px}
            y={py}
          />
        )
      })}
    </div>
  )
}
