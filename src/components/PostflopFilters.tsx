import { useEffect, useRef, useState } from 'react'
import { RANKS_DESC, type PostflopFilter } from '../lib/postflop'

type RankKey = 'flopHigh' | 'flopMid' | 'flopLow'
type Street = 'flop' | 'turn' | 'river'

// The three filter fields each street drives.
const STREET_KEYS: Record<Street, { suit: keyof PostflopFilter; straight: keyof PostflopFilter; paired: keyof PostflopFilter }> = {
  flop: { suit: 'suits', straight: 'straight', paired: 'paired' },
  turn: { suit: 'turnSuits', straight: 'turnStraight', paired: 'turnPaired' },
  river: { suit: 'riverSuits', straight: 'riverStraight', paired: 'riverPaired' },
}

// Suit texture options by flush potential — street-specific (double flush draw
// only on the turn; the river is just flush vs no-flush since draws can't complete).
const SUIT_OPTS: Record<Street, [string, string][]> = {
  flop: [['any', 'suit —'], ['nofd', 'no fd'], ['fd', 'flush draw'], ['flush', 'flush']],
  turn: [['any', 'suit —'], ['nofd', 'no fd'], ['fd', 'flush draw'], ['dfd', 'double fd'], ['flush', 'flush']],
  river: [['any', 'suit —'], ['nofd', 'no flush'], ['flush', 'flush']],
}
const PAIR_OPTS: [string, string][] = [['any', 'pair —'], ['yes', 'paired'], ['no', 'unpaired']]
const STR_OPTS: [string, string][] = [['any', 'str —'], ['yes', 'straight'], ['no', 'no straight']]

function Sel({ value, onChange, opts }: { value: string; onChange: (v: string) => void; opts: [string, string][] }) {
  return (
    <select value={value} onChange={e => onChange(e.target.value)}
      className="bg-gray-900 border border-gray-700 rounded px-1 py-0.5 text-gray-200 focus:outline-none focus:border-yellow-500">
      {opts.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
    </select>
  )
}

// The flop card-rank grid (high / 2nd / 3rd row), shown in a popover.
function FlopCards({ filter, onChange }: { filter: PostflopFilter; onChange: (patch: Partial<PostflopFilter>) => void }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const active = filter.flopHigh.length + filter.flopMid.length + filter.flopLow.length > 0

  // Close the popover on any click/tap outside it.
  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false) }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])
  const toggle = (k: RankKey, r: string) => {
    const cur = filter[k]
    onChange({ [k]: cur.includes(r) ? cur.filter(x => x !== r) : [...cur, r] } as Partial<PostflopFilter>)
  }
  const Row = ({ label, k }: { label: string; k: RankKey }) => (
    <div className="flex items-center gap-1">
      <span className="w-14 text-[10px] uppercase tracking-wide text-gray-500">{label}</span>
      {RANKS_DESC.map(r => {
        const on = filter[k].includes(r)
        return (
          <button key={r} onClick={() => toggle(k, r)}
            className={`w-6 h-6 rounded text-xs transition-colors ${on
              ? 'bg-yellow-500/30 text-yellow-200 border border-yellow-500'
              : 'bg-gray-900 text-gray-400 border border-gray-700 hover:border-gray-500'}`}>
            {r}
          </button>
        )
      })}
    </div>
  )
  return (
    <div className="relative" ref={ref}>
      <button onClick={() => setOpen(o => !o)}
        className={`rounded border px-2 py-0.5 transition-colors ${active
          ? 'border-yellow-500 text-yellow-200' : 'border-gray-700 text-gray-300 hover:border-gray-500'}`}>
        cards{active ? ' •' : ''}
      </button>
      {open && (
        <div className="absolute right-0 z-30 mt-1 rounded-lg border border-gray-700 bg-gray-950 p-3 shadow-xl flex flex-col gap-1.5">
          <Row label="High" k="flopHigh" />
          <Row label="2nd high" k="flopMid" />
          <Row label="3rd high" k="flopLow" />
          <div className="flex justify-between items-center mt-1">
            <span className="text-[10px] text-gray-600">rank of the highest / 2nd / 3rd flop card · pairs match either row</span>
            <button onClick={() => onChange({ flopHigh: [], flopMid: [], flopLow: [] })}
              className="text-[10px] text-gray-500 hover:text-white">clear</button>
          </div>
        </div>
      )}
    </div>
  )
}

// One street's controls: suit + straight + pair (+ the flop card grid on the flop).
export function StreetFilters({ filter, onChange, street }: {
  filter: PostflopFilter
  onChange: (patch: Partial<PostflopFilter>) => void
  street: Street
}) {
  const k = STREET_KEYS[street]
  const set = (key: keyof PostflopFilter) => (v: string) => onChange({ [key]: v } as Partial<PostflopFilter>)
  return (
    <div className="flex items-center gap-1 text-xs text-gray-400">
      <Sel value={filter[k.suit] as string} onChange={set(k.suit)} opts={SUIT_OPTS[street]} />
      <Sel value={filter[k.straight] as string} onChange={set(k.straight)} opts={STR_OPTS} />
      <Sel value={filter[k.paired] as string} onChange={set(k.paired)} opts={PAIR_OPTS} />
      {street === 'flop' && <FlopCards filter={filter} onChange={onChange} />}
    </div>
  )
}

// Compact stacked block (one row per street) for the drill-down detail view.
export default function PostflopFilters({ filter, onChange }: {
  filter: PostflopFilter
  onChange: (patch: Partial<PostflopFilter>) => void
}) {
  return (
    <div className="flex flex-col gap-1">
      {(['flop', 'turn', 'river'] as Street[]).map(s => (
        <div key={s} className="flex items-center gap-2">
          <span className="w-10 text-[10px] uppercase tracking-wide text-gray-500">{s}</span>
          <StreetFilters filter={filter} onChange={onChange} street={s} />
        </div>
      ))}
    </div>
  )
}
