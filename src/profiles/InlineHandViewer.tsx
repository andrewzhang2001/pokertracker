import { useCallback, useMemo, useState } from 'react'
import { computeHandState } from '../shared/poker/computeHandState'
import type { ParsedHand } from '../shared/poker/types'
import PokerTable from '../shared/replayer/PokerTable'
import StepControls, { clampStep, useReplayerKeys } from '../shared/replayer/StepControls'

// One hand on a table that fills its parent frame, with step controls. The
// parent keys this by hand so the step position resets when the hand changes.
export default function InlineHandViewer({ hand, onHand, onExpand, onClose }: {
  hand: ParsedHand
  onHand: (delta: number) => void
  onExpand: () => void
  onClose: () => void
}) {
  const [stepIndex, setStepIndex] = useState(hand.initialStep)
  const [showOpponentCards, setShowOpponentCards] = useState(true)
  const state = useMemo(() => computeHandState(hand, stepIndex), [hand, stepIndex])

  const goStep = useCallback((delta: number) => setStepIndex(i => clampStep(hand, i + delta)), [hand])
  useReplayerKeys(goStep, onHand)

  return (
    <div className="flex-1 min-h-0 flex flex-col gap-2">
      <div className="flex items-center gap-2 text-xs">
        <button onClick={() => onHand(-1)} className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700" title="Previous hand (↑)">▲</button>
        <button onClick={() => onHand(1)} className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700" title="Next hand (↓)">▼</button>
        <span className="text-gray-500 truncate">{hand.date}</span>
        <button
          onClick={() => setShowOpponentCards(v => !v)}
          className={`ml-auto px-2.5 py-0.5 rounded-full border transition-colors ${showOpponentCards ? 'border-yellow-500 text-yellow-400 bg-yellow-500/10' : 'border-gray-600 text-gray-400'}`}
        >
          {showOpponentCards ? 'Cards: on' : 'Cards: off'}
        </button>
        <button onClick={onExpand} className="text-gray-500 hover:text-white border border-gray-700 rounded px-2 py-0.5" title="Open in the full-screen replayer">⤢</button>
        <button onClick={onClose} className="text-gray-500 hover:text-white border border-gray-700 rounded px-2 py-0.5" title="Close">✕</button>
      </div>

      <div className="aspect-[4/3] xl:aspect-auto xl:flex-1 min-h-0">
        <PokerTable hand={hand} state={state} showOpponentCards={showOpponentCards} />
      </div>

      <StepControls stepIndex={stepIndex} totalSteps={hand.actions.length} desc={state.lastAction?.desc ?? '—'} onStep={goStep} />
      <p className="text-center text-gray-700 text-xs">← → to step through actions · ↑ ↓ to change hand</p>
    </div>
  )
}
