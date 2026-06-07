import { Redis } from '@upstash/redis'

export const config = { runtime: 'edge' }

const redis = new Redis({
  url: process.env.KV_REST_API_URL!,
  token: process.env.KV_REST_API_TOKEN!,
})

function randomId(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789'
  let id = ''
  for (let i = 0; i < 8; i++) id += chars[Math.floor(Math.random() * chars.length)]
  return id
}

type Payload = { rawText: string; handNotes: string[] }

export default async function handler(req: Request): Promise<Response> {
  if (req.method === 'POST') {
    const body = await req.json() as { rawText: string; handNotes?: string[]; notes?: string }
    const handNotes = body.handNotes ?? (body.notes ? [body.notes] : [''])
    const id = randomId()
    await redis.set(id, { rawText: body.rawText, handNotes }, { ex: 7_776_000 })
    return Response.json({ id })
  }

  if (req.method === 'GET') {
    const id = new URL(req.url).searchParams.get('id')
    if (!id) return Response.json({ error: 'missing id' }, { status: 400 })
    const data = await redis.get<Payload & { notes?: string }>(id)
    if (!data) return Response.json({ error: 'not found' }, { status: 404 })
    const handNotes = data.handNotes ?? (data.notes ? [data.notes] : [''])
    return Response.json({ rawText: data.rawText, handNotes })
  }

  return Response.json({ error: 'method not allowed' }, { status: 405 })
}
