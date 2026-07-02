import { useMemo, useRef, useState, useEffect } from 'react'
import type { ParsedHand, ParsedCard } from '../lib/types'
import { computeHandState } from '../lib/computeHandState'
import { analyzeHand } from '../lib/analyzeHand'
import { displayPosition } from '../lib/positionUtils'
import PlayingCard from './PlayingCard'

interface HandSummaryItem {
  index: number
  posLabel: string
  holeCards: ParsedCard[] | null
  netBB: number
  participated: boolean
}

function computeSummary(hand: ParsedHand, index: number): HandSummaryItem {
  const hero = hand.players.find(p => p.isMe)
  const posLabel = hero ? displayPosition(hero.position, hand.players.length) : '?'
  const finalState = computeHandState(hand, hand.actions.length - 1)
  const heroFinal = finalState.players.find(p => p.isMe)
  const netBB = hero && heroFinal
    ? (heroFinal.stack - hero.startingStack) / hand.bigBlind
    : 0
  // VPIP — single source of truth in analyzeHand; drives the red/green coloring.
  const participated = analyzeHand(hand).heroVpip
  return { index, posLabel, holeCards: heroFinal?.holeCards ?? null, netBB, participated }
}

function netStr(netBB: number): string {
  const abs = Math.abs(netBB)
  const str = (Number.isInteger(abs) ? String(abs) : abs.toFixed(1)) + 'bb'
  return (netBB >= 0 ? '+' : '−') + str
}

interface Props {
  hands: ParsedHand[]
  handIndex: number
  handNotes: string[]
  onClickHand: (idx: number) => void
}

export default function HandSummaryPanel({
  hands, handIndex, handNotes, onClickHand,
}: Props) {
  const summaries = useMemo(() => hands.map((h, i) => computeSummary(h, i)), [hands])

  // Track scroll position so we can show fade/chevron indicators instead of a
  // scrollbar (hidden via .no-scrollbar).
  const scrollRef = useRef<HTMLDivElement>(null)
  const [canScrollUp, setCanScrollUp] = useState(false)
  const [canScrollDown, setCanScrollDown] = useState(false)

  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const update = () => {
      setCanScrollUp(el.scrollTop > 1)
      setCanScrollDown(el.scrollTop + el.clientHeight < el.scrollHeight - 1)
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    const ro = new ResizeObserver(update)
    ro.observe(el)
    return () => { el.removeEventListener('scroll', update); ro.disconnect() }
  }, [summaries.length])

  return (
    <div className="w-60 border-r border-gray-800 flex flex-col bg-black/30 overflow-hidden shrink-0">
      {/* Header */}
      <div className="flex items-center px-2 py-2 border-b border-gray-800 shrink-0">
        <span className="text-xs text-gray-400 select-none">{hands.length} hands</span>
      </div>

      {/* Rows */}
      <div className="relative flex-1 min-h-0">
        <div ref={scrollRef} className="absolute inset-0 overflow-y-auto no-scrollbar">
        {summaries.map(s => {
          const isActive = s.index === handIndex
          const netColor = s.participated
            ? s.netBB > 0 ? 'text-green-400' : s.netBB < 0 ? 'text-red-400' : 'text-gray-500'
            : 'text-gray-500'

          return (
            <div
              key={s.index}
              className={`flex items-center gap-1 px-2 py-1.5 cursor-pointer border-b border-gray-800/50 hover:bg-white/5 transition-colors ${isActive ? 'bg-yellow-500/10' : ''}`}
              onClick={() => onClickHand(s.index)}
            >
              <div className="flex gap-0.5 shrink-0">
                {s.holeCards
                  ? s.holeCards.map((c, i) => <PlayingCard key={i} card={c} tiny />)
                  : <span className="text-gray-600 text-xs w-[48px]">—</span>}
              </div>
              <span className="text-gray-400 text-xs w-7 shrink-0 text-center">{s.posLabel}</span>
              <span className={`text-xs ml-auto shrink-0 ${netColor}`}>{netStr(s.netBB)}</span>
              {handNotes[s.index] && (
                <span className="w-1.5 h-1.5 rounded-full bg-blue-400 shrink-0" title={handNotes[s.index]} />
              )}
            </div>
          )
        })}
        </div>

        {/* Top fade — shown when there are hands scrolled above */}
        <div
          className={`pointer-events-none absolute top-0 left-0 right-0 h-6 bg-gradient-to-b from-[#16242f] to-transparent transition-opacity ${canScrollUp ? 'opacity-100' : 'opacity-0'}`}
        />
        {/* Bottom fade + chevron — shown when there's more below (i.e. not at end) */}
        <div
          className={`pointer-events-none absolute bottom-0 left-0 right-0 h-7 bg-gradient-to-t from-[#16242f] to-transparent flex items-end justify-center pb-0.5 transition-opacity ${canScrollDown ? 'opacity-100' : 'opacity-0'}`}
        >
          <span className="text-gray-400 text-xs leading-none">▾</span>
        </div>
      </div>
    </div>
  )
}
