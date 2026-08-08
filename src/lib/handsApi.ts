import type { ParsedHand } from './types'
import { canonicalizeHand, rowToParsedHand } from './canonicalHand'
import { spotsForHand } from './canonicalSpots'
import { slimFlopSpot } from './canonicalFlopSpots'
import type { GraphRow } from './graph'
import type { ReportGridRow, ReportSel } from './reports'
import type { FlopSpot, PostflopFilter, PostflopMode } from './postflop'
import { writeFilter } from './postflop'
import type { TableKind } from './positionUtils'
import type { GameKind } from './games'
import { authHeaders } from './auth'

// Hands per POST. The whole batch is one JSON body; Vercel caps request bodies
// at 4.5 MB, and a canonical hand row (parsed + analysis + raw_text) is several
// KB, so we chunk to stay well under the limit — a single 46k-hand POST would be
// hundreds of MB and rejected outright.
export const EXPORT_CHUNK = 250

// Running tally of an export, surfaced to the UI for a live progress indicator.
export interface ExportProgress {
  done: number        // hands processed so far
  total: number       // hands to process
  added: number       // newly inserted
  duplicate: number   // already existed (upsert-updated)
  failed: number      // hands in a chunk that errored out
}

// Export every parsed hand to the database in chunks (bulk, idempotent upsert by
// hand id). Each chunk carries its hands AND their materialized preflop/flop
// spots so the reports stay in sync. Notes are aligned by index with the hands
// array. The server stamps each row with the signed-in account from the token.
//
// A failed chunk (network/DB error) does NOT abort the whole export — its hands
// are counted as `failed` and the run continues, so one bad batch can't strand a
// 6k-hand upload. onProgress fires after each chunk with running totals.
export async function exportHandsToDb(
  hands: ParsedHand[],
  notes: string[],
  onProgress?: (p: ExportProgress) => void,
): Promise<ExportProgress> {
  const total = hands.length
  let added = 0, duplicate = 0, failed = 0
  for (let i = 0; i < hands.length; i += EXPORT_CHUNK) {
    const slice = hands.slice(i, i + EXPORT_CHUNK)
    try {
      const handRows = slice.map((h, j) => canonicalizeHand(h, notes[i + j]))
      const spotRows = slice.flatMap(spotsForHand)
      const flopRows = slice.map(slimFlopSpot).filter((r): r is NonNullable<typeof r> => r !== null)
      const res = await fetch('/api/hands', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
        body: JSON.stringify({ hands: handRows, spots: spotRows, flopSpots: flopRows }),
      })
      if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Export failed')
      const r = await res.json() as { added?: number; updated?: number; inserted: number }
      added += r.added ?? r.inserted
      duplicate += r.updated ?? 0
    } catch {
      failed += slice.length
    }
    onProgress?.({ done: Math.min(i + EXPORT_CHUNK, total), total, added, duplicate, failed })
  }
  // New hands change the postflop data — drop the cached spots/counts so the
  // views refetch fresh next time.
  if (added > 0 || duplicate > 0) clearPostflopCache()
  return { done: total, total, added, duplicate, failed }
}

// Optional month-range filter (epoch ms; `to` is exclusive). Null = unbounded.
export interface DateRange { from: number | null; to: number | null }
const withRange = (p: URLSearchParams, r?: DateRange) => {
  if (r?.from != null) p.set('from', String(r.from))
  if (r?.to != null) p.set('to', String(r.to))
  return p
}

// Optional stake filter — the composite key "<currency>:<big_blind>" (e.g.
// "USD:0.05"). undefined / '' = all stakes. The currency guards against a
// play-money stake sharing a big-blind value with a real one.
export type StakeFilter = string | undefined
const withStake = (p: URLSearchParams, stake?: StakeFilter) => {
  if (stake) p.set('stake', stake)
  return p
}

// A distinct stake present in the pool (one dropdown row). Identified by big
// blind — the small blind is unreliable (short/dead posts record a reduced amount).
export interface StakeInfo {
  bigBlind: number
  currency: string
  count: number         // hands at this stake within the requested scope
}

// Composite "<currency>:<big_blind>" — must round-trip through the server's
// stake-param parser.
export const stakeKey = (s: { bigBlind: number; currency: string }) => `${s.currency}:${s.bigBlind}`

// A short human label for a stake by its big blind, e.g. "$1" (real money) or
// "2 play" (play chips), trimmed of trailing zeros.
export function stakeLabel(s: StakeInfo): string {
  const bb = Number.isInteger(s.bigBlind) ? String(s.bigBlind) : String(Number(s.bigBlind.toFixed(2)))
  return /usd/i.test(s.currency) ? `$${bb}` : `${bb} ${s.currency || 'play'}`
}

