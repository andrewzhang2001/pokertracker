import { authHeaders } from './auth'

// Thin client for /api/notes — persistent per-account study notes keyed by a
// semantic anchor (see noteAnchor.ts). Same auth bridge as handsApi.

export interface Note {
  body: string
  updatedAt: string | null
}

// Every anchor the signed-in user has a note for — for menu "has a note" dots.
export async function fetchNoteAnchors(): Promise<Set<string>> {
  const res = await fetch('/api/notes?list', { headers: await authHeaders() })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load notes')
  const data = await res.json() as { anchors?: string[] }
  return new Set(data.anchors ?? [])
}

export async function fetchNote(anchor: string): Promise<Note> {
  const res = await fetch(`/api/notes?anchor=${encodeURIComponent(anchor)}`, { headers: await authHeaders() })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to load note')
  const data = await res.json() as { body?: string; updated_at?: string | null }
  return { body: data.body ?? '', updatedAt: data.updated_at ?? null }
}

// Upsert (empty body deletes server-side). Returns the persisted note.
export async function saveNote(anchor: string, body: string): Promise<Note> {
  const res = await fetch('/api/notes', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', ...(await authHeaders()) },
    body: JSON.stringify({ anchor, body }),
  })
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error ?? 'Failed to save note')
  const data = await res.json() as { body?: string; updated_at?: string | null }
  return { body: data.body ?? '', updatedAt: data.updated_at ?? null }
}
