// `flop_spots` — materialized postflop spots, one slim FlopSpot per heads-up
// hand, so the postflop views load a single formation's spots and run the
// node-walk client-side. Texture columns drive the per-formation counts query.

export const CREATE_FLOP_SPOTS = `
  CREATE TABLE IF NOT EXISTS flop_spots (
    hand_id        text PRIMARY KEY,
    owner_id       text,
    formation_id   text NOT NULL,
    pot_type       text NOT NULL,
    oop_pos        text NOT NULL,
    ip_pos         text NOT NULL,
    oop_is_hero    boolean NOT NULL,
    ip_is_hero     boolean NOT NULL,
    flop_suits     text,
    flop_paired    boolean,
    flop_straighty boolean,
    flop_high      text,
    flop_mid       text,
    flop_low       text,
    turn_suits     text,
    turn_paired    boolean,
    turn_straighty boolean,
    river_suits    text,
    river_paired   boolean,
    river_straighty boolean,
    spot           jsonb NOT NULL
  )
`

// 'plo' vs 'nlhe' — reserved for NLHE postflop (a later milestone); NULL = 'plo'.
export const FLOP_SPOTS_ADD_GAME = `ALTER TABLE flop_spots ADD COLUMN IF NOT EXISTS game text`

export const FLOP_SPOTS_FORMATION_IDX = `CREATE INDEX IF NOT EXISTS flop_spots_formation ON flop_spots (formation_id)`

export const FLOP_SPOTS: string[] = [
  CREATE_FLOP_SPOTS,
  FLOP_SPOTS_ADD_GAME,
  FLOP_SPOTS_FORMATION_IDX,
]
