import type { PlayerState } from '../lib/types'
import PlayingCard, { FaceDownCard } from './PlayingCard'

interface Props {
  player: PlayerState
  posLabel: string
  bigBlind: number
  showHoleCards: boolean
  equity?: number          // postflop equity vs a random field (0..1), if known
  x: number
  y: number
}

function bbStr(amount: number, bigBlind: number): string {
  const v = amount / bigBlind
  return (Number.isInteger(v) ? String(v) : v.toFixed(1)) + 'bb'
}

export default function PlayerSeat({ player, posLabel, bigBlind, showHoleCards, equity, x, y }: Props) {
  const borderColor = player.isMe
    ? 'border-yellow-400'
    : player.folded
    ? 'border-gray-700'
    : 'border-slate-500'

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
          <div className="text-sm text-gray-300">
            {bbStr(player.stack, bigBlind)}
            {equity !== undefined && (
              <span className="text-cyan-300 ml-1.5">{Math.round(equity * 100)}% eq</span>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
