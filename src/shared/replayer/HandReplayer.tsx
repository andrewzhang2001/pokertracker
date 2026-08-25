import { useState, useMemo, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { computeHandState } from '../poker/computeHandState'
import type { ParsedHand } from '../poker/types'
import PokerTable from './PokerTable'
import HandSummaryPanel from './HandSummaryPanel'

interface Props {
  hands: ParsedHand[]
  handNotes: string[]
  onUpdateNote: (idx: number, value: string) => void
  onBack: () => void
  backLabel?: string
  topBarExtra?: ReactNode      // view-specific controls (export button, filters…)
  initialHandIndex?: number    // which hand to open on first render
  // Paged callers (the database browser) pass these to hand off navigation when
  // the user steps off either end of the current page. Absent = clamp instead.
  onPastStart?: () => void
  onPastEnd?: () => void
}

export default function HandReplayer({
  hands, handNotes, onUpdateNote, onBack, backLabel = '← Back', topBarExtra,
  initialHandIndex = 0, onPastStart, onPastEnd,
}: Props) {
  const [handIndex, setHandIndex] = useState(initialHandIndex)
  const [stepIndex, setStepIndex] = useState(() => hands[initialHandIndex]?.initialStep ?? -1)
  const [showOpponentCards, setShowOpponentCards] = useState(true)

  const hand = hands[handIndex] ?? null

  const state = useMemo(
    () => (hand ? computeHandState(hand, stepIndex) : null),
    [hand, stepIndex],
  )

  function jumpToHand(idx: number) {
    setHandIndex(idx)
    setStepIndex(hands[idx].initialStep)
  }

  const goHand = useCallback((delta: number) => {
    const next = handIndex + delta
    // Off an end: let a paged caller take over, otherwise stay put.
    if (next < 0) { onPastStart?.(); return }
    if (next > hands.length - 1) { onPastEnd?.(); return }
    if (next === handIndex) return
    setHandIndex(next)
    setStepIndex(hands[next].initialStep)
  }, [hands, handIndex, onPastStart, onPastEnd])

  const goStep = useCallback((delta: number) => {
    if (!hand) return
    setStepIndex(i => Math.max(-1, Math.min(hand.actions.length - 1, i + delta)))
  }, [hand])

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

  const totalSteps = hand ? hand.actions.length : 0
  const currentDesc = state?.lastAction?.desc ?? '—'

  return (
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-black/50 border-b border-gray-800 text-sm">
        <div className="flex items-center gap-2">
          <button
            onClick={onBack}
            className="text-xs text-gray-500 hover:text-white border border-gray-700 rounded px-2 py-1 transition-colors"
          >
            {backLabel}
          </button>
          <span className="text-gray-400">Hand</span>
          <div className="flex gap-1">
            <button onClick={() => goHand(-1)} disabled={handIndex === 0 && !onPastStart}
              className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-xs">▲</button>
            <button onClick={() => goHand(1)} disabled={handIndex === hands.length - 1 && !onPastEnd}
              className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-xs">▼</button>
          </div>
          <span className="text-white font-medium">{handIndex + 1} / {hands.length}</span>
          {hand && <span className="text-gray-600 text-xs hidden sm:inline">{hand.date}</span>}
          {hand?.gameType && <span className="text-gray-700 text-xs hidden sm:inline">{hand.gameType}</span>}
        </div>
        <div className="flex items-center gap-2">
          {topBarExtra}
          <button
            onClick={() => setShowOpponentCards(v => !v)}
            className={`text-xs px-3 py-1 rounded-full border transition-colors ${
              showOpponentCards
                ? 'border-yellow-500 text-yellow-400 bg-yellow-500/10'
                : 'border-gray-600 text-gray-400'
            }`}
          >
            {showOpponentCards ? 'Cards: on' : 'Cards: off'}
          </button>
        </div>
      </div>

      {/* Main content: summary panel + table */}
      <div className="flex-1 flex overflow-hidden">
        <HandSummaryPanel
          hands={hands}
          handIndex={handIndex}
          handNotes={handNotes}
          onClickHand={jumpToHand}
        />
        <div className="flex-1 min-h-0 min-w-0 px-4 py-2">
          {hand && state && (
            <PokerTable hand={hand} state={state} showOpponentCards={showOpponentCards} />
          )}
        </div>
      </div>

      {/* Bottom bar */}
      {hand && (
        <div className="border-t border-gray-800 bg-black/50 px-4 py-2">
          <div className="flex items-center gap-3 max-w-3xl mx-auto">
            <button
              onClick={() => goStep(-1)}
              disabled={stepIndex <= -1}
              className="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-sm font-bold"
            >
              ←
            </button>
            <div className="flex-1 text-center">
              <span className="text-white text-sm">{currentDesc}</span>
              <span className="text-gray-600 text-xs ml-2">{stepIndex + 1} / {totalSteps}</span>
            </div>
            <button
              onClick={() => goStep(1)}
              disabled={stepIndex >= totalSteps - 1}
              className="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-sm font-bold"
            >
              →
            </button>
          </div>
          <textarea
            className="w-full max-w-3xl mx-auto block mt-2 bg-transparent text-gray-300 text-sm placeholder-gray-700 resize-none focus:outline-none focus:placeholder-gray-600 transition-colors"
            rows={2}
            placeholder="Notes for this hand…"
            value={handNotes[handIndex] ?? ''}
            onChange={e => onUpdateNote(handIndex, e.target.value)}
          />
          <p className="text-center text-gray-700 text-xs mt-1">← → to step through actions · ↑ ↓ to change hand</p>
        </div>
      )}
    </div>
  )
}
