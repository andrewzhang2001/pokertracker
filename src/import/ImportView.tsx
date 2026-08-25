import HandReplayer from '../shared/replayer/HandReplayer'
import MapPlayersModal from './MapPlayersModal'
import type { Assignment, Identity } from './MapPlayersModal'
import type { ParsedHand } from '../shared/poker/types'

// The import surface: paste/upload a hand history, review the parsed hands in
// the replayer, then export them to the database. PokerNow logs carry player
// identities, so the map step gates export until each seat has a profile.
//
// The parsed hands and the export state live in App — they survive navigating
// away from /import — so this component is presentational.
export default function ImportView({
  hands, notes, pasteText, onPasteText, error, exportState, exportMsg,
  identities, assignments, mapOpen, mapMode,
  onLoadFiles, onLoadText, onReset, onOpenAssign, onStartExport,
  onCancelMap, onConfirmMap, onUpdateNote, onNavigate,
}: {
  hands: ParsedHand[]
  notes: string[]
  pasteText: string
  onPasteText: (value: string) => void
  error: string | null
  exportState: 'idle' | 'busy' | 'done' | 'error'
  exportMsg: string
  identities: Identity[]
  assignments: Assignment[] | null
  mapOpen: boolean
  mapMode: 'assign' | 'export'
  onLoadFiles: (files: FileList | null) => void
  onLoadText: (text: string) => void
  onReset: () => void
  onOpenAssign: () => void
  onStartExport: () => void
  onCancelMap: () => void
  onConfirmMap: (assignments: Assignment[]) => void
  onUpdateNote: (index: number, value: string) => void
  onNavigate: (to: string) => void
}) {
  if (!hands.length) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 gap-4">
        <h1 className="text-3xl font-bold text-white">Import hands</h1>
        <p className="text-gray-400">Upload or paste an Ignition hand history (.txt) or PokerNow log (.csv) — format is auto-detected</p>

        <label className="w-full max-w-2xl cursor-pointer">
          <input
            type="file"
            accept=".txt,.csv,text/plain,text/csv"
            multiple
            className="hidden"
            onChange={e => { onLoadFiles(e.target.files); e.target.value = '' }}
          />
          <div className="border-2 border-dashed border-gray-700 hover:border-yellow-500 rounded-lg p-6 text-center text-sm text-gray-400 hover:text-yellow-400 transition-colors">
            📄 Choose file(s) — Ignition .txt or PokerNow .csv, you can select multiple
          </div>
        </label>

        <div className="text-xs text-gray-600">— or paste below —</div>

        <textarea
          className="w-full max-w-2xl h-48 bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 focus:outline-none focus:border-yellow-500 resize-none font-mono"
          placeholder="Paste hand history here..."
          value={pasteText}
          onChange={e => onPasteText(e.target.value)}
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div className="flex gap-3">
          <button
            onClick={() => onNavigate('/')}
            className="px-6 py-2 border border-gray-700 text-gray-300 hover:text-white rounded-lg transition-colors"
          >
            ← Home
          </button>
          <button
            onClick={() => onLoadText(pasteText)}
            disabled={!pasteText.trim()}
            className="px-6 py-2 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold rounded-lg transition-colors"
          >
            Load hands
          </button>
        </div>
      </div>
    )
  }

  const assignBtn = identities.length > 0 && (
    <button
      onClick={onOpenAssign}
      disabled={exportState === 'busy'}
      className={`text-xs px-3 py-1 rounded-full border transition-colors ${
        assignments ? 'border-green-600 text-green-400 bg-green-600/10' : 'border-gray-600 text-gray-300 hover:text-white'
      }`}
      title="Map PokerNow players to profiles before exporting"
    >
      {assignments ? '✓ Players assigned' : `Assign players (${identities.length})`}
    </button>
  )

  // PokerNow imports must have their players assigned before export is allowed.
  const needsAssign = identities.length > 0 && !assignments
  const exportBtn = (
    <button
      onClick={onStartExport}
      disabled={exportState === 'busy' || needsAssign}
      title={needsAssign ? 'Assign players to profiles first' : exportState === 'error' ? exportMsg : undefined}
      className={`text-xs px-3 py-1 rounded-full border transition-colors disabled:opacity-60 ${
        exportState === 'done'
          ? 'border-green-600 text-green-400 bg-green-600/10'
          : exportState === 'error'
          ? 'border-red-600 text-red-400 bg-red-600/10'
          : 'border-yellow-600 text-yellow-400 bg-yellow-600/10 hover:bg-yellow-600/20'
      }`}
    >
      {exportState === 'busy' ? (exportMsg || 'Saving…')
        : exportState === 'done' ? exportMsg
        : exportState === 'error' ? (exportMsg || 'Export failed')
        : needsAssign ? `Assign players first`
        : `Export ${hands.length} → Database`}
    </button>
  )

  return (
    <>
      <HandReplayer
        key={`import-${hands.length}`}
        hands={hands}
        handNotes={notes}
        onUpdateNote={onUpdateNote}
        onBack={onReset}
        backLabel="← Home"
        topBarExtra={<>{assignBtn}{exportBtn}</>}
      />
      {mapOpen && (
        <MapPlayersModal
          identities={identities}
          initial={assignments ?? undefined}
          confirmLabel={mapMode === 'export' ? 'Save & export' : 'Save assignments'}
          onCancel={onCancelMap}
          onConfirm={onConfirmMap}
        />
      )}
    </>
  )
}
