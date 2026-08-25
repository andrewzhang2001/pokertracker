// The database schema, one file per table. Every CREATE TABLE / ALTER TABLE /
// CREATE INDEX the app relies on lives under db/schema/ and nowhere else — the
// API handlers and the backfill scripts all run these same statements, so there
// is a single place to read to know what the tables look like.
//
// Every statement is idempotent (IF NOT EXISTS), so an ensure* call is safe to
// run on every request; that is how the schema is applied — there is no
// migration runner.

import { HANDS } from './hands'
import { PREFLOP_SPOTS } from './preflop-spots'
import { FLOP_SPOTS } from './flop-spots'
import { PROFILES } from './profiles'
import { HAND_PLAYERS } from './hand-players'
import { NOTES } from './notes'

export * from './hands'
export * from './preflop-spots'
export * from './flop-spots'
export * from './profiles'
export * from './hand-players'
export * from './notes'

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
