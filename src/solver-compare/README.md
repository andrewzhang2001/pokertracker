# solver-compare/ — `/solver-compare`

Proof of concept: your actual heads-up SB RFI frequency against a GTO baseline.

| File | What it is |
|---|---|
| `SolverCompareView.tsx` | Node picker + the 13×13 comparison grid |
| `gtoRange.ts` | Decoder for GTO Wizard's exported solutions |

## Data

Served from `public/solver-nlhe/hu/` — `rfi.json`, `vs-rfi.json`, `vs-3bet.json`,
`vs-4bet.json`, `vs-jam.json`.

These are GTO Wizard exports, not built by a pipeline in this repo. Their
per-action `strategy` arrays are 169 elements ordered **alphabetically** by hand
label (`"22","32o","32s",…,"AA","AKo","AKs",…,"TT"`), not in grid order —
`gtoRange.ts` documents how that was verified.

They stay under `public/` because they are fetched by URL at runtime.
