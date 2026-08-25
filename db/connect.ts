import { readFileSync } from 'node:fs'

const KEYS = ['DATABASE_URL', 'POSTGRES_URL', 'DATABASE_URL_UNPOOLED'] as const

// Connection string for the standalone backfill scripts. Prefers the
// environment; falls back to reading .env.local directly, so a script can be
// run with plain `node` without a dotenv step.
export function loadConn(): string {
  let conn = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL_UNPOOLED || ''
  if (!conn) {
    const env = readFileSync('.env.local', 'utf8')
    for (const key of KEYS) {
      const m = env.match(new RegExp(`^${key}=(.*)$`, 'm'))
      if (m) { conn = m[1].trim().replace(/^["']|["']$/g, ''); break }
    }
  }
  return conn
}
