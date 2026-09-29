// The database schema, one file per table. Every CREATE TABLE / ALTER TABLE /
// CREATE INDEX the app relies on lives under db/schema/ and nowhere else — the
// API handlers and the backfill scripts all run these same statements, so there
// is a single place to read to know what the tables look like.
//
// Every statement is idempotent (IF NOT EXISTS), so an ensure* call is safe to
// run on every request; that is how the schema is applied — there is no
// migration runner.

import { HANDS } from './hands.js'
import { PREFLOP_SPOTS } from './preflop-spots.js'
import { FLOP_SPOTS } from './flop-spots.js'
import { PROFILES } from './profiles.js'
import { HAND_PLAYERS } from './hand-players.js'
import { NOTES } from './notes.js'

export * from './hands.js'
export * from './preflop-spots.js'
export * from './flop-spots.js'
export * from './profiles.js'
export * from './hand-players.js'
export * from './notes.js'

// The subset of the neon client this module needs. `query(text)` sends the
// statement with an empty parameter list, exactly as a tagged template with no
// interpolations does.
export interface SchemaSql {
  query(text: string, params?: unknown[]): Promise<unknown>
}

// Statements run in order; each waits for the previous, since the ALTERs and
// indexes depend on their CREATE TABLE.
export async function apply(sql: SchemaSql, statements: string[]): Promise<void> {
  for (const statement of statements) await sql.query(statement)
}

// Tables behind /api/hands: the hands themselves plus the two materialized
// spot tables derived from them.
export function ensureHandsSchema(sql: SchemaSql): Promise<void> {
  return apply(sql, [...HANDS, ...PREFLOP_SPOTS, ...FLOP_SPOTS])
}

// Tables behind /api/profiles.
export function ensureProfilesSchema(sql: SchemaSql): Promise<void> {
  return apply(sql, [...PROFILES, ...HAND_PLAYERS])
}

// Tables behind /api/notes.
export function ensureNotesSchema(sql: SchemaSql): Promise<void> {
  return apply(sql, NOTES)
}
