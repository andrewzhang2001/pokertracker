import type { ReportSel, SolverTable } from './reports'

// Lazy-load the GTO solver table for a report (PLO50 / 6-max / 100bb), cached
// per file. Served from /public/solver/ as static JSON.
const cache = new Map<string, Promise<SolverTable>>()

export function solverUrl(sel: ReportSel): string {
  return sel.type === 'rfi'
    ? `/solver/rfi/${sel.pos.toLowerCase()}.json`
    : sel.type === 'vsrfi'
      ? `/solver/vsrfi/${sel.defender.toLowerCase()}-${sel.opener.toLowerCase()}.json`
      : sel.type === 'vs3bet'
        ? `/solver/vs3bet/${sel.opener.toLowerCase()}-${sel.tag}.json`
        : '' // limpiso — no GTO baseline
}

export function loadSolver(sel: ReportSel): Promise<SolverTable> {
  const url = solverUrl(sel)
  let p = cache.get(url)
  if (!p) {
    p = fetch(url).then(r => {
      if (!r.ok) throw new Error(`solver ${r.status}`)
      return r.json() as Promise<SolverTable>
    })
    cache.set(url, p)
  }
  return p
}
