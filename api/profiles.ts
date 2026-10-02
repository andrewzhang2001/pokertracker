import { neon } from '@neondatabase/serverless'
import { verifyToken } from '@clerk/backend'
import { ensureProfilesSchema } from '../db/schema/index.js'

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
// to owner_id. See db/schema/profiles.ts + db/schema/hand-players.ts for the tables.

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

// Where an identity is being sent: an existing named profile, a new named
// profile, or its own anonymous profile (named by the identity itself).
type Target = { id: number } | { newName: string } | { anonymous: true }

// Get-or-create the anonymous profile for one raw identity.
async function anonymousProfileFor(ownerId: string, rawName: string): Promise<number> {
  const [existing] = await sql`SELECT id FROM profiles WHERE owner_id = ${ownerId} AND name = ${rawName} AND anonymous = true`
  if (existing) return Number(existing.id)
  const [p] = await sql`INSERT INTO profiles (owner_id, name, anonymous) VALUES (${ownerId}, ${rawName}, true) RETURNING id`
  return Number(p.id)
}

// Resolve a Target to a profile id, or null when it names a profile that isn't
// this owner's or is anonymous (anonymous profiles are never a destination).
async function resolveTarget(ownerId: string, target: Target, rawName: string): Promise<number | null> {
  if ('anonymous' in target) return anonymousProfileFor(ownerId, rawName)
  if ('newName' in target) {
    const name = target.newName.trim()
    if (!name) return null
    const [p] = await sql`INSERT INTO profiles (owner_id, name) VALUES (${ownerId}, ${name}) RETURNING id`
    return Number(p.id)
  }
  const [p] = await sql`SELECT id FROM profiles WHERE id = ${target.id} AND owner_id = ${ownerId} AND anonymous = false`
  return p ? Number(p.id) : null
}

// An anonymous profile exists only to hold its one identity; once that identity
// moves away, the profile goes too.
async function dropEmptyAnonymous(ownerId: string) {
  await sql`
    DELETE FROM profiles p
    WHERE p.owner_id = ${ownerId} AND p.anonymous = true
      AND NOT EXISTS (SELECT 1 FROM hand_players hp WHERE hp.profile_id = p.id)
  `
}

// Case-insensitive name clash with another of this owner's profiles.
async function sameNamed(ownerId: string, name: string, exceptId = 0) {
  return sql`SELECT id, name FROM profiles WHERE owner_id = ${ownerId} AND lower(name) = lower(${name}) AND id <> ${exceptId}`
}

