// `profiles` — the people you've played against, per account.
//
// There is deliberately no alias table: a seat's identity lives on
// hand_players.raw_name. You map each identity at import (an unassigned one
// becomes an anonymous profile named by its raw identity), and move identities
// between profiles afterwards. An anonymous profile holds exactly one identity
// and is never a move/merge target; naming it clears `anonymous`.

export const CREATE_PROFILES = `
  CREATE TABLE IF NOT EXISTS profiles (
    id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    owner_id   text NOT NULL,
    name       text NOT NULL,
    is_hero    boolean NOT NULL DEFAULT false,
    anonymous  boolean NOT NULL DEFAULT false,
    created_at timestamptz DEFAULT now()
  )
`

export const PROFILES_OWNER_IDX = `CREATE INDEX IF NOT EXISTS profiles_owner ON profiles (owner_id)`

export const PROFILES: string[] = [
  CREATE_PROFILES,
  PROFILES_OWNER_IDX,
]
