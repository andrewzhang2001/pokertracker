# graph/ — `/graph`

Hero results over time: BB won/lost, winrate, all-in adjusted, and rake.

| File | What it is |
|---|---|
| `GraphView.tsx` | The chart, its stake picker, and the summary numbers |

Reads precomputed per-hand numbers (`net_bb`, `adj_net_bb`, `rake_bb`) from
`/api/hands?view=graph` — the curve is accumulated client-side by
`shared/poker/graph.ts`, but no hand is re-derived in the browser.

If those columns are missing or stale on old rows, rebuild them with
`npm run backfill-recompute` (see `db/README.md`).