async function handler(req: Request): Promise<Response> {
  if (!connectionString) return Response.json({ error: 'Database not configured' }, { status: 500 })
  const ownerId = await userIdFrom(req)
  if (!ownerId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  try {
    await ensureProfilesSchema(sql)
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
      // One profile's PokerNow identities with a hand count each. raw_name is
      // NULL for older seats whose identity couldn't be recovered.
      if (params.get('view') === 'identities') {
        const id = Number(params.get('id'))
        if (!id) return Response.json({ identities: [] })
        const rows = await sql`
          SELECT raw_name, count(*)::int AS hands
          FROM hand_players
          WHERE owner_id = ${ownerId} AND profile_id = ${id}
          GROUP BY raw_name
          ORDER BY count(*) DESC
        `
        return Response.json({ identities: rows })
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
          const dup = await sameNamed(ownerId, name)
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

      // Rename a profile. Naming an anonymous profile makes it a named one.
      // Unless force=true, a case-insensitive clash with another profile returns
      // { duplicate: [...] } without renaming.
      if (op === 'rename') {
        const id = Number(body.id), name = String(body.name ?? '').trim(), force = !!body.force
        if (!id || !name) return Response.json({ error: 'id and name required' }, { status: 400 })
        if (!force) {
          const dup = await sameNamed(ownerId, name, id)
          if (dup.length) return Response.json({ duplicate: dup })
        }
        await sql`UPDATE profiles SET name = ${name}, anonymous = false WHERE id = ${id} AND owner_id = ${ownerId}`
        return Response.json({ ok: true })
      }

      // Move one identity — every seat stamped with that raw_name — to another
      // profile. How a mis-assignment is undone and how merges are split apart.
      if (op === 'move') {
        const rawName = String(body.rawName ?? ''), target = body.target as Target | undefined
        if (!rawName || !target) return Response.json({ error: 'rawName and target required' }, { status: 400 })
        const [known] = await sql`SELECT 1 FROM hand_players WHERE owner_id = ${ownerId} AND raw_name = ${rawName} LIMIT 1`
        if (!known) return Response.json({ error: 'not found' }, { status: 404 })
        const into = await resolveTarget(ownerId, target, rawName)
        if (!into) return Response.json({ error: 'target must be a named profile' }, { status: 400 })
        await sql`UPDATE hand_players SET profile_id = ${into} WHERE owner_id = ${ownerId} AND raw_name = ${rawName}`
        await dropEmptyAnonymous(ownerId)
        return Response.json({ ok: true, profileId: into })
      }

      // The profile each identity currently belongs to, for preselecting the
      // import map step. byToken lists the named profiles holding any identity
      // with the same PokerNow token (the part after " @ "), most seats first.
      if (op === 'lookup') {
        const rawNames = ((body.rawNames as string[] | undefined) ?? []).map(String)
        const tokens = ((body.tokens as string[] | undefined) ?? []).map(String).filter(Boolean)
        const known = rawNames.length ? await sql`
          SELECT DISTINCT hp.raw_name, hp.profile_id, p.anonymous
          FROM hand_players hp JOIN profiles p ON p.id = hp.profile_id
          WHERE hp.owner_id = ${ownerId} AND hp.raw_name = ANY(${rawNames}::text[])
        ` : []
        const byToken = tokens.length ? await sql`
          SELECT t.token, hp.profile_id, count(*)::int AS seats
          FROM hand_players hp
          JOIN profiles p ON p.id = hp.profile_id
          CROSS JOIN LATERAL (SELECT substring(hp.raw_name from ' @ ([^ ]+)$') AS token) t
          WHERE hp.owner_id = ${ownerId} AND NOT p.anonymous AND t.token = ANY(${tokens}::text[])
          GROUP BY t.token, hp.profile_id
          ORDER BY seats DESC
        ` : []
        return Response.json({ known, byToken })
      }

      if (op === 'delete') {
        const id = Number(body.id)
        if (!id) return Response.json({ error: 'id required' }, { status: 400 })
        // The self profile is protected — it's recreated anyway, and deleting it
        // would orphan your seat links.
        await sql`DELETE FROM profiles WHERE id = ${id} AND owner_id = ${ownerId} AND is_hero = false`
        return Response.json({ ok: true })
      }

      // Merge one profile into another: reassign all its seat links (so all its
      // identities), then delete it. Each identity can be moved back out later.
      if (op === 'merge') {
        const from = Number(body.from), into = Number(body.into)
        if (!from || !into || from === into) return Response.json({ error: 'from and into required' }, { status: 400 })
        const [source] = await sql`SELECT id FROM profiles WHERE id = ${from} AND owner_id = ${ownerId} AND is_hero = false`
        const [dest] = await sql`SELECT id FROM profiles WHERE id = ${into} AND owner_id = ${ownerId} AND anonymous = false`
        if (!source || !dest) return Response.json({ error: 'not found' }, { status: 404 })
        await sql`UPDATE hand_players SET profile_id = ${into} WHERE owner_id = ${ownerId} AND profile_id = ${from}`
        await sql`DELETE FROM profiles WHERE id = ${from} AND owner_id = ${ownerId}`
        return Response.json({ ok: true })
      }

      // Commit an import's mapping — the single write behind the map step. For
      // each raw identity, resolve a profile id: an explicit assignment (existing
      // named profile or a new named one), else get-or-create an anonymous profile
      // named by the identity itself. Then stamp the per-seat links, and move the
      // identity's seats from earlier imports along with it so each identity stays
      // on one profile. Idempotent on re-import (hand_players is keyed on
      // owner+hand+seat).
      if (op === 'commit') {
        const assignments = (body.assignments as { rawName: string; existingId?: number; newName?: string; isHero?: boolean }[] | undefined) ?? []
        const seats = (body.seats as { handId: string; seat: number; rawName: string; isHero?: boolean; netBb?: number }[] | undefined) ?? []
        const named = new Set((await sql`SELECT id FROM profiles WHERE owner_id = ${ownerId} AND anonymous = false` as { id: number }[]).map(r => Number(r.id)))

        // rawName → resolved profile id.
        const byRaw = new Map<string, number>()
        const assigned = new Map(assignments.map(a => [a.rawName, a]))
        for (const raw of new Set(seats.map(s => s.rawName))) {
          const a = assigned.get(raw)
          if (a?.existingId && named.has(Number(a.existingId))) { byRaw.set(raw, Number(a.existingId)); continue }
          if (a?.newName?.trim()) {
            if (a.isHero) await sql`UPDATE profiles SET is_hero = false WHERE owner_id = ${ownerId} AND is_hero = true`
            const [p] = await sql`INSERT INTO profiles (owner_id, name, is_hero) VALUES (${ownerId}, ${a.newName.trim()}, ${!!a.isHero}) RETURNING id`
            byRaw.set(raw, Number(p.id)); continue
          }
          // Unassigned → anonymous profile named by the identity (keyed on the
          // full "name @ token" so two same-named players stay apart).
          byRaw.set(raw, await anonymousProfileFor(ownerId, raw))
        }

        const rows = seats
          .map(s => ({ hand_id: s.handId, seat: s.seat, raw_name: s.rawName, profile_id: byRaw.get(s.rawName), is_hero: !!s.isHero, net_bb: s.netBb ?? null }))
          .filter((r): r is { hand_id: string; seat: number; raw_name: string; profile_id: number; is_hero: boolean; net_bb: number | null } => r.profile_id !== undefined)
        if (rows.length) {
          await sql`
            INSERT INTO hand_players (owner_id, hand_id, seat, raw_name, profile_id, is_hero, net_bb)
            SELECT ${ownerId}, x.hand_id, x.seat, x.raw_name, x.profile_id, x.is_hero, x.net_bb
            FROM jsonb_to_recordset(${JSON.stringify(rows)}::jsonb)
              AS x(hand_id text, seat int, raw_name text, profile_id bigint, is_hero boolean, net_bb numeric)
            ON CONFLICT (owner_id, hand_id, seat) DO UPDATE SET raw_name = EXCLUDED.raw_name, profile_id = EXCLUDED.profile_id, is_hero = EXCLUDED.is_hero, net_bb = EXCLUDED.net_bb
          `
          const moves = [...byRaw].map(([raw_name, profile_id]) => ({ raw_name, profile_id }))
          await sql`
            UPDATE hand_players hp SET profile_id = x.profile_id
            FROM jsonb_to_recordset(${JSON.stringify(moves)}::jsonb) AS x(raw_name text, profile_id bigint)
            WHERE hp.owner_id = ${ownerId} AND hp.raw_name = x.raw_name AND hp.profile_id <> x.profile_id
          `
          await dropEmptyAnonymous(ownerId)
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
