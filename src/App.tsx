import { useState, useEffect, useMemo } from 'react'
import { UserButton } from '@clerk/clerk-react'
import { parseHandHistories, diagnose } from './lib/parseHandHistory'
import { loadShareById, decodeLegacyShare } from './lib/shareUrl'
import { exportHandsToDb, fetchHandsFromDb, fetchHandsPageFromDb, type VpipFilter } from './lib/handsApi'
import { dedupeAndSort } from './lib/mergeHands'
import { buildReport, RFI_POSITIONS, VS_RFI_DEFENDERS, openersFor, VS3BET_REPORTS, type ReportSel, type Vs3betTag, type LimpIsoTag, type LimpMultiway, type SolverTable } from './lib/reports'
import { loadSolver, solverUrl } from './lib/solver'
import { filterByStake, parseStakes, stakeSelectionLabel, stakesIn, writeStakes } from './lib/stakes'
import type { ParsedHand } from './lib/types'
import HandReplayer from './components/HandReplayer'
import ReportsView, { ReportsMenu } from './components/ReportsView'
import StakeFilter from './components/StakeFilter'
import PostflopView from './components/PostflopView'
import PostflopMenu from './components/PostflopMenu'
import GraphView from './components/GraphView'

type View = 'landing' | 'import' | 'database' | 'reports' | 'leakbuster' | 'postflop' | 'graph'

