import { useMemo } from 'react'
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
  selected: Set<number>
  onSelect: (idx: number, checked: boolean) => void
  onSelectAll: () => void
  onClickHand: (idx: number) => void
  onShareSelected: () => void
  sharingSelected: boolean
  copiedSelected: boolean
  enableShare?: boolean
}

export default function HandSummaryPanel({
  hands, handIndex, handNotes, selected, onSelect, onSelectAll, onClickHand,
  onShareSelected, sharingSelected, copiedSelected, enableShare = true,
}: Props) {
  const summaries = useMemo(() => hands.map((h, i) => computeSummary(h, i)), [hands])

  const allSelected = hands.length > 0 && selected.size === hands.length
  const someSelected = selected.size > 0

  return (
    <div className="w-60 border-r border-gray-800 flex flex-col bg-black/30 overflow-hidden shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-2 py-2 border-b border-gray-800 gap-2 shrink-0">
        <label className="flex items-center gap-1.5 cursor-pointer text-xs text-gray-400 select-none">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={onSelectAll}
            className="accent-yellow-500"
          />
          {selected.size > 0 ? `${selected.size} / ${hands.length}` : `${hands.length} hands`}
        </label>
        {enableShare && (
          <button
            onClick={onShareSelected}
            disabled={!someSelected || sharingSelected}
            className={`text-xs px-2 py-1 rounded-full border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${
              copiedSelected
                ? 'border-green-600 text-green-400 bg-green-600/10'
                : 'border-blue-600 text-blue-400 bg-blue-600/10 hover:bg-blue-600/20'
            }`}
          >
            {sharingSelected ? '…' : copiedSelected ? 'Copied!' : 'Share'}
          </button>
        )}
      </div>

      {/* Rows */}
      <div className="overflow-y-auto flex-1">
        {summaries.map(s => {
          const isActive = s.index === handIndex
          const isChecked = selected.has(s.index)
          const netColor = s.participated
            ? s.netBB > 0 ? 'text-green-400' : s.netBB < 0 ? 'text-red-400' : 'text-gray-500'
            : 'text-gray-500'

          return (
            <div
              key={s.index}
              className={`flex items-center gap-1 px-2 py-1.5 cursor-pointer border-b border-gray-800/50 hover:bg-white/5 transition-colors ${isActive ? 'bg-yellow-500/10' : ''}`}
              onClick={() => onClickHand(s.index)}
            >
              <input
                type="checkbox"
                checked={isChecked}
                onChange={e => { e.stopPropagation(); onSelect(s.index, e.target.checked) }}
                onClick={e => e.stopPropagation()}
                className="accent-yellow-500 shrink-0 cursor-pointer"
              />
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
    </div>
  )
}
