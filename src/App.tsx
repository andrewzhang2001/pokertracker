import { useState, useEffect, useMemo } from 'react'
import { parseHandHistories, diagnose } from './lib/parseHandHistory'
import { loadShareById, decodeLegacyShare } from './lib/shareUrl'
import { exportHandsToDb, fetchHandsFromDb } from './lib/handsApi'
import { dedupeAndSort } from './lib/mergeHands'
import { analyzeHand } from './lib/analyzeHand'
import { buildReport, RFI_POSITIONS, VS_RFI_DEFENDERS, openersFor, type ReportSel, type SolverTable } from './lib/reports'
import { loadSolver, solverUrl } from './lib/solver'
import type { ParsedHand } from './lib/types'
import HandReplayer from './components/HandReplayer'
import ReportsView, { ReportsMenu } from './components/ReportsView'

type View = 'landing' | 'import' | 'database' | 'reports'
type VpipFilter = 'all' | 'yes' | 'no'

// --- Routing: the URL path is the source of truth for which view shows. ---
// /  /import  /database  /reports  /reports/rfi/<pos>  /reports/vsrfi/<def>/<opener>
function parseView(p: string): View {
  if (p === '/database') return 'database'
  if (p.startsWith('/reports')) return 'reports'
  if (p === '/import') return 'import'
  return 'landing'
}
function parseReportSel(p: string): ReportSel | null {
  let m = p.match(/^\/reports\/rfi\/([a-z0-9]+)/i)
  if (m) {
    const pos = m[1].toUpperCase()
    return (RFI_POSITIONS as readonly string[]).includes(pos) ? { type: 'rfi', pos } : null
  }
  m = p.match(/^\/reports\/vsrfi\/([a-z]+)\/([a-z0-9]+)/i)
  if (m) {
    const defender = m[1].toUpperCase(), opener = m[2].toUpperCase()
    if ((VS_RFI_DEFENDERS as readonly string[]).includes(defender) && openersFor(defender).includes(opener))
      return { type: 'vsrfi', defender, opener }
  }
  return null
}
function reportUrl(sel: ReportSel): string {
  return sel.type === 'rfi'
    ? `/reports/rfi/${sel.pos.toLowerCase()}`
    : `/reports/vsrfi/${sel.defender.toLowerCase()}/${sel.opener.toLowerCase()}`
}

