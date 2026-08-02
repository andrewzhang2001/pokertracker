import type { StakeOption } from '../lib/stakes'

// Stake picker for the reports — a pill row of the stakes actually present in
// the loaded sample. Multi-select (5NL + 25NL pooled); "All" clears it.
export default function StakeFilter({ options, selected, onChange }: {
  options: StakeOption[]
  selected: string[]
  onChange: (keys: string[]) => void
}) {
  if (!options.length) return null
  const toggle = (key: string) =>
    onChange(selected.includes(key) ? selected.filter(k => k !== key) : [...selected, key])
  const pill = (on: boolean) =>
    `px-2.5 py-1 border-l border-gray-800 first:border-l-0 transition-colors ${
      on ? 'bg-yellow-500/20 text-yellow-300' : 'text-gray-400 hover:text-white'}`

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="uppercase tracking-wide text-gray-500">Stake</span>
      <div className="flex rounded-full border border-gray-700 overflow-hidden">
        <button onClick={() => onChange([])} className={pill(selected.length === 0)}>All</button>
        {options.map(o => (
          <button
            key={o.stake.key}
            onClick={() => toggle(o.stake.key)}
            title={`${o.hands.toLocaleString()} hands at ${o.stake.label}`}
            className={pill(selected.includes(o.stake.key))}
          >
            {o.stake.label}
            <span className="ml-1 text-gray-600">{o.hands.toLocaleString()}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
