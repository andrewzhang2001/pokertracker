import { useState, useEffect, useMemo } from 'react'
import { parseHandHistories, diagnose } from './shared/poker/parsers'
// fetchHandsPageFromDb / VpipFilter drive the paginated database browser, which
// is separate from the aggregated report grid below.
import { exportHandsToDb, fetchHandsPageFromDb, fetchReportGrid, fetchReportHands, fetchStakes, type DateRange, type StakeInfo, type VpipFilter } from './shared/api/handsApi'
import { monthRange } from './shared/ui/MonthRange'
import { dedupeAndSort } from './shared/poker/mergeHands'
import { buildReport, RFI_POSITIONS, VS_RFI_DEFENDERS, openersFor, VS3BET_REPORTS, SIZE_OPTIONS, DEFAULT_SIZE, type SizeAxis, type ReportSel, type ReportGridRow, type Vs3betTag, type LimpIsoTag, type LimpMultiway, type SolverTable } from './shared/poker/reports'
import type { TableKind } from './shared/poker/positionUtils'
import type { GameKind } from './shared/poker/games'
import { loadSolver, solverUrl } from './reports/solver'
import type { ParsedHand } from './shared/poker/types'
import HandReplayer from './shared/replayer/HandReplayer'
import CenteredMessage from './shared/ui/CenteredMessage'
import LandingView from './landing/LandingView'
import DatabaseView from './database/DatabaseView'
import ImportView from './import/ImportView'
import ReportsView, { ReportsMenu } from './reports/ReportsView'
import { reportAnchor } from './shared/api/noteAnchor'
import HandGrid from './reports/HandGrid'
import PostflopView from './postflop/PostflopView'
import PostflopMenu from './postflop/PostflopMenu'
import GraphView from './graph/GraphView'
import ProfilesView from './profiles/ProfilesView'
import ProfileDetailView from './profiles/ProfileDetailView'
import SolverCompareView from './solver-compare/SolverCompareView'
import { collectIdentities, type Assignment } from './import/MapPlayersModal'
import { commitMapping } from './shared/api/profilesApi'

