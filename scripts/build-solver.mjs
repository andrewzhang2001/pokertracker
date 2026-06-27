// Converts prelo's per-action solver JSON into compact lookup tables for the
// tracker. Reads PLO50 / 6-max / 100bb. EVs are divided by the ev-multiplier
// (2000) to bb and rounded. Output (served as static files, fetched per report):
//   public/solver/rfi/<pos>.json        { combo: [foldEvBb, raiseEvBb] }
//   public/solver/vsrfi/<def>-<opener>.json { combo: [foldEvBb, callEvBb, raiseEvBb] }
//
// Run: node scripts/build-solver.mjs [path-to-prelo-100bb-dir]
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, statSync } from 'fs'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..')
const SRC = process.argv[2] ?? resolve(root, '../prelo/static/preflop_v2/PLO50/6-max/100bb')
const EV_MUL = 2000
const round = n => Math.round((n / EV_MUL) * 1000) / 1000

function loadAction(file) {
  const items = JSON.parse(readFileSync(file, 'utf-8')).items
  const m = new Map()
  for (const it of items) m.set(it.combo, it.ev)
  return m
}

function writeTable(outPath, combos, actionMaps) {
  const table = {}
  for (const combo of combos) table[combo] = actionMaps.map(m => round(m.get(combo) ?? 0))
  mkdirSync(dirname(outPath), { recursive: true })
  writeFileSync(outPath, JSON.stringify(table))
  return Object.keys(table).length
}

const RFI_POSITIONS = ['LJ', 'HJ', 'CO', 'BU', 'SB']
let total = 0

for (const pos of RFI_POSITIONS) {
  const dir = resolve(SRC, 'RFI', pos)
  if (!existsSync(dir)) { console.warn('skip RFI', pos); continue }
  const fold = loadAction(resolve(dir, 'FOLD.json'))
  const pot = loadAction(resolve(dir, 'POT.json'))
  const n = writeTable(resolve(root, 'public/solver/rfi', pos.toLowerCase() + '.json'),
    [...pot.keys()], [fold, pot])
  console.log(`rfi/${pos.toLowerCase()}.json  (${n} combos)`); total++
}

const vsRoot = resolve(SRC, 'vs RFI')
for (const def of readdirSync(vsRoot)) {
  const defDir = resolve(vsRoot, def)
  if (!statSync(defDir).isDirectory()) continue
  for (const sub of readdirSync(defDir)) {
    if (!sub.startsWith('vs ')) continue
    const opener = sub.slice(3).trim()
    const dir = resolve(defDir, sub)
    const fold = loadAction(resolve(dir, 'FOLD.json'))
    const call = loadAction(resolve(dir, 'CALL.json'))
    const pot = loadAction(resolve(dir, 'POT.json'))
    const out = resolve(root, 'public/solver/vsrfi', `${def.toLowerCase()}-${opener.toLowerCase()}.json`)
    const n = writeTable(out, [...pot.keys()], [fold, call, pot])
    console.log(`vsrfi/${def.toLowerCase()}-${opener.toLowerCase()}.json  (${n} combos)`); total++
  }
}

console.log(`\nDone. ${total} tables written to public/solver/`)
