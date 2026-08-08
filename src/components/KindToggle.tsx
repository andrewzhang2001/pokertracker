import type { TableKind } from '../lib/positionUtils'

// Top-level 6-max ⇄ heads-up switch shared by Reports/Leakbuster/Postflop.
export function KindToggle({ kind, onChange }: { kind: TableKind; onChange: (k: TableKind) => void }) {
  return (
    <div className="flex rounded-full border border-gray-700 overflow-hidden text-xs">
      {(['sixmax', 'hu'] as TableKind[]).map(k => (
        <button
          key={k}
          onClick={() => onChange(k)}
          className={`px-3 py-1 transition-colors ${kind === k ? 'bg-yellow-500/20 text-yellow-300' : 'text-gray-400 hover:text-white'}`}
        >
          {k === 'sixmax' ? '6-max' : 'Heads-up'}
        </button>
      ))}
    </div>
  )
}
