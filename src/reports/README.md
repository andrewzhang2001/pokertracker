# reports/ — `/reports` and `/leakbuster`

Preflop tendencies as a grid of per-combo actions. Two routes, one
implementation: **Reports** is the population (everyone but you), **Leakbuster**
is your own hands against the same baseline. They differ only in the `subject`
passed down (`'population'` vs `'hero'`), which is why they share a folder.

| File | What it is |
|---|---|
| `ReportsView.tsx` | The report detail, plus `ReportsMenu` — the tile grid |
| `HandGrid.tsx` | The NLHE 13×13 frequency grid, built straight off the aggregate |
| `EvBandsPanel.tsx` | Leakbuster's EV-band breakdown of your opens |
| `evBands.ts` | Bucketing opens into EV bands and weighting combos |
| `solver.ts` | `solverUrl()` / `loadSolver()` — lazy, cached per file |

## Data

`public/solver/**` — 33 tables.

| Path | Contents |
|---|---|
| `solver/rfi/<pos>.json` | `{ combo: [foldEvBb, raiseEvBb] }` |
| `solver/vsrfi/<def>-<opener>.json` | `{ combo: [foldEvBb, callEvBb, raiseEvBb] }` |
| `solver/vs3bet/<opener>-<tag>.json` | `{ combo: [foldEvBb, callEvBb, fourBetEvBb] }`, tag = `ip` / `oop` / `bb` |
| `solver/hu/{rfi,vsrfi,vs3bet}.json` | The single SB(button)-vs-BB heads-up matchup |

Built by `pipeline/build-solver.mjs` from a local **prelo** export (PLO50,
6-max, 100bb). EVs are divided by the ev-multiplier (2000) to bb and rounded.
Only in-range combos are present — hands the opener should not have opened are
absent, and the UI flags them "not in range".

Rebuild: `npm run data:solver -- [path-to-prelo-100bb-dir]`
(defaults to `../prelo/static/preflop_v2/PLO50/6-max/100bb`).

### Why this data is not in this folder

`public/` is served verbatim at `/`, and `solver.ts` builds its URLs
*dynamically* from position names (`/solver/rfi/${pos.toLowerCase()}.json`).
Vite's `?url` escape hatch needs one static import per file, so it cannot
express that. Moving these out of `public/` would 404 every report. They stay
put; this README is the ownership record.

## Pipeline

| Script | Rebuilds | Command |
|---|---|---|
| `pipeline/build-solver.mjs` | `public/solver/**` | `npm run data:solver` |
| `pipeline/backfill-preflop-spots.ts` | the `preflop_spots` table | `npm run backfill-preflop` |

`preflop_spots` is what makes a report a single `GROUP BY` on the server instead
of shipping every hand to the browser. New exports populate it automatically;
the backfill is for hands that predate it or a change to spot extraction.
