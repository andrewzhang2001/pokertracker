# postflop/ — `/postflop`

Postflop spot browser: pick a formation (pot type + positions), walk the action
tree to a decision node, and see the hands that reached it.

| File | What it is |
|---|---|
| `PostflopMenu.tsx` | Formation picker with per-formation counts |
| `PostflopView.tsx` | The chosen node: action breakdown, board filters, hand list |
| `PostflopFilters.tsx` | Flop/turn/river texture filters |

The route is `/postflop/:formationId/:nodeId`. Board and date filters ride in
the query string.

## Data

The `flop_spots` table — one slim spot per heads-up hand, with the flop/turn/
river texture flattened into columns so per-formation counts are a single query.
The view loads one formation's spots and runs the node-walk client-side
(`shared/poker/postflop.ts`).

## Pipeline

| Script | Rebuilds | Command |
|---|---|---|
| `pipeline/backfill-flop-spots.ts` | the `flop_spots` table | `npm run backfill-postflop` |

New exports populate `flop_spots` automatically. Run the backfill after a change
to `extractFlopSpot`, or for hands that predate the table. It reads hands in
keyset pages — selecting `raw_text` for the whole table at once trips Neon's
64 MB response cap, which is the failure this materialization exists to remove.
