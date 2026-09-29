# profiles/ — `/profiles`

Your private roster of the people you play on PokerNow, and per-person stats.

| File | What it is |
|---|---|
| `ProfilesView.tsx` | The roster: rename, delete |
| `ProfileDetailView.tsx` | One person — rates, per-position breakdown, their hands in the replayer |
| `ProfileHands.tsx` | The detail view's hand list (filterable by VPIP / saw flop) and the viewer it opens beside it |
| `InlineHandViewer.tsx` | One hand on a column-sized table with step controls |
| `IdentityPanel.tsx` | A profile's PokerNow identities: move one to another profile, name an anonymous profile, merge this profile into a named one |
| `renameOrMerge.ts` | Rename, offering a merge when the name is already taken |

`/profiles/:id` opens the detail view.

## Data

Two tables, both scoped to `owner_id`: `profiles` (the roster) and
`hand_players` (one row per hand+seat → the profile that sat there, that seat's
PokerNow identity `raw_name`, and its own `net_bb`).

The seat→profile links live **only** in `hand_players`, never in the shared
`hands.parsed` blob, so the population pool stays anonymous.

## Identities

An identity is a PokerNow `name @ token`, stored per seat in
`hand_players.raw_name`. The rules:

- Every seat with the same `raw_name` belongs to one profile. Identities move
  between profiles as a whole — at import, on the profile page, or by merge.
- An anonymous profile holds exactly one identity and is named by it. It is
  never a destination; naming it makes it a named profile. It is deleted once
  its identity moves away.
- Merging a named profile moves all its identities and deletes it. Each
  identity can be moved back out afterwards.
- The import map step preselects the named profile an identity already
  belongs to, and never offers anonymous profiles.

Seats stamped before `raw_name` existed get it from `npm run
backfill-raw-name`, which re-parses `raw_text`. An anonymous profile's name is
not used: profiles created before the one-identity rule could hold several.
Seats whose `raw_text` doesn't re-parse keep `raw_name` NULL: they show under
the profile's name and can't be moved.

`hand_players.net_bb` is that seat's own result, which is zero-sum across the
table — so a profile's summed net is that person's actual result, not a
hero-centric one.

## Pipeline

| Script | Rebuilds | Command |
|---|---|---|
| `pipeline/backfill-hand-net.ts` | `hand_players.net_bb` | `npm run backfill-net` |
| `pipeline/backfill-raw-name.ts` | `hand_players.raw_name` | `npm run backfill-raw-name` (`-- --all` re-derives every row) |

Both only touch rows stamped before their column existed, and both are
idempotent.

- Net is each seat's stack delta, derivable from `hands.parsed` alone, so no
  re-parse is needed.
- `raw_name` is recovered by re-parsing `hands.raw_text`
  (`pipeline/seatIdentities.ts`). The script lists identities whose seats sit
  on more than one profile; moving the identity on its profile page reunites
  them.
