// One-time: attribute legacy hands (owner_id IS NULL) to a Clerk user id, so
// your existing Graph / your-hands data shows up under your account after the
// multi-account migration. New exports are stamped automatically by the API.
//
// Get your Clerk user id from the Clerk dashboard (Users → your user → the
// `user_…` id) or the account menu in the app.
//
// Run: node scripts/backfill-owner.mjs user_xxxxxxxxxxxxxxxx
import { readFileSync } from 'node:fs'
import { neon } from '@neondatabase/serverless'

function loadConn() {
  let conn = process.env.DATABASE_URL || process.env.POSTGRES_URL || process.env.DATABASE_URL_UNPOOLED || ''
  if (!conn) {
    const env = readFileSync('.env.local', 'utf8')
    for (const key of ['DATABASE_URL', 'POSTGRES_URL', 'DATABASE_URL_UNPOOLED']) {
      const m = env.match(new RegExp(`^${key}=(.*)$`, 'm'))
      if (m) { conn = m[1].trim().replace(/^["']|["']$/g, ''); break }
    }
  }
  return conn
}

const ownerId = process.argv[2]
if (!ownerId || !ownerId.startsWith('user_')) {
  console.error('Usage: node scripts/backfill-owner.mjs <clerk user_id>')
  process.exit(1)
}

const sql = neon(loadConn())
await sql`ALTER TABLE hands ADD COLUMN IF NOT EXISTS owner_id text`
const rows = await sql`UPDATE hands SET owner_id = ${ownerId} WHERE owner_id IS NULL RETURNING id`
console.log(`Attributed ${rows.length} legacy hand(s) to ${ownerId}.`)
