import type { SiteFilter } from '../api/handsApi'

const SITES: { key: SiteFilter; label: string }[] = [
  { key: '', label: 'All sites' },
  { key: 'ignition', label: 'Ignition' },
  { key: 'pokernow', label: 'PokerNow' },
]

// Which site's hands to include: all, Ignition only, or PokerNow only.
export function SiteToggle({ site, onChange }: { site: SiteFilter; onChange: (s: SiteFilter) => void }) {
  return (
    <div className="flex rounded-full border border-gray-700 overflow-hidden text-xs">
      {SITES.map(s => (
        <button
          key={s.key || 'all'}
          onClick={() => onChange(s.key)}
          className={`px-3 py-1 transition-colors ${site === s.key ? 'bg-yellow-500/20 text-yellow-300' : 'text-gray-400 hover:text-white'}`}
        >
          {s.label}
        </button>
      ))}
    </div>
  )
}
