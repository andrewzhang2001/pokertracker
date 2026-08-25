// One-time: attribute legacy hands (owner_id IS NULL) to a Clerk user id, so
// your existing Graph / your-hands data shows up under your account after the
// multi-account migration. New exports are stamped automatically by the API.
//
// Get your Clerk user id from the Clerk dashboard (Users → your user → the
// `user_…` id) or the account menu in the app.
//
// Run: npm run backfill-owner -- user_xxxxxxxxxxxxxxxx
import { neon } from '@neondatabase/serverless'
import { loadConn } from '../connect'
import { apply, HANDS_ADD_OWNER_ID } from '../schema'

const ownerId = process.argv[2]
if (!ownerId || !ownerId.startsWith('user_')) {
  console.error('Usage: npm run backfill-owner -- <clerk user_id>')
  process.exit(1)
}

const sql = neon(loadConn())
await apply(sql, [HANDS_ADD_OWNER_ID])
const rows = await sql`UPDATE hands SET owner_id = ${ownerId} WHERE owner_id IS NULL RETURNING id`
console.log(`Attributed ${rows.length} legacy hand(s) to ${ownerId}.`)
