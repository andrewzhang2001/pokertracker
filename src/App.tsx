import { useState, useMemo, useEffect, useCallback } from 'react'
import { parseHandHistories, diagnose } from './lib/parseHandHistory'
import { computeHandState } from './lib/computeHandState'
import type { ParsedHand } from './lib/types'
import PokerTable from './components/PokerTable'

export default function App() {
  const [hands, setHands] = useState<ParsedHand[]>([])
  const [handIndex, setHandIndex] = useState(0)
  const [stepIndex, setStepIndex] = useState(-1)
  const [showOpponentCards, setShowOpponentCards] = useState(true)
  const [pasteText, setPasteText] = useState('')
  const [error, setError] = useState<string | null>(null)

  const hand = hands[handIndex] ?? null

  const state = useMemo(
    () => (hand ? computeHandState(hand, stepIndex) : null),
    [hand, stepIndex],
  )

  function loadText(text: string) {
    const parsed = parseHandHistories(text)
    if (!parsed.length) {
      setError(`No hands parsed. ${diagnose(text)}`)
    } else {
      setError(null)
      setHands(parsed)
      setHandIndex(0)
      setStepIndex(parsed[0].initialStep)
    }
  }

  const goHand = useCallback((delta: number) => {
    const next = Math.max(0, Math.min(hands.length - 1, handIndex + delta))
    if (next === handIndex) return
    setHandIndex(next)
    setStepIndex(hands[next].initialStep)
  }, [hands, handIndex])

  const goStep = useCallback((delta: number) => {
    if (!hand) return
    setStepIndex(i => Math.max(-1, Math.min(hand.actions.length - 1, i + delta)))
  }, [hand])

  // Keyboard navigation — stable closure via useCallback refs
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

  if (!hands.length) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 gap-4">
        <h1 className="text-3xl font-bold text-white">Poker Hand Tracker</h1>
        <p className="text-gray-400">Paste your Ignition hand history below</p>
        <textarea
          className="w-full max-w-2xl h-64 bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 focus:outline-none focus:border-yellow-500 resize-none font-mono"
          placeholder="Paste hand history here..."
          value={pasteText}
          onChange={e => setPasteText(e.target.value)}
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <button
          onClick={() => loadText(pasteText)}
          disabled={!pasteText.trim()}
          className="px-6 py-2 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold rounded-lg transition-colors"
        >
          Load hands
        </button>
      </div>
    )
  }

  const totalSteps = hand ? hand.actions.length : 0
  const currentDesc = state?.lastAction?.desc ?? '—'

  return (
    <div className="min-h-screen flex flex-col">
      {/* Top bar: hand navigation */}
      <div className="flex items-center justify-between px-4 py-2 bg-black/50 border-b border-gray-800 text-sm">
        <div className="flex items-center gap-2">
          <button
            onClick={() => { setHands([]); setPasteText('') }}
            className="text-xs text-gray-500 hover:text-white border border-gray-700 rounded px-2 py-1 transition-colors"
          >
            ← Back
          </button>
          <span className="text-gray-400">Hand</span>
          <div className="flex gap-1">
            <button onClick={() => goHand(-1)} disabled={handIndex === 0}
              className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-xs">▲</button>
            <button onClick={() => goHand(1)} disabled={handIndex === hands.length - 1}
              className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-xs">▼</button>
          </div>
          <span className="text-white font-medium">{handIndex + 1} / {hands.length}</span>
          {hand && <span className="text-gray-600 text-xs hidden sm:inline">{hand.date}</span>}
        </div>
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

      {/* Table */}
      <div className="flex-1 flex items-center justify-center px-4 py-2">
        {hand && state && (
          <div className="w-full max-w-3xl">
            <PokerTable hand={hand} state={state} showOpponentCards={showOpponentCards} />
          </div>
        )}
      </div>

      {/* Bottom bar: step navigation */}
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
              <span className="text-gray-600 text-xs ml-2">
                {stepIndex + 1} / {totalSteps}
              </span>
            </div>
            <button
              onClick={() => goStep(1)}
              disabled={stepIndex >= totalSteps - 1}
              className="px-3 py-1 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30 text-sm font-bold"
            >
              →
            </button>
          </div>
          <p className="text-center text-gray-700 text-xs mt-1">← → to step through actions · ↑ ↓ to change hand</p>
        </div>
      )}
    </div>
  )
}
