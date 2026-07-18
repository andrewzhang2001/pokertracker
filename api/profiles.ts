import { neon } from '@neondatabase/serverless'
import { verifyToken } from '@clerk/backend'

// Node.js runtime (Fluid Compute) — @clerk/backend needs Node crypto. See
// api/hands.ts for why the handler is exported via the `fetch` Web Standard shape.
export const config = { runtime: 'nodejs' }

const connectionString =
  process.env.DATABASE_URL ?? process.env.POSTGRES_URL ?? process.env.DATABASE_URL_UNPOOLED ?? ''

const sql = neon(connectionString)

async function userIdFrom(req: Request): Promise<string | null> {
  const secretKey = process.env.CLERK_SECRET_KEY
  if (!secretKey) return null
  const token = req.headers.get('Authorization')?.replace(/^Bearer\s+/i, '')
  if (!token) return null
  try {
    return (await verifyToken(token, { secretKey })).sub ?? null
  } catch {
    return null
  }
}

// Per-account player profiles: a private roster of the real people you play
// against on PokerNow, so a person's hands unify across tables even though the
// site's "name @ token" identity changes room to room. Everything here is scoped
// to owner_id; the seat→profile links live only here, never in the shared
// `hands.parsed` blob, so the population pool stays anonymous.
//
// There is deliberately no alias table: identities aren't auto-matched. You map
// each seat at import (an unassigned one becomes an anonymous profile named by
// its raw identity), and unify a person's different-token identities with merge.
async function ensureTable() {
  await sql`
    CREATE TABLE IF NOT EXISTS profiles (
      id         bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
      owner_id   text NOT NULL,
      name       text NOT NULL,
      is_hero    boolean NOT NULL DEFAULT false,
      anonymous  boolean NOT NULL DEFAULT false,
      created_at timestamptz DEFAULT now()
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS profiles_owner ON profiles (owner_id)`

  // One row per (hand, seat) → the profile that sat there. Stamped at import;
  // powers per-person analysis ("how do I run vs Alan Zhu") by joining to the
  // hand's structured actions at that seat.
  await sql`
    CREATE TABLE IF NOT EXISTS hand_players (
      owner_id   text NOT NULL,
      hand_id    text NOT NULL,
      seat       int  NOT NULL,
      profile_id bigint NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
      is_hero    boolean NOT NULL DEFAULT false,
      PRIMARY KEY (owner_id, hand_id, seat)
    )
  `
  await sql`CREATE INDEX IF NOT EXISTS hand_players_profile ON hand_players (profile_id)`
  // This seat's own net (bb) for the hand — zero-sum across the table, so a
  // profile's summed net is that person's actual result (not hero-centric).
  await sql`ALTER TABLE hand_players ADD COLUMN IF NOT EXISTS net_bb numeric`
}

// Guarantee a self profile exists so there's always an unambiguous "you" to map
// your seat to — created lazily, named "Hero", never duplicated (only if the
// account has no hero profile yet). You can rename it later; the flag stays.
async function ensureHero(ownerId: string) {
  await sql`
    INSERT INTO profiles (owner_id, name, is_hero)
    SELECT ${ownerId}, 'Hero', true
    WHERE NOT EXISTS (SELECT 1 FROM profiles WHERE owner_id = ${ownerId} AND is_hero = true)
  `
}

// Next "Player N" placeholder name for an anonymous profile — max existing
// suffix + 1, so deletes don't cause reuse collisions.
async function nextAnonName(ownerId: string): Promise<string> {
  const rows = await sql`
    SELECT COALESCE(max((regexp_replace(name, '^Player ', ''))::int), 0) AS n
    FROM profiles WHERE owner_id = ${ownerId} AND name ~ '^Player [0-9]+$'
  ` as { n: number }[]
  return `Player ${(rows[0]?.n ?? 0) + 1}`
}

