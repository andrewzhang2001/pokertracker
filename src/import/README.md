# import/ — `/import`

Paste or upload a hand history, review the parsed hands in the replayer, then
export them to the database.

| File | What it is |
|---|---|
| `ImportView.tsx` | The paste/upload screen and the post-parse replayer with the export button |
| `MapPlayersModal.tsx` | The PokerNow map step: seat identities → profiles. Also exports `collectIdentities()` |

## How it works

Ignition `.txt` and PokerNow `.csv` are auto-detected by
`shared/poker/parsers`. PokerNow logs carry player identities, so export is
gated on the map step — each seat must be assigned to a profile (or made an
anonymous one) before the hands can be written. Ignition is anonymous and skips
the step entirely.

The parsed hands, the export progress, and the pending assignments live in
`src/App.tsx`, so they survive navigating away from `/import` and back.

The single write is `commitMapping()` then `exportHandsToDb()` — the API stamps
`owner_id` from the Clerk token and materializes the hand's preflop and flop
spots in the same request.
