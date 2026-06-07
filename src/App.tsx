import { useState, useMemo, useEffect, useCallback } from 'react'
import { parseHandHistories, diagnose } from './lib/parseHandHistory'
import { computeHandState } from './lib/computeHandState'
import { createShareLink, loadShareById, decodeLegacyShare } from './lib/shareUrl'
import type { ParsedHand } from './lib/types'
import PokerTable from './components/PokerTable'
import HandSummaryPanel from './components/HandSummaryPanel'

export default function App() {
  const [hands, setHands] = useState<ParsedHand[]>([])
  const [handIndex, setHandIndex] = useState(0)
  const [stepIndex, setStepIndex] = useState(-1)
  const [showOpponentCards, setShowOpponentCards] = useState(true)
  const [pasteText, setPasteText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [handNotes, setHandNotes] = useState<string[]>([])
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

  // Decode shared link on first load — supports both #id= (new) and #h= (legacy)
  useEffect(() => {
    const hash = window.location.hash
    let promise: Promise<{ rawText: string; handNotes: string[] }> | null = null
    if (hash.startsWith('#id=')) promise = loadShareById(hash.slice(4))
    else if (hash.startsWith('#h=')) promise = decodeLegacyShare(hash.slice(3))
    if (!promise) return
    promise.then(({ rawText, handNotes: hn }) => {
      const parsed = parseHandHistories(rawText)
      if (parsed.length) {
        setHands(parsed)
        setHandIndex(0)
        setStepIndex(parsed[0].initialStep)
        const notes = Array.from({ length: parsed.length }, (_, i) => hn[i] ?? '')
        setHandNotes(notes)
      }
    }).catch(() => {})
  }, [])

  function loadText(text: string) {
    const parsed = parseHandHistories(text)
    if (!parsed.length) {
      setError(`No hands parsed. ${diagnose(text)}`)
    } else {
      setError(null)
      setHands(parsed)
      setHandIndex(0)
      setStepIndex(parsed[0].initialStep)
      setHandNotes(new Array(parsed.length).fill(''))
      setSelectedHandIndices(new Set())
      history.replaceState(null, '', window.location.pathname)
    }
  }

  function resetApp() {
    setHands([])
    setPasteText('')
    setHandNotes([])
    setSelectedHandIndices(new Set())
    history.replaceState(null, '', window.location.pathname)
  }

  function jumpToHand(idx: number) {
    setHandIndex(idx)
    setStepIndex(hands[idx].initialStep)
  }

  function updateNote(idx: number, value: string) {
    setHandNotes(prev => {
      const next = [...prev]
      next[idx] = value
      return next
    })
  }

  function toggleSelectHand(idx: number, checked: boolean) {
    setSelectedHandIndices(prev => {
      const next = new Set(prev)
      if (checked) next.add(idx); else next.delete(idx)
      return next
    })
  }

  function toggleSelectAll() {
    if (selectedHandIndices.size === hands.length) {
      setSelectedHandIndices(new Set())
    } else {
      setSelectedHandIndices(new Set(hands.map((_, i) => i)))
    }
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
    const next = Math.max(0, Math.min(hands.length - 1, handIndex + delta))
    if (next === handIndex) return
    setHandIndex(next)
    setStepIndex(hands[next].initialStep)
  }, [hands, handIndex])

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
    <div className="h-screen flex flex-col overflow-hidden">
      {/* Top bar */}
      <div className="flex items-center justify-between px-4 py-2 bg-black/50 border-b border-gray-800 text-sm">
        <div className="flex items-center gap-2">
          <button
            onClick={resetApp}
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
        <div className="flex items-center gap-2">
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
        />
        <div className="flex-1 flex items-center justify-center px-4 py-2 min-h-0">
          {hand && state && (
            <div className="w-full max-w-5xl">
              <PokerTable hand={hand} state={state} showOpponentCards={showOpponentCards} />
            </div>
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
          <textarea
            className="w-full max-w-3xl mx-auto block mt-2 bg-transparent text-gray-300 text-sm placeholder-gray-700 resize-none focus:outline-none focus:placeholder-gray-600 transition-colors"
            rows={2}
            placeholder="Notes for this hand…"
            value={handNotes[handIndex] ?? ''}
            onChange={e => updateNote(handIndex, e.target.value)}
          />
          <p className="text-center text-gray-700 text-xs mt-1">← → to step through actions · ↑ ↓ to change hand</p>
        </div>
      )}
    </div>
  )
}
