// `hands` — one row per exported hand. `parsed` is the structured hand,
// `raw_text` the original history text, `analysis` the derived summary.

export const CREATE_HANDS = `
  CREATE TABLE IF NOT EXISTS hands (
    id            text PRIMARY KEY,
    site          text NOT NULL,
    game_type     text NOT NULL,
    table_size    int  NOT NULL,
    small_blind   numeric,
    big_blind     numeric NOT NULL,
    currency      text,
    played_at     bigint,
    hero_position text,
    net_bb        numeric,
    pot_type      text,
    analysis      jsonb NOT NULL,
    parsed        jsonb NOT NULL,
    raw_text      text NOT NULL,
    notes         text,
    created_at    timestamptz DEFAULT now()
  )
`

// Result columns added later; backfilled on next export of each hand.
export const HANDS_ADD_ADJ_NET_BB = `ALTER TABLE hands ADD COLUMN IF NOT EXISTS adj_net_bb numeric`
export const HANDS_ADD_RAKE_BB = `ALTER TABLE hands ADD COLUMN IF NOT EXISTS rake_bb numeric`

// Per-account ownership. Legacy rows stay NULL until backfilled
// (db/backfill/hands-owner.mjs) or re-exported by their owner.
export const HANDS_ADD_OWNER_ID = `ALTER TABLE hands ADD COLUMN IF NOT EXISTS owner_id text`

// analysis.heroVpip promoted to a real column: the database view filters on
// it while paginating, which can't be done client-side any more.
export const HANDS_ADD_HERO_VPIP = `ALTER TABLE hands ADD COLUMN IF NOT EXISTS hero_vpip boolean`

// Matches the keyset order used by every listing query, so paging deep into a
// large account stays an index scan instead of a full sort.
export const HANDS_OWNER_ORDER_IDX = `
  CREATE INDEX IF NOT EXISTS hands_owner_order_idx
  ON hands (owner_id, played_at DESC NULLS LAST, created_at DESC)
`

// Empties itself once backfillHeroVpip has run, which is what makes calling
// that on every request cheap (the planner finds no candidate rows).
export const HANDS_HERO_VPIP_BACKFILL_IDX = `
  CREATE INDEX IF NOT EXISTS hands_hero_vpip_backfill_idx
  ON hands (owner_id) WHERE hero_vpip IS NULL
`

export const HANDS: string[] = [
  CREATE_HANDS,
  HANDS_ADD_ADJ_NET_BB,
  HANDS_ADD_RAKE_BB,
  HANDS_ADD_OWNER_ID,
  HANDS_ADD_HERO_VPIP,
  HANDS_OWNER_ORDER_IDX,
  HANDS_HERO_VPIP_BACKFILL_IDX,
]
