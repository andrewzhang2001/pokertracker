import { GAMES, type GameKind } from '../lib/games'

// Top-level PLO ⇄ NLHE switch — a second dimension alongside the 6-max/HU toggle.
export function GameToggle({ game, onChange }: { game: GameKind; onChange: (g: GameKind) => void }) {
  return (
    <div className="flex rounded-full border border-gray-700 overflow-hidden text-xs">
      {(Object.keys(GAMES) as GameKind[]).map(g => (
        <button
          key={g}
          onClick={() => onChange(g)}
          className={`px-3 py-1 transition-colors ${game === g ? 'bg-yellow-500/20 text-yellow-300' : 'text-gray-400 hover:text-white'}`}
        >
          {GAMES[g].label}
        </button>
      ))}
    </div>
  )
}