async function handler(req: Request): Promise<Response> {
  if (!connectionString) return Response.json({ error: 'Database not configured' }, { status: 500 })
  const ownerId = await userIdFrom(req)
  if (!ownerId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await ensureTable()
    await ensureHero(ownerId)

    if (req.method === 'GET') {
      const params = new URL(req.url).searchParams
      // One profile's hands (+ the seat they sat in), for per-person stats. Your
      // own hands only; parsed is anonymous, so the seat is the join back to them.
      if (params.get('view') === 'hands') {
        const id = Number(params.get('id'))
        if (!id) return Response.json({ hands: [] })
        const rows = await sql`
          SELECT h.parsed, hp.seat
          FROM hand_players hp JOIN hands h ON h.id = hp.hand_id
          WHERE hp.owner_id = ${ownerId} AND hp.profile_id = ${id}
          ORDER BY h.played_at DESC NULLS LAST
        `
        return Response.json({ hands: rows })
      }
      // The Profiles page: the roster + your aggregate data on each person —
      // hands played together and your net (bb) in those hands.
      const rows = await sql`
        SELECT p.id, p.name, p.is_hero, p.anonymous,
          (SELECT count(DISTINCT hp.hand_id) FROM hand_players hp WHERE hp.profile_id = p.id)::int AS hands,
          COALESCE((SELECT sum(hp.net_bb) FROM hand_players hp WHERE hp.profile_id = p.id), 0) AS net_bb
        FROM profiles p
        WHERE p.owner_id = ${ownerId}
        ORDER BY p.is_hero DESC, p.name
      `
      return Response.json({ profiles: rows })
    }

    if (req.method === 'POST') {
      const body = await req.json() as Record<string, unknown>
      const op = body.op

      // Create a profile. Unless force=true, a case-insensitive name match returns
      // { duplicate: [...] } WITHOUT inserting, so the client can warn. Anonymous
      // profiles with no name get the next "Player N".
      if (op === 'create') {
        const isHero = !!body.isHero, anonymous = !!body.anonymous, force = !!body.force
        let name = String(body.name ?? '').trim()
        if (!name && anonymous) name = await nextAnonName(ownerId)
        if (!name) return Response.json({ error: 'name required' }, { status: 400 })
        if (!force) {
          const dup = await sql`SELECT id, name FROM profiles WHERE owner_id = ${ownerId} AND lower(name) = lower(${name})`
          if (dup.length) return Response.json({ duplicate: dup })
        }
        // At most one hero profile per account.
        if (isHero) await sql`UPDATE profiles SET is_hero = false WHERE owner_id = ${ownerId} AND is_hero = true`
        const [profile] = await sql`
          INSERT INTO profiles (owner_id, name, is_hero, anonymous)
          VALUES (${ownerId}, ${name}, ${isHero}, ${anonymous})
          RETURNING id, name, is_hero, anonymous
        `
        return Response.json({ profile })
      }

      if (op === 'rename') {
        const id = Number(body.id), name = String(body.name ?? '').trim()
        if (!id || !name) return Response.json({ error: 'id and name required' }, { status: 400 })
        await sql`UPDATE profiles SET name = ${name} WHERE id = ${id} AND owner_id = ${ownerId}`
        return Response.json({ ok: true })
      }

      if (op === 'delete') {
        const id = Number(body.id)
        if (!id) return Response.json({ error: 'id required' }, { status: 400 })
        // The self profile is protected — it's recreated anyway, and deleting it
        // would orphan your seat links.
        await sql`DELETE FROM profiles WHERE id = ${id} AND owner_id = ${ownerId} AND is_hero = false`
        return Response.json({ ok: true })
      }

      // Merge one profile into another: reassign its seat links, then delete it.
      // How a person's different-token identities (or an anon you later recognize)
      // become one profile.
      if (op === 'merge') {
        const from = Number(body.from), into = Number(body.into)
        if (!from || !into || from === into) return Response.json({ error: 'from and into required' }, { status: 400 })
        const owned = (await sql`SELECT id FROM profiles WHERE owner_id = ${ownerId} AND id IN (${from}, ${into})` as { id: number }[]).map(r => Number(r.id))
        if (!owned.includes(from) || !owned.includes(into)) return Response.json({ error: 'not found' }, { status: 404 })
        await sql`UPDATE hand_players SET profile_id = ${into} WHERE owner_id = ${ownerId} AND profile_id = ${from}`
        await sql`DELETE FROM profiles WHERE id = ${from} AND owner_id = ${ownerId}`
        return Response.json({ ok: true })
      }

      // Commit an import's mapping — the single write behind the map step. For
      // each raw identity, resolve a profile id: an explicit assignment (existing
      // profile or a new named one), else get-or-create an anonymous profile named
      // by the identity itself. Then stamp the per-seat links. Idempotent on
      // re-import (hand_players is keyed on owner+hand+seat).
      if (op === 'commit') {
        const assignments = (body.assignments as { rawName: string; existingId?: number; newName?: string; isHero?: boolean }[] | undefined) ?? []
        const seats = (body.seats as { handId: string; seat: number; rawName: string; isHero?: boolean; netBb?: number }[] | undefined) ?? []
        const owned = new Set((await sql`SELECT id FROM profiles WHERE owner_id = ${ownerId}` as { id: number }[]).map(r => Number(r.id)))

        // rawName → resolved profile id.
        const byRaw = new Map<string, number>()
        const assigned = new Map(assignments.map(a => [a.rawName, a]))
        for (const raw of new Set(seats.map(s => s.rawName))) {
          const a = assigned.get(raw)
          if (a?.existingId && owned.has(Number(a.existingId))) { byRaw.set(raw, Number(a.existingId)); continue }
          if (a?.newName?.trim()) {
            if (a.isHero) await sql`UPDATE profiles SET is_hero = false WHERE owner_id = ${ownerId} AND is_hero = true`
            const [p] = await sql`INSERT INTO profiles (owner_id, name, is_hero) VALUES (${ownerId}, ${a.newName.trim()}, ${!!a.isHero}) RETURNING id`
            byRaw.set(raw, Number(p.id)); continue
          }
          // Unassigned → anonymous profile named by the identity (get-or-create,
          // keyed on the full "name @ token" so two same-named players stay apart).
          const [existing] = await sql`SELECT id FROM profiles WHERE owner_id = ${ownerId} AND name = ${raw} AND anonymous = true`
          if (existing) { byRaw.set(raw, Number(existing.id)); continue }
          const [p] = await sql`INSERT INTO profiles (owner_id, name, anonymous) VALUES (${ownerId}, ${raw}, true) RETURNING id`
          byRaw.set(raw, Number(p.id))
        }

        const rows = seats
          .map(s => ({ hand_id: s.handId, seat: s.seat, profile_id: byRaw.get(s.rawName), is_hero: !!s.isHero, net_bb: s.netBb ?? null }))
          .filter((r): r is { hand_id: string; seat: number; profile_id: number; is_hero: boolean; net_bb: number | null } => r.profile_id !== undefined)
        if (rows.length) {
          await sql`
            INSERT INTO hand_players (owner_id, hand_id, seat, profile_id, is_hero, net_bb)
            SELECT ${ownerId}, x.hand_id, x.seat, x.profile_id, x.is_hero, x.net_bb
            FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
              AS x(hand_id text, seat int, profile_id bigint, is_hero boolean, net_bb numeric)
            ON CONFLICT (owner_id, hand_id, seat) DO UPDATE SET profile_id = EXCLUDED.profile_id, is_hero = EXCLUDED.is_hero, net_bb = EXCLUDED.net_bb
          `
        }
        return Response.json({ ok: true, stamped: rows.length })
      }

      return Response.json({ error: 'unknown op' }, { status: 400 })
    }

    return Response.json({ error: 'method not allowed' }, { status: 405 })
  } catch (e) {
    return Response.json({ error: String(e) }, { status: 500 })
  }
}

export default { fetch: handler }
