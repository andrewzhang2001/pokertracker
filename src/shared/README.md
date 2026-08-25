# shared/

Code with **two or more** surface consumers. Everything here was verified to
have real consumers in more than one feature — nothing was placed here in
anticipation.

Features import from `shared/`. `shared/` never imports from a feature.

## poker/ — the domain engine

The bulk of the app. Parsing, hand reconstruction, evaluation, and the
aggregations the reports are built from. Consumed by 6–8 surfaces each.

| File | What it does |
|---|---|
| `types.ts` | `ParsedHand`, `HandAction`, `HandState`, `ParsedCard` — the shapes everything else speaks |
| `parsers/` | `index.ts` re-exports `parseHandHistories` / `diagnose`; `dispatch.ts` picks a parser by format; `ignition.ts`, `pokernow.ts` |
| `computeHandState.ts` | Replays actions into per-street table state |
| `analyzeHand.ts` | Derived per-hand summary (net, pot type, hero VPIP) |
| `equity.ts`, `ploEval.ts` | Showdown equities; PLO hand/board classification |
| `ploCombo.ts`, `holdemCombo.ts` | Hole cards → canonical combo label |
| `positionUtils.ts`, `games.ts` | Seat → position, 6-max vs HU, PLO vs NLHE |
| `reports.ts` | Preflop spot extraction + report aggregation (RFI, vs-RFI, vs-3bet, limp/iso) |
| `postflop.ts` | Formations, flop texture, node-walk spot extraction |
| `graph.ts` | Per-seat net, running results |
| `profileStats.ts` | Per-opponent rates and per-position breakdown |
| `canonicalHand.ts`, `canonicalSpots.ts`, `canonicalFlopSpots.ts` | Parsed hand → the row shapes the database stores |
| `mergeHands.ts` | Dedupe + sort an imported batch |
| `stakes.ts` | **No consumers.** See "Dead code" below |

## api/ — the client side of `/api/*`

`handsApi.ts` (hands, report grid, spots, stakes), `notesApi.ts`,
`profilesApi.ts`, `auth.ts` (Clerk bearer header), `noteAnchor.ts` (the stable
per-spot note key).

## replayer/ — the hand replayer

`HandReplayer` and the table it draws: `PokerTable`, `PlayerSeat`,
`PlayingCard`, `ChipStack`, `HandSummaryPanel`. Used by `database/`, `import/`,
`profiles/`, and the `postflop/` and `reports/` drill-downs.

## ui/ — cross-surface controls

`MonthRange`, `KindToggle` (6-max/HU), `GameToggle` (PLO/NLHE), `StakePicker`,
`NotesPanel`, `CenteredMessage`. Each has 2–3 consumers.

`StakeFilter.tsx` — **no consumers.** See below.

## __tests__/

Vitest over the domain engine, with hand-history fixtures in `__tests__/fixtures/`.
`reports/` keeps its own `__tests__/` for `evBands`.

## Dead code

`poker/stakes.ts` and `ui/StakeFilter.tsx` have **zero** consumers — nothing in
`src/`, `api/`, or `db/` imports either. `StakeFilter` was superseded by
`ui/StakePicker.tsx`, which reads its options from `handsApi`'s `StakeInfo`
rather than deriving them client-side from a hand pool.

They are kept only because `__tests__/stakes.test.ts` still exercises
`stakes.ts`. Delete all three together when you want them gone.
