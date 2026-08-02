import { GAME_KEYS, GAME_LABELS, type GameFilter, type GameKey } from '../lib/games'

// Game-variant picker (NLHE / PLO) for the database browser and the graph.
// Single-select — unlike stakes, pooling variants is exactly what the filter
// exists to undo. Only variants actually present are offered; `counts` is what
// tells us which those are, so a table with no PLO never shows a dead PLO pill.
export default function GameFilter({ counts, selected, onChange, label = 'Game' }: {
  counts: Record<GameKey, number>
  selected: GameFilter
  onChange: (game: GameFilter) => void
  label?: string
}) {
  const present = GAME_KEYS.filter(k => counts[k] > 0)
  // Nothing to choose between — one variant (or no hands at all).
  if (present.length < 2) return null

  const total = present.reduce((n, k) => n + counts[k], 0)
  const pill = (on: boolean) =>
    `px-2.5 py-1 border-l border-gray-800 first:border-l-0 transition-colors ${
      on ? 'bg-yellow-500/20 text-yellow-300' : 'text-gray-400 hover:text-white'}`

  return (
    <div className="flex items-center gap-1.5 text-xs">
      <span className="uppercase tracking-wide text-gray-500">{label}</span>
      <div className="flex rounded-full border border-gray-700 overflow-hidden">
        <button onClick={() => onChange('all')} className={pill(selected === 'all')} title={`${total.toLocaleString()} hands`}>
          All
        </button>
        {present.map(k => (
          <button
            key={k}
            onClick={() => onChange(k)}
            title={`${counts[k].toLocaleString()} ${GAME_LABELS[k]} hands`}
            className={pill(selected === k)}
          >
            {GAME_LABELS[k]}
            <span className="ml-1 text-gray-600">{counts[k].toLocaleString()}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
