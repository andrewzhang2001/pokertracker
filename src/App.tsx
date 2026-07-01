import { useState, useEffect, useMemo } from 'react'
import { UserButton } from '@clerk/clerk-react'
import { parseHandHistories, diagnose } from './lib/parseHandHistory'
import { loadShareById, decodeLegacyShare } from './lib/shareUrl'
import { exportHandsToDb, fetchHandsFromDb, fetchReportGrid, fetchReportHands, type DateRange } from './lib/handsApi'
import { monthRange } from './components/MonthRange'
import { dedupeAndSort } from './lib/mergeHands'
import { analyzeHand } from './lib/analyzeHand'
import { buildReport, RFI_POSITIONS, VS_RFI_DEFENDERS, openersFor, VS3BET_REPORTS, type ReportSel, type ReportGridRow, type Vs3betTag, type LimpIsoTag, type LimpMultiway, type SolverTable } from './lib/reports'
import type { TableKind } from './lib/positionUtils'
import { loadSolver, solverUrl } from './lib/solver'
import type { ParsedHand } from './lib/types'
import HandReplayer from './components/HandReplayer'
import ReportsView, { ReportsMenu } from './components/ReportsView'
import PostflopView from './components/PostflopView'
import PostflopMenu from './components/PostflopMenu'
import GraphView from './components/GraphView'

type View = 'landing' | 'import' | 'database' | 'reports' | 'leakbuster' | 'postflop' | 'graph'
type VpipFilter = 'all' | 'yes' | 'no'

