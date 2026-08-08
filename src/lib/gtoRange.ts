// ---------------------------------------------------------------------------
// GTO Wizard range decoder. Their exported solutions store per-action `strategy`
// (and `evs`) as 169-element arrays. The DISPLAY is a normal 13×13 grid, but the
// ARRAY is ordered ALPHABETICALLY by hand label ("22","32o","32s",…,"AA","AKo",
// "AKs",…,"TT") — verified by matching the labeled grid EVs back to the array.
// Labels are high-card-first (matches holdemCombo()), so they slot straight into
// the app's grid.
// ---------------------------------------------------------------------------

const RANKS = ['A', 'K', 'Q', 'J', 'T', '9', '8', '7', '6', '5', '4', '3', '2']
const V: Record<string, number> = Object.fromEntries(RANKS.map((r, i) => [r, 12 - i]))

// The 169 hand labels in the alphabetical order the arrays use — index i of any
// strategy/evs array is GTO_HANDS[i].
export const GTO_HANDS: string[] = (() => {
  const set = new Set<string>()
  for (const a of RANKS) for (const b of RANKS) {
    if (a === b) set.add(a + a)
    else { const hi = V[a] > V[b] ? a : b, lo = V[a] > V[b] ? b : a; set.add(hi + lo + 's'); set.add(hi + lo + 'o') }
  }
  return [...set].sort()
})()

export interface ComboFreq { raise: number; call: number; fold: number }

// A decoded node: each combo's action split, folding every RAISE-type action
// (open, 3-bet, jam…) into `raise`, CALL into `call`, FOLD into `fold`.
export interface GtoNode {
  byCombo: Record<string, ComboFreq>
  // The bet the primary raise uses (e.g. "2.5") — for labeling.
  raiseSize: string | null
}

interface GtoFile {
  action_solutions: { action: { type: string; betsize: string }; strategy: number[] }[]
}

export function decodeGto(json: GtoFile): GtoNode {
  const byCombo: Record<string, ComboFreq> = {}
  for (const h of GTO_HANDS) byCombo[h] = { raise: 0, call: 0, fold: 0 }
  let raiseSize: string | null = null
  for (const a of json.action_solutions) {
    const t = a.action.type
    const bucket: keyof ComboFreq = t === 'FOLD' ? 'fold' : t === 'CALL' ? 'call' : 'raise'
    if (bucket === 'raise' && a.action.betsize !== '0' && !raiseSize) raiseSize = a.action.betsize
    GTO_HANDS.forEach((h, i) => { byCombo[h][bucket] += a.strategy[i] ?? 0 })
  }
  return { byCombo, raiseSize }
}

const cache = new Map<string, Promise<GtoNode>>()

// Load a served GTO node (POC: HU RFI). Cached per url.
export function loadGtoNode(url: string): Promise<GtoNode> {
  let p = cache.get(url)
  if (!p) {
    p = fetch(url).then(r => { if (!r.ok) throw new Error(`gto ${r.status}`); return r.json() }).then(decodeGto)
    cache.set(url, p)
  }
  return p
}
