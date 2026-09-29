import { useEffect } from 'react'
import type { ParsedHand } from '../poker/types'

// ← → steps through actions, ↑ ↓ changes hand. Ignored while typing in a textarea.
export function useReplayerKeys(goStep: (delta: number) => void, goHand: (delta: number) => void) {
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.target instanceof HTMLTextAreaElement) return
      if (e.key === 'ArrowRight') goStep(1)
      else if (e.key === 'ArrowLeft') goStep(-1)
      else if (e.key === 'ArrowUp') { e.preventDefault(); goHand(-1) }
      else if (e.key === 'ArrowDown') { e.preventDefault(); goHand(1) }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [goStep, goHand])
}

// Clamp a step index to a hand's range: -1 (before any action) through its last action.
export const clampStep = (hand: ParsedHand, step: number) => Math.max(-1, Math.min(hand.actions.length - 1, step))

// The ← [current action · n / N] → row under the table.
export default function StepControls({ stepIndex, totalSteps, desc, onStep }: {
  stepIndex: number
  totalSteps: number
  desc: string
  onStep: (delta: number) => void
}) {
  return (
    <div className="flex items-center gap-3">
      <button
        onClick={() => onStep(-1)}
        disabled={stepIndex <= -1}
        className="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-sm font-bold"
      >
        ←
      </button>
      <div className="flex-1 text-center">
        <span className="text-white text-sm">{desc}</span>
        <span className="text-gray-600 text-xs ml-2">{stepIndex + 1} / {totalSteps}</span>
      </div>
      <button
        onClick={() => onStep(1)}
        disabled={stepIndex >= totalSteps - 1}
        className="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-sm font-bold"
      >
        →
      </button>
    </div>
  )
}