export default function App() {
  const [path, setPath] = useState(() => window.location.pathname)
  const view = parseView(path)
  const reportSel = parseReportSel(path)

  function navigate(to: string, replace = false) {
    if (replace) { history.replaceState(null, '', to); setPath(to); return }
    if (window.location.pathname !== to) history.pushState(null, '', to)
    setPath(to)
  }

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
  const [vpipFilter, setVpipFilter] = useState<VpipFilter>('all')

  // reports view state
  const [reportHands, setReportHands] = useState<ParsedHand[]>([])
  const [reportStatus, setReportStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [reportError, setReportError] = useState<string | null>(null)
  // drill-down: viewing a subset of hands (from a report bucket) in the replayer
  const [drill, setDrill] = useState<{ hands: ParsedHand[]; notes: string[]; index: number } | null>(null)
  // GTO solver table for the current report (lazy-loaded), keyed by its url
  const [solver, setSolver] = useState<{ url: string; table: SolverTable } | null>(null)

  // Filters run client-side over the loaded hands (derived live via analyzeHand),
  // so no stored column / DB backfill is needed. Keep notes aligned to filtered hands.
  const dbFiltered = useMemo(() => {
    return dbHands
      .map((h, i) => ({ h, note: dbNotes[i] ?? '', orig: i }))
      .filter(({ h }) => {
        if (vpipFilter === 'all') return true
        const v = analyzeHand(h).heroVpip
        return vpipFilter === 'yes' ? v : !v
      })
  }, [dbHands, dbNotes, vpipFilter])

  async function loadDatabase() {
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

  async function loadReports() {
    setReportStatus('loading')
    setReportError(null)
    try {
      const { hands } = await fetchHandsFromDb()
      setReportHands(hands)
      setReportStatus('idle')
    } catch (e) {
      setReportError(String((e as Error).message ?? e))
      setReportStatus('error')
    }
  }

  // Browser back/forward.
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Leaving the report drill-down whenever the route changes.
  useEffect(() => { setDrill(null) }, [path])

  // Fetch data when entering database/reports (covers direct loads & refresh).
  useEffect(() => {
    if (view === 'database') loadDatabase()
    else if (view === 'reports') loadReports()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  // Lazy-load the GTO solver table for the open report.
  useEffect(() => {
    const sel = parseReportSel(path)
    if (view !== 'reports' || !sel) return
    const url = solverUrl(sel)
    let cancelled = false
    loadSolver(sel).then(table => { if (!cancelled) setSolver({ url, table }) }).catch(() => {})
    return () => { cancelled = true }
  }, [view, path])

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
        navigate('/import', true)
      }
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    navigate('/import', true) // normalize URL (strip any share hash)
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

  function resetImport() {
    setImportHands([])
    setPasteText('')
    setImportNotes([])
    setExportState('idle')
    navigate('/')
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
            onClick={() => navigate('/database')}
            className="w-64 h-44 rounded-xl border border-gray-700 bg-gray-900 hover:border-yellow-500 hover:bg-gray-800 transition-colors flex flex-col items-center justify-center gap-3 text-center px-6"
          >
            <span className="text-3xl">🗄️</span>
            <span className="text-lg font-semibold text-white">View Database</span>
            <span className="text-xs text-gray-500">Browse and filter your saved hands</span>
          </button>
          <button
            onClick={() => { setError(null); navigate('/import') }}
            className="w-64 h-44 rounded-xl border border-gray-700 bg-gray-900 hover:border-yellow-500 hover:bg-gray-800 transition-colors flex flex-col items-center justify-center gap-3 text-center px-6"
          >
            <span className="text-3xl">📥</span>
            <span className="text-lg font-semibold text-white">Import</span>
            <span className="text-xs text-gray-500">Paste a hand history to review, then export to your database</span>
          </button>
          <button
            onClick={() => navigate('/reports')}
            className="w-64 h-44 rounded-xl border border-gray-700 bg-gray-900 hover:border-yellow-500 hover:bg-gray-800 transition-colors flex flex-col items-center justify-center gap-3 text-center px-6"
          >
            <span className="text-3xl">📊</span>
            <span className="text-lg font-semibold text-white">Reports</span>
            <span className="text-xs text-gray-500">Population tendencies — RFI by position, and more</span>
          </button>
        </div>
      </div>
    )
  }

  // ---- Database ----
  if (view === 'database') {
    if (dbStatus === 'loading') {
      return <CenteredMessage title="Loading hands…" onBack={() => navigate('/')} />
    }
    if (dbStatus === 'error') {
      return <CenteredMessage title="Couldn't load hands" detail={dbError ?? ''} onBack={() => navigate('/')} />
    }
    if (!dbHands.length) {
      return <CenteredMessage title="No hands saved yet" detail="Import some hands and export them to your database." onBack={() => navigate('/')} />
    }

    const filterBar = (
      <label className="flex items-center gap-1.5 text-xs text-gray-400">
        VPIP
        <select
          value={vpipFilter}
          onChange={e => setVpipFilter(e.target.value as VpipFilter)}
          className="bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-gray-200 focus:outline-none focus:border-yellow-500"
        >
          <option value="all">All</option>
          <option value="yes">VPIP only</option>
          <option value="no">No VPIP</option>
        </select>
        <span className="text-gray-600">{dbFiltered.length}/{dbHands.length}</span>
      </label>
    )

    if (!dbFiltered.length) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-8 gap-4">
          <h1 className="text-2xl font-bold text-white">No hands match this filter</h1>
          <div>{filterBar}</div>
          <button onClick={() => setVpipFilter('all')} className="px-6 py-2 border border-gray-700 text-gray-300 hover:text-white rounded-lg transition-colors">Reset filter</button>
          <button onClick={() => navigate('/')} className="text-xs text-gray-500 hover:text-white">← Home</button>
        </div>
      )
    }

    return (
      <HandReplayer
        key={`db-${vpipFilter}-${dbFiltered.length}`}
        hands={dbFiltered.map(x => x.h)}
        handNotes={dbFiltered.map(x => x.note)}
        onUpdateNote={(idx, value) => {
          const orig = dbFiltered[idx].orig
          setDbNotes(prev => { const n = [...prev]; n[orig] = value; return n })
        }}
        onBack={() => navigate('/')}
        backLabel="← Home"
        topBarExtra={filterBar}
      />
    )
  }

  // ---- Reports ----
  if (view === 'reports') {
    if (drill) {
      return (
        <HandReplayer
          key={`drill-${drill.index}-${drill.hands.length}`}
          hands={drill.hands}
          handNotes={drill.notes}
          initialHandIndex={drill.index}
          onUpdateNote={(idx, value) => setDrill(d => {
            if (!d) return d
            const notes = [...d.notes]; notes[idx] = value
            return { ...d, notes }
          })}
          onBack={() => setDrill(null)}
          backLabel="← Report"
        />
      )
    }
    if (reportStatus === 'loading') return <CenteredMessage title="Loading hands…" onBack={() => navigate('/')} />
    if (reportStatus === 'error') return <CenteredMessage title="Couldn't load hands" detail={reportError ?? ''} onBack={() => navigate('/')} />
    if (reportSel === null) {
      return <ReportsMenu hands={reportHands} onOpen={sel => navigate(reportUrl(sel))} onBack={() => navigate('/')} />
    }
    const solverTable = solver && solver.url === solverUrl(reportSel) ? solver.table : undefined
    return (
      <ReportsView
        result={buildReport(reportHands, reportSel, solverTable)}
        onOpenHands={(hands, index) => setDrill({ hands, notes: hands.map(() => ''), index })}
        onBack={() => navigate('/reports')}
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
            onClick={() => navigate('/')}
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