type View = 'landing' | 'import' | 'database' | 'reports' | 'leakbuster' | 'postflop' | 'graph' | 'profiles' | 'solver-compare'

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
  if (p.startsWith('/profiles')) return 'profiles'
  if (p === '/solver-compare') return 'solver-compare'
  if (p === '/import') return 'import'
  return 'landing'
}
// The faced-size filter carried in the URL (?sz), validated against the axis's
// options. Returns undefined for the default / an unknown value so the SEL stays
// canonical (reportUrl only writes ?sz for a non-default bucket).
function sizeParam(axis: SizeAxis): string | undefined {
  const sz = new URLSearchParams(window.location.search).get('sz')
  if (!sz || sz === DEFAULT_SIZE[axis]) return undefined
  return SIZE_OPTIONS[axis].some(o => o.key === sz) ? sz : undefined
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
      return { type: 'vsrfi', defender, opener, size: sizeParam('open') }
  }
  m = p.match(/^\/(?:reports|leakbuster)\/vs3bet\/([a-z]+)\/(ip|oop|bb)/i)
  if (m) {
    const opener = m[1].toUpperCase(), tag = m[2].toLowerCase() as Vs3betTag
    if (VS3BET_REPORTS.some(r => r.opener === opener && r.tag === tag))
      return { type: 'vs3bet', opener, tag, size: sizeParam('threebet') }
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
// ?sz carries a non-default faced-size bucket (default is omitted so the base URL
// stays canonical and notes/anchors — which ignore size — don't fragment).
// The stake selection is no longer a URL filter: it lives in App state and is
// applied by the server-side aggregation instead.
const szQuery = (size: string | undefined, axis: SizeAxis) =>
  size && size !== DEFAULT_SIZE[axis] ? `?sz=${size}` : ''
function reportUrl(sel: ReportSel, base: string): string {
  return sel.type === 'rfi'
    ? `${base}/rfi/${sel.pos.toLowerCase()}`
    : sel.type === 'vsrfi'
      ? `${base}/vsrfi/${sel.defender.toLowerCase()}/${sel.opener.toLowerCase()}${szQuery(sel.size, 'open')}`
      : sel.type === 'vs3bet'
        ? `${base}/vs3bet/${sel.opener.toLowerCase()}/${sel.tag}${szQuery(sel.size, 'threebet')}`
        : `${base}/limpiso/${sel.iso}${sel.multiway !== 'all' ? `?mw=${sel.multiway}` : ''}`
}

export default function App() {
  // Location = pathname + query, so query-only filter changes re-render (and
  // back/forward between two filter states works).
  const [loc, setLoc] = useState(() => window.location.pathname + window.location.search)
  const path = loc.split('?')[0]
  const query = useMemo(() => new URLSearchParams(loc.slice(path.length)), [loc, path])
  const view = parseView(path)
  const reportSel = parseReportSel(path)

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
  // PokerNow import carries player identities to map to profiles. You assign them
  // in the map step (openable right after import); the assignments are held here
  // until export writes them. `mapMode` = whether confirming should also export.
  const [mapOpen, setMapOpen] = useState(false)
  const [mapMode, setMapMode] = useState<'assign' | 'export'>('assign')
  const [assignments, setAssignments] = useState<Assignment[] | null>(null)

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

  // reports view state. The menu/tiles run off the compact aggregate grid; the
  // postflop views fetch their own per-formation spots (see PostflopMenu/View).
  const [reportStatus, setReportStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  const [reportError, setReportError] = useState<string | null>(null)
  // preflop report grid (one GROUP BY) — drives every report/leakbuster tile
  const [reportGrid, setReportGrid] = useState<ReportGridRow[]>([])
  // Which filter combination reportGrid currently holds, so re-entering Reports
  // doesn't refetch a grid we already have. null = nothing loaded yet.
  const [gridLoadedKey, setGridLoadedKey] = useState<string | null>(null)
  // 6-max vs heads-up — top-level filter for reports/leakbuster/postflop
  const [kind, setKind] = useState<TableKind>('sixmax')
  // PLO vs NLHE — a second dimension. NLHE reports render a 13×13 frequency grid.
  const [game, setGame] = useState<GameKind>('plo')
  // Month-range filter (inclusive; '' = all-time), shared across the three tabs.
  const [monthFrom, setMonthFrom] = useState('')
  const [monthTo, setMonthTo] = useState('')
  const setMonths = (from: string, to: string) => { setMonthFrom(from); setMonthTo(to) }
  // Stake filter (composite key; '' = all stakes), shared across reports/leakbuster.
  const [stakeFilter, setStakeFilter] = useState('')
  const [stakes, setStakes] = useState<StakeInfo[]>([])
  // Top-level faced-size filter (PLO): the open-size bucket for vs-RFI tiles and
  // the 3-bet-size bucket for vs-3-bet tiles. Rides into the opened report via
  // the sel's `size` (→ URL ?sz), where the detail's own toggle can refine it.
  const [openSize, setOpenSize] = useState<string>(DEFAULT_SIZE.open)
  const [threebetSize, setThreebetSize] = useState<string>(DEFAULT_SIZE.threebet)
  // a single report's drill-down hands (fetched only when a report is opened)
  const [detailHands, setDetailHands] = useState<ParsedHand[]>([])
  const [detailStatus, setDetailStatus] = useState<'idle' | 'loading' | 'error'>('idle')
  // drill-down: viewing a subset of hands (from a report bucket) in the replayer
  const [drill, setDrill] = useState<{ hands: ParsedHand[]; notes: string[]; index: number } | null>(null)
  // GTO solver table for the current report (lazy-loaded), keyed by its url
  const [solver, setSolver] = useState<{ url: string; table: SolverTable } | null>(null)

  // The stake filter is no longer derived from a downloaded hand pool: the
  // stakes present come from /api/hands?view=stakes and the selection is applied
  // by the server-side aggregation (see `stakes` / `stakeFilter` above).

  const dbPageCount = Math.max(1, Math.ceil(dbCounts.filtered / DB_PAGE_SIZE))

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

  // Reports/Leakbuster — the per-combo preflop grid (no hand pool fetched). It
  // serves the tiles, the report detail and the NLHE hand grid, so it carries a
  // row per (report, combo, action) and is tens of thousands of rows: fetched
  // on demand rather than prefetched, and cached by filter combination.
  async function loadReportGrid(range: DateRange, stake: string, key: string) {
    setReportStatus('loading')
    setReportError(null)
    try {
      setReportGrid(await fetchReportGrid(range, stake || undefined))
      setGridLoadedKey(key)
      setReportStatus('idle')
    } catch (e) {
      setGridLoadedKey(null)   // let a retry re-fetch
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

  // Fetch the grid only for the views that read it, and only once per filter
  // combination. It was previously fetched on mount from every view, which paid
  // for a multi-megabyte response on the landing page and on every filter
  // change regardless of whether a report was open.
  const needsGrid = view === 'reports' || view === 'leakbuster'
  const gridKey = `${monthFrom}:${monthTo}:${stakeFilter}`
  useEffect(() => {
    if (!needsGrid || gridLoadedKey === gridKey) return
    loadReportGrid(monthRange(monthFrom, monthTo), stakeFilter, gridKey)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [needsGrid, gridKey, gridLoadedKey])

  // The stakes present in the pool (for the active game) → the stake picker.
  useEffect(() => {
    let cancelled = false
    fetchStakes('all', game).then(s => { if (!cancelled) setStakes(s) }).catch(() => { if (!cancelled) setStakes([]) })
    return () => { cancelled = true }
  }, [game])

  // The database view fetches per page and per filter; `view` is in the deps so
  // this also covers entering it. Postflop fetches its own per-formation spots
  // inside PostflopMenu/View, and the report grid is kept fresh above.
  useEffect(() => {
    if (view === 'database') loadDatabase(dbPage, vpipFilter)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [view, dbPage, vpipFilter])

  // Lazy-load the GTO solver table for the open report.
  useEffect(() => {
    const sel = parseReportSel(path)
    if ((view !== 'reports' && view !== 'leakbuster') || !sel) return
    const url = solverUrl(sel, kind)
    if (!url) return // solverless report (e.g. limp vs iso)
    let cancelled = false
    loadSolver(sel, kind).then(table => { if (!cancelled) setSolver({ url, table }) }).catch(() => {})
    return () => { cancelled = true }
    // `kind` picks the hu/sixmax solver; `query` covers selections that live in
    // the query string rather than the path. loadSolver caches, so the extra
    // dependency costs nothing but keeps the table from going stale.
  }, [view, path, query, kind])

  // Fetch just the open report's hands (those with a qualifying spot) so the
  // detail view can build populated bucket lists without loading the whole pool.
  // Keyed on the report's identity (not multiway — that's filtered client-side).
  const reportSelForDetail = (view === 'reports' || view === 'leakbuster') ? parseReportSel(path) : null
  const detailKey = reportSelForDetail
    ? `${view}:${game}:${kind}:${monthFrom}:${monthTo}:${stakeFilter}:${reportSelForDetail.type}:${'pos' in reportSelForDetail ? reportSelForDetail.pos : ''}:${'defender' in reportSelForDetail ? reportSelForDetail.defender : ''}:${'opener' in reportSelForDetail ? reportSelForDetail.opener : ''}:${'tag' in reportSelForDetail ? reportSelForDetail.tag : ''}:${'iso' in reportSelForDetail ? reportSelForDetail.iso : ''}`
    : ''
  useEffect(() => {
    // NLHE builds its 13×13 grid straight off the aggregate grid — no hand-pool fetch.
    if (!reportSelForDetail || game === 'nlhe') return
    const subject = view === 'leakbuster' ? 'hero' : 'population'
    let cancelled = false
    setDetailStatus('loading')
    setDetailHands([])
    fetchReportHands(reportSelForDetail, subject, kind, monthRange(monthFrom, monthTo), 'plo', undefined, stakeFilter || undefined)
      .then(({ hands }) => { if (!cancelled) { setDetailHands(hands); setDetailStatus('idle') } })
      .catch(() => { if (!cancelled) setDetailStatus('error') })
    return () => { cancelled = true }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detailKey])


  function loadText(text: string) {
    const parsed = dedupeAndSort(parseHandHistories(text))
    if (!parsed.length) {
      setError(`No hands parsed. ${diagnose(text)}`)
      return
    }
    setError(null)
    setImportHands(parsed)
    setImportNotes(new Array(parsed.length).fill(''))
    setAssignments(null)
    setExportState('idle')
    navigate('/import', true)
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
    setAssignments(null)
    setExportState('idle')
    navigate('/')
  }

  // Distinct player identities in the current import (empty for anonymous sources
  // like Ignition, which skip the map step entirely).
  const mapData = useMemo(() => collectIdentities(importHands), [importHands])

  // Open the map step on its own (from the top-bar button), so you can assign
  // right after importing without committing anything.
  function openAssign() {
    setMapMode('assign')
    setMapOpen(true)
  }

  // Export: if there are players to map and you haven't yet, open the map step
  // (confirming there also exports); otherwise export with what you assigned.
  function startExport() {
    if (mapData.identities.length && !assignments) { setMapMode('export'); setMapOpen(true) }
    else runExport(assignments)
  }

  // The single write: commit the profile mapping (if any), then upsert the hands.
  async function runExport(assignments: Assignment[] | null) {
    setMapOpen(false)
    setExportState('busy')
    setExportMsg(`Saving 0/${importHands.length.toLocaleString()}…`)
    try {
      if (assignments) await commitMapping(assignments, mapData.seats)
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
    return <LandingView onNavigate={navigate} onImport={() => { setError(null); navigate('/import') }} />
  }

  // ---- Database ----
  if (view === 'database') {
    return (
      <DatabaseView
        status={dbStatus}
        error={dbError}
        loadedKey={dbLoadedKey}
        hands={dbHands}
        notes={dbNotes}
        counts={dbCounts}
        page={dbPage}
        pageCount={dbPageCount}
        pageSize={DB_PAGE_SIZE}
        landOn={dbLandOn}
        vpipFilter={vpipFilter}
        onVpipFilter={changeVpipFilter}
        onGoToPage={goToDbPage}
        onUpdateNote={(idx, value) => {
          setDbNotes(prev => { const n = [...prev]; n[idx] = value; return n })
        }}
        onNavigate={navigate}
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
    if (reportStatus === 'error') return <CenteredMessage title="Couldn't load reports" detail={reportError ?? ''} onBack={() => navigate('/')} />
    // Also wait when the grid is merely stale: the fetch is kicked off by an
    // effect, so the first render after entering has last filter's grid (or
    // none) and would otherwise flash empty tiles.
    if (reportStatus === 'loading' || gridLoadedKey !== gridKey) {
      return <CenteredMessage title="Loading reports…" onBack={() => navigate('/')} />
    }
    if (reportSel === null) {
      return <ReportsMenu grid={reportGrid} kind={kind} onKind={setKind} game={game} onGame={setGame} monthFrom={monthFrom} monthTo={monthTo} onMonths={setMonths} stakes={stakes} stake={stakeFilter} onStake={setStakeFilter} openSize={openSize} threebetSize={threebetSize} onOpenSize={setOpenSize} onThreebetSize={setThreebetSize} subject={subject} title={title} onOpen={sel => navigate(reportUrl(sel, base))} onBack={() => navigate('/')} />
    }
    // NLHE: a 13×13 frequency grid built from the aggregate grid (no EV, no pool fetch).
    if (game === 'nlhe') {
      return (
        <HandGrid
          grid={reportGrid} sel={reportSel} subject={subject} kind={kind} title={title}
          noteAnchor={reportAnchor(game, kind, subject, reportSel)}
          onBack={() => navigate(base)}
          onOpenCell={async combo => {
            const { hands, notes } = await fetchReportHands(reportSel, subject, kind, monthRange(monthFrom, monthTo), 'nlhe', combo, stakeFilter || undefined)
            if (hands.length) setDrill({ hands, notes, index: 0 })
          }}
        />
      )
    }
    if (detailStatus === 'loading') return <CenteredMessage title="Loading hands…" onBack={() => navigate(base)} />
    const solverTable = solver && solver.url === solverUrl(reportSel, kind) ? solver.table : undefined
    // Limp-vs-iso reports carry a heads-up / multiway filter in the URL query.
    const mwToggle = reportSel.type === 'limpiso' ? (
      <div className="flex rounded-full border border-gray-700 overflow-hidden text-xs">
        {(['all', 'hu', 'multi'] as LimpMultiway[]).map(m => (
          <button key={m} onClick={() => navigate(reportUrl({ ...reportSel, multiway: m }, base), true)}
            className={`px-3 py-1 transition-colors ${reportSel.multiway === m ? 'bg-yellow-500/20 text-yellow-300' : 'text-gray-400 hover:text-white'}`}>
            {m === 'all' ? 'All' : m === 'hu' ? 'Heads-up' : 'Multiway'}
          </button>
        ))}
      </div>
    ) : undefined
    // Faced-size filter (PLO vs-RFI: open size · vs-3-bet: 3-bet size). Slices the
    // report so the field's response to different sizings can be compared. Carried
    // in the URL (?sz); all sizes are already loaded, so switching re-filters
    // client-side without a refetch.
    const sizeAxis: SizeAxis | null = reportSel.type === 'vsrfi' ? 'open' : reportSel.type === 'vs3bet' ? 'threebet' : null
    const sizeToggle = sizeAxis ? (() => {
      const active = ('size' in reportSel && reportSel.size) || DEFAULT_SIZE[sizeAxis]
      return (
        <div className="ml-auto flex items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-gray-600">faced size</span>
          <div className="flex rounded-full border border-gray-700 overflow-hidden text-xs">
            {SIZE_OPTIONS[sizeAxis].map(o => (
              <button key={o.key} onClick={() => navigate(reportUrl({ ...reportSel, size: o.key } as ReportSel, base), true)}
                className={`px-3 py-1 transition-colors ${active === o.key ? 'bg-yellow-500/20 text-yellow-300' : 'text-gray-400 hover:text-white'}`}>
                {o.label}
              </button>
            ))}
          </div>
        </div>
      )
    })() : undefined
    return (
      <ReportsView
        result={buildReport(detailHands, reportSel, solverTable, subject, kind)}
        headerExtra={mwToggle ?? sizeToggle}
        noteAnchor={reportAnchor(game, kind, subject, reportSel)}
        handFilterCtx={{ rows: reportGrid, sel: reportSel, subject, kind, game }}
        solver={solverTable}
        showEvBands={view === 'leakbuster' && reportSel.type === 'rfi'}
        onOpenHands={(hands, index) => setDrill({ hands, notes: hands.map(() => ''), index })}
        onBack={() => navigate(base)}
      />
    )
  }

  // ---- Graph (hero results over time, from precomputed DB numbers) ----
  if (view === 'graph') {
    return <GraphView onBack={() => navigate('/')} />
  }

  // ---- Range vs Solver (POC) ----
  if (view === 'solver-compare') {
    return <SolverCompareView onBack={() => navigate('/')} />
  }

  // ---- PokerNow profiles (per-account player roster) ----
  if (view === 'profiles') {
    const idM = path.match(/^\/profiles\/(\d+)/)
    if (idM) return <ProfileDetailView id={Number(idM[1])} onBack={() => navigate('/profiles')} />
    return <ProfilesView onBack={() => navigate('/')} onOpen={id => navigate(`/profiles/${id}`)} />
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
          game={game}
          onGame={setGame}
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
        game={game}
        monthFrom={monthFrom}
        monthTo={monthTo}
        onOpenHands={(hands, index) => setDrill({ hands, notes: hands.map(() => ''), index })}
        onBack={() => navigate(`/postflop${window.location.search}`)}
      />
    )
  }

  // ---- Import ----
  return (
    <ImportView
      hands={importHands}
      notes={importNotes}
      pasteText={pasteText}
      onPasteText={setPasteText}
      error={error}
      exportState={exportState}
      exportMsg={exportMsg}
      identities={mapData.identities}
      assignments={assignments}
      mapOpen={mapOpen}
      mapMode={mapMode}
      onLoadFiles={loadFiles}
      onLoadText={loadText}
      onReset={resetImport}
      onOpenAssign={openAssign}
      onStartExport={startExport}
      onCancelMap={() => setMapOpen(false)}
      onConfirmMap={a => {
        setAssignments(a)
        setMapOpen(false)
        if (mapMode === 'export') runExport(a)
      }}
      onUpdateNote={(idx, value) => setImportNotes(prev => { const n = [...prev]; n[idx] = value; return n })}
      onNavigate={navigate}
    />
  )
}
