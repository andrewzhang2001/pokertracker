// `profiles` — the people you've played against, per account.
//
// There is deliberately no alias table: identities aren't auto-matched. You map
// each seat at import (an unassigned one becomes an anonymous profile named by
// its raw identity), and unify a person's different-token identities with merge.

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
