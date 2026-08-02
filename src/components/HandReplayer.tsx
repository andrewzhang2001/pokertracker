import { useState, useMemo, useEffect, useCallback } from 'react'
import type { ReactNode } from 'react'
import { computeHandState } from '../lib/computeHandState'
import { createShareLink } from '../lib/shareUrl'
import type { ParsedHand } from '../lib/types'
import PokerTable from './PokerTable'
import HandSummaryPanel from './HandSummaryPanel'

interface Props {
  hands: ParsedHand[]
  handNotes: string[]
  onUpdateNote: (idx: number, value: string) => void
  onBack: () => void
  backLabel?: string
  topBarExtra?: ReactNode      // view-specific controls (export button, filters…)
  enableShare?: boolean        // show share buttons (default true)
  initialHandIndex?: number    // which hand to open on first render
  // Paged callers (the database browser) pass these to hand off navigation when
  // the user steps off either end of the current page. Absent = clamp instead.
  onPastStart?: () => void
  onPastEnd?: () => void
}

export default function HandReplayer({
  hands, handNotes, onUpdateNote, onBack, backLabel = '← Back', topBarExtra, enableShare = true,
  initialHandIndex = 0, onPastStart, onPastEnd,
}: Props) {
  const [handIndex, setHandIndex] = useState(initialHandIndex)
  const [stepIndex, setStepIndex] = useState(() => hands[initialHandIndex]?.initialStep ?? -1)
  const [showOpponentCards, setShowOpponentCards] = useState(true)
  const [sharing, setSharing] = useState(false)
  const [copied, setCopied] = useState(false)
  const [selectedHandIndices, setSelectedHandIndices] = useState<Set<number>>(new Set())
  const [sharingSelected, setSharingSelected] = useState(false)
  const [copiedSelected, setCopiedSelected] = useState(false)

  const hand = hands[handIndex] ?? null

  const state = useMemo(
    () => (hand ? computeHandState(hand, stepIndex) : null),
    [hand, stepIndex],
  )

  function jumpToHand(idx: number) {
    setHandIndex(idx)
    setStepIndex(hands[idx].initialStep)
  }

  function toggleSelectHand(idx: number, checked: boolean) {
    setSelectedHandIndices(prev => {
      const next = new Set(prev)
      if (checked) next.add(idx); else next.delete(idx)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedHandIndices.size === hands.length) setSelectedHandIndices(new Set())
    else setSelectedHandIndices(new Set(hands.map((_, i) => i)))
  }

  async function shareSelectedHands() {
    const sorted = [...selectedHandIndices].sort((a, b) => a - b)
    const rawText = sorted.map(i => hands[i].rawText).join('\n\n')
    const notes = sorted.map(i => handNotes[i] ?? '')
    setSharingSelected(true)
    try {
      const url = await createShareLink(rawText, notes)
      await navigator.clipboard.writeText(url)
      setCopiedSelected(true)
      setTimeout(() => setCopiedSelected(false), 2000)
    } finally {
      setSharingSelected(false)
    }
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

  async function copyShareLink() {
    if (!hand) return
    setSharing(true)
    try {
      const url = await createShareLink(hand.rawText, [handNotes[handIndex] ?? ''])
      await navigator.clipboard.writeText(url)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } finally {
      setSharing(false)
    }
  }

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
          {enableShare && (
            <button
              onClick={copyShareLink}
              disabled={sharing}
              className={`text-xs px-3 py-1 rounded-full border transition-colors disabled:opacity-60 ${
                copied
                  ? 'border-green-600 text-green-400 bg-green-600/10'
                  : 'border-blue-600 text-blue-400 bg-blue-600/10 hover:bg-blue-600/20'
              }`}
            >
              {sharing ? '…' : copied ? 'Copied!' : 'Share'}
            </button>
          )}
        </div>
      </div>

      {/* Main content: summary panel + table */}
      <div className="flex-1 flex overflow-hidden">
        <HandSummaryPanel
          hands={hands}
          handIndex={handIndex}
          handNotes={handNotes}
          selected={selectedHandIndices}
          onSelect={toggleSelectHand}
          onSelectAll={toggleSelectAll}
          onClickHand={jumpToHand}
          onShareSelected={shareSelectedHands}
          sharingSelected={sharingSelected}
          copiedSelected={copiedSelected}
          enableShare={enableShare}
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
