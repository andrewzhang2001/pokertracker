import type { PlayerState } from '../lib/types'
import PlayingCard, { FaceDownCard } from './PlayingCard'

interface Props {
  player: PlayerState
  bigBlind: number
  showCards: boolean
  x: number
  y: number
}

function bbStr(amount: number, bigBlind: number): string {
  const v = amount / bigBlind
  return (Number.isInteger(v) ? String(v) : v.toFixed(1)) + 'bb'
}

export default function PlayerSeat({ player, bigBlind, showCards, x, y }: Props) {
  const showHoleCards = player.isMe || showCards
  const hasBet = player.streetBet > 0

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
      className="absolute flex flex-col items-center gap-0.5"
      style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
    >
      {/* Hole cards */}
      <div className="flex gap-1">
        {player.holeCards
          ? showHoleCards
            ? player.holeCards.map((c, i) => <PlayingCard key={i} card={c} small />)
            : player.holeCards.map((_, i) => <FaceDownCard key={i} small />)
          : null}
      </div>

      {/* Info box */}
      <div
        className={`border-2 ${borderColor} rounded-lg px-2 py-1 text-center min-w-[72px] max-w-[90px]`}
        style={{ background: 'rgba(0,0,0,0.75)', opacity: player.folded ? 0.45 : 1 }}
      >
        <div className="text-xs font-semibold text-white truncate">
          {player.position}{player.isMe ? ' ★' : ''}
        </div>
        <div className="text-xs text-gray-300">{bbStr(player.stack, bigBlind)}</div>
      </div>

      {/* Street action badge */}
      {player.streetAction && (
        <div className={`text-xs px-1.5 py-0.5 rounded-full font-medium ${actionColor}`}>
          {player.streetAction}
        </div>
      )}

      {/* Current street bet (chips in front) */}
      {hasBet && !player.folded && (
        <div className="text-xs text-yellow-300 font-medium">
          {bbStr(player.streetBet, bigBlind)}
        </div>
      )}
    </div>
  )
}
