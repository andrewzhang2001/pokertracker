import type { PlayerState } from '../lib/types'
import PlayingCard, { FaceDownCard } from './PlayingCard'

interface Props {
  player: PlayerState
  posLabel: string
  bigBlind: number
  showHoleCards: boolean
  x: number
  y: number
}

function bbStr(amount: number, bigBlind: number): string {
  const v = amount / bigBlind
  return (Number.isInteger(v) ? String(v) : v.toFixed(1)) + 'bb'
}

export default function PlayerSeat({ player, posLabel, bigBlind, showHoleCards, x, y }: Props) {
  const borderColor = player.isMe
    ? 'border-yellow-400'
    : player.folded
    ? 'border-gray-700'
    : 'border-slate-500'

  const actionColor =
    player.streetAction === 'Fold'
      ? 'bg-gray-700 text-gray-400'
      : player.streetAction?.startsWith('Raise') || player.streetAction?.startsWith('Bet') || player.streetAction?.startsWith('All-in')
      ? 'bg-orange-700 text-orange-200'
      : player.streetAction?.startsWith('Call')
      ? 'bg-blue-800 text-blue-200'
      : 'bg-slate-700 text-slate-300'

  return (
    <div
      className="absolute z-20"
      style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
    >
      <div className="flex flex-col items-center gap-0.5">
        {/* Hole cards sit on top of the info box */}
        {player.holeCards && !player.folded && (
          <div className="flex gap-1">
            {showHoleCards
              ? player.holeCards.map((c, i) => <PlayingCard key={i} card={c} medium />)
              : player.holeCards.map((_, i) => <FaceDownCard key={i} medium />)
            }
          </div>
        )}

        <div
          className={`border-2 ${borderColor} rounded-lg px-3 py-1.5 text-center min-w-[108px] max-w-[135px]`}
          style={{ background: 'rgba(0,0,0,0.85)', opacity: player.folded ? 0.45 : 1 }}
        >
          <div className="text-sm font-semibold text-white truncate">
            {posLabel}{player.isMe ? ' ★' : ''}
          </div>
          <div className="text-sm text-gray-300">{bbStr(player.stack, bigBlind)}</div>
        </div>
      </div>

      {/* Badge: absolutely positioned so it never shifts cards/box */}
      {player.streetAction && (
        <div
          className={`absolute left-1/2 -translate-x-1/2 whitespace-nowrap text-xs px-1.5 py-0.5 rounded-full font-medium ${actionColor}`}
          style={{ top: '100%', marginTop: 2 }}
        >
          {player.streetAction}
        </div>
      )}
    </div>
  )
}