// --- Routing: the URL path is the source of truth for which view shows. ---
// /  /import  /database  /reports[/rfi|/vsrfi/...]  /leakbuster[/...]
// Reports = population (excludes you); Leakbuster = your hands only.
function parseView(p: string): View {
  if (p === '/database') return 'database'
  if (p.startsWith('/leakbuster')) return 'leakbuster'
  if (p.startsWith('/reports')) return 'reports'
  if (p.startsWith('/postflop')) return 'postflop'
  if (p === '/graph') return 'graph'
  if (p === '/import') return 'import'
  return 'landing'
}
function parseReportSel(p: string): ReportSel | null {
  let m = p.match(/^\/(?:reports|leakbuster)\/rfi\/([a-z0-9]+)/i)
  if (m) {
    const pos = m[1].toUpperCase()
    return (RFI_POSITIONS as readonly string[]).includes(pos) ? { type: 'rfi', pos } : null
  }
  m = p.match(/^\/(?:reports|leakbuster)\/vsrfi\/([a-z]+)\/([a-z0-9]+)/i)
  if (m) {
    const defender = m[1].toUpperCase(), opener = m[2].toUpperCase()
    if ((VS_RFI_DEFENDERS as readonly string[]).includes(defender) && openersFor(defender).includes(opener))
      return { type: 'vsrfi', defender, opener }
  }
  m = p.match(/^\/(?:reports|leakbuster)\/vs3bet\/([a-z]+)\/(ip|oop|bb)/i)
  if (m) {
    const opener = m[1].toUpperCase(), tag = m[2].toLowerCase() as Vs3betTag
    if (VS3BET_REPORTS.some(r => r.opener === opener && r.tag === tag))
      return { type: 'vs3bet', opener, tag }
  }
  m = p.match(/^\/(?:reports|leakbuster)\/limpiso\/(ip|oop)/i)
  if (m) {
    const iso = m[1].toLowerCase() as LimpIsoTag
    const mw = new URLSearchParams(window.location.search).get('mw')
    const multiway: LimpMultiway = mw === 'hu' || mw === 'multi' ? mw : 'all'
    return { type: 'limpiso', iso, multiway }
  }
  return null
}
// /postflop/:formationId/:nodeId — the chosen formation + decision node.
function parsePostflopSel(p: string): { formationId: string; nodeId: string } | null {
  const m = p.match(/^\/postflop\/([a-z0-9-]+)\/([a-z0-9~-]+)/i)
  return m ? { formationId: m[1], nodeId: m[2] } : null
}
function reportUrl(sel: ReportSel, base: string): string {
  return sel.type === 'rfi'
    ? `${base}/rfi/${sel.pos.toLowerCase()}`
    : sel.type === 'vsrfi'
      ? `${base}/vsrfi/${sel.defender.toLowerCase()}/${sel.opener.toLowerCase()}`
      : sel.type === 'vs3bet'
        ? `${base}/vs3bet/${sel.opener.toLowerCase()}/${sel.tag}`
        : `${base}/limpiso/${sel.iso}${sel.multiway !== 'all' ? `?mw=${sel.multiway}` : ''}`
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

  // reports view state. The menu/tiles run off the compact aggregate grid; the
  // postflop views fetch their own per-formation spots (see PostflopMenu/View).
  const [reportStatus, setReportStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [reportError, setReportError] = useState<string | null>(null)
  // preflop report grid (one GROUP BY) — drives every report/leakbuster tile
  const [reportGrid, setReportGrid] = useState<ReportGridRow[]>([])
  // 6-max vs heads-up — top-level filter for reports/leakbuster/postflop
  const [kind, setKind] = useState<TableKind>('sixmax')
  // Month-range filter (inclusive; '' = all-time), shared across the three tabs.
  const [monthFrom, setMonthFrom] = useState('')
  const [monthTo, setMonthTo] = useState('')
  const setMonths = (from: string, to: string) => { setMonthFrom(from); setMonthTo(to) }
  // a single report's drill-down hands (fetched only when a report is opened)
  const [detailHands, setDetailHands] = useState<ParsedHand[]>([])
  const [detailStatus, setDetailStatus] = useState<'idle' | 'loading' | 'error'>('idle')
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

  // Your own hands — the personal database browser.
  async function loadDatabase() {
    setDbStatus('loading')
    setDbError(null)
    try {
      const { hands, notes } = await fetchHandsFromDb(true)
      setDbHands(hands)
      setDbNotes(notes)
      setDbStatus('idle')
    } catch (e) {
      setDbError(String((e as Error).message ?? e))
      setDbStatus('error')
    }
  }

  // Reports/Leakbuster menu — the compact preflop grid (no hand pool fetched).
  // Kept fresh in the background so entering Reports/Leakbuster is instant; the
  // grid is small and serves both views (population + your-hands columns).
  async function loadReportGrid(range: DateRange) {
    setReportStatus('loading')
    setReportError(null)
    try {
      setReportGrid(await fetchReportGrid(range))
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

  // (Re)fetch the report grid on mount and whenever the month range changes —
  // prefetched from any view so opening Reports/Leakbuster is instant.
  useEffect(() => { loadReportGrid(monthRange(monthFrom, monthTo)) // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monthFrom, monthTo])

  // Fetch data when entering the database view (reports grid is kept fresh above;
  // postflop fetches its own per-formation spots inside PostflopMenu/View).
  useEffect(() => {
    if (view === 'database') loadDatabase()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  // Lazy-load the GTO solver table for the open report.
  useEffect(() => {
    const sel = parseReportSel(path)
    if ((view !== 'reports' && view !== 'leakbuster') || !sel) return
    const url = solverUrl(sel, kind)
    if (!url) return // solverless report (e.g. limp vs iso)
    let cancelled = false
    loadSolver(sel, kind).then(table => { if (!cancelled) setSolver({ url, table }) }).catch(() => {})
    return () => { cancelled = true }
  }, [view, path, kind])

  // Fetch just the open report's hands (those with a qualifying spot) so the
  // detail view can build populated bucket lists without loading the whole pool.
  // Keyed on the report's identity (not multiway — that's filtered client-side).
  const reportSelForDetail = (view === 'reports' || view === 'leakbuster') ? parseReportSel(path) : null
  const detailKey = reportSelForDetail
    ? `${view}:${kind}:${monthFrom}:${monthTo}:${reportSelForDetail.type}:${'pos' in reportSelForDetail ? reportSelForDetail.pos : ''}:${'defender' in reportSelForDetail ? reportSelForDetail.defender : ''}:${'opener' in reportSelForDetail ? reportSelForDetail.opener : ''}:${'tag' in reportSelForDetail ? reportSelForDetail.tag : ''}:${'iso' in reportSelForDetail ? reportSelForDetail.iso : ''}`
    : ''
  useEffect(() => {
    if (!reportSelForDetail) return
    const subject = view === 'leakbuster' ? 'hero' : 'population'
    let cancelled = false
    setDetailStatus('loading')
    setDetailHands([])
    fetchReportHands(reportSelForDetail, subject, kind, monthRange(monthFrom, monthTo))
      .then(({ hands }) => { if (!cancelled) { setDetailHands(hands); setDetailStatus('idle') } })
      .catch(() => { if (!cancelled) setDetailStatus('error') })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailKey])

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
    setExportMsg(`Saving 0/${importHands.length.toLocaleString()}…`)
    try {
      const r = await exportHandsToDb(importHands, importNotes, p => {
        const extra = [p.duplicate && `${p.duplicate.toLocaleString()} dup`, p.failed && `${p.failed.toLocaleString()} failed`].filter(Boolean).join(' · ')
        setExportMsg(`Saving ${p.done.toLocaleString()}/${p.total.toLocaleString()}${extra ? ` · ${extra}` : ''}…`)
      })
      const parts = [`${r.added.toLocaleString()} new`]
      if (r.duplicate) parts.push(`${r.duplicate.toLocaleString()} dup`)
      if (r.failed) parts.push(`${r.failed.toLocaleString()} failed`)
      setExportState(r.failed ? 'error' : 'done')
      setExportMsg(`Saved ${parts.join(' · ')}`)
      setTimeout(() => setExportState('idle'), r.failed ? 6000 : 3000)
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
        <div className="absolute top-3 right-3"><UserButton afterSignOutUrl="/" /></div>
        <h1 className="text-4xl font-bold text-white">Poker Hand Tracker</h1>
        {(() => {
          const Card = ({ to, icon, title, desc, onClick }: { to?: string; icon: string; title: string; desc: string; onClick?: () => void }) => (
            <button
              onClick={onClick ?? (() => navigate(to!))}
              className="w-64 h-44 rounded-xl border border-gray-700 bg-gray-900 hover:border-yellow-500 hover:bg-gray-800 transition-colors flex flex-col items-center justify-center gap-3 text-center px-6"
            >
              <span className="text-3xl">{icon}</span>
              <span className="text-lg font-semibold text-white">{title}</span>
              <span className="text-xs text-gray-500">{desc}</span>
            </button>
          )
          return (
            <div className="flex flex-col gap-6">
              <div className="flex flex-col sm:flex-row gap-6">
                <Card icon="📥" title="Import" desc="Paste a hand history to review, then export to your database" onClick={() => { setError(null); navigate('/import') }} />
                <Card to="/database" icon="🗄️" title="View Database" desc="Browse and filter your saved hands" />
                <Card to="/graph" icon="📈" title="Graph" desc="BB won/lost, winrate, all-in adjusted &amp; rake" />
              </div>
              <div className="flex flex-col sm:flex-row gap-6">
                <Card to="/reports" icon="📊" title="Reports" desc="Population tendencies — RFI by position, and more" />
                <Card to="/leakbuster" icon="🛠️" title="Leakbuster" desc="Your own EV leaks vs GTO — same reports, your hands" />
                <Card to="/postflop" icon="🃏" title="Postflop" desc="Spot browser — formations, lines &amp; sizing" />
              </div>
            </div>
          )
        })()}
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

  // ---- Reports (population) & Leakbuster (your hands) — same UI, different subject ----
  if (view === 'reports' || view === 'leakbuster') {
    const subject = view === 'leakbuster' ? 'hero' : 'population'
    const base = view === 'leakbuster' ? '/leakbuster' : '/reports'
    const title = view === 'leakbuster' ? 'Leakbuster' : 'Reports'
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
          backLabel={`← ${title}`}
        />
      )
    }
    if (reportStatus === 'loading') return <CenteredMessage title="Loading reports…" onBack={() => navigate('/')} />
    if (reportStatus === 'error') return <CenteredMessage title="Couldn't load reports" detail={reportError ?? ''} onBack={() => navigate('/')} />
    if (reportSel === null) {
      return <ReportsMenu grid={reportGrid} kind={kind} onKind={setKind} monthFrom={monthFrom} monthTo={monthTo} onMonths={setMonths} subject={subject} title={title} onOpen={sel => navigate(reportUrl(sel, base))} onBack={() => navigate('/')} />
    }
    if (detailStatus === 'loading') return <CenteredMessage title="Loading hands…" onBack={() => navigate(base)} />
    const solverTable = solver && solver.url === solverUrl(reportSel, kind) ? solver.table : undefined
    // Limp-vs-iso reports carry a heads-up / multiway filter in the URL query.
    const mwToggle = reportSel.type === 'limpiso' ? (
      <div className="ml-auto flex rounded-full border border-gray-700 overflow-hidden text-xs">
        {(['all', 'hu', 'multi'] as LimpMultiway[]).map(m => (
          <button key={m} onClick={() => navigate(reportUrl({ ...reportSel, multiway: m }, base), true)}
            className={`px-3 py-1 transition-colors ${reportSel.multiway === m ? 'bg-yellow-500/20 text-yellow-300' : 'text-gray-400 hover:text-white'}`}>
            {m === 'all' ? 'All' : m === 'hu' ? 'Heads-up' : 'Multiway'}
          </button>
        ))}
      </div>
    ) : undefined
    return (
      <ReportsView
        result={buildReport(detailHands, reportSel, solverTable, subject, kind)}
        headerExtra={mwToggle}
        onOpenHands={(hands, index) => setDrill({ hands, notes: hands.map(() => ''), index })}
        onBack={() => navigate(base)}
      />
    )
  }

  // ---- Graph (hero results over time, from precomputed DB numbers) ----
  if (view === 'graph') {
    return <GraphView onBack={() => navigate('/')} />
  }

  // ---- Postflop spot browser ----
  if (view === 'postflop') {
    if (drill) {
      return (
        <HandReplayer
          key={`pf-drill-${drill.index}-${drill.hands.length}`}
          hands={drill.hands}
          handNotes={drill.notes}
          initialHandIndex={drill.index}
          onUpdateNote={(idx, value) => setDrill(d => {
            if (!d) return d
            const notes = [...d.notes]; notes[idx] = value
            return { ...d, notes }
          })}
          onBack={() => setDrill(null)}
          backLabel="← Postflop"
        />
      )
    }
    const pfSel = parsePostflopSel(path)
    if (!pfSel) {
      return (
        <PostflopMenu
          kind={kind}
          onKind={setKind}
          monthFrom={monthFrom}
          monthTo={monthTo}
          onMonths={setMonths}
          onOpen={(formationId, nodeId) => navigate(`/postflop/${formationId}/${nodeId}${window.location.search}`)}
          onBack={() => navigate('/')}
        />
      )
    }
    return (
      <PostflopView
        formationId={pfSel.formationId}
        nodeId={pfSel.nodeId}
        monthFrom={monthFrom}
        monthTo={monthTo}
        onOpenHands={(hands, index) => setDrill({ hands, notes: hands.map(() => ''), index })}
        onBack={() => navigate(`/postflop${window.location.search}`)}
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
      {exportState === 'busy' ? (exportMsg || 'Saving…')
        : exportState === 'done' ? exportMsg
        : exportState === 'error' ? (exportMsg || 'Export failed')
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
