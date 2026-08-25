import type { PlayerState } from '../poker/types'
import PlayingCard, { FaceDownCard } from './PlayingCard'

interface Props {
  player: PlayerState
  posLabel: string
  bigBlind: number
  showHoleCards: boolean
  holeCount: number        // cards per hand for this game (PLO 4 / NLHE 2) — the
                           // face-down back count when a live seat's cards are unknown
  made?: string | null     // top-level made-hand class (postflop), if known
  equity?: number          // postflop showdown equity (0..1), if known
  x: number
  y: number
}

function bbStr(amount: number, bigBlind: number): string {
  const v = amount / bigBlind
  return (Number.isInteger(v) ? String(v) : v.toFixed(1)) + 'bb'
}

export default function PlayerSeat({ player, posLabel, bigBlind, showHoleCards, holeCount, made, equity, x, y }: Props) {
  const borderColor = player.isMe
    ? 'border-yellow-400'
    : player.folded
    ? 'border-gray-700'
    : 'border-slate-500'

  // Face-up real cards only for revealed hands (hero / shown mucks) with the
  // toggle on. Every live (unfolded) seat otherwise shows face-down backs — even
  // when its holding is unknown — so an observed table still looks like a table
  // instead of empty seats. A folded seat with no reveal shows no cards.
  const showFace = !!player.holeCards && showHoleCards
  const showBack = !showFace && !player.folded
  const backCount = player.holeCards?.length ?? holeCount

  return (
    <div
      className="absolute z-20"
      style={{ left: `${x}%`, top: `${y}%`, transform: 'translate(-50%, -50%)' }}
    >
      <div className="flex flex-col items-center gap-0.5">
        {/* Hole cards sit on top of the info box. Live seats show face-down backs;
            a folded seat's cards show only when actually revealed (a voluntary/
            shown muck), dimmed to read as folded. */}
        {(showFace || showBack) && (
          <div className={`flex gap-1 ${player.folded ? 'opacity-50' : ''}`}>
            {showFace
              ? player.holeCards!.map((c, i) => <PlayingCard key={i} card={c} medium />)
              : Array.from({ length: backCount }).map((_, i) => <FaceDownCard key={i} medium />)
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
          {made && <div className="text-xs text-amber-300 truncate">{made}</div>}
          {equity !== undefined && <div className="text-xs text-cyan-300">{Math.round(equity * 100)}% eq</div>}
        </div>
      </div>
    </div>
  )
}
