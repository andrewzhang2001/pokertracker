import HandReplayer from '../shared/replayer/HandReplayer'
import CenteredMessage from '../shared/ui/CenteredMessage'
import type { ParsedHand } from '../shared/poker/types'
import type { VpipFilter } from '../shared/api/handsApi'

// The personal hand browser: one server-fetched page at a time in the replayer,
// with a VPIP filter and a pager in the top bar.
//
// The page/filter state and the fetch live in App, not here — leaving the view
// and coming back must keep the page you were on, and this component unmounts
// when you navigate away.
export default function DatabaseView({
  status, error, loadedKey, hands, notes, counts, page, pageCount, pageSize,
  landOn, vpipFilter, onVpipFilter, onGoToPage, onUpdateNote, onNavigate,
}: {
  status: 'idle' | 'loading' | 'error'
  error: string | null
  loadedKey: string | null
  hands: ParsedHand[]
  notes: string[]
  counts: { total: number; filtered: number }
  page: number
  pageCount: number
  pageSize: number
  landOn: 'first' | 'last'
  vpipFilter: VpipFilter
  onVpipFilter: (next: VpipFilter) => void
  onGoToPage: (next: number, landOn?: 'first' | 'last') => void
  onUpdateNote: (index: number, value: string) => void
  onNavigate: (to: string) => void
}) {
  // Only block the whole screen on the first load; later page/filter fetches
  // keep the current page on screen and show a spinner in the top bar.
  if (status === 'loading' && loadedKey === null) {
    return <CenteredMessage title="Loading hands…" onBack={() => onNavigate('/')} />
  }
  if (status === 'error') {
    return <CenteredMessage title="Couldn't load hands" detail={error ?? ''} onBack={() => onNavigate('/')} />
  }
  if (!counts.total) {
    return <CenteredMessage title="No hands saved yet" detail="Import some hands and export them to your database." onBack={() => onNavigate('/')} />
  }

  const loading = status === 'loading'
  const firstShown = page * pageSize + 1
  const lastShown = page * pageSize + hands.length

  const filterBar = (
    <div className="flex items-center gap-3">
      <label className="flex items-center gap-1.5 text-xs text-gray-400">
        VPIP
        <select
          value={vpipFilter}
          onChange={e => onVpipFilter(e.target.value as VpipFilter)}
          className="bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-gray-200 focus:outline-none focus:border-yellow-500"
        >
          <option value="all">All</option>
          <option value="yes">VPIP only</option>
          <option value="no">No VPIP</option>
        </select>
        {/* matching / total — only differs when a filter is on */}
        <span className="text-gray-600">
          {counts.filtered}{vpipFilter !== 'all' ? `/${counts.total}` : ''}
        </span>
      </label>
      {counts.filtered > 0 && (
        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <button
            onClick={() => onGoToPage(page - 1, 'first')}
            disabled={page === 0 || loading}
            title="Newer hands"
            className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30"
          >‹</button>
          <span className="tabular-nums">
            {loading ? '…' : `${firstShown}–${lastShown}`} of {counts.filtered}
          </span>
          <button
            onClick={() => onGoToPage(page + 1, 'first')}
            disabled={page >= pageCount - 1 || loading}
            title="Older hands"
            className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30"
          >›</button>
          <span className="text-gray-600">pg {page + 1}/{pageCount}</span>
        </div>
      )}
    </div>
  )

  if (!counts.filtered) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 gap-4">
        <h1 className="text-2xl font-bold text-white">No hands match this filter</h1>
        <div>{filterBar}</div>
        <button onClick={() => onVpipFilter('all')} className="px-6 py-2 border border-gray-700 text-gray-300 hover:text-white rounded-lg transition-colors">Reset filter</button>
        <button onClick={() => onNavigate('/')} className="text-xs text-gray-500 hover:text-white">← Home</button>
      </div>
    )
  }

  return (
    <HandReplayer
      // Remount per loaded page so the hand cursor resets to the right edge.
      key={`db-${loadedKey}`}
      hands={hands}
      handNotes={notes}
      initialHandIndex={landOn === 'last' ? Math.max(0, hands.length - 1) : 0}
      onUpdateNote={onUpdateNote}
      // ↑/↓ off either end of the page continues into the adjacent one. Gated
      // on `loading` like the pager buttons: the page cursor has already moved
      // while a fetch is in flight, so a held key would otherwise skip pages.
      onPastStart={page > 0 && !loading ? () => onGoToPage(page - 1, 'last') : undefined}
      onPastEnd={page < pageCount - 1 && !loading ? () => onGoToPage(page + 1, 'first') : undefined}
      onBack={() => onNavigate('/')}
      backLabel="← Home"
      topBarExtra={filterBar}
    />
  )
}
