# profiles/ — `/profiles`

Your private roster of the people you play on PokerNow, and per-person stats.

| File | What it is |
|---|---|
| `ProfilesView.tsx` | The roster: rename, merge, delete |
| `ProfileDetailView.tsx` | One person — rates, per-position breakdown, their hands in the replayer |

`/profiles/:id` opens the detail view.

## Data

Two tables, both scoped to `owner_id`: `profiles` (the roster) and
`hand_players` (one row per hand+seat → the profile that sat there, plus that
seat's own `net_bb`).

The seat→profile links live **only** in `hand_players`, never in the shared
`hands.parsed` blob, so the population pool stays anonymous.

There is deliberately no alias table: identities are never auto-matched. You map
each seat at import (see `src/import/`), and unify a person's different-token
identities with merge.

`hand_players.net_bb` is that seat's own result, which is zero-sum across the
table — so a profile's summed net is that person's actual result, not a
hero-centric one.

## Pipeline

| Script | Rebuilds | Command |
|---|---|---|
| `pipeline/backfill-hand-net.ts` | `hand_players.net_bb` | `npm run backfill-net` |

Only for rows stamped before that column existed. Net is each seat's stack
delta, derivable from `hands.parsed` alone, so no re-parse is needed and the
value is correct even for hands parsed by older code. Idempotent.
