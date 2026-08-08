import type { DateRange } from '../lib/handsApi'

// A "YYYY-MM" month string → epoch ms. `end` gives the EXCLUSIVE upper bound
// (start of the following month), so a from–to month range is inclusive of both
// end months. Empty string → null (that side unbounded).
export function monthToMs(m: string, end: boolean): number | null {
  if (!m) return null
  const [y, mo] = m.split('-').map(Number)
  if (!y || !mo) return null
  return new Date(y, end ? mo : mo - 1, 1).getTime() // JS rolls mo=12 → Jan next year
}
export const monthRange = (from: string, to: string): DateRange => ({ from: monthToMs(from, false), to: monthToMs(to, true) })

// Month-granularity date range (inclusive). Empty = all-time.
export function MonthRange({ from, to, onChange }: { from: string; to: string; onChange: (from: string, to: string) => void }) {
  const cls = 'bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-gray-200 focus:outline-none focus:border-yellow-500 [color-scheme:dark]'
  return (
    <div className="flex items-center gap-1 text-xs text-gray-400">
      <input type="month" value={from} max={to || undefined} onChange={e => onChange(e.target.value, to)} className={cls} aria-label="from month" />
      <span className="text-gray-500">–</span>
      <input type="month" value={to} min={from || undefined} onChange={e => onChange(from, e.target.value)} className={cls} aria-label="to month" />
      {(from || to) && <button onClick={() => onChange('', '')} className="text-gray-500 hover:text-white ml-1" title="clear (all-time)">all</button>}
    </div>
  )
}
