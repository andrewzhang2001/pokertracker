import type { ReportSel, SolverTable } from '../shared/poker/reports'
import type { TableKind } from '../shared/poker/positionUtils'

// Lazy-load the GTO solver table for a report (PLO50 / 100bb), cached per file.
// Served from /public/solver/ as static JSON. Heads-up has its own single
// SB(button)-vs-BB matchup under /solver/hu/.
const cache = new Map<string, Promise<SolverTable>>()

export function solverUrl(sel: ReportSel, kind: TableKind = 'sixmax'): string {
  if (kind === 'hu') {
    return sel.type === 'rfi' ? '/solver/hu/rfi.json'
      : sel.type === 'vsrfi' ? '/solver/hu/vsrfi.json'
        : sel.type === 'vs3bet' ? '/solver/hu/vs3bet.json'
          : '' // limpiso — n/a
  }
  return sel.type === 'rfi'
    ? `/solver/rfi/${sel.pos.toLowerCase()}.json`
    : sel.type === 'vsrfi'
      ? `/solver/vsrfi/${sel.defender.toLowerCase()}-${sel.opener.toLowerCase()}.json`
      : sel.type === 'vs3bet'
        ? `/solver/vs3bet/${sel.opener.toLowerCase()}-${sel.tag}.json`
        : '' // limpiso — no GTO baseline
}

export function loadSolver(sel: ReportSel, kind: TableKind = 'sixmax'): Promise<SolverTable> {
  const url = solverUrl(sel, kind)
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
