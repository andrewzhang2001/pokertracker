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

export async function encodeShare(rawText: string, notes: string): Promise<string> {
  const payload = JSON.stringify({ h: rawText, n: notes })
  const bytes = new TextEncoder().encode(payload)
  const cs = new CompressionStream('deflate-raw')
  const writer = cs.writable.getWriter()
  writer.write(bytes)
  writer.close()
  const compressed = await readStream(cs.readable)
  let bin = ''
  for (let i = 0; i < compressed.length; i++) bin += String.fromCharCode(compressed[i])
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '')
}

export async function decodeShare(encoded: string): Promise<{ rawText: string; notes: string }> {
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
