import { describe, test, expect, beforeEach, afterEach, vi } from 'vitest'
import { fetchHandsFromDb } from '../handsApi'

// handsApi reaches for the Clerk session on window; in the test env there is no
// DOM, so a bare stub is enough to make authHeaders resolve to no headers.
;(globalThis as { window?: unknown }).window = {}

const CHUNK_SIZE = 500 // must match handsApi's chunk size

// A stored row as the API returns it for the aggregate feed: `parsed` (minus
// rawText) plus the raw_text column, no notes.
function row(id: string) {
  return { parsed: { handId: id } as never, raw_text: `raw ${id}` }
}

interface FakeServer {
  requests: { view: string | null; chunk: number; offset: number }[]
}

// Serves `ids` in chunks the way /api/hands does, reporting `total` on the
// first chunk only. `overrides` can bend a single response to simulate the
// sample shifting under a parallel load; `delay` controls how long each offset
// takes, so chunks can be made to arrive out of order.
function fakeServer(
  ids: string[],
  overrides: (offset: number, slice: string[]) => string[] = (_, slice) => slice,
  delay: (offset: number) => number = () => 0,
): FakeServer {
  const server: FakeServer = { requests: [] }
  vi.stubGlobal('fetch', async (url: string) => {
    const params = new URL(url, 'http://localhost').searchParams
    const chunk = Number(params.get('chunk'))
    const offset = Number(params.get('offset'))
    server.requests.push({ view: params.get('view'), chunk, offset })
    await new Promise(r => setTimeout(r, delay(offset)))
    const slice = overrides(offset, ids.slice(offset, offset + chunk))
    return {
      ok: true,
      json: async () => ({ hands: slice.map(row), total: offset === 0 ? ids.length : undefined }),
    }
  })
  return server
}

const ids = (n: number, prefix = 'h') => Array.from({ length: n }, (_, i) => `${prefix}${i}`)

describe('fetchHandsFromDb – chunked aggregate feed', () => {
  beforeEach(() => vi.unstubAllGlobals())
  afterEach(() => vi.unstubAllGlobals())

  test('a sample smaller than one chunk takes a single request', async () => {
    const server = fakeServer(ids(10))
    const hands = await fetchHandsFromDb()
    expect(hands.map(h => h.handId)).toEqual(ids(10))
    expect(server.requests).toHaveLength(1)
    expect(server.requests[0]).toMatchObject({ view: null, offset: 0 })
  })

  test('pulls every chunk and keeps the server order', async () => {
    const all = ids(CHUNK_SIZE * 3 + 7)
    // Later chunks land first — the assembled sample must still read
    // newest-first, since the reports show hands in the order they arrive in.
    const server = fakeServer(all, (_, slice) => slice, offset => 20 - offset / CHUNK_SIZE * 5)
    const hands = await fetchHandsFromDb()
    expect(hands.map(h => h.handId)).toEqual(all)
    // One request per chunk, no gaps and nothing fetched twice.
    expect(server.requests.map(r => r.offset).sort((a, b) => a - b))
      .toEqual([0, CHUNK_SIZE, CHUNK_SIZE * 2, CHUNK_SIZE * 3])
  })

  test('rawText is rebuilt from the raw_text column', async () => {
    fakeServer(ids(3))
    const hands = await fetchHandsFromDb()
    expect(hands.map(h => h.rawText)).toEqual(['raw h0', 'raw h1', 'raw h2'])
  })

  test('view=mine asks for your hands only', async () => {
    const server = fakeServer(ids(5))
    await fetchHandsFromDb(true)
    expect(server.requests[0].view).toBe('mine')
  })

  test('reports progress against the total from the first chunk', async () => {
    fakeServer(ids(CHUNK_SIZE * 2))
    const seen: [number, number][] = []
    await fetchHandsFromDb(false, (loaded, total) => seen.push([loaded, total]))
    expect(seen[0]).toEqual([CHUNK_SIZE, CHUNK_SIZE * 2])
    expect(seen[seen.length - 1]).toEqual([CHUNK_SIZE * 2, CHUNK_SIZE * 2])
  })

  test('a hand straddling two chunks is only counted once', async () => {
    const all = ids(CHUNK_SIZE * 2)
    // A hand exported mid-load shifts the window, so the last hand of chunk 1
    // reappears at the top of chunk 2 — reports must not double-count it.
    const server = fakeServer(all, (offset, slice) =>
      offset === CHUNK_SIZE ? [all[CHUNK_SIZE - 1], ...slice.slice(0, -1)] : slice)
    const hands = await fetchHandsFromDb()
    expect(server.requests).toHaveLength(2)
    expect(hands.map(h => h.handId)).toEqual(all.slice(0, CHUNK_SIZE * 2 - 1))
    expect(new Set(hands.map(h => h.handId)).size).toBe(hands.length)
  })

  test('an empty database yields no hands and one request', async () => {
    const server = fakeServer([])
    expect(await fetchHandsFromDb()).toEqual([])
    expect(server.requests).toHaveLength(1)
  })

  test('surfaces the API error message', async () => {
    vi.stubGlobal('fetch', async () => ({
      ok: false,
      json: async () => ({ error: 'Unauthorized' }),
    }))
    await expect(fetchHandsFromDb()).rejects.toThrow('Unauthorized')
  })
})