// Hands per page in the database browser. The whole `parsed` + `raw_text` blob
// comes down per hand, so this trades round-trips against payload size.
const DB_PAGE_SIZE = 100

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
function parseReportSel(p: string, q: URLSearchParams): ReportSel | null {
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
    const mw = q.get('mw')
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
// "?stake=…" for the reports menu (the only filter it carries), '' when unset.
function stakeSuffix(stakes: string[]): string {
  const q = new URLSearchParams()
  writeStakes(q, stakes)
  const qs = q.toString()
  return qs ? `?${qs}` : ''
}

// Report URL = the report's path + the filters that survive navigation (the
// stake selection everywhere, the multiway toggle on limp-vs-iso).
function reportUrl(sel: ReportSel, base: string, stakes: string[]): string {
  const path = sel.type === 'rfi'
    ? `${base}/rfi/${sel.pos.toLowerCase()}`
    : sel.type === 'vsrfi'
      ? `${base}/vsrfi/${sel.defender.toLowerCase()}/${sel.opener.toLowerCase()}`
      : sel.type === 'vs3bet'
        ? `${base}/vs3bet/${sel.opener.toLowerCase()}/${sel.tag}`
        : `${base}/limpiso/${sel.iso}`
  const q = new URLSearchParams()
  if (sel.type === 'limpiso' && sel.multiway !== 'all') q.set('mw', sel.multiway)
  writeStakes(q, stakes)
  const qs = q.toString()
  return qs ? `${path}?${qs}` : path
}

export default function App() {
  // Location = pathname + query, so query-only filter changes re-render (and
  // back/forward between two filter states works).
  const [loc, setLoc] = useState(() => window.location.pathname + window.location.search)
  const path = loc.split('?')[0]
  const query = useMemo(() => new URLSearchParams(loc.slice(path.length)), [loc, path])
  const view = parseView(path)
  const reportSel = parseReportSel(path, query)

  function navigate(to: string, replace = false) {
    if (replace) { history.replaceState(null, '', to); setLoc(to); return }
    if (window.location.pathname + window.location.search !== to) history.pushState(null, '', to)
    setLoc(to)
  }

  // import view state
  const [importHands, setImportHands] = useState<ParsedHand[]>([])
  const [importNotes, setImportNotes] = useState<string[]>([])
  const [pasteText, setPasteText] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [exportState, setExportState] = useState<'idle' | 'busy' | 'done' | 'error'>('idle')
  const [exportMsg, setExportMsg] = useState('')

  // database view state — one page at a time, filtered + counted server-side
  const [dbHands, setDbHands] = useState<ParsedHand[]>([])
  const [dbNotes, setDbNotes] = useState<string[]>([])
  const [dbStatus, setDbStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [dbError, setDbError] = useState<string | null>(null)
  const [vpipFilter, setVpipFilter] = useState<VpipFilter>('all')
  const [dbPage, setDbPage] = useState(0)
  // filtered = hands matching the VPIP filter (what gets paginated); total = all yours
  const [dbCounts, setDbCounts] = useState({ total: 0, filtered: 0 })
  // Identifies the page currently in dbHands (not the one being requested), so
  // the replayer only remounts once new hands have actually landed.
  const [dbLoadedKey, setDbLoadedKey] = useState<string | null>(null)
  // Paging backwards off the first hand should land on the *last* hand of the
  // previous page, so arrow-key navigation reads as one continuous list.
  const [dbLandOn, setDbLandOn] = useState<'first' | 'last'>('first')

  // reports view state
  const [reportHands, setReportHands] = useState<ParsedHand[]>([])
  const [reportStatus, setReportStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [reportError, setReportError] = useState<string | null>(null)
  // The sample arrives in chunks, so a large one takes a few seconds — show it landing.
  const [reportProgress, setReportProgress] = useState({ loaded: 0, total: 0 })
  // drill-down: viewing a subset of hands (from a report bucket) in the replayer
  const [drill, setDrill] = useState<{ hands: ParsedHand[]; notes: string[]; index: number } | null>(null)
  // GTO solver table for the current report (lazy-loaded), keyed by its url
  const [solver, setSolver] = useState<{ url: string; table: SolverTable } | null>(null)

  // Stake filter for the reports — the stakes on offer are derived from the
  // loaded hands, and the selection lives in the URL (?stake=plo25,plo50).
  const stakeOptions = useMemo(() => stakesIn(reportHands), [reportHands])
  // Drop stakes that aren't in the sample (stale link) so the URL can't pin the
  // reports to an empty set — an unknown stake falls back to "all stakes".
  const stakeSel = useMemo(() => {
    const keys = parseStakes(query)
    if (!keys.length || !stakeOptions.length) return keys
    const known = new Set(stakeOptions.map(o => o.stake.key))
    return keys.filter(k => known.has(k))
  }, [query, stakeOptions])
  const stakedHands = useMemo(() => filterByStake(reportHands, stakeSel), [reportHands, stakeSel])

  const dbPageCount = Math.max(1, Math.ceil(dbCounts.filtered / DB_PAGE_SIZE))

  // "1,500 / 18,320 hands" under the reports/postflop loading message. Blank
  // until the first chunk reports the total, so it never shows "0 / 0".
  const loadProgress = reportProgress.total
    ? `${reportProgress.loaded.toLocaleString()} / ${reportProgress.total.toLocaleString()} hands`
    : undefined

  // Your own hands — the personal database browser. The VPIP filter is part of
  // the query (not a client-side pass over the page) so that pages are full and
  // the counts describe the whole filtered set rather than the current page.
  async function loadDatabase(page: number, vpip: VpipFilter) {
    setDbStatus('loading')
    setDbError(null)
    try {
      const res = await fetchHandsPageFromDb({
        limit: DB_PAGE_SIZE, offset: page * DB_PAGE_SIZE, vpip,
      })
      // Offset landed past the end (e.g. hands removed since the count) — retry at
      // the top rather than showing an empty replayer.
      if (!res.hands.length && res.filtered > 0 && page > 0) {
        setDbCounts({ total: res.total, filtered: res.filtered })
        setDbPage(0)
        return
      }
      setDbHands(res.hands)
      setDbNotes(res.notes)
      setDbCounts({ total: res.total, filtered: res.filtered })
      setDbLoadedKey(`${vpip}-${page}`)
      setDbStatus('idle')
    } catch (e) {
      setDbError(String((e as Error).message ?? e))
      setDbStatus('error')
    }
  }

  function goToDbPage(next: number, landOn: 'first' | 'last' = 'first') {
    if (next < 0 || next > dbPageCount - 1 || next === dbPage) return
    setDbLandOn(landOn)
    setDbPage(next)
  }

  // Switching filters changes which hands exist, so any page number beyond the
  // first is meaningless — start over at the top of the new result set.
  function changeVpipFilter(next: VpipFilter) {
    setVpipFilter(next)
    setDbLandOn('first')
    setDbPage(0)
  }

  // Leakbuster = your hands only; Reports/Postflop = the pooled sample.
  async function loadReports(mine: boolean) {
    setReportStatus('loading')
    setReportError(null)
    setReportProgress({ loaded: 0, total: 0 })
    try {
      const hands = await fetchHandsFromDb(mine, (loaded, total) => setReportProgress({ loaded, total }))
      setReportHands(hands)
      setReportStatus('idle')
    } catch (e) {
      setReportError(String((e as Error).message ?? e))
      setReportStatus('error')
    }
  }

  // Browser back/forward.
  useEffect(() => {
    const onPop = () => setLoc(window.location.pathname + window.location.search)
    window.addEventListener('popstate', onPop)
    return () => window.removeEventListener('popstate', onPop)
  }, [])

  // Leaving the report drill-down whenever the route changes.
  useEffect(() => { setDrill(null) }, [path])

  // Fetch data when entering reports/leakbuster/postflop (covers direct loads & refresh).
  useEffect(() => {
    if (view === 'reports' || view === 'leakbuster' || view === 'postflop') loadReports(view === 'leakbuster')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view])

  // The database view refetches per page and per filter, not just on entry.
  useEffect(() => {
    if (view === 'database') loadDatabase(dbPage, vpipFilter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, dbPage, vpipFilter])

  // Lazy-load the GTO solver table for the open report.
  useEffect(() => {
    const sel = parseReportSel(path, query)
    if ((view !== 'reports' && view !== 'leakbuster') || !sel) return
    const url = solverUrl(sel)
    if (!url) return // solverless report (e.g. limp vs iso)
    let cancelled = false
    loadSolver(sel).then(table => { if (!cancelled) setSolver({ url, table }) }).catch(() => {})
    return () => { cancelled = true }
  }, [view, path, query])

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
    // Only block the whole screen on the first load; later page/filter fetches
    // keep the current page on screen and show a spinner in the top bar.
    if (dbStatus === 'loading' && dbLoadedKey === null) {
      return <CenteredMessage title="Loading hands…" onBack={() => navigate('/')} />
    }
    if (dbStatus === 'error') {
      return <CenteredMessage title="Couldn't load hands" detail={dbError ?? ''} onBack={() => navigate('/')} />
    }
    if (!dbCounts.total) {
      return <CenteredMessage title="No hands saved yet" detail="Import some hands and export them to your database." onBack={() => navigate('/')} />
    }

    const loading = dbStatus === 'loading'
    const firstShown = dbPage * DB_PAGE_SIZE + 1
    const lastShown = dbPage * DB_PAGE_SIZE + dbHands.length

    const filterBar = (
      <div className="flex items-center gap-3">
        <label className="flex items-center gap-1.5 text-xs text-gray-400">
          VPIP
          <select
            value={vpipFilter}
            onChange={e => changeVpipFilter(e.target.value as VpipFilter)}
            className="bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-gray-200 focus:outline-none focus:border-yellow-500"
          >
            <option value="all">All</option>
            <option value="yes">VPIP only</option>
            <option value="no">No VPIP</option>
          </select>
          {/* matching / total — only differs when a filter is on */}
          <span className="text-gray-600">
            {dbCounts.filtered}{vpipFilter !== 'all' ? `/${dbCounts.total}` : ''}
          </span>
        </label>
        {dbCounts.filtered > 0 && (
          <div className="flex items-center gap-1.5 text-xs text-gray-400">
            <button
              onClick={() => goToDbPage(dbPage - 1, 'first')}
              disabled={dbPage === 0 || loading}
              title="Newer hands"
              className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30"
            >‹</button>
            <span className="tabular-nums">
              {loading ? '…' : `${firstShown}–${lastShown}`} of {dbCounts.filtered}
            </span>
            <button
              onClick={() => goToDbPage(dbPage + 1, 'first')}
              disabled={dbPage >= dbPageCount - 1 || loading}
              title="Older hands"
              className="px-2 py-0.5 rounded bg-gray-800 hover:bg-gray-700 disabled:opacity-30"
            >›</button>
            <span className="text-gray-600">pg {dbPage + 1}/{dbPageCount}</span>
          </div>
        )}
      </div>
    )

    if (!dbCounts.filtered) {
      return (
        <div className="min-h-screen flex flex-col items-center justify-center p-8 gap-4">
          <h1 className="text-2xl font-bold text-white">No hands match this filter</h1>
          <div>{filterBar}</div>
          <button onClick={() => changeVpipFilter('all')} className="px-6 py-2 border border-gray-700 text-gray-300 hover:text-white rounded-lg transition-colors">Reset filter</button>
          <button onClick={() => navigate('/')} className="text-xs text-gray-500 hover:text-white">← Home</button>
        </div>
      )
    }

    return (
      <HandReplayer
        // Remount per loaded page so the hand cursor resets to the right edge.
        key={`db-${dbLoadedKey}`}
        hands={dbHands}
        handNotes={dbNotes}
        initialHandIndex={dbLandOn === 'last' ? Math.max(0, dbHands.length - 1) : 0}
        onUpdateNote={(idx, value) => {
          setDbNotes(prev => { const n = [...prev]; n[idx] = value; return n })
        }}
        // ↑/↓ off either end of the page continues into the adjacent one. Gated
        // on `loading` like the pager buttons: the page cursor has already moved
        // while a fetch is in flight, so a held key would otherwise skip pages.
        onPastStart={dbPage > 0 && !loading ? () => goToDbPage(dbPage - 1, 'last') : undefined}
        onPastEnd={dbPage < dbPageCount - 1 && !loading ? () => goToDbPage(dbPage + 1, 'first') : undefined}
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
    if (reportStatus === 'loading') return <CenteredMessage title="Loading hands…" detail={loadProgress} onBack={() => navigate('/')} />
    if (reportStatus === 'error') return <CenteredMessage title="Couldn't load hands" detail={reportError ?? ''} onBack={() => navigate('/')} />
    const stakeBar = (
      <StakeFilter
        options={stakeOptions}
        selected={stakeSel}
        onChange={keys => navigate(reportSel ? reportUrl(reportSel, base, keys) : `${base}${stakeSuffix(keys)}`, true)}
      />
    )
    if (reportSel === null) {
      return (
        <ReportsMenu
          hands={stakedHands}
          subject={subject}
          title={title}
          filterBar={stakeBar}
          onOpen={sel => navigate(reportUrl(sel, base, stakeSel))}
          onBack={() => navigate('/')}
        />
      )
    }
    const solverTable = solver && solver.url === solverUrl(reportSel) ? solver.table : undefined
    const result = buildReport(stakedHands, reportSel, solverTable, subject)
    // Limp-vs-iso reports carry a heads-up / multiway filter in the URL query.
    const mwToggle = reportSel.type === 'limpiso' ? (
      <div className="flex rounded-full border border-gray-700 overflow-hidden text-xs">
        {(['all', 'hu', 'multi'] as LimpMultiway[]).map(m => (
          <button key={m} onClick={() => navigate(reportUrl({ ...reportSel, multiway: m }, base, stakeSel), true)}
            className={`px-3 py-1 transition-colors ${reportSel.multiway === m ? 'bg-yellow-500/20 text-yellow-300' : 'text-gray-400 hover:text-white'}`}>
            {m === 'all' ? 'All' : m === 'hu' ? 'Heads-up' : 'Multiway'}
          </button>
        ))}
      </div>
    ) : undefined
    return (
      <ReportsView
        result={{ ...result, subtitle: `${result.subtitle} · ${stakeSelectionLabel(stakeSel, stakeOptions)}` }}
        headerExtra={
          <div className="ml-auto flex items-center gap-3">
            {mwToggle}
            {stakeBar}
          </div>
        }
        onOpenHands={(hands, index) => setDrill({ hands, notes: hands.map(() => ''), index })}
        onBack={() => navigate(`${base}${stakeSuffix(stakeSel)}`)}
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
    if (reportStatus === 'loading') return <CenteredMessage title="Loading hands…" detail={loadProgress} onBack={() => navigate('/')} />
    if (reportStatus === 'error') return <CenteredMessage title="Couldn't load hands" detail={reportError ?? ''} onBack={() => navigate('/')} />
    const pfSel = parsePostflopSel(path)
    if (!pfSel) {
      return (
        <PostflopMenu
          hands={reportHands}
          onOpen={(formationId, nodeId) => navigate(`/postflop/${formationId}/${nodeId}${window.location.search}`)}
          onBack={() => navigate('/')}
        />
      )
    }
    return (
      <PostflopView
        hands={reportHands}
        formationId={pfSel.formationId}
        nodeId={pfSel.nodeId}
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
