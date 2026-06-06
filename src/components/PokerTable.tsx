import type { ParsedHand, HandState, PlayerInfo } from '../lib/types'
import PlayerSeat from './PlayerSeat'
import PlayingCard from './PlayingCard'

interface Props {
  hand: ParsedHand
  state: HandState
  showOpponentCards: boolean
}

function getPositions(players: PlayerInfo[]) {
  const me = players.find(p => p.isMe)
  if (!me) return {}

  const others = [...players]
    .filter(p => !p.isMe)
    .sort((a, b) => ((a.seatNumber - me.seatNumber + 9) % 9) - ((b.seatNumber - me.seatNumber + 9) % 9))

  const all = [me, ...others]
  const n = all.length
  const cx = 50, cy = 50, rx = 42, ry = 34

  const result: Record<number, { x: number; y: number }> = {}
  all.forEach((p, idx) => {
    const deg = 180 - idx * (360 / n)
    const rad = (deg * Math.PI) / 180
    result[p.seatNumber] = {
      x: cx + rx * Math.sin(rad),
      y: cy - ry * Math.cos(rad),
    }
  })
  return result
}

function bbStr(amount: number, bigBlind: number): string {
  const v = amount / bigBlind
  return (Number.isInteger(v) ? String(v) : v.toFixed(1)) + 'bb'
}

export default function PokerTable({ hand, state, showOpponentCards }: Props) {
  const positions = getPositions(hand.players)

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

      {/* Community cards + pot */}
      <div className="absolute inset-0 flex flex-col items-center justify-center gap-2">
        {state.communityCards.length > 0 && (
          <div className="flex gap-1.5">
            {state.communityCards.map((c, i) => (
              <PlayingCard key={i} card={c} />
            ))}
          </div>
        )}
        {state.pot > 0 && (
          <div className="text-yellow-300 font-bold text-sm bg-black/50 px-3 py-1 rounded-full">
            Pot: {bbStr(state.pot, hand.bigBlind)}
          </div>
        )}
      </div>

      {/* Player seats */}
      {state.players.map(player => {
        const pos = positions[player.seatNumber]
        if (!pos) return null
        return (
          <PlayerSeat
            key={player.seatNumber}
            player={player}
            bigBlind={hand.bigBlind}
            showCards={showOpponentCards}
            x={pos.x}
            y={pos.y}
          />
        )
      })}
    </div>
  )
}
