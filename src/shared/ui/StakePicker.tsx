import { useEffect } from 'react'
import { type StakeInfo, stakeKey, stakeLabel } from '../api/handsApi'

// Stake dropdown. Value is the composite stake key ('' = all stakes). The list
// is the distinct stakes present in the relevant pool (fetched by the parent).
// When the list changes (another game or site) and no longer holds the selected
// stake, the selection resets to all stakes.
export function StakePicker({ stakes, value, onChange }: {
  stakes: StakeInfo[]
  value: string
  onChange: (stake: string) => void
}) {
  const selectionGone = value !== '' && !stakes.some(s => stakeKey(s) === value)
  useEffect(() => { if (selectionGone) onChange('') }, [selectionGone, onChange])

  const cls = 'bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-gray-200 focus:outline-none focus:border-yellow-500 [color-scheme:dark]'
  return (
    <select value={value} onChange={e => onChange(e.target.value)} className={cls} aria-label="stake">
      <option value="">All stakes</option>
      {stakes.map(s => {
        const key = stakeKey(s)
        return <option key={key} value={key}>{stakeLabel(s)} · {s.count}</option>
      })}
    </select>
  )
}
