// `preflop_spots` — materialized preflop spots, one row per extracted spot, so
// reports become a single GROUP BY here instead of shipping every hand to the
// browser. Derived from `hands.parsed`; rebuilt on each export and by
// src/reports/pipeline/backfill-preflop-spots.ts.

export const CREATE_PREFLOP_SPOTS = `
  CREATE TABLE IF NOT EXISTS preflop_spots (
    id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    hand_id       text NOT NULL,
    owner_id      text,
    report_type   text NOT NULL,
    pos_a         text NOT NULL,
    pos_b         text,
    multiway      boolean,
    combo         text,
    action        text NOT NULL,
    is_hero       boolean NOT NULL,
    stack_bb      numeric NOT NULL,
    key_stack_bb  numeric NOT NULL
  )
`

// 'hu' vs 'sixmax' — keeps heads-up and 6-max reports on separate tracks.
export const PREFLOP_SPOTS_ADD_TABLE_KIND = `ALTER TABLE preflop_spots ADD COLUMN IF NOT EXISTS table_kind text`

// 'plo' vs 'nlhe' — a second dimension parallel to table_kind. Backfilled rows
// predate this column; treat NULL as 'plo'.
export const PREFLOP_SPOTS_ADD_GAME = `ALTER TABLE preflop_spots ADD COLUMN IF NOT EXISTS game text`

// Faced raise size (bb) + its report-filter partition — vsrfi: the open size,
// vs3bet: the 3-bet size; NULL for rfi/limpiso and rows predating this column
// (treated as the default top bucket by the grid, so tiles don't go empty
// pre-backfill). Populated by canonicalSpots / backfill-preflop-spots.ts.
export const PREFLOP_SPOTS_ADD_FACED_BB = `ALTER TABLE preflop_spots ADD COLUMN IF NOT EXISTS faced_bb numeric`
export const PREFLOP_SPOTS_ADD_SIZE_BUCKET = `ALTER TABLE preflop_spots ADD COLUMN IF NOT EXISTS size_bucket text`

export const PREFLOP_SPOTS_LOOKUP_IDX = `CREATE INDEX IF NOT EXISTS preflop_spots_lookup ON preflop_spots (game, table_kind, report_type, pos_a, pos_b, is_hero)`
export const PREFLOP_SPOTS_HAND_IDX = `CREATE INDEX IF NOT EXISTS preflop_spots_hand ON preflop_spots (hand_id)`

export const PREFLOP_SPOTS: string[] = [
  CREATE_PREFLOP_SPOTS,
  PREFLOP_SPOTS_ADD_TABLE_KIND,
  PREFLOP_SPOTS_ADD_GAME,
  PREFLOP_SPOTS_ADD_FACED_BB,
  PREFLOP_SPOTS_ADD_SIZE_BUCKET,
  PREFLOP_SPOTS_LOOKUP_IDX,
  PREFLOP_SPOTS_HAND_IDX,
]