// Distinct stakes present. scope='mine' → the viewer's own hands (graph);
// 'all' → the whole pool (reports). Optional game (plo/nlhe) narrows the list.
export async function fetchStakes(scope: 'mine' | 'all', game?: GameKind): Promise<StakeInfo[]> {
  const p = new URLSearchParams({ view: 'stakes' })
  if (scope === 'mine') p.set('scope', 'mine')
  if (game) p.set('game', game)
  const res = await fetch(`/api/hands?${p}`, { headers: await authHeaders() })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load stakes')
  const data = await res.json() as { stakes?: { big_blind: number | string; currency: string; n: number }[] }
  return (data.stakes ?? []).map(s => ({
    bigBlind: Number(s.big_blind),
    currency: s.currency,
    count: s.n,
  }))
}

// The compact per-combo report grid (one GROUP BY over preflop_spots). Drives
// every report tile without shipping the hand pool to the browser.
export async function fetchReportGrid(range?: DateRange, stake?: StakeFilter): Promise<ReportGridRow[]> {
  const p = withStake(withRange(new URLSearchParams({ view: 'reports' }), range), stake)
  const res = await fetch(`/api/hands?${p}`, { headers: await authHeaders() })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load reports')
  const data = await res.json() as { grid?: ReportGridRow[] }
  return data.grid ?? []
}

// Hands for ONE report's drill-down — only those with a qualifying spot, so the
// detail view can re-derive populated bucket lists with buildReport cheaply.
export async function fetchReportHands(sel: ReportSel, subject: 'hero' | 'population', kind: TableKind, range?: DateRange, game: GameKind = 'plo', combo?: string, stake?: StakeFilter): Promise<{ hands: ParsedHand[]; notes: string[] }> {
  const p = withStake(withRange(new URLSearchParams({ view: 'report-hands', subject, kind, game }), range), stake)
  if (combo) p.set('combo', combo) // drill to one 13×13 grid cell
  if (sel.type === 'rfi') { p.set('type', 'rfi'); p.set('pos_a', sel.pos) }
  else if (sel.type === 'vsrfi') { p.set('type', 'vsrfi'); p.set('pos_a', sel.defender); p.set('pos_b', sel.opener) }
  else if (sel.type === 'vs3bet') { p.set('type', 'vs3bet'); p.set('pos_a', sel.opener); p.set('pos_b', sel.tag) }
  else { p.set('type', 'limpiso'); p.set('pos_a', sel.iso) }
  const res = await fetch(`/api/hands?${p}`, { headers: await authHeaders() })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load hands')
  const data = await res.json() as { hands: { parsed: Omit<ParsedHand, 'rawText'>; notes: string | null }[] }
  return {
    hands: data.hands.map(rowToParsedHand),
    notes: data.hands.map(r => r.notes ?? ''),
  }
}

// In-memory caches for the postflop fetches. Drilling into the hand replayer
// unmounts the postflop view, so returning to it would otherwise refetch the
// same formation's spots every time. Keyed by the exact query string; peek*()
// lets a view initialize from cache synchronously (no loading flash), and the
// caches are cleared on export (new hands change the underlying data).
const flopSpotsCache = new Map<string, FlopSpot[]>()
const flopCountsCache = new Map<string, Record<string, number>>()

export function clearPostflopCache(): void {
  flopSpotsCache.clear()
  flopCountsCache.clear()
}

const flopSpotsKey = (formationId: string, range: DateRange | undefined, mode: PostflopMode, game: GameKind) =>
  withRange(new URLSearchParams({ view: 'flop-spots', formation: formationId, mode, game }), range).toString()

const flopCountsKey = (mode: PostflopMode, filter: PostflopFilter, range: DateRange | undefined, game: GameKind) => {
  const q = withRange(new URLSearchParams({ view: 'flop-counts', mode, game }), range)
  writeFilter(q, filter)
  return q.toString()
}

export function peekFlopSpots(formationId: string, range: DateRange | undefined, mode: PostflopMode, game: GameKind): FlopSpot[] | undefined {
  return flopSpotsCache.get(flopSpotsKey(formationId, range, mode, game))
}
export function peekFlopCounts(mode: PostflopMode, filter: PostflopFilter, range: DateRange | undefined, game: GameKind): Record<string, number> | undefined {
  return flopCountsCache.get(flopCountsKey(mode, filter, range, game))
}

// One formation's slim postflop spots — the browser runs the node-walk over
// these (board texture / line / node / mode all stay client-side). `hand` is
// omitted; drill-down resolves it via fetchHandsByIds.
export async function fetchFlopSpots(formationId: string, range?: DateRange, mode: PostflopMode = 'population', game: GameKind = 'plo'): Promise<FlopSpot[]> {
  const key = flopSpotsKey(formationId, range, mode, game)
  const hit = flopSpotsCache.get(key)
  if (hit) return hit
  const res = await fetch(`/api/hands?${key}`, { headers: await authHeaders() })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load spots')
  const data = await res.json() as { spots?: FlopSpot[] }
  const spots = data.spots ?? []
  flopSpotsCache.set(key, spots)
  return spots
}

