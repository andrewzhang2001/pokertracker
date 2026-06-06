// Legacy: decode old #h= links that were base64+compressed
async function readStream(readable: ReadableStream<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = []
  const reader = readable.getReader()
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    chunks.push(value)
  }
  const len = chunks.reduce((s, c) => s + c.length, 0)
  const out = new Uint8Array(len)
  let off = 0
  for (const c of chunks) { out.set(c, off); off += c.length }
  return out
}

export async function decodeLegacyShare(encoded: string): Promise<{ rawText: string; notes: string }> {
  const b64 = encoded.replace(/-/g, '+').replace(/_/g, '/')
  const bin = atob(b64)
  const bytes = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
  const ds = new DecompressionStream('deflate-raw')
  const writer = ds.writable.getWriter()
  writer.write(bytes)
  writer.close()
  const decompressed = await readStream(ds.readable)
  const payload = JSON.parse(new TextDecoder().decode(decompressed))
  return { rawText: payload.h as string, notes: (payload.n as string) ?? '' }
}

// New: server-side short links via /api/share
export async function createShareLink(rawText: string, notes: string): Promise<string> {
  const res = await fetch('/api/share', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ rawText, notes }),
  })
  if (!res.ok) throw new Error('Failed to create share link')
  const { id } = await res.json() as { id: string }
  return `${window.location.origin}${window.location.pathname}#id=${id}`
}

export async function loadShareById(id: string): Promise<{ rawText: string; notes: string }> {
  const res = await fetch(`/api/share?id=${encodeURIComponent(id)}`)
  if (!res.ok) throw new Error('Share link not found or expired')
  return res.json() as Promise<{ rawText: string; notes: string }>
}
