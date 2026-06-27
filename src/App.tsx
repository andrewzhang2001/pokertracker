import { useState, useEffect } from 'react'
import { parseHandHistories, diagnose } from './lib/parseHandHistory'
import { loadShareById, decodeLegacyShare } from './lib/shareUrl'
import { exportHandsToDb, fetchHandsFromDb } from './lib/handsApi'
import { dedupeAndSort } from './lib/mergeHands'
import type { ParsedHand } from './lib/types'
import HandReplayer from './components/HandReplayer'

type View = 'landing' | 'import' | 'database'

export default function App() {
  const [view, setView] = useState<View>('landing')

  // import view state
  const [importHands, setImportHands] = useState<ParsedHand[]>([])
  const [importNotes, setImportNotes] = useState<string[]>([])
  const [pasteText, setPasteText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [exportState, setExportState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [exportMsg, setExportMsg] = useState('')

  // database view state
  const [dbHands, setDbHands] = useState<ParsedHand[]>([])
  const [dbNotes, setDbNotes] = useState<string[]>([])
  const [dbStatus, setDbStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [dbError, setDbError] = useState<string | null>(null)

  // Decode shared link on first load — supports #id= (new) and #h= (legacy)
  useEffect(() => {
    const hash = window.location.hash
    let promise: Promise<{ rawText: string; handNotes: string[] }> | null = null
    if (hash.startsWith('#id=')) promise = loadShareById(hash.slice(4))
    else if (hash.startsWith('#h=')) promise = decodeLegacyShare(hash.slice(3))
    if (!promise) return
    promise.then(({ rawText, handNotes }) => {
      const parsed = parseHandHistories(rawText)
      if (parsed.length) {
        setImportHands(parsed)
        setImportNotes(Array.from({ length: parsed.length }, (_, i) => handNotes[i] ?? ''))
        setView('import')
      }
    }).catch(() => {})
  }, [])

  function loadText(text: string) {
    const parsed = dedupeAndSort(parseHandHistories(text))
    if (!parsed.length) {
      setError(`No hands parsed. ${diagnose(text)}`)
      return
    }
    setError(null)
    setImportHands(parsed)
    setImportNotes(new Array(parsed.length).fill(''))
    setExportState('idle')
    history.replaceState(null, '', window.location.pathname)
  }

  async function loadFiles(fileList: FileList | null) {
    if (!fileList || !fileList.length) return
    try {
      const texts = await Promise.all(Array.from(fileList).map(f => f.text()))
      loadText(texts.join('\n\n'))
    } catch (e) {
      setError(`Couldn't read file(s): ${String((e as Error).message ?? e)}`)
    }
  }

  function backToLanding() {
    setView('landing')
    history.replaceState(null, '', window.location.pathname)
  }

  function resetImport() {
    setImportHands([])
    setPasteText('')
    setImportNotes([])
    setExportState('idle')
    setView('landing')
    history.replaceState(null, '', window.location.pathname)
  }

  async function openDatabase() {
    setView('database')
    setDbStatus('loading')
    setDbError(null)
    try {
      const { hands, notes } = await fetchHandsFromDb()
      setDbHands(hands)
      setDbNotes(notes)
      setDbStatus('idle')
    } catch (e) {
      setDbError(String((e as Error).message ?? e))
      setDbStatus('error')
    }
  }

  async function handleExport() {
    setExportState('busy')
    try {
      const n = await exportHandsToDb(importHands, importNotes)
      setExportState('done')
      setExportMsg(`Saved ${n}`)
      setTimeout(() => setExportState('idle'), 2500)
    } catch (e) {
      setExportState('error')
      setExportMsg(String((e as Error).message ?? e))
      setTimeout(() => setExportState('idle'), 3500)
    }
  }

  // ---- Landing ----
  if (view === 'landing') {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 gap-8">
        <h1 className="text-4xl font-bold text-white">Poker Hand Tracker</h1>
        <div className="flex flex-col sm:flex-row gap-6">
          <button
            onClick={openDatabase}
            className="w-64 h-44 rounded-xl border border-gray-700 bg-gray-900 hover:border-yellow-500 hover:bg-gray-800 transition-colors flex flex-col items-center justify-center gap-3 text-center px-6"
          >
            <span className="text-3xl">🗄️</span>
            <span className="text-lg font-semibold text-white">View Database</span>
            <span className="text-xs text-gray-500">Browse and filter your saved hands</span>
          </button>
          <button
            onClick={() => { setView('import'); setError(null) }}
            className="w-64 h-44 rounded-xl border border-gray-700 bg-gray-900 hover:border-yellow-500 hover:bg-gray-800 transition-colors flex flex-col items-center justify-center gap-3 text-center px-6"
          >
            <span className="text-3xl">📥</span>
            <span className="text-lg font-semibold text-white">Import</span>
            <span className="text-xs text-gray-500">Paste a hand history to review, then export to your database</span>
          </button>
        </div>
      </div>
    )
  }

  // ---- Database ----
  if (view === 'database') {
    if (dbStatus === 'loading') {
      return <CenteredMessage title="Loading hands…" onBack={backToLanding} />
    }
    if (dbStatus === 'error') {
      return <CenteredMessage title="Couldn't load hands" detail={dbError ?? ''} onBack={backToLanding} />
    }
    if (!dbHands.length) {
      return <CenteredMessage title="No hands saved yet" detail="Import some hands and export them to your database." onBack={backToLanding} />
    }
    return (
      <HandReplayer
        key={`db-${dbHands.length}`}
        hands={dbHands}
        handNotes={dbNotes}
        onUpdateNote={(idx, value) => setDbNotes(prev => { const n = [...prev]; n[idx] = value; return n })}
        onBack={backToLanding}
        backLabel="← Home"
        topBarExtra={<span className="text-xs text-gray-600">Filters coming soon</span>}
      />
    )
  }

  // ---- Import ----
  if (!importHands.length) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-8 gap-4">
        <h1 className="text-3xl font-bold text-white">Import hands</h1>
        <p className="text-gray-400">Upload or paste your Ignition hand history (NLHE &amp; PLO supported)</p>

        <label className="w-full max-w-2xl cursor-pointer">
          <input
            type="file"
            accept=".txt,text/plain"
            multiple
            className="hidden"
            onChange={e => { loadFiles(e.target.files); e.target.value = '' }}
          />
          <div className="border-2 border-dashed border-gray-700 hover:border-yellow-500 rounded-lg p-6 text-center text-sm text-gray-400 hover:text-yellow-400 transition-colors">
            📄 Choose hand history file(s) — you can select multiple
          </div>
        </label>

        <div className="text-xs text-gray-600">— or paste below —</div>

        <textarea
          className="w-full max-w-2xl h-48 bg-gray-900 border border-gray-700 rounded-lg p-3 text-sm text-gray-200 focus:outline-none focus:border-yellow-500 resize-none font-mono"
          placeholder="Paste hand history here..."
          value={pasteText}
          onChange={e => setPasteText(e.target.value)}
        />
        {error && <p className="text-red-400 text-sm">{error}</p>}
        <div className="flex gap-3">
          <button
            onClick={backToLanding}
            className="px-6 py-2 border border-gray-700 text-gray-300 hover:text-white rounded-lg transition-colors"
          >
            ← Home
          </button>
          <button
            onClick={() => loadText(pasteText)}
            disabled={!pasteText.trim()}
            className="px-6 py-2 bg-yellow-500 hover:bg-yellow-400 disabled:opacity-40 disabled:cursor-not-allowed text-black font-semibold rounded-lg transition-colors"
          >
            Load hands
          </button>
        </div>
      </div>
    )
  }

  const exportBtn = (
    <button
      onClick={handleExport}
      disabled={exportState === 'busy'}
      title={exportState === 'error' ? exportMsg : undefined}
      className={`text-xs px-3 py-1 rounded-full border transition-colors disabled:opacity-60 ${
        exportState === 'done'
          ? 'border-green-600 text-green-400 bg-green-600/10'
          : exportState === 'error'
          ? 'border-red-600 text-red-400 bg-red-600/10'
          : 'border-yellow-600 text-yellow-400 bg-yellow-600/10 hover:bg-yellow-600/20'
      }`}
    >
      {exportState === 'busy' ? 'Saving…'
        : exportState === 'done' ? exportMsg
        : exportState === 'error' ? 'Export failed'
        : `Export ${importHands.length} → Database`}
    </button>
  )

  return (
    <HandReplayer
      key={`import-${importHands.length}`}
      hands={importHands}
      handNotes={importNotes}
      onUpdateNote={(idx, value) => setImportNotes(prev => { const n = [...prev]; n[idx] = value; return n })}
      onBack={resetImport}
      backLabel="← Home"
      topBarExtra={exportBtn}
    />
  )
}

function CenteredMessage({ title, detail, onBack }: { title: string; detail?: string; onBack: () => void }) {
  return (
    <div className="min-h-screen flex flex-col items-center justify-center p-8 gap-4">
      <h1 className="text-2xl font-bold text-white">{title}</h1>
      {detail && <p className="text-gray-400 text-sm max-w-md text-center">{detail}</p>}
      <button
        onClick={onBack}
        className="px-6 py-2 border border-gray-700 text-gray-300 hover:text-white rounded-lg transition-colors"
      >
        ← Home
      </button>
    </div>
  )
}
