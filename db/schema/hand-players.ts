// `hand_players` — one row per (hand, seat) → the profile that sat there.
// Stamped at import; powers per-person analysis ("how do I run vs Alan Zhu") by
// joining to the hand's structured actions at that seat.
//
// The seat→profile links live only here, never in the shared `hands.parsed`
// blob, so the population pool stays anonymous.

export const CREATE_HAND_PLAYERS = `
  CREATE TABLE IF NOT EXISTS hand_players (
    owner_id   text NOT NULL,
    hand_id    text NOT NULL,
    seat       int  NOT NULL,
    profile_id bigint NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
    is_hero    boolean NOT NULL DEFAULT false,
    PRIMARY KEY (owner_id, hand_id, seat)
  )
`

export const HAND_PLAYERS_PROFILE_IDX = `CREATE INDEX IF NOT EXISTS hand_players_profile ON hand_players (profile_id)`

// This seat's own net (bb) for the hand — zero-sum across the table, so a
// profile's summed net is that person's actual result (not hero-centric).
export const HAND_PLAYERS_ADD_NET_BB = `ALTER TABLE hand_players ADD COLUMN IF NOT EXISTS net_bb numeric`

// The seat's PokerNow identity ("name @ token"), stamped at import. Every seat
// with the same raw_name belongs to the same profile: identities move between
// profiles as a whole. NULL for rows stamped before this column existed whose
// raw_text couldn't be re-parsed.
export const HAND_PLAYERS_ADD_RAW_NAME = `ALTER TABLE hand_players ADD COLUMN IF NOT EXISTS raw_name text`

export const HAND_PLAYERS_RAW_NAME_IDX = `CREATE INDEX IF NOT EXISTS hand_players_raw_name ON hand_players (owner_id, raw_name)`

export const HAND_PLAYERS: string[] = [
  CREATE_HAND_PLAYERS,
  HAND_PLAYERS_PROFILE_IDX,
  HAND_PLAYERS_ADD_NET_BB,
  HAND_PLAYERS_ADD_RAW_NAME,
  HAND_PLAYERS_RAW_NAME_IDX,
]
