# db/

The database schema and the maintenance scripts that operate on it across every
surface. Neon Postgres, reached over HTTP by `@neondatabase/serverless`.

## schema/ — one file per table

Every `CREATE TABLE`, `ALTER TABLE`, and `CREATE INDEX` the app relies on lives
here and nowhere else. Previously the same DDL was duplicated inline in three
API handlers and four scripts; they now all run these statements.

| File | Table | Read by |
|---|---|---|
| `hands.ts` | `hands` | every surface |
| `preflop-spots.ts` | `preflop_spots` | `/reports`, `/leakbuster` |
| `flop-spots.ts` | `flop_spots` | `/postflop` |
| `profiles.ts` | `profiles` | `/profiles`, `/import` |
| `hand-players.ts` | `hand_players` | `/profiles`, `/import` |
| `notes.ts` | `notes` | `/reports`, `/leakbuster`, `/postflop` |
| `index.ts` | the runner + the per-endpoint `ensure*Schema()` groupings | `api/*.ts` |

Each file exports its statements individually (`HANDS_ADD_OWNER_ID`) and as an
ordered list (`HANDS`), so a script can apply exactly the subset it needs.

### There is no migration runner

Every statement is idempotent (`IF NOT EXISTS`), and `ensure*Schema()` runs on
every API request. That is how a schema change reaches production: add the
statement, deploy, and the next request applies it.

**Adding a column:** append an `ALTER TABLE … ADD COLUMN IF NOT EXISTS` to the
table's file and add it to that file's exported list. Never edit a shipped
`CREATE TABLE` body — existing databases have already run it, so the edit would
only take effect on a fresh one.

## backfill/ — cross-cutting maintenance

Scripts that touch data every surface reads. Feature-specific backfills live
with their feature instead (`src/reports/pipeline/`, `src/postflop/pipeline/`,
`src/profiles/pipeline/`).

| Script | What it does | Command |
|---|---|---|
| `hands-reparse.ts` | Re-parse every hand's `raw_text` with the current parser, then rebuild its derived columns **and** its preflop + flop spots. Use after a parser change instead of re-importing. | `npm run backfill-reparse` |
| `hands-recompute.ts` | Re-derive `net_bb` / `adj_net_bb` / `rake_bb` / `parsed` and re-upsert. | `npm run backfill-recompute` |
| `hands-owner.ts` | One-time: attribute legacy `owner_id IS NULL` hands to a Clerk user. | `npm run backfill-owner -- user_xxx` |

`hands-reparse.ts` is non-destructive to hands whose `raw_text` cannot be
re-parsed (PokerNow rows stored before `raw_text` became a faithful CSV — those
still need a re-import), and leaves the `hand_players` mapping untouched.

## connect.ts

`loadConn()` — the connection string for the standalone scripts. Prefers
`DATABASE_URL` / `POSTGRES_URL` / `DATABASE_URL_UNPOOLED` from the environment,
falling back to reading `.env.local` directly so a script runs under plain
`node` with no dotenv step. The API handlers read `process.env` themselves.