// Per-formation sample counts under the active board filter (postflop menu tiles).
export async function fetchFlopCounts(mode: PostflopMode, filter: PostflopFilter, range?: DateRange, game: GameKind = 'plo'): Promise<Record<string, number>> {
  const key = flopCountsKey(mode, filter, range, game)
  const hit = flopCountsCache.get(key)
  if (hit) return hit
  const res = await fetch(`/api/hands?${key}`, { headers: await authHeaders() })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load counts')
  const data = await res.json() as { counts?: { formation_id: string; total: number }[] }
  const counts = Object.fromEntries((data.counts ?? []).map(c => [c.formation_id, c.total]))
  flopCountsCache.set(key, counts)
  return counts
}

// Drill-down: resolve hand ids to full ParsedHands, in the requested order.
// raw_text is not shipped to the browser (nothing in the UI reads it).
export async function fetchHandsByIds(ids: string[]): Promise<ParsedHand[]> {
  if (!ids.length) return []
  const res = await fetch(`/api/hands?view=hands-by-id&ids=${ids.map(encodeURIComponent).join(',')}`, { headers: await authHeaders() })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load hands')
  const data = await res.json() as { hands: { id: string; parsed: Omit<ParsedHand, 'rawText'> }[] }
  const byId = new Map(data.hands.map(r => [r.id, rowToParsedHand(r)]))
  return ids.map(id => byId.get(id)).filter((h): h is ParsedHand => h !== undefined)
}

// Lightweight graph feed — YOUR precomputed per-hand result numbers (no parsing).
// `game` optionally restricts to PLO or NLHE; omitted = all games.
export async function fetchGraphFromDb(game?: GameKind, stake?: StakeFilter): Promise<GraphRow[]> {
  const q = withStake(new URLSearchParams({ view: 'graph' }), stake)
  if (game) q.set('game', game)
  const res = await fetch(`/api/hands?${q}`, { headers: await authHeaders() })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load graph')
  const data = await res.json() as { rows?: { played_at: number | null; net_bb: number; adj_net_bb: number | null; rake_bb: number | null }[] }
  return (data.rows ?? []).map(r => ({
    playedAt: r.played_at,
    net: Number(r.net_bb),
    adjNet: r.adj_net_bb !== null ? Number(r.adj_net_bb) : Number(r.net_bb), // fall back to actual if not yet backfilled
    rake: r.rake_bb !== null ? Number(r.rake_bb) : 0,
  }))
}

export type VpipFilter = 'all' | 'yes' | 'no'

export interface HandsPage {
  hands: ParsedHand[]
  notes: string[]
  total: number      // all your hands, ignoring the filter
  filtered: number   // hands matching the filter (i.e. what's paginated)
  limit: number
  offset: number
}

// One page of YOUR hands for the database browser. The VPIP filter is applied
// server-side so a page is always `limit` *matching* hands — filtering after
// paginating would give ragged pages and a wrong count.
export async function fetchHandsPageFromDb(
  { limit, offset, vpip }: { limit: number; offset: number; vpip: VpipFilter },
): Promise<HandsPage> {
  const qs = new URLSearchParams({ view: 'mine', limit: String(limit), offset: String(offset), vpip })
  const res = await fetch(`/api/hands?${qs}`, { headers: await authHeaders() })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load hands')
  const data = await res.json() as {
    hands: { parsed: Omit<ParsedHand, 'rawText'>; raw_text: string; notes: string | null }[]
    total: number; filtered: number; limit: number; offset: number
  }
  return {
    hands: data.hands.map(rowToParsedHand),
    notes: data.hands.map(r => r.notes ?? ''),
    total: data.total,
    filtered: data.filtered,
    limit: data.limit,
    offset: data.offset,
  }
}

// `mine` → just your hands (your-hands review / Leakbuster); otherwise the whole
// pooled sample (population Reports + Postflop spots).
export async function fetchHandsFromDb(mine = false): Promise<{ hands: ParsedHand[]; notes: string[] }> {
  const res = await fetch(mine ? '/api/hands?view=mine' : '/api/hands', { headers: await authHeaders() })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load hands')
  const data = await res.json() as { hands: { parsed: Omit<ParsedHand, 'rawText'>; notes: string | null }[] }
  return {
    hands: data.hands.map(rowToParsedHand),
    notes: data.hands.map(r => r.notes ?? ''),
  }
}
