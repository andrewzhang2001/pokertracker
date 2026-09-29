import { useEffect, useMemo, useRef, useState } from 'react'
import { sawFlop } from '../shared/poker/profileStats'
import { voluntarilyEntered } from '../shared/poker/analyzeHand'
import { computeHandState } from '../shared/poker/computeHandState'
import { displayPosition } from '../shared/poker/positionUtils'
import { netForSeat } from '../shared/poker/graph'
import type { ParsedHand } from '../shared/poker/types'
import PlayingCard from '../shared/replayer/PlayingCard'
import { fmtNet, netTone } from '../shared/ui/net'
import InlineHandViewer from './InlineHandViewer'

type SeatHand = { hand: ParsedHand; seat: number }

const FILTERS = [
  { key: 'vpip', label: 'VPIP', title: 'They called, bet, or raised', keep: (h: SeatHand) => voluntarilyEntered(h.hand, h.seat) },
  { key: 'postflop', label: 'Saw flop', title: 'They were still in when the flop was dealt', keep: (h: SeatHand) => sawFlop(h.hand, h.seat) },
] as const
type FilterKey = typeof FILTERS[number]['key']

const newestFirst = (a: SeatHand, b: SeatHand) => (b.hand.playedAt ?? 0) - (a.hand.playedAt ?? 0)

const fmtWhen = (playedAt: number | null) =>
  playedAt == null ? '—' : new Date(playedAt).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

// This profile's hands, newest first, narrowed by the active filters (all must
// match). Clicking a row opens that hand in a viewer beside the list; ↑ ↓ in the
// viewer walk the visible list.
export default function ProfileHands({ hands, onExpand }: {
  hands: SeatHand[]
  onExpand: (visible: ParsedHand[], index: number) => void
}) {
  const [active, setActive] = useState<Set<FilterKey>>(new Set())
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const toggle = (key: FilterKey) => setActive(prev => {
    const next = new Set(prev)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    return next
  })

  const visible = useMemo(() => {
    const activeFilters = FILTERS.filter(f => active.has(f.key))
    return hands.filter(h => activeFilters.every(f => f.keep(h))).sort(newestFirst)
  }, [hands, active])

  // The open hand stays open when a filter hides it; ↓ then starts from the top.
  const selected = hands.find(h => h.hand.handId === selectedId) ?? null
  const selectedIndex = visible.findIndex(h => h.hand.handId === selectedId)
  const stepHand = (delta: number) => {
    const next = visible[selectedIndex + delta]
    if (next) setSelectedId(next.hand.handId)
  }
  const expand = () => onExpand(visible.map(h => h.hand), Math.max(0, selectedIndex))

  return (
    <>
      <aside className="w-full xl:w-80 shrink-0 flex flex-col gap-2 xl:sticky xl:top-6 xl:max-h-[calc(100vh-3rem)]">
        <div className="flex items-center gap-2">
          <div className="text-xs uppercase tracking-wide text-gray-500">Hands</div>
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => toggle(f.key)}
              title={f.title}
              className={`text-xs px-2.5 py-0.5 rounded-full border transition-colors ${active.has(f.key) ? 'border-yellow-600 bg-yellow-500/20 text-yellow-300' : 'border-gray-700 text-gray-400 hover:text-white'}`}
            >
              {f.label}
            </button>
          ))}
          <span className="ml-auto text-xs text-gray-600">{visible.length}</span>
        </div>

        <div className="overflow-y-auto rounded-lg border border-gray-800 divide-y divide-gray-900">
          {visible.length === 0 && <div className="px-3 py-4 text-sm text-gray-500">No hands match.</div>}
          {visible.map(h => (
            <HandRow key={h.hand.handId} {...h} selected={h.hand.handId === selectedId} onClick={() => setSelectedId(h.hand.handId)} />
          ))}
        </div>
      </aside>

      <section className="w-full flex-1 min-w-0 flex flex-col rounded-lg border border-gray-800 bg-black/30 p-3 xl:sticky xl:top-6 xl:h-[calc(100vh-3rem)]">
        {selected
          ? (
            <InlineHandViewer
              key={selected.hand.handId}
              hand={selected.hand}
              onHand={stepHand}
              onExpand={expand}
              onClose={() => setSelectedId(null)}
            />
          )
          : <div className="flex-1 flex items-center justify-center py-12 text-sm text-gray-600">Click a hand to view it here.</div>}
      </section>
    </>
  )
}

function HandRow({ hand, seat, selected, onClick }: SeatHand & { selected: boolean; onClick: () => void }) {
  const player = hand.players.find(p => p.seatNumber === seat)
  const pos = player ? displayPosition(player.position, hand.players.length) : '?'
  const holeCards = useMemo(
    () => computeHandState(hand, hand.actions.length - 1).players.find(p => p.seatNumber === seat)?.holeCards ?? null,
    [hand, seat],
  )
  const net = netForSeat(hand, seat)

  // Keep the open hand visible as ↑ ↓ move the selection.
  const ref = useRef<HTMLButtonElement>(null)
  useEffect(() => { if (selected) ref.current?.scrollIntoView({ block: 'nearest' }) }, [selected])

  return (
    <button
      ref={ref}
      onClick={onClick}
      className={`w-full flex items-center gap-3 px-3 py-1.5 text-left transition-colors ${selected ? 'bg-yellow-500/15' : 'hover:bg-gray-800/60'}`}
    >
      <span className="w-10 text-xs text-white font-medium">{pos}</span>
      <span className="flex gap-0.5 min-w-[48px]">
        {holeCards
          ? holeCards.map((c, i) => <PlayingCard key={i} card={c} tiny />)
          : <span className="text-xs text-gray-600">—</span>}
      </span>
      <span className="flex-1 text-xs text-gray-500">{fmtWhen(hand.playedAt)}</span>
      <span className={`text-xs tabular-nums ${netTone(net, voluntarilyEntered(hand, seat))}`}>{fmtNet(net)}</span>
    </button>
  )
}
